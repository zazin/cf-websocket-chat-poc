# Production POC deployment

Deployed using `npx wrangler deploy` on 2026-11-09.

- Frontend: https://edge-chat-frontend-54a16de8.zazin.workers.dev
- Backend: https://edge-chat-backend-54a16de8.zazin.workers.dev
- Backend version: c43c867a-f61f-449a-9713-a103282dd580
- Frontend version: 68e291f3-f4f2-4838-b759-d07877ef2c13

## Verified against deployed production endpoints

```sh
npm run test:integration -- https://edge-chat-frontend-54a16de8.zazin.workers.dev https://edge-chat-backend-54a16de8.zazin.workers.dev
npm run test:browser -- https://edge-chat-frontend-54a16de8.zazin.workers.dev
```

Both commands exited 0.

Integration: both health endpoints, input validation, frontend asset, bidirectional WebSocket broadcast across frontend service binding and direct backend, join/leave presence, room isolation, reconnect history, malformed JSON, invalid payload, oversized text rejection and per-connection rate limiting passed.

Browser: desktop/mobile contexts connected and exchanged messages through actual UI; literal HTML text rendered safely; automatic reconnect after transport interruption and persisted history recovery passed. No page errors were observed.

Public unauthenticated POC: nicknames are not verified identities, rooms are not private, and anybody can access the deployment. Message history is bounded to 50 messages per room; idle history is cleaned after approximately 24 hours. This is not a production-hardened service with comprehensive abuse prevention or spending controls.
