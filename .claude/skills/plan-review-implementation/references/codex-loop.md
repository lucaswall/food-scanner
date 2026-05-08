# Post-PR Codex Review Monitor — Per-Tick Logic

This is the per-tick workflow for the cron monitor created by
`plan-review-implementation` after a successful PR. The cron fires every
3 minutes; each firing runs **one** iteration of the steps below. Read this
file at the start of each tick — do not rely on memory between firings.

## Inputs (from the cron prompt)

The cron prompt includes:
- `PR_NUMBER` — the PR being monitored
- `BRANCH` — the head branch (used for sanity checks and merge cleanup)
- `MONITOR_TAG` — a unique substring (e.g., `"Codex monitor for PR <N>"`) so
  the tick can locate its own cron via `CronList` for self-deletion

## Per-Tick Steps

### Step 1 — Read state

Run all three in parallel (single message, 3 Bash calls):

```bash
# CI status
gh pr checks <PR_NUMBER>

# PR + reactions + reviews
gh pr view <PR_NUMBER> --json headRefOid,reactionGroups,reviews,statusCheckRollup,state

# Unresolved Codex review threads
gh api graphql -f query='query {
  repository(owner: "lucaswall", name: "food-scanner") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 50) {
        nodes { id isResolved comments(first: 1) { nodes { databaseId path line body } } }
      }
    }
  }
}'
```

(Substitute `<PR_NUMBER>`. The first `gh pr view` call also returns the
HEAD oid which the next steps need.)

Capture:
- `HEAD_SHA` — the latest commit on the PR
- `PR_STATE` — `OPEN | MERGED | CLOSED`
- `CI_STATE` — `pass | pending | fail`
- `LATEST_REVIEW` — most recent Codex review (commit, body, submittedAt)
- `EYES` — whether `chatgpt-codex-connector` has 👀 reacted
- `THUMBS` — whether Codex has 👍 reacted on the PR
- `OPEN_THREADS` — list of unresolved review threads with body, path, line
- `HEAD_PUSH_TIME` — `git log -1 --format=%aI <HEAD_SHA>` (commit author/commit time)

**Short-circuit:** if `PR_STATE` is `MERGED` or `CLOSED`, skip directly to
"Self-terminate" — the user (or another flow) closed the PR; the monitor's
job is done.

### Step 2 — CI assessment

| `CI_STATE` | Action |
|---|---|
| `fail` | Fetch failing logs (`gh run view <run-id> --log-failed`). Diagnose, fix, commit, push. End tick. The next tick will re-check. |
| `pending` | End tick — wait for CI. |
| `pass` | Continue to step 3. |

If CI status is mixed or unclear (e.g., one check passing, one missing),
treat as `pending`. Never proceed to merge while any required check is
unresolved.

### Step 3 — Codex assessment (only when CI is green)

Evaluate in order — first match wins:

#### 3a. 👍 reaction present AND latest review is on HEAD_SHA AND zero unresolved threads
**Action:** STOP — proceed to step 4 (merge phase). Codex has signalled
clean review of the current HEAD.

All three conditions must hold:
- `THUMBS == true` (PR has 👍 from `chatgpt-codex-connector`).
- `LATEST_REVIEW.commit == HEAD_SHA` (the most recent Codex review is for
  the current HEAD, not a stale predecessor — PR-level reactions persist
  across pushes, so a 👍 on commit A would otherwise leak forward to a
  later, unreviewed commit B).
- Zero unresolved review threads (any open thread overrides the reaction).

If any check fails, fall through to 3b. Step 4's merge phase re-verifies
threads as a backstop, but trusting only the reaction here would skip the
"New findings on HEAD" branch entirely — which is what this guard prevents.

#### 3b. New findings on HEAD (top-level review body OR open threads)
**Action:** Assess each finding for validity, then fix or resolve.

For **each** finding:
1. **Read the cited code** (`Read` tool with file path + lines).
2. **Verify the claim**:
   - Does the described code path actually exist?
   - Does the bug actually trigger under realistic conditions?
   - Is there project-specific context (CLAUDE.md, MEMORY.md, accepted patterns) that makes this a non-issue?
3. **Decide:**
   - **Valid** → fix with TDD where appropriate (test → implement → verify), commit, push, then resolve the thread via `gh api graphql ... resolveReviewThread`.
   - **Invalid** (false positive, misread, accepted-by-design) → resolve the thread with `resolveReviewThread`. Optionally post a brief reply explaining the rejection (`gh api repos/lucaswall/food-scanner/pulls/<PR_NUMBER>/comments/<id>/replies`), but only if it adds clarity. Do not silently dismiss.

Top-level review body findings (no thread) are addressed by pushing the fix —
they do not have a thread to resolve, but the next Codex review on the new
commit confirms resolution.

After all findings are handled, end tick. The push will trigger a new Codex
review; the next tick re-evaluates.

**Critical rule:** never accept a finding on face value. Codex hallucinates,
misreads regex semantics, and sometimes flags accepted patterns that the
project has explicitly opted into. CLAUDE.md's "KNOWN ACCEPTED PATTERNS"
section and project memory list known-accepted patterns — consult them.

#### 3c. Latest review on HEAD has zero findings (no body content beyond boilerplate AND no inline threads)
**Action:** STOP — proceed to step 4. Codex reviewed and had nothing to say.

A "zero findings" review body looks like the standard `### 💡 Codex Review` /
`Reviewed commit: <sha>` boilerplate with no `P0/P1/P2/P3` badges and no
inline comments. Codex would normally use a 👍 reaction for this case;
treat the empty-body review as equivalent.

#### 3d. HEAD pushed > 15 min ago AND no review of HEAD
**Action:** STOP — proceed to step 4. Codex queue is drained or skipped this
commit.

Compute elapsed: `(now - HEAD_PUSH_TIME) > 15 minutes`. The 15-minute window
is generous — Codex normally responds within 5–10 min.

#### 3e. None of the above (eyes still on, or review pending)
**Action:** End tick. Wait for the next firing.

### Step 3.5 — Calibration (BEFORE acting on findings in 3b)

Codex finds real bugs but does not calibrate severity to the project context.
For a single-/family-scale production app like this one, race conditions
requiring sub-second concurrent timing, edge cases of opt-in extreme
configurations, and theme-cascade findings (the same root cause re-flagged
in successively narrower call sites) hit diminishing returns fast. Apply
this calibration before fixing in 3b — file-and-defer instead of fix-now
when the rules below say so.

#### Track three signals across ticks (in your turn-to-turn context)

- **Iteration count** on this PR (how many push→review cycles you have done since PR creation).
- **Theme** of each finding (1-3 word root cause label, e.g. "non-positive engine output" or "stale-write race").
- **Severity floor** crossed so far (P1 fixed? P2 fixed? P3 fixed?).

#### Decision matrix (apply per finding, not per-tick)

| Iteration | Severity | Same theme as a prior fix on this PR? | Action |
|---|---|---|---|
| 1 (first review) | any | n/a | **Fix** |
| 2 | P0/P1 | any | **Fix** |
| 2 | P2 | no | **Fix** |
| 2 | P2 | yes | **File and defer** — create Linear in `Backlog`, resolve thread with the link |
| 2 | P3 | any | **File and defer** |
| 3+ | P0/P1 | any | **Fix** |
| 3+ | P2 | no | **Fix** |
| 3+ | P2 | yes | **File and defer** |
| 3+ | P3 | any | **File and defer** |

"File and defer" means: create a Linear issue in `Backlog` (NOT Todo) labeled
`Codex follow-up`, with the finding body and the `gh` thread URL. Resolve
the Codex thread by replying with a link to the Linear issue, then resolve
via `resolveReviewThread`. The PR proceeds to merge with the issue tracked
for later prioritization.

#### Hard caps

These bypass the matrix and force a stop:

- **Iteration cap:** after 4 push→review cycles on a single PR, stop and
  defer all remaining P2/P3 findings even if they're new themes.
- **Time cap:** after 90 minutes of monitor uptime, stop. (The cron's
  session-only nature already limits reach; this is the explicit upper bound
  on engineering time.)
- **Race-condition realism cap:** any race-condition finding requiring
  concurrent sub-second timing is **automatically P3** for a
  single-/family-scale app, regardless of Codex's posted severity. The
  CLAUDE.md "STATUS: PRODUCTION" tag does not change this — production
  here means "deployed", not "high-concurrency." File and defer.

#### Theme detection

Track theme labels across the session. If you have already fixed 1 finding
with theme T, and a new finding shares theme T:

- The fact that Codex re-flagged a similar issue at a different site is
  evidence the design (not the call site) needs revisiting — but a single
  PR is not the venue for that. **File and defer.**
- The deferred Linear issue should reference the prior fix(es) so the
  follow-up author sees the cluster.

Examples of "same theme":
- "non-positive engine output" — every site filtering on `> 0` for a value
  the engine permits to be ≤ 0.
- "stale-compute race" — every code path where in-flight compute can race
  with a concurrent invalidation/PATCH.
- "missing exhaustive case" — every union-mapped switch missing a new
  variant.

#### Reporting

When you defer a finding, include in the user-facing tick summary:
> Deferred [Codex finding summary] to [Linear URL] under theme "[theme]"
> (iteration N, severity P2). PR proceeds to merge.

This makes the calibration visible to the user; if they disagree, they can
override and ask for the fix.

### Step 4 — Merge phase (when stopping)

Run all checks again before merging — state can change between ticks:

1. **Re-verify CI green:** `gh pr checks <PR_NUMBER>` — must show `pass`.
2. **Re-verify all threads resolved:** GraphQL `reviewThreads` filtered to `isResolved: false` must return zero.
3. **If either check fails:** abort merge, end tick, do NOT delete the cron. Inform the user via final message and let the loop continue.
4. **If both pass:**
   ```bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   git checkout main
   git pull
   ```
   `gh pr merge --delete-branch` deletes both the local and remote branch
   automatically (it switches off the branch first if needed).
5. **Self-terminate** (locate and delete the cron):
   ```bash
   CronList                       # find the entry whose prompt contains MONITOR_TAG
   CronDelete id=<that-id>
   ```
6. **Inform the user** with the final outcome:
   - PR merged, branch deleted, on `main`
   - Summary of Codex iterations (count of pushes, count of findings fixed, count discarded)

## Failure Modes

| Situation | Action |
|---|---|
| `gh pr merge` rejects (e.g., not mergeable, conflict) | Do NOT delete cron. Inform user with the gh error and stop the tick. User can rebase or abort. |
| `git pull` after merge has conflicts | Stash/abort cleanly, inform user. The merge already succeeded; this is just local sync. |
| CronDelete fails (cron not found) | Inform user; instruct them to run `/cron list` and `/cron delete <id>` manually. |
| New commits pushed by another author mid-loop | Continue normally — the tick reads the latest HEAD. Codex re-reviews on next push. |
| Codex never reviews HEAD AND no eyes ever | Step 3d (15-min timeout) covers this. |
| Codex 👍 but CI later regresses | Step 4 re-verification catches this. Don't merge. Wait for fix; user-initiated. |
| PR closed/merged externally (PR_STATE ≠ OPEN) | Step 1 short-circuit — skip to self-terminate immediately. |

## Bounds

The cron is intentionally **session-only** (`CronCreate` called without
`durable: true`). If the user closes their Claude session, the cron dies —
this is the correct behavior, since the user is no longer supervising the
auto-merge. The session-only cron's recurring jobs also auto-expire after
7 days. In practice this loop should self-terminate within 30–60 minutes
of PR creation under normal Codex cadence.

## Resolving a Codex Review Thread

To resolve a thread (after fixing valid findings or rejecting invalid ones):

```bash
gh api graphql -f query='mutation {
  resolveReviewThread(input: { threadId: "<THREAD_ID>" }) {
    thread { id isResolved }
  }
}'
```

`<THREAD_ID>` is the `id` field returned by the `reviewThreads` query in
step 1 (a base64-encoded GraphQL node ID, NOT the comment's databaseId).
