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

### Step 3.5 — Calibration: FIX or REJECT (BEFORE acting on findings in 3b)

**Every finding has exactly two dispositions: FIX it now, or REJECT it with
reasoning. There is NO defer/Backlog path — the monitor creates NO Linear
issues for Codex findings.** A deferred issue is just "fix it later" with
overhead: the next `plan-backlog` pulls it straight back in, so either the
finding is worth fixing (fix it now, on this PR) or it is not (reject it, file
nothing). Plans/PRs complete — they do not spawn follow-up tickets.

Codex finds real bugs but does not calibrate to project context, so the only
question this step answers is: **must we fix this?**

- **FIX (now):** a real bug that can realistically occur and matters. Fix with
  TDD, push, resolve the thread. This is the default for anything genuinely
  wrong — regardless of severity, iteration count, or whether it is
  pre-existing.
- **REJECT (file nothing):** not something we have to fix. Resolve the thread
  with a brief reasoned reply (do not silently dismiss). Reject ONLY for a
  concrete reason:
  - **False positive / misread** — the code is actually correct.
  - **Accepted pattern** — listed in CLAUDE.md "KNOWN ACCEPTED PATTERNS",
    project memory, or already adjudicated as accepted/discarded in a prior
    plan-review/audit (e.g. a deliberate design tradeoff). *This is the check
    that prevents re-filing an already-decided non-bug.*
  - **Not realistically triggerable in context** — e.g. a race requiring
    concurrent sub-second timing in this family-scale (2-user) app. CLAUDE.md
    "STATUS: PRODUCTION" means deployed, not high-concurrency.
  - **Style-only** — cosmetic, zero correctness impact, not enforced by CLAUDE.md.

"Low severity", "pre-existing", or "out of scope" are NOT reasons to reject —
if it is a real bug, FIX it. When genuinely unsure whether it is a real bug,
FIX it.

#### Theme cascades — fix the root, never leave a tail

If Codex re-flags the same root cause at multiple call sites (a "theme
cascade"), do not patch one site and abandon the rest, and do not file the
tail as a Backlog issue. Either the sites are real bugs — fix them all, or fix
the shared root cause in one change so the whole cascade is resolved on this PR
— or they are not, and you reject them with reasoning. Track theme labels
across ticks (1-3 word root-cause labels, e.g. "non-positive engine output",
"stale-compute race", "missing exhaustive case") so you recognize a cascade and
address it holistically instead of one site per iteration.

#### Hard caps — escalate to the user, never defer

The caps are a runaway guard for the unsupervised cron, NOT a defer trigger:

- **Iteration cap:** 4 push→review cycles on a single PR.
- **Time cap:** 90 minutes of monitor uptime.

If a cap is hit while **real, must-fix bugs remain**, STOP the monitor, leave
the PR OPEN (do not merge), and report the outstanding findings to the user so
they decide how to proceed. Never auto-merge over a known real bug and never
create Backlog issues. A 4+-iteration cascade of genuine bugs signals a design
problem that is the human's call. If the only things left at a cap are
rejectable non-bugs, reject them with reasoning and proceed to merge as normal.

#### Reporting

In each tick summary, state the disposition of every finding handled:
> [finding summary]: FIXED in <sha> (theme "[theme]") — or — REJECTED:
> [concrete reason]. No issue filed.

This makes the calibration visible; if the user disagrees with a rejection
they can override.

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
