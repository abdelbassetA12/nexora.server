# NEXORA server (standalone)

Node.js + Express + MongoDB + Socket.IO. Independent project: its own `package.json` and `node_modules`; nothing else is needed to run it.

```bash
cd nexora-server
npm install
npm run db:up          # MongoDB in Docker (or point MONGODB_URI at your own MongoDB)
npm run setup          # creates .env with fresh random JWT secrets
npm run seed           # optional sample data; prints sample emails + a random password once
npm run dev            # http://localhost:4000   (health: /health)
```
Other commands: `npm test` (Vitest, in-memory MongoDB, needs internet the first time), `npm run build && npm start` (compiled), `npm run typecheck`.

- API: `/api/v1/...` (see `../docs/API.md`), Socket.IO on the same port.
- Development emails are not delivered; verification/reset codes are printed in this terminal.
- Validation schemas live in `src/shared/` (a copy also exists in `../nexora-mobile/src/shared/`; keep them in sync, see the root README).
- Not run by the author (no network in the build sandbox): expect to fix small issues on first start.
