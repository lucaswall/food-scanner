# Food Scanner - Technical Reference

## STATUS: DEVELOPMENT

Breaking changes OK. No backward compatibility required. Delete unused code immediately.

---

## PROJECT OVERVIEW

Single-user web application for logging food to Fitbit using AI-powered nutritional analysis. User takes photos of food, adds optional text description, Claude Sonnet analyzes nutrition information via tool_use, user confirms/edits, and data is posted directly to Fitbit API.

**Single authorized user:** wall.lucas@gmail.com
**Database:** PostgreSQL via Drizzle ORM — sessions, Fitbit tokens, and food logs stored in DB. iron-session cookies used for session ID transport only.

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16+ (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + shadcn/ui |
| Testing | Vitest + Testing Library |
| Database | PostgreSQL + Drizzle ORM |
| Session | iron-session (cookie transport) + PostgreSQL (session data) |
| Auth | Google OAuth 2.0 + Fitbit OAuth 2.0 |
| AI | Anthropic Claude API (tool_use) |
| Logging | pino (structured JSON, Railway-optimized) |
| Deployment | Railway (single service, custom domain) |

---

## COMMANDS

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build (next build)
npm start            # Start production server
npm run lint         # ESLint check
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm test             # Run tests
```

---

## STRUCTURE

```
food-scanner/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout
│   │   ├── page.tsx                      # Landing page (public)
│   │   ├── global-error.tsx              # Global error boundary
│   │   ├── app/
│   │   │   └── page.tsx                  # Protected food logging page
│   │   ├── settings/
│   │   │   └── page.tsx                  # Settings (reconnect Fitbit, logout)
│   │   └── api/
│   │       ├── health/route.ts           # Health check (public)
│   │       ├── auth/
│   │       │   ├── google/route.ts       # Initiate Google OAuth
│   │       │   ├── google/callback/route.ts
│   │       │   ├── fitbit/route.ts       # Initiate Fitbit OAuth
│   │       │   ├── fitbit/callback/route.ts
│   │       │   ├── session/route.ts      # Validate session
│   │       │   └── logout/route.ts       # Destroy session
│   │       ├── analyze-food/route.ts     # Claude tool_use analysis
│   │       ├── find-matches/route.ts     # Food matching (keyword + nutrient)
│   │       └── log-food/route.ts         # Fitbit search + create + log
│   ├── components/                       # React components
│   │   ├── food-match-card.tsx           # Food match card (reuse suggestion)
│   │   └── ui/                           # shadcn/ui components
│   ├── hooks/
│   │   ├── use-keyboard-shortcuts.ts     # Keyboard shortcuts (Ctrl+Enter, Escape)
│   │   └── use-theme.ts                  # Dark mode with localStorage persistence
│   ├── db/
│   │   ├── schema.ts                     # Drizzle schema (source of truth for DB tables)
│   │   ├── index.ts                      # Singleton DB connection (getDb)
│   │   └── migrate.ts                    # Migration runner (called at startup)
│   ├── lib/
│   │   ├── session.ts                    # iron-session config + getSession() (DB-backed)
│   │   ├── session-db.ts                 # Session CRUD (createSession, getSessionById, touchSession, deleteSession)
│   │   ├── fitbit-tokens.ts              # Fitbit token CRUD (getFitbitTokens, upsertFitbitTokens, deleteFitbitTokens)
│   │   ├── food-log.ts                   # Food log insert (insertCustomFood, insertFoodLogEntry, getCustomFoodById)
│   │   ├── food-matching.ts              # Food matching engine (keyword ratio + nutrient tolerance)
│   │   ├── api-response.ts              # Standardized API response helpers
│   │   ├── url.ts                        # APP_URL helper + buildUrl()
│   │   ├── logger.ts                     # pino structured logging
│   │   ├── utils.ts                      # shadcn/ui cn() utility
│   │   ├── claude.ts                     # Claude API client (tool_use)
│   │   ├── fitbit.ts                     # Fitbit API client
│   │   ├── auth.ts                       # OAuth helpers (Google, Fitbit)
│   │   └── haptics.ts                    # Mobile haptic feedback (Vibration API)
│   ├── types/                            # Shared TypeScript types
│   └── test-setup.ts                     # Vitest global test setup
├── drizzle/                              # Generated SQL migration files
├── drizzle.config.ts                     # Drizzle Kit configuration
├── docker-compose.yml                    # Local Postgres for development
├── middleware.ts                          # Auth enforcement for protected routes
├── CLAUDE.md                             # This file
├── DEVELOPMENT.md                        # Local setup guide
├── README.md                             # Deployment & operations guide
└── PLANS.md                              # Current implementation plan (when active)
```

**Test file convention:** Tests are colocated with source files in `__tests__/` subdirectories (e.g., `src/lib/__tests__/session.test.ts`, `src/app/api/auth/google/__tests__/route.test.ts`).

---

## STYLE GUIDE

### TypeScript
- **Strict mode** enabled (tsconfig.json)
- **No `any`** casts without justification
- **Use `@/` path alias** for imports (e.g., `import { getSession } from '@/lib/session'`)
- **Prefer `interface` over `type`** for object shapes
- **Use `const` by default**, `let` only when reassignment needed

### Naming
- **Files:** kebab-case (`analyze-food`, `log-food`)
- **Components:** PascalCase (`FoodAnalysis`, `MealTypeSelector`)
- **Functions/variables:** camelCase (`getSession`, `fitbitToken`)
- **Types/interfaces:** PascalCase (`SessionData`, `FoodAnalysis`)
- **Constants:** UPPER_SNAKE_CASE (`FITBIT_MEAL_TYPES`)

### React Components
- Use Server Components by default (Next.js App Router)
- Mark client components with `'use client'` only when needed (interactivity, hooks)
- Keep components small and focused
- Use shadcn/ui components for UI elements

### Error Handling
- API routes return standardized responses:
  ```typescript
  // Success
  { success: true, data: T, timestamp: number }
  // Error
  { success: false, error: { code: string, message: string }, timestamp: number }
  ```
- Use error codes defined in `src/types/index.ts` (`ErrorCode` type)

---

## API ENDPOINTS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| POST | `/api/auth/google` | No | Initiate Google OAuth |
| GET | `/api/auth/google/callback` | No | Google OAuth callback |
| POST | `/api/auth/fitbit` | Yes | Initiate Fitbit OAuth |
| GET | `/api/auth/fitbit/callback` | Yes | Fitbit OAuth callback |
| GET | `/api/auth/session` | Yes | Validate current session |
| POST | `/api/auth/logout` | Yes | Destroy session cookie |
| POST | `/api/analyze-food` | Yes | Claude analysis (multipart/form-data) |
| POST | `/api/find-matches` | Yes | Find matching foods (keyword + nutrient) |
| POST | `/api/log-food` | Yes | Post to Fitbit |

**Auth enforcement:** Next.js middleware (`middleware.ts`) checks for session cookie on all protected routes. Route handlers validate session contents via iron-session.

---

## SECURITY

- **Single user only:** wall.lucas@gmail.com — enforced at Google OAuth callback
- **iron-session:** Encrypted httpOnly cookies (AES-256-CBC + HMAC-SHA-256)
- **Cookie flags:** httpOnly, secure, sameSite: lax, 30-day expiry
- **No public API surface** for unauthenticated users (except landing page and health check)
- **Image validation:** Max 10MB per image, max 3 images, JPEG/PNG/GIF/WebP/HEIC supported
- **HEIC conversion:** HEIC/HEIF images are converted to JPEG client-side via heic2any library before upload
- **Client-side compression:** Resize to ~1024px, 80% JPEG quality before upload
- **Never log:** Cookie values, access tokens, images, user descriptions

---

## PWA

The app is configured as a Progressive Web App for "Add to Home Screen" functionality on mobile devices.

**Assets:**
- `public/manifest.json` — PWA manifest with app metadata
- `public/icon-192.png` — 192x192 app icon
- `public/icon-512.png` — 512x512 app icon

**Features:**
- Standalone display mode (no browser chrome)
- Portrait orientation
- Apple touch icon for iOS
- Theme color integration

**Not included:** Service worker, offline support

**Icon replacement:** The placeholder icons can be replaced with branded icons. Maintain the same filenames and dimensions.

---

## DATABASE

- **ORM:** Drizzle ORM with `pg` driver
- **Schema:** Defined in TypeScript at `src/db/schema.ts` (source of truth for DB tables)
- **Tables:** `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries`
- **Migrations:** Generated via `npx drizzle-kit generate`, applied at startup via programmatic `migrate()` in `src/db/migrate.ts`
- **Connection:** Singleton via `getDb()` in `src/db/index.ts`
- **Local dev:** Docker Compose Postgres (`docker compose up -d`)
- **Production:** Railway Postgres (`DATABASE_URL` reference variable)

### Conventions
- Use Drizzle query builder — **never raw SQL**
- All DB access through `src/lib/` modules (`session-db.ts`, `fitbit-tokens.ts`, `food-log.ts`) — route handlers never import from `src/db/` directly
- Schema changes: edit `src/db/schema.ts`, then run `npx drizzle-kit generate` to create migration
- Migration files in `drizzle/` must be committed to git
- **Never hand-write migration files or snapshots** — always run `npx drizzle-kit generate`. It does NOT need a live database; it diffs `src/db/schema.ts` against the previous snapshot locally.

---

## SUBAGENTS

| Agent | Model | Purpose | Trigger |
|-------|-------|---------|---------|
| **verifier** | Haiku | Test + build validation | Proactively after code changes, "run tests" |
| **commit-bot** | Sonnet | Create commits | Only when explicitly requested |
| **pr-creator** | Sonnet | Full PR workflow | Only when explicitly requested |
| **bug-hunter** | Opus | Code review for bugs | Proactively before commits |

**Critical rule:** Git agents (commit-bot, pr-creator) only commit/PR when **explicitly requested** by the user. Never auto-commit.

---

## SKILLS

| Skill | Trigger | What It Does |
|-------|---------|--------------|
| **plan-implement** | "implement the plan" | Agent team parallel PLANS.md execution with file-partitioned workers (falls back to single-agent) |
| **plan-backlog** | "plan FOO-123" | Convert Linear Backlog issues to Todo state |
| **plan-inline** | Direct feature request | Create issues in Todo state from free-form requests |
| **plan-fix** | Bug report | Investigate and create fix plan |
| **code-audit** | "audit the codebase" | Agent team (3 reviewers: security, reliability, quality) → create Linear Backlog issues (falls back to single-agent) |
| **investigate** | "check why X is failing" | Read-only investigation, report findings |
| **add-to-backlog** | "add to backlog" | Convert ideas to structured Linear Backlog issues |
| **backlog-refine** | "refine FOO-123" | Interactive refinement of vague Backlog issues via discussion |
| **plan-review-implementation** | After plan-implement | Agent team (3 reviewers: security, reliability, quality) QA review, create fix issues or mark COMPLETE (falls back to single-agent) |
| **frontend-review** | "review frontend", "check UI/UX" | Agent team (3 reviewers: accessibility, visual/UX, performance) → consolidated frontend report (falls back to single-agent) |
| **tools-improve** | Before modifying skills/agents | Best practices for Claude Code extensibility |

**Skill workflow:** `code-audit`/`add-to-backlog` → `backlog-refine` (optional) → `plan-backlog` → `plan-implement` → `plan-review-implementation` (repeat)

---

## LINEAR INTEGRATION

- **Team:** "Food Scanner"
- **Issue Key Prefix:** FOO-xxx
- **States:** Backlog → Todo → In Progress → Review → Merge → Done
- **Labels:** Security, Bug, Performance, Convention, Technical Debt, Feature, Improvement
- **Priorities:** 1 (Urgent), 2 (High), 3 (Medium), 4 (Low)

---

## MCP SERVERS

### Railway (deployment)
- **Read-only access:** Logs, deployments, services, variables
- **Write access denied:** Deploy, create-environment, set-variables
- **Usage:** Check deployment status, read logs for debugging

### Linear (issue tracking)
- **Full access:** Create/update issues, manage labels, projects
- **Authentication:** OAuth via `/mcp` command
- **Usage:** Issue management across all skills
- **CRITICAL:** Any skill that uses Linear tools (`mcp__linear__*`) MUST verify Linear MCP is connected before proceeding. Test by calling `mcp__linear__list_teams`. If the tool is unavailable or errors, **STOP immediately** and tell the user: "Linear MCP is not connected. Run `/mcp` to reconnect, then re-run this skill." Do NOT silently fall back or continue without Linear.

---

## ENVIRONMENT VARIABLES

```
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Fitbit OAuth
FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=

# Anthropic
ANTHROPIC_API_KEY=

# Session (iron-session password, min 32 characters)
SESSION_SECRET=

# App URL (public domain, used for OAuth redirect URIs)
APP_URL=https://food.lucaswall.me

# Auth
ALLOWED_EMAIL=wall.lucas@gmail.com

# Logging (optional, defaults to info in production, debug in development)
LOG_LEVEL=info
```

---

## DEVELOPMENT POLICIES

- **Breaking changes OK** — No backward compatibility required
- **Delete unused code immediately** — No deprecation warnings
- **No "for compatibility" code** — When changing APIs, update ALL references
- **Mobile-first design** — All UI components must work on mobile
- **Touch targets** — All interactive elements (buttons, links) must be at least 44px x 44px
- **Same-origin deployment** — No CORS, no cross-domain cookie issues
- **Keep documentation current** — When making changes that affect project structure, APIs, environment variables, setup steps, or deployment, update all relevant documentation files (`CLAUDE.md`, `README.md`, `DEVELOPMENT.md`) in the same changeset. Documentation must never drift from the actual codebase.
- **No co-author attribution in commits** — Commit messages must NOT include `Co-Authored-By` tags. This applies to all commits created by agents (commit-bot, pr-creator) and skills.
- **Zero warnings policy** — Build and lint must produce zero warnings. Fix all warnings immediately, including pre-existing ones. Use framework-appropriate solutions (e.g., `next/image` instead of `<img>`).
