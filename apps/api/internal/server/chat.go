package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/ThreeDotsLabs/watermill/pubsub/gochannel"
	"github.com/gofiber/fiber/v3"
)

const chatTopic = "chat.messages"
const queueSize = 32
const maxSubscribers = 16

type chatMessage struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Text   string    `json:"text"`
	SentAt time.Time `json:"sentAt"`
}

type chatHub struct {
	bus             *gochannel.GoChannel
	ctx             context.Context
	cancel          context.CancelFunc
	publishing      chan struct{}
	subscribers     atomic.Int64
	published       atomic.Uint64
	enqueued        atomic.Uint64
	slowDisconnects atomic.Uint64
}

func newChatHub() *chatHub {
	ctx, cancel := context.WithCancel(context.Background())
	return &chatHub{
		// demo:bus:start
		bus: gochannel.NewGoChannel(gochannel.Config{
			OutputChannelBuffer:            1,
			BlockPublishUntilSubscriberAck: true,
			// Persistent defaults to false: this is live-only, in-process fanout.
		}, watermill.NopLogger{}),
		// demo:bus:end
		ctx: ctx, cancel: cancel, publishing: make(chan struct{}, 1),
	}
}

func (h *chatHub) close() error { h.cancel(); return h.bus.Close() }

type chatSubscription struct {
	id     string
	events <-chan []byte
	ctx    context.Context
	cancel context.CancelFunc
}

func (h *chatHub) subscribe() (*chatSubscription, error) {
	if h.subscribers.Add(1) > maxSubscribers {
		h.subscribers.Add(-1)
		return nil, fiber.NewError(503, "Demo connection limit reached (16)")
	}
	ctx, cancel := context.WithCancel(h.ctx)
	// Each SSE connection owns a distinct Watermill subscription, not a shared channel.
	// demo:subscribe:start
	incoming, err := h.bus.Subscribe(ctx, chatTopic)
	// demo:subscribe:end
	if err != nil {
		cancel()
		h.subscribers.Add(-1)
		return nil, err
	}
	queue := make(chan []byte, queueSize)
	sub := &chatSubscription{watermill.NewUUID(), queue, ctx, cancel}
	go func() {
		defer h.subscribers.Add(-1)
		defer cancel()
		defer close(queue)
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-incoming:
				if !ok {
					return
				}
				select {
				case <-ctx.Done():
					return
				case queue <- msg.Payload:
					h.enqueued.Add(1)
					// Ack means queued for SSE, NOT delivered/read by a browser.
					msg.Ack()
				default:
					// Never Nack-loop a slow browser. Cancel it; reconnect has no replay.
					h.slowDisconnects.Add(1)
					return
				}
			}
		}
	}()
	return sub, nil
}

func (h *chatHub) publish(name, text string) (chatMessage, error) {
	// Nonblocking admission bounds GoChannel's internal delivery goroutines too.
	select {
	case h.publishing <- struct{}{}:
	default:
		return chatMessage{}, fiber.NewError(429, "Publisher busy; try again")
	}
	defer func() { <-h.publishing }()
	if h.ctx.Err() != nil {
		return chatMessage{}, fiber.ErrServiceUnavailable
	}
	event := chatMessage{watermill.NewUUID(), name, text, time.Now().UTC()}
	payload, err := json.Marshal(event)
	if err != nil {
		return chatMessage{}, err
	}
	// demo:publish:start
	msg := message.NewMessage(event.ID, payload)
	if err := h.bus.Publish(chatTopic, msg); err != nil {
		return chatMessage{}, err
	}
	// demo:publish:end
	h.published.Add(1)
	return event, nil
}

func (h *chatHub) routes(app *fiber.App) {
	app.Hooks().OnPreShutdown(h.close)
	app.Get("/api/chat/stats", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"subscribers": h.subscribers.Load(), "published": h.published.Load(), "enqueued": h.enqueued.Load(), "slowDisconnects": h.slowDisconnects.Load()})
	})
	app.Post("/api/chat/messages", func(c fiber.Ctx) error {
		if !strings.HasPrefix(strings.ToLower(c.Get("Content-Type")), "application/json") {
			return fiber.ErrUnsupportedMediaType
		}
		if len(c.Body()) > 4096 {
			return fiber.ErrRequestEntityTooLarge
		}
		var input struct {
			Name string `json:"name"`
			Text string `json:"text"`
		}
		decoder := json.NewDecoder(bytes.NewReader(c.Body()))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			return fiber.NewError(400, "Expected JSON with name and text")
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			return fiber.NewError(400, "Expected one JSON object")
		}
		input.Name = strings.TrimSpace(input.Name)
		input.Text = strings.TrimSpace(input.Text)
		if !utf8.ValidString(input.Name) || !utf8.ValidString(input.Text) || utf8.RuneCountInString(input.Name) < 1 || utf8.RuneCountInString(input.Name) > 40 || utf8.RuneCountInString(input.Text) < 1 || utf8.RuneCountInString(input.Text) > 500 {
			return fiber.NewError(400, "Name must be 1–40 characters and text 1–500 characters")
		}
		event, err := h.publish(input.Name, input.Text)
		if err != nil {
			return err
		}
		return c.Status(202).JSON(event)
	})
	app.Get("/api/chat/events", func(c fiber.Ctx) error {
		sub, err := h.subscribe()
		if err != nil {
			return err
		}
		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache, no-transform")
		c.Set("X-Accel-Buffering", "no")
		// Capture the connection, never the pooled Fiber context, in the stream callback.
		conn := c.RequestCtx().Conn()
		return c.SendStreamWriter(func(w *bufio.Writer) {
			defer sub.cancel()
			flush := func(frame string) error {
				if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
					return err
				}
				if _, err := w.WriteString(frame); err != nil {
					return err
				}
				return w.Flush()
			}
			ready, _ := json.Marshal(fiber.Map{"subscriberId": sub.id})
			if flush("retry: 2000\nevent: ready\ndata: "+string(ready)+"\n\n") != nil {
				return
			}
			heartbeat := time.NewTicker(2 * time.Second)
			defer heartbeat.Stop()
			for {
				select {
				case <-sub.ctx.Done():
					return
				case payload, ok := <-sub.events:
					if !ok {
						return
					}
					// JSON safely escapes user newlines. No replay IDs: reconnect is live only.
					if flush(fmt.Sprintf("event: chat\ndata: %s\n\n", payload)) != nil {
						return
					}
				case <-heartbeat.C:
					if flush(": heartbeat\n\n") != nil {
						return
					}
				}
			}
		})
	})
}
