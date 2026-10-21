package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/mattsp1290/boston-golang-20261026/apps/api/internal/server"
)

func main() {
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:3000"
	}
	app := server.New()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("API listening on http://%s", addr)
	if err := app.Listen(addr, fiber.ListenConfig{DisableStartupMessage: true, GracefulContext: ctx, ShutdownTimeout: 5 * time.Second}); err != nil {
		log.Fatal(err)
	}
}
