package server

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/pubsub/gochannel"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func testReportHub(t *testing.T) *reportHub {
	t.Helper()
	h := newReportHub()
	h.delay = 5 * time.Millisecond
	t.Cleanup(h.close)
	return h
}

func awaitReport(t *testing.T, r *reportRun) reportView {
	t.Helper()
	select {
	case <-r.done:
	case <-time.After(8 * time.Second):
		t.Fatal("report did not stop within timeout")
	}
	return r.snapshot()
}

func TestReportsPublicationAndGenerationModes(t *testing.T) {
	for _, mode := range []string{"publish", "subscribe", "router", "retry", "durable"} {
		t.Run(mode, func(t *testing.T) {
			if mode == "durable" {
				requireReportPostgres(t)
			}
			h := testReportHub(t)
			r, err := h.start(mode)
			if err != nil {
				t.Fatal(err)
			}
			view := awaitReport(t, r)
			wantStatus := "Ready"
			if mode == "publish" {
				wantStatus = "Published"
			}
			if view.Status != wantStatus || view.Error != "" {
				t.Fatalf("status %s want %s: %+v", view.Status, wantStatus, view)
			}
			wantAttempts := 1
			if mode == "publish" {
				wantAttempts = 0
			}
			if mode == "retry" {
				wantAttempts = 3
			}
			if view.Attempts != wantAttempts {
				t.Fatalf("attempts %d want %d", view.Attempts, wantAttempts)
			}
			if mode == "publish" {
				if view.CSV != "" {
					t.Fatalf("publication unexpectedly generated CSV: %q", view.CSV)
				}
			} else {
				records, err := csv.NewReader(strings.NewReader(view.CSV)).ReadAll()
				if err != nil || len(records) != 3 || records[0][0] != "team" || records[2][1] != "8" {
					t.Fatalf("invalid generated CSV: %q, %v", view.CSV, err)
				}
			}
			counts := map[string]int{}
			positions := map[string]int{}
			for i, event := range view.Events {
				if event.Sequence != i+1 {
					t.Fatalf("event sequence %d at %d", event.Sequence, i)
				}
				counts[event.Kind]++
				positions[event.Kind] = i
				if event.Kind == "attempt" && !strings.Contains(event.Detail, view.MessageID) {
					t.Fatalf("worker consumed wrong message: %+v", event)
				}
			}
			wantReady := 1
			if mode == "publish" {
				wantReady = 0
			}
			if counts["published"] != 1 || counts["ready"] != wantReady || counts["attempt"] != wantAttempts {
				t.Fatalf("wrong event counts: %v", counts)
			}
			if mode == "publish" {
				if counts["available"] != 1 || counts["ack"] != 0 || counts["worker-online"] != 0 || counts["retry"] != 0 {
					t.Fatalf("publish-only ran business logic or failed to prove availability: %v", counts)
				}
				if positions["available"] <= positions["published"] {
					t.Fatalf("availability precedes publish: %+v", view.Events)
				}
			}
			if mode == "subscribe" && counts["ack"] != 1 {
				t.Fatal("direct subscriber did not acknowledge")
			}
			if mode != "publish" && mode != "subscribe" && counts["worker-online"] != 1 {
				t.Fatal("router never became ready")
			}
			if mode == "retry" && counts["retry"] != 2 {
				t.Fatalf("expected two actual handler errors: %v", counts)
			}
			if mode == "durable" {
				for _, kind := range []string{"worker-offline", "db-closed", "db-reopened"} {
					if counts[kind] != 1 {
						t.Fatalf("missing durability proof: %v", counts)
					}
				}
				ordered := []string{"worker-offline", "published", "db-closed", "db-reopened", "attempt", "ready"}
				for i := 1; i < len(ordered); i++ {
					if positions[ordered[i-1]] >= positions[ordered[i]] {
						t.Fatalf("invalid durability stage order: %+v", view.Events)
					}
				}
			}
		})
	}
}

func requireReportPostgres(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_REPORT_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TEST_REPORT_POSTGRES_DSN to a dedicated disposable PostgreSQL database for integration tests")
	}
	t.Setenv("REPORT_POSTGRES_DSN", dsn)
	return dsn
}

func TestReportsPostgresMissingConfiguration(t *testing.T) {
	t.Setenv("REPORT_POSTGRES_DSN", "")
	h := testReportHub(t)
	r, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	v := awaitReport(t, r)
	if v.Status != "Error" || !strings.Contains(v.Error, "REPORT_POSTGRES_DSN") || v.Attempts != 0 || v.CSV != "" {
		t.Fatalf("missing PostgreSQL configuration was not actionable: %+v", v)
	}
	for _, e := range v.Events {
		if e.Kind == "published" || e.Kind == "db-closed" {
			t.Fatalf("false persistence evidence: %+v", e)
		}
	}
	// Optional persistence setup must not prevent the in-memory demos from running.
	memory, err := h.start("router")
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitReport(t, memory); got.Status != "Ready" {
		t.Fatalf("memory demo requires PostgreSQL: %+v", got)
	}
}

func TestReportsDurableOfflinePauseHasNoAttempts(t *testing.T) {
	dsn := requireReportPostgres(t)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := testReportHub(t)
	h.delay = 150 * time.Millisecond
	r, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	observed := false
	for time.Now().Before(deadline) {
		v := r.snapshot()
		closed, reopened := false, false
		for _, e := range v.Events {
			closed = closed || e.Kind == "db-closed"
			reopened = reopened || e.Kind == "db-reopened"
		}
		if closed && !reopened {
			if v.Attempts != 0 || v.CSV != "" {
				t.Fatalf("handler ran while offline: %+v", v)
			}
			observed = true
			break
		}
		if v.Status == "Error" {
			t.Fatalf("PostgreSQL run failed: %+v", v)
		}
		time.Sleep(time.Millisecond)
	}
	if !observed {
		t.Fatal("never observed persisted message with original connections closed")
	}
	names, err := reportPostgresTables(r.view.ID)
	if err != nil {
		t.Fatal(err)
	}
	var storedID string
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT uuid FROM public."%s"`, names.messages)).Scan(&storedID); err != nil {
		t.Fatal(err)
	}
	if storedID != r.view.MessageID {
		t.Fatalf("persisted ID %q want %q", storedID, r.view.MessageID)
	}

	if got := awaitReport(t, r); got.Status != "Ready" {
		t.Fatalf("reopened PostgreSQL subscription did not deliver: %+v", got)
	}
	for _, name := range []string{names.messages, names.offsets} {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", "public."+name).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Fatalf("run left PostgreSQL table %s", name)
		}
	}
}

func TestReportsPostgresTableNamesAreIsolated(t *testing.T) {
	ids := []string{"a1234567-1234-1234-1234-123456789abc", "b1234567-1234-1234-1234-123456789abc"}
	used := map[string]bool{}
	for _, id := range ids {
		names, err := reportPostgresTables(id)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{names.topic, names.messages, names.offsets} {
			if len(name) > 63 || used[name] || strings.ContainsAny(name, "\"'; ") {
				t.Fatalf("unsafe or colliding identifier %q", name)
			}
			used[name] = true
		}
	}
	for _, id := range []string{"", "reports", `x"; DROP TABLE reports;--`, "A1234567-1234-1234-1234-123456789abc"} {
		if _, err := reportPostgresTables(id); err == nil {
			t.Fatalf("unsafe ID accepted: %q", id)
		}
	}
}

func TestReportsInvalidCapacityAndCancellation(t *testing.T) {
	h := testReportHub(t)
	if _, err := h.start("not-a-mode"); err == nil {
		t.Fatal("invalid mode accepted")
	}
	h.delay = time.Second
	runs := make([]*reportRun, 0, maxReportRuns)
	for i := 0; i < maxReportRuns; i++ {
		r, err := h.start("retry")
		if err != nil {
			t.Fatal(err)
		}
		runs = append(runs, r)
	}
	if _, err := h.start("publish"); err == nil {
		t.Fatal("capacity not bounded")
	}
	var wg sync.WaitGroup
	for _, r := range runs {
		wg.Add(1)
		go func(r *reportRun) { defer wg.Done(); h.remove(r.view.ID) }(r)
	}
	wg.Wait()
	for _, r := range runs {
		if v := awaitReport(t, r); v.Status != "Error" || v.CSV != "" {
			t.Fatalf("canceled run succeeded: %+v", v)
		}
	}
	h.mu.Lock()
	remaining := len(h.runs)
	h.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("retained %d canceled runs", remaining)
	}
	h.delay = time.Millisecond
	r, err := h.start("publish")
	if err != nil {
		t.Fatalf("capacity not recovered: %v", err)
	}
	if v := awaitReport(t, r); v.Status != "Published" {
		t.Fatalf("new publication run failed: %+v", v)
	}
}

func TestReportsExpiryAndIsolation(t *testing.T) {
	h := testReportHub(t)
	h.ttl = 50 * time.Millisecond
	h.delay = time.Second
	a, err := h.start("publish")
	if err != nil {
		t.Fatal(err)
	}
	b, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	if a.view.ID == b.view.ID || a.view.MessageID == b.view.MessageID {
		t.Fatal("runs share identifiers")
	}
	for _, r := range []*reportRun{a, b} {
		if v := awaitReport(t, r); v.Status != "Error" {
			t.Fatalf("expiry did not cancel: %+v", v)
		}
	}
	deadline := time.Now().Add(time.Second)
	for {
		h.mu.Lock()
		n := len(h.runs)
		h.mu.Unlock()
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expired runs retained: %d", n)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestReportRoutes(t *testing.T) {
	h := testReportHub(t)
	app := fiber.New()
	h.routes(app)
	defer app.Shutdown()
	request := func(method, path, body string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != want {
			t.Fatalf("%s %s: status %d want %d, %s", method, path, resp.StatusCode, want, data)
		}
		return data
	}
	request("POST", "/api/reports/runs", `{"mode":"unknown"}`, 400)
	request("POST", "/api/reports/runs", `{`, 400)
	request("GET", "/api/reports/runs/missing", "", 404)
	data := request("POST", "/api/reports/runs", `{"mode":"router"}`, 202)
	var created reportView
	if err := json.Unmarshal(data, &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.MessageID == "" {
		t.Fatalf("missing run identity: %s", data)
	}
	request("GET", "/api/reports/runs/"+created.ID, "", 200)
	request("DELETE", "/api/reports/runs/"+created.ID, "", 204)
	request("GET", "/api/reports/runs/"+created.ID, "", 404)
	request("DELETE", "/api/reports/runs/"+created.ID, "", 204)
}

func TestReportsImmediateCancellationAllModes(t *testing.T) {
	for _, mode := range []string{"publish", "subscribe", "router", "retry", "durable"} {
		t.Run(mode, func(t *testing.T) {
			h := testReportHub(t)
			h.delay = time.Second
			for i := 0; i < 10; i++ {
				r, err := h.start(mode)
				if err != nil {
					t.Fatal(err)
				}
				h.remove(r.view.ID)
				v := awaitReport(t, r)
				if v.Status != "Error" || v.CSV != "" {
					t.Fatalf("immediately canceled run did work: %+v", v)
				}
			}
		})
	}
}

func TestReportsShutdownClosesAdmission(t *testing.T) {
	h := testReportHub(t)
	h.delay = time.Second
	r, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	h.close()
	if v := awaitReport(t, r); v.Status != "Error" {
		t.Fatalf("shutdown did not cancel work: %+v", v)
	}
	if _, err := h.start("publish"); err == nil {
		t.Fatal("shutdown allowed new run")
	}
	h.close()
}

func TestReportsRouterCancellationDuringStartup(t *testing.T) {
	for i := 0; i < 30; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		r := &reportRun{view: reportView{Mode: "router", MessageID: "cancel-startup"}, ctx: ctx, cancel: cancel, delay: time.Millisecond}
		bus := gochannel.NewGoChannel(gochannel.Config{OutputChannelBuffer: 1}, watermill.NopLogger{})
		done := make(chan error, 1)
		go func() { done <- r.routed(bus, nil) }()
		time.Sleep(10 * time.Microsecond)
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("router cancellation blocked during startup")
		}
		if err := bus.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReportsSustainedReplayReleasesCapacity(t *testing.T) {
	h := testReportHub(t)
	h.delay = time.Millisecond
	previousIDs := map[string]bool{}
	modes := []string{"publish", "subscribe", "router", "retry"}
	if os.Getenv("TEST_REPORT_POSTGRES_DSN") != "" {
		requireReportPostgres(t)
		modes = append(modes, "durable")
	}
	for i := 0; i < maxReportRuns*3; i++ {
		r, err := h.start(modes[i%len(modes)])
		if err != nil {
			t.Fatalf("cycle %d could not start: %v", i, err)
		}
		v := awaitReport(t, r)
		wantStatus := "Ready"
		if modes[i%len(modes)] == "publish" {
			wantStatus = "Published"
		}
		if v.Status != wantStatus {
			t.Fatalf("cycle %d failed: %+v", i, v)
		}
		if previousIDs[v.ID] || previousIDs[v.MessageID] {
			t.Fatal("replay reused a run or message ID")
		}
		previousIDs[v.ID] = true
		previousIDs[v.MessageID] = true
		h.remove(v.ID)
		h.mu.Lock()
		active := len(h.runs)
		h.mu.Unlock()
		if active != 0 {
			t.Fatalf("cycle %d left %d retained runs", i, active)
		}
	}
}

func TestReportConcurrentDeletesWaitForCleanup(t *testing.T) {
	h := testReportHub(t)
	ctx, cancel := context.WithCancel(context.Background())
	r := &reportRun{view: reportView{ID: "slow-cleanup"}, ctx: ctx, cancel: cancel, done: make(chan struct{}), expiry: time.NewTimer(time.Hour)}
	h.runs[r.view.ID] = r
	returned := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() { h.remove(r.view.ID); returned <- struct{}{} }()
	}
	<-ctx.Done()
	select {
	case <-returned:
		t.Fatal("DELETE returned before worker cleanup finished")
	case <-time.After(20 * time.Millisecond):
	}
	h.mu.Lock()
	retained := h.runs[r.view.ID] == r
	h.mu.Unlock()
	if !retained {
		t.Fatal("run removed before cleanup finished; repeated DELETE could acknowledge too soon")
	}
	close(r.done)
	for i := 0; i < 2; i++ {
		select {
		case <-returned:
		case <-time.After(time.Second):
			t.Fatal("DELETE did not finish after cleanup")
		}
	}
	h.mu.Lock()
	count := len(h.runs)
	h.mu.Unlock()
	if count != 0 {
		t.Fatal("cleaned run retained")
	}
}

func TestReportSubscriberClosedAndCancelled(t *testing.T) {
	for _, closed := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		r := &reportRun{view: reportView{Mode: "subscribe", MessageID: "subscriber-cancel"}, ctx: ctx, cancel: cancel, delay: time.Millisecond}
		bus := gochannel.NewGoChannel(gochannel.Config{OutputChannelBuffer: 1}, watermill.NopLogger{})
		if closed {
			_ = bus.Close()
		} else {
			cancel()
		}
		if err := r.subscribed(bus); err == nil {
			t.Fatal("closed/canceled subscriber unexpectedly succeeded")
		}
		cancel()
		_ = bus.Close()
		if r.snapshot().CSV != "" {
			t.Fatal("closed/canceled subscriber generated output")
		}
	}
}

func TestReportsPostgresCancellationCleansOnlyOwnTables(t *testing.T) {
	dsn := requireReportPostgres(t)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := testReportHub(t)
	h.delay = 500 * time.Millisecond
	first, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(6 * time.Second)
	for {
		bothClosed := true
		for _, r := range []*reportRun{first, second} {
			closed := false
			v := r.snapshot()
			if v.Status == "Error" {
				t.Fatalf("PostgreSQL setup failed: %+v", v)
			}
			for _, event := range v.Events {
				if event.Kind == "db-closed" {
					closed = true
				}
			}
			bothClosed = bothClosed && closed
		}
		if bothClosed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("did not reach concurrent offline stage")
		}
		time.Sleep(time.Millisecond)
	}
	h.remove(first.view.ID)
	if v := first.snapshot(); v.Status != "Error" || v.Attempts != 0 {
		t.Fatalf("canceled offline run did work: %+v", v)
	}
	firstNames, err := reportPostgresTables(first.view.ID)
	if err != nil {
		t.Fatal(err)
	}
	secondNames, err := reportPostgresTables(second.view.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, name := range []string{firstNames.messages, firstNames.offsets} {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", "public."+name).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Fatalf("canceled run retained table %s", name)
		}
	}
	var secondExists bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", "public."+secondNames.messages).Scan(&secondExists); err != nil {
		t.Fatal(err)
	}
	if !secondExists {
		t.Fatal("canceling first run removed another run's message table")
	}
	if v := awaitReport(t, second); v.Status != "Ready" || v.Attempts != 1 {
		t.Fatalf("other isolated run failed: %+v", v)
	}
}

func TestReportsPostgresConfigurationErrorDoesNotLeakSecrets(t *testing.T) {
	const secret = "do-not-expose-this-password"
	t.Setenv("REPORT_POSTGRES_DSN", "postgres://demo:"+secret+"@localhost:bad-port/demo")
	h := testReportHub(t)
	r, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	v := awaitReport(t, r)
	if v.Status != "Error" || v.Attempts != 0 || v.CSV != "" {
		t.Fatalf("invalid configuration unexpectedly worked: %+v", v)
	}
	encoded, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) {
		t.Fatal("configuration secret leaked into API response")
	}
}

// Controlled callbacks test cleanup coordination, not PostgreSQL persistence.
func TestReportDeleteRetainsFailedCleanupUntilSuccessfulRetry(t *testing.T) {
	h := testReportHub(t)
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	r := &reportRun{view: reportView{ID: "cleanup-retry", Status: "Error"}, ctx: ctx, cancel: cancel, done: make(chan struct{}), expiry: time.NewTimer(time.Hour)}
	r.cleanup = func() error {
		calls++
		if calls == 1 {
			return errors.New("isolated cleanup unavailable")
		}
		return nil
	}
	r.cleanupErr = errors.New("previous cleanup unavailable")
	close(r.done)
	h.runs[r.view.ID] = r
	app := fiber.New()
	h.routes(app)
	response, err := app.Test(httptest.NewRequest("DELETE", "/api/reports/runs/cleanup-retry", nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 || calls != 1 {
		t.Fatalf("failed cleanup falsely acknowledged: status %d calls %d", response.StatusCode, calls)
	}
	h.mu.Lock()
	retained := h.runs[r.view.ID] == r
	h.mu.Unlock()
	if !retained {
		t.Fatal("cleanup failure released capacity or lost retry state")
	}
	response, err = app.Test(httptest.NewRequest("DELETE", "/api/reports/runs/cleanup-retry", nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 204 || calls != 2 {
		t.Fatalf("cleanup retry did not finish: status %d calls %d", response.StatusCode, calls)
	}
	h.mu.Lock()
	remaining := len(h.runs)
	h.mu.Unlock()
	if remaining != 0 || r.cleanup != nil {
		t.Fatal("successful cleanup retained capacity or captured DSN callback")
	}
	if err := h.remove(r.view.ID); err != nil || calls != 2 {
		t.Fatal("repeated delete was not idempotent")
	}
}

func TestReportConcurrentCleanupRetriesSerialize(t *testing.T) {
	h := testReportHub(t)
	ctx, cancel := context.WithCancel(context.Background())
	entered, release := make(chan struct{}), make(chan struct{})
	calls := 0
	r := &reportRun{view: reportView{ID: "serialized-cleanup"}, ctx: ctx, cancel: cancel, done: make(chan struct{}), expiry: time.NewTimer(time.Hour)}
	r.cleanup = func() error { calls++; close(entered); <-release; return nil }
	r.cleanupErr = errors.New("previous cleanup unavailable")
	close(r.done)
	h.runs[r.view.ID] = r
	results := make(chan error, 2)
	go func() { results <- h.remove(r.view.ID) }()
	<-entered
	go func() { results <- h.remove(r.view.ID) }()
	select {
	case <-results:
		t.Fatal("DELETE acknowledged cleanup before it completed")
	case <-time.After(20 * time.Millisecond):
	}
	h.mu.Lock()
	retained := h.runs[r.view.ID] == r
	h.mu.Unlock()
	if !retained {
		t.Fatal("cleanup in progress released capacity")
	}
	close(release)
	for i := 0; i < 2; i++ {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(time.Second):
			t.Fatal("serialized cleanup did not finish")
		}
	}
	if calls != 1 {
		t.Fatalf("concurrent DELETE repeated successful cleanup %d times", calls)
	}
}
