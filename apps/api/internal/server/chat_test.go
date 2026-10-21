package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func eventually(t *testing.T, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if f() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition did not become true")
}

func TestChatFanoutAndSlowConsumer(t *testing.T) {
	h := newChatHub()
	defer h.close()
	a, err := h.subscribe()
	if err != nil {
		t.Fatal(err)
	}
	defer a.cancel()
	b, err := h.subscribe()
	if err != nil {
		t.Fatal(err)
	}
	defer b.cancel()
	event, err := h.publish("Alice", "hello\nBoston")
	if err != nil {
		t.Fatal(err)
	}
	for _, sub := range []*chatSubscription{a, b} {
		select {
		case payload := <-sub.events:
			var got chatMessage
			if err := json.Unmarshal(payload, &got); err != nil {
				t.Fatal(err)
			}
			if got.ID != event.ID || got.Text != "hello\nBoston" {
				t.Fatalf("wrong fanout: %+v", got)
			}
		case <-time.After(time.Second):
			t.Fatal("missing fanout")
		}
	}
	b.cancel()
	eventually(t, func() bool { return h.subscribers.Load() == 1 })

	// A non-reading stream cannot build unbounded Watermill deliveries or block a healthy stream.
	healthy, err := h.subscribe()
	if err != nil {
		t.Fatal(err)
	}
	defer healthy.cancel()
	for i := 0; i < queueSize+1; i++ {
		sent, err := h.publish("Alice", fmt.Sprint(i))
		if err != nil {
			t.Fatal(err)
		}
		select {
		case payload := <-healthy.events:
			var got chatMessage
			if err := json.Unmarshal(payload, &got); err != nil {
				t.Fatal(err)
			}
			if got.ID != sent.ID {
				t.Fatal("healthy stream missed or reordered a message")
			}
		case <-time.After(time.Second):
			t.Fatal("slow stream blocked healthy stream")
		}
	}
	eventually(t, func() bool { return h.subscribers.Load() == 1 })
	if h.slowDisconnects.Load() != 1 {
		t.Fatal("slow consumer was not disconnected")
	}
	sent, err := h.publish("Alice", "still live")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case payload := <-healthy.events:
		var got chatMessage
		if err := json.Unmarshal(payload, &got); err != nil {
			t.Fatal(err)
		}
		if got.ID != sent.ID {
			t.Fatal("healthy stream did not survive slow disconnect")
		}
	case <-time.After(time.Second):
		t.Fatal("publish stopped after slow disconnect")
	}

}

func TestChatConcurrentPublishSubscribeThenShutdown(t *testing.T) {
	h := newChatHub()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				s, err := h.subscribe()
				if err == nil {
					_, _ = h.publish("test", "message")
					s.cancel()
				}
			}
		}()
	}
	wg.Wait()
	if err := h.close(); err != nil {
		t.Fatal(err)
	}
	eventually(t, func() bool { return h.subscribers.Load() == 0 })
}

func TestChatValidation(t *testing.T) {
	app := New()
	defer app.Shutdown()
	cases := []struct {
		body, content string
		status        int
	}{
		{`{"name":"Alice","text":"hello"}`, "application/json", 202},
		{`{"name":" ","text":"hello"}`, "application/json", 400},
		{`{"name":"Alice","text":" "}`, "application/json", 400},
		{`{"name":"Alice","text":"` + strings.Repeat("x", 501) + `"}`, "application/json", 400},
		{`{"name":"` + strings.Repeat("x", 41) + `","text":"hello"}`, "application/json", 400},
		{`{"name":"Alice","text":"hello","other":true}`, "application/json", 400},
		{`{"name":"Alice","text":"hello"} {}`, "application/json", 400},
		{`not json`, "application/json", 400},
		{`{"name":"Alice","text":"hello"}`, "text/plain", 415},
	}
	for _, tt := range cases {
		req := httptest.NewRequest("POST", "/api/chat/messages", strings.NewReader(tt.body))
		req.Header.Set("Content-Type", tt.content)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tt.status {
			t.Errorf("status %d want %d", resp.StatusCode, tt.status)
		}
	}
}

func TestChatHTTPStreams(t *testing.T) {
	app := New()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true}) }()
	t.Cleanup(func() {
		if err := app.ShutdownWithTimeout(6 * time.Second); err != nil {
			t.Error(err)
		}
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	base := "http://" + listener.Addr().String()
	client := &http.Client{Timeout: 15 * time.Second}
	oversized, err := client.Post(base+"/api/chat/messages", "application/json", strings.NewReader(strings.Repeat("x", 4097)))
	if err != nil {
		t.Fatal(err)
	}
	oversized.Body.Close()
	if oversized.StatusCode != 413 {
		t.Fatalf("oversized status = %d", oversized.StatusCode)
	}

	connect := func() (*http.Response, *bufio.Scanner) {
		t.Helper()
		resp, err := client.Get(base + "/api/chat/events")
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" {
			t.Fatal("not SSE")
		}
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "data:") {
				return resp, scanner
			}
		}
		t.Fatal("no ready event")
		return nil, nil
	}
	a, as := connect()
	defer a.Body.Close()
	b, bs := connect()
	defer b.Body.Close()
	response, err := client.Post(base+"/api/chat/messages", "application/json", strings.NewReader(`{"name":"Alice","text":"live over HTTP"}`))
	if err != nil {
		t.Fatal(err)
	}
	var sent chatMessage
	if err := json.NewDecoder(response.Body).Decode(&sent); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 202 {
		t.Fatal("POST not accepted")
	}
	for _, scanner := range []*bufio.Scanner{as, bs} {
		received := false
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "data:") {
				var got chatMessage
				if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &got); err != nil {
					t.Fatal(err)
				}
				if got.ID != sent.ID {
					t.Fatal("message IDs differ")
				}
				received = true
				break
			}
		}
		if !received {
			t.Fatalf("missing event: %v", scanner.Err())
		}
	}
	a.Body.Close()
	b.Body.Close()
	eventually(t, func() bool {
		resp, err := client.Get(base + "/api/chat/stats")
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		var stats struct {
			Subscribers int `json:"subscribers"`
		}
		if json.NewDecoder(resp.Body).Decode(&stats) != nil {
			return false
		}
		return stats.Subscribers == 0
	})
	// A newly connected client receives no historical chat, just ready/heartbeat.
	c, cs := connect()
	defer c.Body.Close()
	for cs.Scan() {
		line := cs.Text()
		if strings.HasPrefix(line, "event: chat") {
			t.Fatal("unexpected historical replay")
		}
		if line == ": heartbeat" {
			break
		}
	}
}

func TestChatConnectionLimitAndShutdown(t *testing.T) {
	h := newChatHub()
	for i := 0; i < maxSubscribers; i++ {
		if _, err := h.subscribe(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.subscribe(); err == nil {
		t.Fatal("connection limit not enforced")
	}
	if err := h.close(); err != nil {
		t.Fatal(err)
	}
	eventually(t, func() bool { return h.subscribers.Load() == 0 })
	if _, err := h.publish("Alice", "closed"); err == nil {
		t.Fatal("published after shutdown")
	}
}
