package server

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/recover"
)

// New creates the API without opening a socket, so routes can be tested in isolation.
func New() *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:      "Boston Golang API",
		BodyLimit:    4096,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
		ErrorHandler: func(c fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"
			var fiberErr *fiber.Error
			if errors.As(err, &fiberErr) {
				code = fiberErr.Code
				message = fiberErr.Message
			}
			return c.Status(code).JSON(fiber.Map{"error": message})
		},
	})
	app.Use(recover.New())
	app.Get("/api/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "boston-golang-api"})
	})
	app.Get("/api/message", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "Hello from Go + Fiber!", "topic": "A talk on Watermill"})
	})
	newReportHub().routes(app)
	return app
}
