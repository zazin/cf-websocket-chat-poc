# Afterglow — Cloudflare chat POC

Two plain JavaScript module Workers: a static-assets frontend and a backend with one SQLite-backed Durable Object per room. The browser uses same-origin `/ws`; the frontend forwards `/ws` (including upgrades) and `/health` over its `BACKEND` service binding. No build pipeline or external UI dependencies.

## Setup and preview

Node 22+ recommended. From this directory:

```sh
npm install
# If npm 12 fails with EALLOWSCRIPTS:
npx --yes npm@11 install
npm run dry-run:backend
npm run dry-run:frontend
npm run dev
```

The multi-config dev command runs both Workers together with local service binding resolution. Open the frontend URL printed by Wrangler. Local Durable Object data lives in `.wrangler/`. To expose both endpoints for local integration testing, run `npm run dev:backend` and `npm run dev:frontend` in separate terminals instead; test with `http://localhost:8787 http://localhost:8788`.

## Monorepo structure

- `frontend/` — frontend Worker, browser UI, and static assets.
- `backend/` — WebSocket backend Worker and per-room Durable Objects.
- `tests/` — integration and desktop/mobile browser tests.
- Root `package.json` and lockfile — shared tooling and commands for both Workers.

## Live deployment

- Frontend: https://edge-chat-frontend-54a16de8.zazin.workers.dev
- Backend: https://edge-chat-backend-54a16de8.zazin.workers.dev

Both Workers were deployed and verified with live integration and browser tests. See [DEPLOYMENT.md](DEPLOYMENT.md) for version IDs and verification details.

## Deploy

Inspect the randomized names in both configs; they share a suffix and the frontend service binding names the backend exactly. Authenticate Wrangler, select the intended account, then deploy backend before frontend:

```sh
npx wrangler deploy -c backend/wrangler.jsonc
npx wrangler deploy -c frontend/wrangler.jsonc
```

Exactly one Worker per command. The backend's `v1` migration creates the `ChatRoom` SQLite Durable Object class. Keep migration history on subsequent deployments. No secrets or environment variables are required. `/health` is a lightweight liveness check, not a storage check.

## Verify

Provide the actual HTTPS URLs printed by deployment (frontend first):

```sh
npm run test:integration -- https://FRONTEND.workers.dev https://BACKEND.workers.dev
npx playwright install chromium
npm run test:browser -- https://FRONTEND.workers.dev
```

Integration uses real WebSocket connections through both Workers. It checks both health endpoints, request validation, HTML, two-way broadcast, join/leave counts, isolated rooms, reconnect history, malformed JSON, invalid payloads, oversized text, and the per-connection rate limit. Browser testing uses separate desktop/mobile contexts, sends messages via controls, checks literal HTML rendering, interrupts the transport to verify automatic reconnect, and checks reload history. HTTP localhost URLs are also supported for local verification. Tests create uniquely named public rooms; their storage expires after inactivity.

## Protocol

Connect with `GET /ws?room=lobby&name=Alex` and a WebSocket upgrade. Room names match `^[a-z0-9][a-z0-9_-]{0,47}$`; nicknames are trimmed, 1–32 UTF-16 code units, with no ASCII control characters. Invalid parameters return HTTP 400; a missing upgrade returns 426; full rooms return 429. Other backend paths return 404. Query parameters must be URL encoded.

Client text frame:

```json
{"type":"chat","text":"Hello!"}
```

Nonempty trimmed text, at most 2000 UTF-16 code units before trimming. Binary frames and invalid JSON/payloads are rejected. Extra object fields are ignored. Server frames:

- `{"type":"history","messages":[],"count":1}` immediately on connection. Messages contain the same fields as a live `chat` event, oldest first.
- `{"type":"chat","id":"uuid","name":"Alex","text":"Hello!","timestamp":1790000000000}` broadcasts to every connection in the room, including the sender, after persistence.
- `{"type":"presence","event":"join","name":"Alex","count":2}` (or `leave`). Count means connections, not unique nicknames. Join is also sent to the joining client.
- `{"type":"error","code":"invalid_json","message":"Malformed JSON."}`. Other codes: `invalid_message`, `too_large`, `rate_limit`. Errors do not close the socket or enter history.

All inbound frames count toward 10 frames per 10 seconds per connection, stored in a WebSocket attachment so hibernation preserves the limit. Frames over 16000 string code units are rejected before JSON parsing. A transport-level oversized frame may be closed by the runtime instead. Nicknames are not identities and can be duplicated or impersonated. History stores the last 50 chat messages; presence is ephemeral. The browser reconnects with exponential backoff, jitter and a 30-second base-delay cap, loads history and deduplicates message IDs. Unsent messages are not queued or retried.

## Limits

**Public, unauthenticated proof of concept. Do not share private information.** Anyone can read a named room and impersonate a nickname. There is no moderation, durable identity, delivery acknowledgement, end-to-end encryption, global abuse prevention, or room listing. The backend is also publicly reachable. Per-connection rate limits can be bypassed by reconnecting. Room capacity is 100 connections, but room creation is not globally limited; operators must monitor usage and billing.

History is bounded to 50 messages per room. A 24-hour alarm after the latest connection or accepted message deletes all room storage if no clients remain. Connected rooms reschedule the alarm daily; cleanup may therefore occur up to 24 hours after the last disconnect, or later if the platform delays execution. Durable Object identity can remain addressable after data deletion. Connection names/rate state use hibernatable WebSocket attachments; no heartbeat timers keep the object awake. Browser messages use `textContent` and the frontend adds a restrictive CSP. Transport disconnects during deployments can cause temporary presence inaccuracies; reconnects restore history, not guaranteed exactly-once delivery.

Implementation follows Cloudflare's [WebSocket hibernation example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) and [Durable Object guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
