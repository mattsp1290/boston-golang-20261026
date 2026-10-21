package server

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill-sqlite/wmsqlitemodernc"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/ThreeDotsLabs/watermill/message/router/middleware"
	"github.com/ThreeDotsLabs/watermill/pubsub/gochannel"
	"github.com/gofiber/fiber/v3"
	_ "modernc.org/sqlite"
)

const reportTopic = "reports"
const maxReportRuns = 16

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
	if err := pub.Publish(reportTopic, msg); err != nil {
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
	handler := router.AddConsumerHandler("generate-report", reportTopic, sub,
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
func openReportDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err = db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
func (r *reportRun) durable() error {
	dir, err := os.MkdirTemp("", "watermill-report-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "queue.sqlite")
	db, err := openReportDB(path)
	if err != nil {
		return err
	}
	pub, err := wmsqlitemodernc.NewPublisher(db, wmsqlitemodernc.PublisherOptions{InitializeSchema: true})
	if err != nil {
		_ = db.Close()
		return err
	}
	r.event("worker-offline", "No subscriber exists. Publish into file-backed SQLite.")
	if err = r.pause(); err != nil {
		_ = pub.Close()
		_ = db.Close()
		return err
	}
	if err = r.publish(pub); err != nil {
		_ = pub.Close()
		_ = db.Close()
		return err
	}
	// demo:durable:start
	if err := pub.Close(); err != nil {
		_ = db.Close()
		return err
	}
	if err := db.Close(); err != nil {
		return err
	}
	r.event("db-closed", "All database connections closed. Request remains on disk.")
	for range 3 {
		if err := r.pause(); err != nil {
			return err
		}
	}
	db, err = openReportDB(path) // Same file, a completely new connection pool.
	if err != nil {
		return err
	}
	defer db.Close()
	sub, err := wmsqlitemodernc.NewSubscriber(db, wmsqlitemodernc.SubscriberOptions{
		InitializeSchema: true, PollInterval: 50 * time.Millisecond, BatchSize: 1,
	})
	if err != nil {
		return err
	}
	// demo:durable:end
	defer sub.Close()
	r.event("db-reopened", "New SQLite connections opened. Start the subscriber and Router; do not republish.")
	return r.routed(sub, nil)
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
		bus := gochannel.NewGoChannel(gochannel.Config{OutputChannelBuffer: 1}, watermill.NopLogger{})
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
		return nil, fiber.NewError(503, "Demo capacity reached; leave other demo tabs or wait 90 seconds")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	r := &reportRun{view: reportView{ID: watermill.NewUUID(), Mode: mode, Status: "Queued", MessageID: watermill.NewUUID(), Events: []reportEvent{}}, ctx: ctx, cancel: cancel, done: make(chan struct{}), delay: h.delay}
	r.event("queued", "Generate weekly summary using synthetic data")
	h.runs[r.view.ID] = r
	r.expiry = time.AfterFunc(h.ttl, func() { h.remove(r.view.ID) })
	go r.execute()
	return r, nil
}
func (h *reportHub) remove(id string) {
	h.mu.Lock()
	r := h.runs[id]
	h.mu.Unlock()
	if r != nil {
		r.expiry.Stop()
		r.cancel()
		<-r.done
		h.mu.Lock()
		if h.runs[id] == r {
			delete(h.runs, id)
		}
		h.mu.Unlock()
	}
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
	app.Delete("/api/reports/runs/:id", func(c fiber.Ctx) error { h.remove(c.Params("id")); return c.SendStatus(204) })
}
