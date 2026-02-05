# Development Guide

## Prerequisites

- Node.js 20+
- npm
- Git
- [Railway CLI](https://docs.railway.com/guides/cli) (for deployment monitoring)

## Local Setup

### 1. Clone and Install

```bash
git clone git@github.com:lucaswall/food-scanner.git
cd food-scanner
npm install
```

### 2. Environment Variables

Create `.env.local`:

```bash
# Session (iron-session password, min 32 characters)
# Generate with: openssl rand -base64 32
SESSION_SECRET=at-least-32-characters-long-random-string

# App URL (must match OAuth redirect URIs)
APP_URL=http://localhost:3000

# Auth
ALLOWED_EMAIL=wall.lucas@gmail.com

# Google OAuth (see OAuth Setup for Local Development section below)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Fitbit OAuth (see OAuth Setup for Local Development section below)
FITBIT_CLIENT_ID=your-fitbit-client-id
FITBIT_CLIENT_SECRET=your-fitbit-client-secret

# Anthropic (see Anthropic API Setup section below)
ANTHROPIC_API_KEY=your-anthropic-api-key

# Logging (optional, defaults to debug in development)
LOG_LEVEL=debug
```

Google and Fitbit OAuth credentials are required for the auth flow. See the **OAuth Setup for Local Development** section below. Anthropic API key is required for food analysis — see the **Anthropic API Setup** section below.

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Verify

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
| `npm test` | Run tests |

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

This project is in **active development**. Breaking changes are expected and acceptable.

- No backward compatibility required
- Delete unused code immediately
- No deprecation warnings needed
- When changing APIs/configs, update ALL references

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
- **commit-bot** — Creates commits (only when asked)
- **pr-creator** — Full PR workflow (only when asked)
- **bug-hunter** — Reviews code for bugs (use proactively before commits)

### Skills (invoke with `/skill-name`)
- `/plan-todo FOO-123` — Plan implementation of a backlog issue
- `/plan-inline <description>` — Plan from a direct description
- `/plan-implement` — Execute the current plan
- `/plan-review-implementation` — Review completed implementation
- `/plan-fix <bug>` — Investigate and plan a bug fix
- `/investigate <issue>` — Read-only investigation
- `/code-audit` — Full codebase audit
- `/add-to-backlog <items>` — Add issues to Linear backlog

### Typical Workflow
1. `/plan-todo FOO-123` or `/plan-inline <feature>` — Create plan
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

Copy the Client ID and Client Secret values into your `.env.local` file.

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
