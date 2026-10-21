package server

import (
	"context"
	"encoding/csv"
	"encoding/json"
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

func TestReportsAllModesAndRealCSV(t *testing.T) {
	for _, mode := range []string{"publish", "router", "retry", "durable"} {
		t.Run(mode, func(t *testing.T) {
			h := testReportHub(t)
			r, err := h.start(mode)
			if err != nil {
				t.Fatal(err)
			}
			view := awaitReport(t, r)
			if view.Status != "Ready" || view.Error != "" {
				t.Fatalf("not ready: %+v", view)
			}
			wantAttempts := 1
			if mode == "retry" {
				wantAttempts = 3
			}
			if view.Attempts != wantAttempts {
				t.Fatalf("attempts %d want %d", view.Attempts, wantAttempts)
			}
			records, err := csv.NewReader(strings.NewReader(view.CSV)).ReadAll()
			if err != nil || len(records) != 3 || records[0][0] != "team" || records[2][1] != "8" {
				t.Fatalf("invalid generated CSV: %q, %v", view.CSV, err)
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
			if counts["published"] != 1 || counts["ready"] != 1 || counts["attempt"] != wantAttempts {
				t.Fatalf("wrong event counts: %v", counts)
			}
			if mode == "publish" && counts["ack"] != 1 {
				t.Fatal("direct subscriber did not acknowledge")
			}
			if mode != "publish" && counts["worker-online"] != 1 {
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

func TestReportsDurableOfflinePauseHasNoAttempts(t *testing.T) {
	tempRoot := t.TempDir()
	t.Setenv("TMPDIR", tempRoot)
	h := testReportHub(t)
	h.delay = 150 * time.Millisecond
	r, err := h.start("durable")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
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
				t.Fatalf("worker ran while offline: %+v", v)
			}
			observed = true
			break
		}
		time.Sleep(time.Millisecond)
	}
	if !observed {
		t.Fatal("never observed persisted message with all original connections closed")
	}
	files, err := os.ReadDir(tempRoot)
	if err != nil || len(files) != 1 {
		t.Fatalf("expected one real run directory while offline: %v %v", files, err)
	}
	if got := awaitReport(t, r); got.Status != "Ready" {
		t.Fatalf("reopened queue did not deliver: %+v", got)
	}
	files, err = os.ReadDir(tempRoot)
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary SQLite resources were not removed: %v %v", files, err)
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
	if v := awaitReport(t, r); v.Status != "Ready" {
		t.Fatalf("new run failed: %+v", v)
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
	h.mu.Lock()
	n := len(h.runs)
	h.mu.Unlock()
	if n != 0 {
		t.Fatalf("expired runs retained: %d", n)
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
	for _, mode := range []string{"publish", "router", "retry", "durable"} {
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
