# Post-PR CI Merge Monitor — Per-Tick Logic

This is the per-tick workflow for the cron monitor created by
`plan-review-implementation` after the PR is created and its `bug-hunter`
review is clean. The cron fires every 3 minutes; each firing runs **one**
iteration of the steps below. Read this file at the start of each tick — do
not rely on memory between firings.

**Merge rule:** a PR is ready to merge when CI (GitHub Actions) is green on the
current HEAD and the review findings are fixed. The review ran before this
monitor started; every commit the monitor pushes gets its own `bug-hunter`
pass before the push, so the second half of the rule stays true.

## Inputs (from the cron prompt)

- `PR_NUMBER` — the PR being monitored
- `BRANCH` — the head branch (used for sanity checks and merge cleanup)
- `MONITOR_TAG` — a unique substring (e.g., `"CI monitor for PR <N>"`) so
  the tick can locate its own cron via `CronList` for self-deletion

## Per-Tick Steps

### Step 1 — Read state

Run both in parallel (single message, 2 Bash calls):

```bash
# PR state, HEAD, mergeability and every check on HEAD
gh pr view <PR_NUMBER> --json state,headRefOid,mergeable,statusCheckRollup

# Human-readable check list with run links (for log lookups)
gh pr checks <PR_NUMBER>
```

Capture:
- `PR_STATE` — `OPEN | MERGED | CLOSED`
- `HEAD_SHA` — `headRefOid`
- `MERGEABLE` — `MERGEABLE | CONFLICTING | UNKNOWN`
- `CI_STATE`, derived from `statusCheckRollup`:
  - `fail` — any check run completed with `FAILURE`, `TIMED_OUT`, `CANCELLED` or `ACTION_REQUIRED` (or a status context in `FAILURE`/`ERROR`)
  - `pending` — any check not yet `COMPLETED`, or no checks reported on HEAD yet (but see "No CI expected" below)
  - `pass` — every check `COMPLETED` with `SUCCESS`, `SKIPPED` or `NEUTRAL` (CI jobs: `lint-typecheck`, `unit-tests`, `build`, `e2e`)

**No CI expected:** `.github/workflows/ci.yml` runs on pull requests only when
they touch a path in its `pull_request.paths` list. If
`git diff --name-only origin/main...HEAD` matches none of those paths (e.g. a
docs/tooling-only PR), CI will never report — treat `CI_STATE` as `pass`.

**Short-circuit:** if `PR_STATE` is `MERGED` or `CLOSED`, skip to Step 3.3
(self-terminate) — someone else closed the PR; the monitor's job is done.

### Step 2 — CI assessment

| `CI_STATE` | Action |
|---|---|
| `fail` | Fix the failure (below). End tick. |
| `pending` | End tick — wait for CI. If CI is expected but no check has appeared on HEAD 15 minutes after it was pushed (`git log -1 --format=%cI <HEAD_SHA>`), the workflow did not trigger: self-terminate, leave the PR open and tell the user. |
| `pass` | Continue to Step 3. |

Treat a mixed or unclear state (a check missing, one still queued) as
`pending`. Never merge while any check is unresolved.

#### Fixing a CI failure

1. **Cap:** count earlier fixes with `git log --oneline origin/main..HEAD --grep='^ci-fix:'`. If there are already 3, stop: leave the PR open, self-terminate, and report the failing check and a log summary to the user. Repeated CI failures are the user's call.
2. **Fetch the failing logs:** `gh run view <run-id> --log-failed` (run id from the `gh pr checks` link, or `gh run list --branch <BRANCH> --limit 5`).
3. **Diagnose** from the log and the cited code. A code bug gets a TDD fix (failing test → fix → pass). A flaky test is a bug too — fix the test. Never skip or delete a test, loosen a threshold, or disable a check to get green.
4. **Verify:** run `npm test` (for an `e2e` failure, also the `verifier` agent in E2E mode), then `bug-hunter` (standalone subagent, no `team_name`) on the uncommitted fix. Fix its real findings the same way.
5. **Commit and push** with a simple `-m` (no heredoc, no `$()`): `git commit -m "ci-fix: <summary>"`, then `git push`. The next tick re-reads CI.

### Step 3 — Merge phase (CI green)

1. **Re-verify** with a fresh `gh pr view <PR_NUMBER> --json state,headRefOid,mergeable,statusCheckRollup`: PR still `OPEN`, `headRefOid` still `HEAD_SHA`, `CI_STATE` still `pass`, and `MERGEABLE` is `MERGEABLE`. If HEAD moved or `MERGEABLE` is `UNKNOWN` (GitHub still computing), end tick. If `CONFLICTING`, see Failure Modes.
2. **Merge:**
   ```bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   git checkout main
   git pull
   ```
   `gh pr merge --delete-branch` deletes both the local and remote branch
   automatically (it switches off the branch first if needed).
3. **Self-terminate** (locate and delete the cron):
   ```
   CronList                       # find the entry whose prompt contains MONITOR_TAG
   CronDelete id=<that-id>
   ```
4. **Inform the user** with the final outcome:
   - PR merged (or found already merged/closed), branch deleted, on `main`
   - Number of `ci-fix:` commits the monitor pushed

## Failure Modes

| Situation | Action |
|---|---|
| `gh pr merge` rejects, or `MERGEABLE` is `CONFLICTING` | Do NOT delete the cron. Inform the user with the gh error and end the tick. The user can rebase or abort; the monitor picks up the new HEAD. |
| `git pull` after merge has conflicts | Stash/abort cleanly, inform user. The merge already succeeded; this is just local sync. |
| CronDelete fails (cron not found) | Inform user; instruct them to run `/cron list` and `/cron delete <id>` manually. |
| New commits pushed by another author mid-loop | Continue normally — the tick reads the latest HEAD and CI re-runs on it. |
| CI green, then a later push turns it red | Step 3 re-verification catches it; Step 2 handles the failure. |
| PR closed/merged externally | Step 1 short-circuit — self-terminate immediately. |
| 3 `ci-fix:` commits and CI still red | Step 2 cap — stop, PR left open, hand back to the user. |

## Bounds

The cron is intentionally **session-only** (`CronCreate` called without
`durable: true`). If the user closes their Claude session, the cron dies —
this is the correct behavior, since the user is no longer supervising the
auto-merge. The session-only cron's recurring jobs also auto-expire after
7 days. In practice this loop self-terminates within one or two CI runs of
PR creation.
