# Development Guide

## Prerequisites

- Node.js 20+
- npm
- Git
- Docker (via [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [OrbStack](https://orbstack.dev/)) — for local PostgreSQL
- [Railway CLI](https://docs.railway.com/guides/cli) (for deployment monitoring)

## Local Setup

### 1. Clone and Install

```bash
git clone git@github.com:lucaswall/food-scanner.git
cd food-scanner
npm install
```

### 2. Start Database

```bash
docker compose up -d
```

This starts a local PostgreSQL instance on port 5432. To stop it:

```bash
docker compose down        # Stop (data persisted)
docker compose down -v     # Stop and delete all data
```

### 3. Environment Variables

The fastest way to set up your `.env.local` is to pull variables from Railway and override the ones that differ locally.

**Option A: Pull from Railway (recommended)**

```bash
# Requires Railway CLI linked to the project (see Railway CLI Setup below)
railway variables --kv > .env.local
```

Then edit `.env.local` and override these values for local development:

| Variable | Change to | Why |
|----------|-----------|-----|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/food_scanner` | Use local Docker Postgres instead of Railway Postgres |
| `APP_URL` | `http://localhost:3000` | Local dev server, not production domain |
| `LOG_LEVEL` | `debug` (optional) | More verbose logging during development |
| `FITBIT_DRY_RUN` | `true` (optional) | Skip Fitbit API calls, log to DB only |

Remove any Railway-internal variables (e.g., `RAILWAY_*`, `PORT`) — they're not needed locally.

**Option B: Start from sample file**

```bash
cp .env.sample .env.local
```

Then fill in the secrets. See `.env.sample` for all required variables with comments. You'll need to provide:
- `SESSION_SECRET` — generate with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — see **OAuth Setup for Local Development** below
- `ANTHROPIC_API_KEY` — see **Anthropic API Setup** below

> **Note:** Fitbit credentials (`FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET`) are no longer in env vars. Each user enters their own Fitbit Personal app credentials through the app's setup flow at `/app/setup-fitbit`.

> **Note:** Migrations run automatically when you start the dev server (`npm run dev`).

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Verify

```bash
curl http://localhost:3000/api/health
```

Should return `{ "success": true, "data": { "status": "ok" }, "timestamp": ... }`.

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm test` | Run unit/integration tests |
| `npm run e2e` | Run E2E tests (Playwright) |
| `docker compose up -d` | Start local PostgreSQL |
| `docker compose down` | Stop local PostgreSQL |
| `npx drizzle-kit generate` | Generate migration from schema changes |
| `npx drizzle-kit studio` | Open Drizzle Studio (DB browser) |

---

## E2E Testing

End-to-end tests use Playwright to test the full application stack against a production build.

### Prerequisites

1. **Docker PostgreSQL** must be running (`docker compose up -d`)
2. **Chromium browser** installed (one-time setup):
   ```bash
   npx playwright install chromium
   ```

### Running E2E Tests

```bash
npm run e2e
```

This will:
1. Load environment variables from `.env.test`
2. Build the application (`npm run build`)
3. Start the production server on port 3001
4. Run global setup:
   - Truncate all database tables
   - Authenticate via test-login endpoint (creates test user + session)
   - Seed test data (custom foods, food log entries)
   - Save session cookies to storage state
5. Run all E2E tests (13 tests covering landing, auth, dashboard, settings)
6. Capture screenshots to `e2e/screenshots/` (landing.png, dashboard.png, settings.png)
7. Run global teardown (truncate DB, close connections)

### Test Environment

E2E tests use `.env.test` for configuration. This file is checked into git (contains no secrets) and configured with:
- `DATABASE_URL` → local Docker Postgres (`food_scanner` database)
- `ENABLE_TEST_AUTH=true` → enables test-only auth bypass route
- `FITBIT_DRY_RUN=true` → skips Fitbit API calls
- `PORT=3001` → production server port (avoids conflict with dev server on 3000)
- Test values for Google OAuth, Anthropic API (not actually called in smoke tests)

### Test Structure

```
e2e/
├── fixtures/
│   ├── auth.ts        # Authentication helpers (storage state path, unauthenticated constant)
│   └── db.ts          # Database utilities (seed, truncate)
├── tests/
│   ├── health.spec.ts        # API health check
│   ├── landing.spec.ts       # Landing page (unauthenticated)
│   ├── auth.spec.ts          # Auth redirects (unauthenticated + authenticated)
│   ├── dashboard.spec.ts     # Dashboard smoke tests
│   └── settings.spec.ts      # Settings page smoke tests
├── global-setup.ts    # Runs before all tests (truncate, auth, seed)
└── global-teardown.ts # Runs after all tests (cleanup)
```

### Test Data

The test-login endpoint (`POST /api/auth/test-login`) is gated by `ENABLE_TEST_AUTH=true` and creates:
- Test user: `test@example.com` / `Test User`
- Test session (iron-session cookie)

Global setup seeds:
- 3 custom foods (chicken, rice, broccoli)
- 3 food log entries for today's date

### Screenshots

Screenshots are captured to `e2e/screenshots/` (gitignored) for visual review. They are overwritten on each test run (not accumulated).

### Troubleshooting

**Tests fail with "Test login failed":**
- Ensure `.env.test` has `ENABLE_TEST_AUTH=true`
- Check that Docker Postgres is running

**Tests hang during build:**
- Remove `.next/lock` file if present
- Ensure port 3001 is available (no other process using it)

**Database errors:**
- Run `docker compose down -v && docker compose up -d` to reset the DB
- Ensure `DATABASE_URL` in `.env.test` points to local Docker Postgres

---

## Project Structure

See [CLAUDE.md](CLAUDE.md) for the full project structure breakdown.

Key directories:
- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/lib/` — Shared utilities (session, API clients)
- `src/types/` — TypeScript type definitions

---

## Code Style

### TypeScript
- **Strict mode** is enabled — no implicit `any`, no unused locals/params
- Use `@/` path alias for imports: `import { getSession } from '@/lib/session'`
- Build must pass with **zero warnings**

### Formatting
- Tailwind CSS for styling (no custom CSS unless necessary)
- shadcn/ui for UI components
- Mobile-first responsive design

### Commit Messages

Format: `<type>: <summary>`

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring |
| `chore` | Build, config, dependencies |
| `docs` | Documentation |
| `test` | Tests |

Examples:
- `feat: add Google OAuth login flow`
- `fix: handle expired Fitbit tokens gracefully`
- `chore: update Next.js to 15.1`

---

## Development Status

This project is in **production**. When changes affect existing data (DB schema, session format, token format), document the migration path and inform the user in the commit/PR — no approval gate, just transparency.

- Delete unused code immediately
- No deprecation warnings needed

---

## Branch Workflow

| Branch | Deploys To | Purpose |
|--------|-----------|---------|
| `main` | Staging | Development branch, auto-deploys |
| `release` | Production | Stable branch, auto-deploys |

**Feature workflow:**
1. Create feature branch from `main`
2. PR to `main` → merge → staging auto-deploys
3. Merge `main` → `release` → production auto-deploys

**Staging** uses `FITBIT_DRY_RUN=true` to skip Fitbit API calls while preserving local DB logging.

---

## Linear Integration

Issues are tracked in Linear under the "Food Scanner" team with FOO-xxx prefix.

**State flow:** Backlog → Todo → In Progress → Review → Merge → Done

To authenticate Linear MCP, use the `/mcp` command in Claude Code.

---

## Claude Code Workflow

This project uses Claude Code with custom agents and skills for development:

### Agents
- **verifier** — Runs tests and build validation (use proactively)
- **pr-creator** — Full PR workflow (only when asked)
- **bug-hunter** — Reviews code for bugs (use proactively before commits)

### Skills (invoke with `/skill-name`)
- `/plan-backlog FOO-123` — Plan implementation of a backlog issue
- `/plan-inline <description>` — Plan from a direct description
- `/plan-implement` — Execute the current plan
- `/plan-review-implementation` — Review completed implementation
- `/plan-fix <bug>` — Investigate and plan a bug fix
- `/investigate <issue>` — Read-only investigation
- `/code-audit` — Full codebase audit
- `/add-to-backlog <items>` — Add issues to Linear backlog

### Typical Workflow
1. `/plan-backlog FOO-123` or `/plan-inline <feature>` — Create plan
2. `/plan-implement` — Execute the plan with TDD
3. `/plan-review-implementation` — Review the implementation
4. Ask for commit and PR when ready

---

## Railway CLI Setup

The Railway CLI is used to monitor deployments and read logs. See [README.md](README.md) for full deployment instructions.

```bash
# Install Railway CLI (macOS)
brew install railway

# Login
railway login

# Link to the food-scanner project (from this directory)
railway link

# Useful commands
railway logs              # Stream deploy logs
railway logs --build      # Stream build logs
railway variables          # List environment variables
railway domain             # Show or generate public URL
```

The CLI link is stored globally at `~/.railway/config.json`, not in the project directory.

---

## OAuth Setup for Local Development

Follow the [OAuth Setup section in README.md](README.md#oauth-setup) to create Google and Fitbit OAuth credentials. Then add the localhost redirect URIs to each provider:

- **Google Cloud Console** → Your OAuth client → Authorized redirect URIs → add:
  `http://localhost:3000/api/auth/google/callback`
- **Fitbit Developer** → Your app → Redirect URIs → add:
  `http://localhost:3000/api/auth/fitbit/callback`

Copy the Google Client ID and Client Secret values into your `.env.local` file. For Fitbit, enter your Personal app credentials through the setup flow at `/app/setup-fitbit` after logging in.

---

## Anthropic API Setup

The Anthropic API is used for AI-powered food analysis via Claude Sonnet.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to **API Keys** in the sidebar
4. Click **Create Key** and give it a name (e.g., "food-scanner-dev")
5. Copy the API key immediately (it won't be shown again)
6. Add the key to your `.env.local`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

**Permissions:** The API key needs standard API access. No special scopes or permissions are required.

**Costs:** Claude Sonnet is used for food analysis. Typical usage (1-3 analyses per day) costs approximately $0.02/day or ~$0.60/month. See [Anthropic pricing](https://www.anthropic.com/pricing) for current rates.
