# Watermill: a presentation, not a dashboard

## Scope and review gate

Plan for the existing `feat/watermill-sse-chat-demo` branch, inspected clean at `af0a522` and matching its remote. This document precedes implementation. Two independent reviews must clear the visual direction and teaching accuracy before changes begin. Keep all four real API demonstrations and their replay/cancellation lifecycle. Do not redesign the backend or substitute simulated success.

## Diagnosis

The current twelve slides repeat a website-like header, chapter label, footer, and dense explanatory layout. Idea slides combine title, paragraph, multiple boxed nodes, takeaway, and next-step text. Live slides combine a state dashboard, diagram, source column, artifact, replay instructions, and expandable technical sections. The latest PostgreSQL diff is simpler, but sits within the same page chrome. The redesign replaces these compositions rather than just hiding individual paragraphs.

## Art direction and measurable rules

- One fixed 1920 × 1080 stage, scaled proportionally by Reveal to fit the viewport. No responsive reflow into a webpage, no slide scrollbars. Letterbox non-16:9 screens. The content frame has 120 px horizontal and 90 px vertical safe margins.
- Reserve measured regions: title y=90–210, main body y=260–890, optional single annotation below. Fourteen code lines at 36 px × 1.2 occupy 605 px, fitting the 630 px body. Cut or split before reducing type.
- Live diagrams have one main observed state, two or three labelled entities, and only the essential relationship. Remove duplicate SVG captions, contract text, token legends, retention pills, and lifecycle boxes. Verify effective rendered SVG label sizes after its scale, not just nominal source font values.
- One thought and one visual composition per slide. Left-aligned editorial typography; asymmetry and whitespace, not grids of cards. No repeated navigation/header bars, divider rules, chapter badges, footers, source links, buttons, pills, or expandable technical panels in the normal projected view.
- Dark ink background, warm white type, restrained lime accent. Use coral only for errors/removals. Symbols and words supplement all state colors. No gradients, ornamental frames, shadows, or faux application windows.
- Titles 80–88 px on the design stage (53–59 px at 1280 × 720). Supporting text 42–46 px (28–31 projected). Diagram labels at least 36 px (24 projected). Code 36 px with 1.2 line height (24 px projected), maximum 14 lines and 70 characters per line. Setup notes, if essential on the slide, 30 px (20 projected), one line.
- Non-code slides: at most 25 visible words, excluding the speaker biography and necessary live error messages. Live slides: at most 35 words across title, primary state, and diagram labels; no instructional paragraphs. Code slides: one code composition, title at most seven words, at most one short setup annotation.
- A 250 ms fade is the only deck transition. Live movement follows observed API state, not independent timeline animation. Respect reduced-motion preference by removing travel/spin/transition while preserving icons, position, and state labels.
- Presenter notes carry source URLs, setup/import assumptions, full explanations, transport guarantees, idempotency caveats, and omitted scaffolding. Preserve accessible DOM descriptions even when they are visually hidden.

## Proposed fourteen-slide sequence

1. **Watermill.** Huge title, one short subtitle, Matt Spurlin. A single subtle message motif, not a diagram with explanatory labels. Date and Boston Golang context in notes.
2. **Matt Spurlin.** Name, “Senior Software Engineer”, “Datadog”, and GitHub handle. Large initials as a typographic accent, not a profile card. No invented biography.
3. **Publish → Handle → Middleware.** Three words linked by a fine line; one small sentence: “A Go library, not a broker.” Notes introduce the weekly team CSV example and the optional persistence extension.
4. **Publish a report request.** One large source excerpt: construct a message and call `Publish`. Maximum six lines. A short “Published ≠ processed” annotation is the only extra text. Notes explain topic, ID, payload, error handling, and the pre-existing GoChannel subscription.
5. **Make the message available.** Publish-only live illustration: one message moves from the Publish boundary into the existing subscription. No handler, CSV, or completed-report imagery. One large observed state, no code column. After success hold four seconds and repeat.
6. **Subscribe returns a channel.** One large source excerpt showing `incoming, err := bus.Subscribe(ctx, topic)` and its error check, at most six lines. Keep these names visibly consistent with the continued example on slide 7. One simple channel arrow can replace prose if space permits. Notes explicitly identify `bus` as the shared GoChannel Publisher/Subscriber adapter. Subscriber is never labelled handler or worker.
7. **Receive. Handle. Acknowledge.** One large code excerpt showing context cancellation, closed-channel check, processing, then Ack or Nack. At most fifteen lines, no accompanying role cards. This continues slide 6 with the same incoming channel and variable names. Notes explicitly identify it as one finite receive, not a complete long-running loop. Fold demo publishing/telemetry using a visible omission marker, never deceptively contiguous “actual source”. This is the low-level manual plumbing, not a fifth live demo. Keep safety checks visible rather than silently presenting an unsafe loop.
8. **Let the Router handle the plumbing.** One source excerpt, at most eight lines, with actual `AddConsumerHandler` wiring and the unchanged application function. Two compact outcome lines visibly attributed to the Router: “Router: nil → Ack” and “Router: error → Nack”. Notes distinguish the Subscriber adapter, Router lifecycle, and application handler.
9. **One delivery. One handler call.** Focused live scene: Subscriber → application handler → CSV result, with Router represented only as the encompassing relationship. One observed state. The generated CSV appears only after the real Ready response, using its actual data rather than a fabricated preview. No technical timeline or source panel.
10. **Retry wraps the same handler.** One source excerpt of actual Retry middleware, at most seven lines. No attempt motif here; the following live slide demonstrates it. One annotation: “One message. Three calls.” Notes distinguish middleware retries from republishing and transport redelivery.
11. **Try again. Same message.** Retry live scene with only the handler and retry loop. Attempt counter and two failure marks become the main visual. Stable message identity is represented consistently, with the full ID available accessibly rather than as prominent dashboard text. No app/queue/CSV pipeline.
12. **Swap the transport. Keep the handler.** Preserve the requested single GoChannel → PostgreSQL diff, fourteen lines maximum. Large monospaced type and explicit +/− signs. Preserve both Publisher and Subscriber changes, the shared GoChannel origin, and unchanged r.process. Meet the line budget by folding configuration, never by dropping Subscriber or assigning persistence to middleware. No comparison cards or second snippet. One minimal setup note; full schema/offset/type/error assumptions remain in notes. This is configuration comparison, not the temporal order of the live test.
13. **Stored now. Delivered later.** Focused PostgreSQL live illustration: saved request, closed/reopened application database connections, then Subscriber + Router starts. The disk and connection gap dominate. Use “Not started” before the Subscriber exists, never an “offline” label implying a crashed process. Show “Close connections → Reconnect” and “No republish” as the essential lifecycle relationship. No generic worker terminology. A short permanent scope label, “Database reconnect only”, prevents implying a process/server crash. No simulated fallback when PostgreSQL is unavailable.
14. **Publish. Handle. Extend.** Three large words and `watermill.io`. Optional “Questions?” as a small closing cue. This is a conclusion, not a new concept or a wall of references; detailed references stay in notes.

## Live presentation behavior

- Keep `runReportScenario`, its cleanup-confirmed serial gate, bounded backend sessions, four-second completed hold, and cancellation on leaving/overview/unmount unchanged.
- Retain a subtle “Replay in 4…” label during the completed hold only; remove RUN counters, “LIVE · GO API”, startup instructions, persistent replay copy, technical-details disclosure, and concept-boundary disclosure from the audience stage.
- Put event logs, full IDs, source commentary, and operational instructions in notes/documentation, not a second audience panel. Keep accessible status text and real error reporting.
- If the API fails, stop animation/replay and show a readable “Demo paused” state with the actual sanitized error and a single explicit retry control. Errors are the intentional exception to normal word budgets; never hide failures to protect aesthetics.
- Source excerpts are extracted or explicitly labelled as illustrative, with omissions documented. They must not invent constructors, omit meaningful acknowledgement semantics, or change the report handler.

## Implementation boundaries

Primary edits: `App.tsx`, `App.css`, `ReportSlide.tsx`, `ReportSlide.css`, and focused SVG label/layout changes in `ReportFlow.tsx`. Update deck and presentation tests to the new fourteen-slide structure. Preserve `reports.ts`, `reportVisual.ts` evidence mapping, Go backend behavior, Docker/run scripts, and transport configuration unless a specific presentation hook is necessary and reviewed.

## Verification and acceptance

1. Two independent plan reviews: visual/readability and teaching/semantics. Reconcile findings in this plan, obtain parent clearance, then implement.
2. Validate 1920 × 1080 and 1280 × 720: no overlap, clipping, scrollbars, tiny code, or stacked website layouts. Check 4:3 letterboxing and narrow screens retain the proportional stage rather than hiding information. Include completed CSV and error-state captures, not only idle frames.
3. Prefer actual browser screenshots and geometry assertions if the cloud browser can launch under its existing security restrictions. Do not disable security controls to obtain screenshots. If still blocked, render actual slide content with available permitted tooling where feasible, check DOM/CSS budgets, and explicitly label the missing browser verification. Static reconstructed SVGs are not equivalent to an actual slide render.
4. Test all demo types across multiple cycles and navigation/overview/unmount. Verify API-derived states, no overlapping runs, cleanup before replay, errors pausing loops, reduced-motion rules, and accessible state labels. Preserve existing backend tests.
5. Run frontend lint, tests, production build, and script tests. Run aggregate Go/race checks when its toolchain is available; otherwise state the exact limitation, with no claim that unchanged backend tests were rerun.
6. Review final source, screenshots/render evidence, and git diff. Commit and push only after review/checks pass; verify remote SHA and clean working tree. No merge or unrelated PR edits.

## Review reconciliation

Visual reviewer approved direction with requirements incorporated: fourteen-line ceiling with measured body region; explicit minimal live diagram budget; no duplicate attempt motif on middleware explanation; “Database reconnect only” scope label; 4:3, completed CSV, and error-state QA. Teaching reviewer also approved after requirements incorporated: continued Subscribe/receive variable names and finite-receive scope; visible Router ownership of acknowledgements; both transport interfaces and same handler retained in the diff; precise close/reopen lifecycle and Not started label. Parent clearance was received after both reviews; the approved plan was then implemented.


## Implementation verification

- Implemented fourteen fixed-stage slides, separate code lessons, and full-stage focused live demonstrations. Backend behavior and the client cleanup/replay gate were preserved.
- Aggregate `npm run check` passed: frontend lint/typecheck, Go formatting/vet, 82 frontend tests, 25 script tests, Go race tests, and both production builds. Real PostgreSQL integration remains opt-in and was not run without a database server. The existing Vite chunk-size advisory remains non-blocking.
- Rendered the actual React HTML and production CSS for all fourteen slides and six additional live states. The fallback renderer required mechanically applying external production SVG styles inline; it did not reconstruct diagrams. Twenty renders fit a single stage with no off-page text. Reviewed 1280 × 720, 1920 × 1080, and proportional 4:3 letterbox previews, including real-data-shaped CSV completion, retry failure/completion, database closure/reconnection, and API error fixtures.
- These are static layout previews, not browser screenshots or evidence of live API success. Chromium could not launch because the environment denies its required socket. Browser animation, actual Reveal viewport scaling, and native retry-button metrics therefore remain unverified visually; unit/integration tests cover lifecycle and rendering contracts.
- Final independent teaching/semantic and visual/readability reviews both cleared the implemented deck. The reviewers inspected production source and corrected static renders; neither found a material blocker to commit and push.
