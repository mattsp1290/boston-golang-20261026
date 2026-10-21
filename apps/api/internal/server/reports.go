package server

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	wmsql "github.com/ThreeDotsLabs/watermill-sql/v4/pkg/sql"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/ThreeDotsLabs/watermill/message/router/middleware"
	"github.com/ThreeDotsLabs/watermill/pubsub/gochannel"
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
)

const reportTopic = "reports"
const maxReportRuns = 16

var reportRunIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type reportEvent struct {
	Sequence int       `json:"sequence"`
	Kind     string    `json:"kind"`
	Detail   string    `json:"detail"`
	At       time.Time `json:"at"`
}
type reportView struct {
	ID        string        `json:"id"`
	Mode      string        `json:"mode"`
	Status    string        `json:"status"`
	Attempts  int           `json:"attempts"`
	MessageID string        `json:"messageId"`
	Events    []reportEvent `json:"events"`
	CSV       string        `json:"csv,omitempty"`
	Error     string        `json:"error,omitempty"`
}
type reportRun struct {
	mu     sync.Mutex
	view   reportView
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	expiry *time.Timer
	delay  time.Duration

	// Only failed PostgreSQL cleanup is retained, bounded by maxReportRuns.
	// Never include the closure (which captures its DSN) in the public view.
	cleanupMu  sync.Mutex
	cleanup    func() error
	cleanupErr error
}

func (r *reportRun) snapshot() reportView {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := r.view
	v.Events = append([]reportEvent{}, v.Events...)
	return v
}
func (r *reportRun) event(kind, detail string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.view.Events = append(r.view.Events, reportEvent{len(r.view.Events) + 1, kind, detail, time.Now().UTC()})
}
func (r *reportRun) pause() error {
	timer := time.NewTimer(r.delay)
	defer timer.Stop()
	select {
	case <-r.ctx.Done():
		return r.ctx.Err()
	case <-timer.C:
		return nil
	}
}
func (r *reportRun) process(msg *message.Message) error {
	r.mu.Lock()
	r.view.Attempts++
	attempt := r.view.Attempts
	r.view.Status = "Processing"
	r.mu.Unlock()
	r.event("attempt", fmt.Sprintf("Application handler invoked for %s · attempt %d", msg.UUID, attempt))
	if err := r.pause(); err != nil {
		return err
	}
	// demo:handler:start
	if r.view.Mode == "retry" && attempt <= 2 {
		r.event("retry", "Temporary report error: handler returns error")
		return errors.New("temporary report error")
	}
	// A deterministic report replaces this run's result; no external side effects.
	var output strings.Builder
	writer := csv.NewWriter(&output)
	if err := writer.WriteAll([][]string{{"team", "tickets_closed"}, {"alpha", "12"}, {"beta", "8"}}); err != nil {
		return err
	}
	r.mu.Lock()
	r.view.CSV = output.String()
	r.mu.Unlock()
	return nil // Router acknowledges only after a successful return.
	// demo:handler:end
}
func (r *reportRun) publish(pub message.Publisher) error {
	// demo:publish:start
	msg := message.NewMessage(r.view.MessageID, []byte(`{"report":"weekly-summary"}`))
	msg.SetContext(r.ctx)
	if err := pub.Publish(r.topic(), msg); err != nil {
		return err
	}
	// demo:publish:end
	r.event("published", "Report request published · "+msg.UUID)
	return nil
}
func (r *reportRun) routed(sub message.Subscriber, publish func() error) error {
	if err := r.ctx.Err(); err != nil {
		return err
	}
	router, err := message.NewRouter(message.RouterConfig{CloseTimeout: 3 * time.Second}, watermill.NopLogger{})
	if err != nil {
		return err
	}
	done := make(chan struct{}, 1)
	// demo:router:start
	handler := router.AddConsumerHandler("generate-report", r.topic(), sub,
		func(msg *message.Message) error {
			if err := r.process(msg); err != nil {
				return err
			}
			select {
			case done <- struct{}{}:
			default:
			}
			return nil
		})
	// demo:router:end
	if r.view.Mode == "retry" {
		// demo:retry:start
		handler.AddMiddleware(middleware.Retry{
			MaxRetries: 2, InitialInterval: r.delay,
			MaxInterval: r.delay, Multiplier: 1,
			RandomizationFactor: 0,
		}.Middleware)
		// demo:retry:end
	}
	exited := make(chan error, 1)
	go func() { exited <- router.Run(r.ctx); close(exited) }()
	defer func() { _ = router.Close(); <-exited }()
	select {
	case <-router.Running():
	case err := <-exited:
		if err != nil {
			return err
		}
		return errors.New("router stopped before starting")
	}
	if err := r.ctx.Err(); err != nil {
		return err
	}
	r.event("worker-online", "Router subscriber is running")
	if publish != nil {
		if err := publish(); err != nil {
			return err
		}
	}
	select {
	case <-done:
		return nil
	case <-r.ctx.Done():
		return r.ctx.Err()
	}
}

// Every durable run owns two generated tables, never a shared offsets table.
// Names are well below PostgreSQL's 63-byte limit. Request input cannot choose them.
type reportPostgresTableNames struct{ topic, messages, offsets string }

func reportPostgresTables(runID string) (reportPostgresTableNames, error) {
	if !reportRunIDPattern.MatchString(runID) {
		return reportPostgresTableNames{}, errors.New("invalid generated report run ID")
	}
	suffix := strings.ReplaceAll(runID, "-", "")
	return reportPostgresTableNames{
		topic: "report_demo_" + suffix, messages: "watermill_messages_" + suffix,
		offsets: "watermill_offsets_" + suffix,
	}, nil
}
func (n reportPostgresTableNames) messagesTable(string) string {
	return pgx.Identifier{"public", n.messages}.Sanitize()
}
func (n reportPostgresTableNames) offsetsTable(string) string {
	return pgx.Identifier{"public", n.offsets}.Sanitize()
}
func (r *reportRun) topic() string {
	if r.view.Mode == "durable" {
		// durable validates the server-generated ID before constructing adapters.
		names, _ := reportPostgresTables(r.view.ID)
		return names.topic
	}
	return reportTopic
}

// Never include driver errors in API snapshots: they can contain credentials,
// hostnames, or DSN text. Give the presenter an actionable, bounded diagnosis.
func reportPostgresError(ctx context.Context, action string, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "28P01", "28000":
			return fmt.Errorf("PostgreSQL %s failed: check the credentials in REPORT_POSTGRES_DSN", action)
		case "42501":
			return fmt.Errorf("PostgreSQL %s failed: the demo role needs CREATE in public and access to its own tables", action)
		case "3D000":
			return fmt.Errorf("PostgreSQL %s failed: create the demo database named in REPORT_POSTGRES_DSN", action)
		}
	}
	return fmt.Errorf("PostgreSQL %s failed: check REPORT_POSTGRES_DSN, server availability, and demo database permissions", action)
}

func openReportDB(ctx context.Context, dsn string) (*sql.DB, error) {
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, errors.New("invalid REPORT_POSTGRES_DSN: use a PostgreSQL connection URI or keyword connection string")
	}
	config.ConnectTimeout = 3 * time.Second
	config.RuntimeParams["statement_timeout"] = "3000"
	config.RuntimeParams["lock_timeout"] = "1000"
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, reportPostgresError(ctx, "connection", err)
	}
	return db, nil
}

// Use the official adapters' DDL, but run it with our cancellable context.
// Their automatic initialization uses an independent 60-second context.
func initializeReportTables(ctx context.Context, db *sql.DB, names reportPostgresTableNames,
	schema wmsql.DefaultPostgreSQLSchema, offsets wmsql.DefaultPostgreSQLOffsetsAdapter,
) (owned bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	// Hold the adapter's same initialization lock before checking ownership.
	// A second initializer must not adopt tables created after its preflight.
	lock := wmsql.DefaultSchemaInitializationLock("watermill")
	if schema.InitializeSchemaLock > 0 {
		lock = schema.InitializeSchemaLock
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", lock); err != nil {
		return false, err
	}
	var exists bool
	err = tx.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL OR to_regclass($2) IS NOT NULL",
		names.messagesTable(""), names.offsetsTable("")).Scan(&exists)
	if err != nil || exists {
		if err == nil {
			err = errors.New("generated report table already exists; refusing to reuse or remove it")
		}
		return false, err
	}
	queries, err := schema.SchemaInitializingQueries(wmsql.SchemaInitializingQueriesParams{Topic: names.topic})
	if err != nil {
		return false, err
	}
	offsetQueries, err := offsets.SchemaInitializingQueries(wmsql.OffsetsSchemaInitializingQueriesParams{Topic: names.topic})
	if err != nil {
		return false, err
	}
	for _, query := range append(queries, offsetQueries...) {
		if _, err := tx.ExecContext(ctx, query.Query, query.Args...); err != nil {
			return true, err
		}
	}
	// Cleanup also runs after an uncertain commit, but only for these new names.
	return true, tx.Commit()
}

func cleanupReportTables(dsn, runID string) error {
	names, err := reportPostgresTables(runID)
	if err != nil {
		return err // Validate again before constructing any DROP statement.
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel() // Cleanup must still work after navigation cancels the run.
	db, err := openReportDB(ctx, dsn)
	if err != nil {
		return errors.New("PostgreSQL cleanup could not connect: check REPORT_POSTGRES_DSN; this run's isolated tables may remain")
	}
	defer db.Close()
	// No database/schema deletion, wildcard lookup, shared table, or CASCADE.
	_, err = db.ExecContext(ctx, "DROP TABLE IF EXISTS "+names.offsetsTable("")+", "+names.messagesTable(""))
	if err != nil {
		return errors.New("PostgreSQL cleanup failed: this run's isolated tables may remain; check demo database permissions and availability")
	}
	return nil
}

func (r *reportRun) durable() (result error) {
	dsn := strings.TrimSpace(os.Getenv("REPORT_POSTGRES_DSN"))
	if dsn == "" {
		return errors.New("PostgreSQL demo is not configured: set REPORT_POSTGRES_DSN in the root .env and restart the API; GoChannel demos do not need a database")
	}
	names, err := reportPostgresTables(r.view.ID)
	if err != nil {
		return err
	}
	db, err := openReportDB(r.ctx, dsn)
	if err != nil {
		return err
	}
	var pub *wmsql.Publisher
	var sub *wmsql.Subscriber
	owned := false
	defer func() {
		// routed has already joined Router.Run. Close the subscriber before its
		// pool, and every worker/publisher pool before deleting any table.
		if sub != nil {
			result = errors.Join(result, sub.Close())
		}
		if pub != nil {
			result = errors.Join(result, pub.Close())
		}
		if db != nil {
			if err := db.Close(); err != nil {
				result = errors.Join(result, errors.New("PostgreSQL connection pool could not close"))
			}
		}
		if owned {
			cleanup := func() error { return cleanupReportTables(dsn, r.view.ID) }
			if err := cleanup(); err != nil {
				r.cleanupMu.Lock()
				r.cleanup, r.cleanupErr = cleanup, err
				r.cleanupMu.Unlock()
				result = errors.Join(result, err)
			} else {
				r.event("cleaned-up", "Worker connections closed; only this run's PostgreSQL message and offset tables removed.")
			}
		}
	}()

	schema := wmsql.DefaultPostgreSQLSchema{GenerateMessagesTableName: names.messagesTable, SubscribeBatchSize: 1}
	offsets := wmsql.DefaultPostgreSQLOffsetsAdapter{GenerateMessagesOffsetsTableName: names.offsetsTable}
	owned, err = initializeReportTables(r.ctx, db, names, schema, offsets)
	if err != nil {
		return reportPostgresError(r.ctx, "table setup", err)
	}
	// demo:postgres-publisher:start
	// Tables were initialized with bounded, cancellable setup above.
	pub, err = wmsql.NewPublisher(wmsql.BeginnerFromStdSQL(db), wmsql.PublisherConfig{
		SchemaAdapter:        schema, // DefaultPostgreSQLSchema
		AutoInitializeSchema: false,
	}, watermill.NopLogger{})
	// demo:postgres-publisher:end
	if err != nil {
		return reportPostgresError(r.ctx, "publisher setup", err)
	}
	r.event("worker-offline", "No subscriber exists. Publish into a real PostgreSQL message table.")
	if err := r.pause(); err != nil {
		return err
	}
	if err := r.publish(pub); err != nil {
		return reportPostgresError(r.ctx, "publish", err)
	}
	// demo:durable:start
	if err := pub.Close(); err != nil {
		return reportPostgresError(r.ctx, "publisher close", err)
	}
	pub = nil
	if err := db.Close(); err != nil {
		return reportPostgresError(r.ctx, "connection close", err)
	}
	db = nil
	r.event("db-closed", "All connections owned by this run are closed. PostgreSQL is still running; no subscriber exists.")
	for range 3 {
		if err := r.pause(); err != nil {
			return err
		}
	}
	db, err = openReportDB(r.ctx, dsn) // Same PostgreSQL database, new pool.
	if err != nil {
		return err
	}
	// demo:durable:end
	// demo:postgres-subscriber:start
	sub, err = wmsql.NewSubscriber(wmsql.BeginnerFromStdSQL(db), wmsql.SubscriberConfig{
		SchemaAdapter:  schema,  // DefaultPostgreSQLSchema
		OffsetsAdapter: offsets, // DefaultPostgreSQLOffsetsAdapter
		ConsumerGroup:  "report-worker", InitializeSchema: false,
		PollInterval: 50 * time.Millisecond,
	}, watermill.NopLogger{})
	// demo:postgres-subscriber:end
	if err != nil {
		return reportPostgresError(r.ctx, "subscriber setup", err)
	}
	r.event("db-reopened", "New PostgreSQL connections opened. Start the subscriber and Router; do not republish.")
	// demo:durable-consume:start
	if err := r.routed(sub, nil); err != nil {
		return reportPostgresError(r.ctx, "consume", err)
	}
	// demo:durable-consume:end
	return nil
}

// publication observes a buffered delivery without invoking application code.
// The subscriber exists before Publish because GoChannel is live-only.
func (r *reportRun) publication(bus *gochannel.GoChannel) error {
	incoming, err := bus.Subscribe(r.ctx, reportTopic)
	if err != nil {
		return err
	}
	r.event("subscriber-listening", "A live GoChannel subscriber is listening; no handler is attached.")
	if err := r.publish(bus); err != nil {
		return err
	}
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		if len(incoming) > 0 {
			r.event("available", "The message became available in the subscriber's buffered channel. No application handler ran.")
			return nil
		}
		select {
		case <-r.ctx.Done():
			return r.ctx.Err()
		case <-ticker.C:
		}
	}
}

// subscribed demonstrates one finite message; a long-lived worker would keep reading.
func (r *reportRun) subscribed(bus *gochannel.GoChannel) error {
	// demo:subscribe:start
	incoming, err := bus.Subscribe(r.ctx, reportTopic)
	if err != nil {
		return err
	}
	// Subscribe first: this GoChannel transport does not retain missed messages.
	if err := r.publish(bus); err != nil {
		return err
	}
	select {
	case <-r.ctx.Done():
		return r.ctx.Err()
	case msg, ok := <-incoming:
		if !ok {
			return errors.New("subscriber closed")
		}
		if err := r.process(msg); err != nil {
			msg.Nack()
			return err
		}
		msg.Ack()
		r.event("ack", "Application receive loop called Ack after successful work")
		return nil
	}
	// demo:subscribe:end
}
func (r *reportRun) execute() {
	defer close(r.done)
	defer r.cancel()
	var err error
	// A short cancellable teaching pause makes the accepted state observable.
	err = r.pause()
	if err != nil {
		// Cancellation is reported by the shared terminal-state path below.
	} else if r.view.Mode == "durable" {
		err = r.durable()
	} else {
		// demo:gochannel:start
		bus := gochannel.NewGoChannel(gochannel.Config{OutputChannelBuffer: 1}, watermill.NopLogger{})
		// demo:gochannel:end
		defer bus.Close()
		if r.view.Mode == "publish" {
			err = r.publication(bus)
		} else if r.view.Mode == "subscribe" {
			err = r.subscribed(bus)
		} else {
			err = r.routed(bus, func() error { return r.publish(bus) })
		}
	}
	r.mu.Lock()
	kind, detail := "ready", "Synthetic CSV is ready. Handler finished."
	if err != nil {
		r.view.Status = "Error"
		r.view.Error = err.Error()
		kind, detail = "error", err.Error()
	} else if r.view.Mode == "publish" {
		r.view.Status = "Published"
		kind, detail = "publication-complete", "Publication observed. No handler or report generation in this demonstration."
	} else {
		r.view.Status = "Ready"
	}
	r.view.Events = append(r.view.Events, reportEvent{len(r.view.Events) + 1, kind, detail, time.Now().UTC()})
	r.mu.Unlock()
}

type reportHub struct {
	closed bool
	mu     sync.Mutex
	runs   map[string]*reportRun
	delay  time.Duration
	ttl    time.Duration
}

func newReportHub() *reportHub {
	return &reportHub{runs: make(map[string]*reportRun), delay: 1200 * time.Millisecond, ttl: 90 * time.Second}
}
func (h *reportHub) start(mode string) (*reportRun, error) {
	if mode != "publish" && mode != "subscribe" && mode != "router" && mode != "retry" && mode != "durable" {
		return nil, fiber.NewError(400, "Unknown report demo mode")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, fiber.NewError(503, "Report service is shutting down")
	}
	if len(h.runs) >= maxReportRuns {
		return nil, fiber.NewError(503, "Demo capacity reached; leave other tabs, retry failed cleanup, or wait 90 seconds for completed runs")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	r := &reportRun{view: reportView{ID: watermill.NewUUID(), Mode: mode, Status: "Queued", MessageID: watermill.NewUUID(), Events: []reportEvent{}}, ctx: ctx, cancel: cancel, done: make(chan struct{}), delay: h.delay}
	r.event("queued", "Generate weekly summary using synthetic data")
	h.runs[r.view.ID] = r
	r.expiry = time.AfterFunc(h.ttl, func() { h.remove(r.view.ID) })
	go r.execute()
	return r, nil
}
func (h *reportHub) remove(id string) error {
	h.mu.Lock()
	r := h.runs[id]
	h.mu.Unlock()
	if r != nil {
		alreadyFinished := false
		select {
		case <-r.done:
			alreadyFinished = true
		default:
		}
		r.expiry.Stop()
		r.cancel()
		<-r.done
		r.cleanupMu.Lock()
		// Don't immediately repeat cleanup that just failed during cancellation.
		// A later DELETE may retry the same bounded, isolated cleanup operation.
		if alreadyFinished && r.cleanup != nil {
			r.cleanupErr = r.cleanup()
			if r.cleanupErr == nil {
				r.cleanup = nil // Release the captured DSN as soon as cleanup succeeds.
			}
		}
		cleanupErr := r.cleanupErr
		r.cleanupMu.Unlock()
		if cleanupErr != nil {
			return fiber.NewError(503, cleanupErr.Error())
		}
		h.mu.Lock()
		if h.runs[id] == r {
			delete(h.runs, id)
		}
		h.mu.Unlock()
	}
	return nil
}
func (h *reportHub) close() {
	h.mu.Lock()
	h.closed = true
	ids := make([]string, 0, len(h.runs))
	for id := range h.runs {
		ids = append(ids, id)
	}
	h.mu.Unlock()
	for _, id := range ids {
		h.remove(id)
	}
}
func (h *reportHub) routes(app *fiber.App) {
	app.Hooks().OnPreShutdown(func() error { h.close(); return nil })
	app.Post("/api/reports/runs", func(c fiber.Ctx) error {
		var input struct {
			Mode string `json:"mode"`
		}
		if err := c.Bind().JSON(&input); err != nil {
			return fiber.NewError(400, "Expected JSON with a demo mode")
		}
		r, err := h.start(input.Mode)
		if err != nil {
			return err
		}
		return c.Status(202).JSON(r.snapshot())
	})
	app.Get("/api/reports/runs/:id", func(c fiber.Ctx) error {
		h.mu.Lock()
		r := h.runs[c.Params("id")]
		h.mu.Unlock()
		if r == nil {
			return fiber.NewError(404, "Report run not found or expired")
		}
		return c.JSON(r.snapshot())
	})
	app.Delete("/api/reports/runs/:id", func(c fiber.Ctx) error {
		if err := h.remove(c.Params("id")); err != nil {
			return err
		}
		return c.SendStatus(204)
	})
}
