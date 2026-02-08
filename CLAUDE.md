# Food Scanner

## STATUS: PRODUCTION

Delete unused code immediately. No deprecation warnings needed.

---

## TECH STACK

Next.js 16+ (App Router), TypeScript (strict), Tailwind CSS + shadcn/ui, Vitest + Testing Library, PostgreSQL + Drizzle ORM, iron-session (cookie transport) + PostgreSQL (session data), Google OAuth 2.0 + Fitbit OAuth 2.0, Anthropic Claude API (tool_use), pino logging, Railway deployment.

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
src/app/           # Next.js App Router pages and API routes
src/components/    # React components (shadcn/ui in ui/)
src/hooks/         # Custom React hooks
src/db/            # Drizzle schema (source of truth), connection, migrations
src/lib/           # Business logic modules — route handlers never import from src/db/ directly
src/types/         # Shared TypeScript types (source of truth for API contracts)
drizzle/           # Generated SQL migration files (never hand-write — use drizzle-kit generate)
```

**Test file convention:** Colocated `__tests__/` subdirectories (e.g., `src/lib/__tests__/session.test.ts`).

---

## STYLE (deviations from defaults only)

- **Use `@/` path alias** for all imports (e.g., `import { getSession } from '@/lib/session'`)
- **Prefer `interface` over `type`** for object shapes
- Server Components by default; `'use client'` only when needed
- API responses use standardized format — see `src/lib/api-response.ts` and `ErrorCode` in `src/types/index.ts`

---

## KNOWN ACCEPTED PATTERNS

Do NOT flag these in code reviews:

- **Double casts on Fitbit API responses:** `data as unknown as Type` in `src/lib/fitbit.ts` — accepted because critical fields are runtime-validated immediately after
- **String literals in Drizzle test mocks:** Using string values instead of real Drizzle column objects in test `where()` clauses — TypeScript catches column name typos at compile time

---

## SECURITY

- **Authorized users only** — `ALLOWED_EMAILS` allowlist enforced at Google OAuth callback
- **Never log:** Cookie values, access tokens, images, user descriptions
- **Client-side logging:** `console.error`/`console.warn` are correct for `'use client'` components — pino is server-only
- **Image validation:** Max 10MB/image, max 3 images, JPEG/PNG/GIF/WebP/HEIC. HEIC converted client-side via heic2any.

---

## DATABASE

- **Tables:** `users`, `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries`
- All DB access through `src/lib/` modules — route handlers never import from `src/db/` directly
- Schema changes: edit `src/db/schema.ts`, then `npx drizzle-kit generate` (does NOT need a live DB)
- **IMPORTANT: Never hand-write migration files or snapshots**
- Log potential production data migrations in `MIGRATIONS.md` (description only, no code)

---

## ENVIRONMENTS

| Environment | Branch | URL | Fitbit API |
|---|---|---|---|
| Production | `release` | `food.lucaswall.me` | Live |
| Staging | `main` | Railway-generated URL | Dry-run (`FITBIT_DRY_RUN=true`) |

**Promotion:** `main` → `release` via `/push-to-production` skill only.
**Env vars:** See `.env.sample`. MCP Fitbit credentials are shell-only (not in Railway).

---

## SUBAGENTS

| Agent | Model | Purpose | Trigger |
|---|---|---|---|
| **verifier** | Haiku | Test + build validation | Proactively after code changes, "run tests" |
| **pr-creator** | Sonnet | Full PR workflow | Only when explicitly requested |
| **bug-hunter** | Sonnet | Code review for bugs | Proactively before commits |

**IMPORTANT:** pr-creator only creates PRs when **explicitly requested**. Never auto-commit or auto-PR.

---

## SKILLS

| Skill | Trigger | What It Does |
|---|---|---|
| **plan-implement** | "implement the plan" | Agent team parallel PLANS.md execution |
| **plan-backlog** | "plan FOO-123" | Convert Linear Backlog issues to Todo |
| **plan-inline** | Direct feature request | Create issues in Todo from free-form requests |
| **plan-fix** | Bug report | Investigate and create fix plan |
| **code-audit** | "audit the codebase" | Agent team review → Linear Backlog issues |
| **investigate** | "check why X is failing" | Read-only investigation |
| **add-to-backlog** | "add to backlog" | Convert ideas to Linear Backlog issues |
| **backlog-refine** | "refine FOO-123" | Interactive refinement of vague issues |
| **plan-review-implementation** | After plan-implement | Agent team QA review |
| **frontend-review** | "review frontend" | Agent team frontend review |
| **tools-improve** | Before modifying skills/agents/CLAUDE.md | Best practices for Claude Code extensibility |
| **push-to-production** | "push to production", "release" | Backup DB, migrate, merge `main` → `release` |

**Workflow:** `code-audit`/`add-to-backlog` → `backlog-refine` (optional) → `plan-backlog` → `plan-implement` → `plan-review-implementation` (repeat) → `push-to-production`

---

## LINEAR INTEGRATION

- **Team:** "Food Scanner" | **Prefix:** FOO-xxx
- **States:** Backlog → Todo → In Progress → Review → Merge → Done
- **Labels:** Security, Bug, Performance, Convention, Technical Debt, Feature, Improvement
- **CRITICAL:** Skills using Linear tools (`mcp__linear__*`) MUST verify MCP is connected first via `mcp__linear__list_teams`. If unavailable, **STOP** and tell the user to run `/mcp`.

---

## DEVELOPMENT POLICIES

- **Log migrations in MIGRATIONS.md** — When a change could require production data migration, append a description. Do NOT write migration code.
- **Mobile-first design** — All UI must work on mobile. Touch targets at least 44px x 44px.
- **Keep documentation current** — Update `CLAUDE.md`, `README.md`, `DEVELOPMENT.md` in the same changeset when structure, APIs, env vars, or deployment changes.
- **No co-author attribution** — Commit messages must NOT include `Co-Authored-By` tags.
- **Zero warnings policy** — Build and lint must produce zero warnings. Fix immediately.
- **PWA configured** — `public/manifest.json`, icons in `public/`. No service worker.
