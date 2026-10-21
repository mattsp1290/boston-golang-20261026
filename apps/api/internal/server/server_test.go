package server

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutes(t *testing.T) {
	tests := []struct {
		path   string
		status int
		key    string
		value  string
	}{
		{"/api/health", 200, "status", "ok"},
		{"/api/message", 200, "message", "Hello from Go + Fiber!"},
		{"/api/missing", 404, "error", "Not Found"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			app := New()
			response, err := app.Test(httptest.NewRequest("GET", tt.path, nil))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != tt.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, tt.status)
			}
			if !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
				t.Fatal("expected JSON response")
			}
			var body map[string]string
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body[tt.key] != tt.value {
				t.Fatalf("%s = %q, want %q", tt.key, body[tt.key], tt.value)
			}
		})
	}
}
