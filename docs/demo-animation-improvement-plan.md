# Demo animation improvements

## Diagnosis and scope
The 789f540 redesign improved non-demo slides but removed active-work motion, differentiated equipment silhouettes and visible message identity. The short 250ms token transition was easy to miss. Preserve App.tsx, App.css, all non-demo slides, backend semantics and replay/cleanup lifecycle.

## Reviewed storyboard
- Publish: gold request paper moves into a recognizable subscription tray after actual publication; availability is highlighted separately. No handler or invented delivery.
- Handle: distinguish Subscriber tray, Router boundary and application handler. Processing ring exists only while working; actual CSV appears only on Ready.
- Retry: one stationary identified message, animated wrapper only during observed retry waits, three large call badges with words and symbols. The working indicator restarts on actual attempts.
- Persistence: cylinder retains the request until receipt, plugs indicate application database connections only, and receipt after reconnect confirms the original message. Keep the reconnect-only qualifier.
- Visible identity reads `ID: <six UUID characters>`, with full UUID accessible. Three-beat progress rows describe evidence rather than time.

## Timing and correctness
650ms movement illustrates state changes, not measured transit. Late first snapshots display current evidence without fabricating earlier steps. Existing continuous replay, four-second terminal hold, abort and cleanup remain unchanged. Active indicators unmount on completion/error; reduced-motion disables animations and transitions without removing state.

## Review and validation
Independent plan and final review approved the original implementation. Review caught a durable footer overlap: right-align its progress strip, use 10px top spacing, and keep token identity inside the consumer silhouette. Non-demo files remain unchanged.

Original validation passed npm run check (84 web tests, 25 script tests, Go tests, lint and both builds). Static React-derived state renders fit 20 single-slide compositions with no off-page text. No real PostgreSQL integration or live browser motion/replay/reduced-motion QA was performed: the supported browser could not reach the executor loopback, and file URLs are unsupported. Static fixtures are not live backend evidence.

## Recovery
The environment subsequently reverted to 789f540, losing local commits d63fa5a and ea89c39 before publication. This replacement reconstructs their scoped changes from retained task history. Automated checks and independent review are repeated before the user-authorized push. The previous browser-QA limitations remain; no new live-QA claim is made.

Recovery validation: npm run check passed again (84 web tests, 25 script tests, Go tests, lint/typecheck, both builds). Independent final review approved the reconstructed diff with no blocking findings.
