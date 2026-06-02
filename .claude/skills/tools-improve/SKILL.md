---
name: tools-improve
description: "REQUIRED: Load this skill BEFORE creating, modifying, or reviewing any Claude Code skill, subagent, or CLAUDE.md file. Contains critical best practices for .claude/skills/, .claude/agents/, and CLAUDE.md. Use when: creating agents, creating skills, editing SKILL.md files, editing agent .md files, reviewing skill/agent code, reviewing or editing CLAUDE.md, adding instructions to CLAUDE.md, or any work involving Claude Code extensibility."
argument-hint: <skill or agent name>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Tools Improve - Agent, Skill & CLAUDE.md Assistant

You create and optimize Claude Code subagents, skills, and CLAUDE.md files.

## Workflow

**For skills/agents:**
1. **Clarify requirements** - What does user want to create/modify?
2. **Decide type** - Skill vs subagent (see Decision section below)
3. **Create/edit file** - Use appropriate template
4. **Update CLAUDE.md** - Add new skill/agent to the SKILLS or SUBAGENTS table
5. **Verify** - Confirm description triggers correctly for auto-discovery

**For CLAUDE.md:** Read [references/claude-md-reference.md](references/claude-md-reference.md) for the full review checklist, `@import` syntax, and inclusion/exclusion criteria (sourced from Anthropic official docs).

## Reference Docs

For detailed information beyond this file:
- [references/claude-md-reference.md](references/claude-md-reference.md) - CLAUDE.md include/exclude criteria, review checklist, `@import` syntax, modular organization
- [references/skills-reference.md](references/skills-reference.md) - Invocation control, context budget, hooks, progressive disclosure, testing, troubleshooting
- [references/subagents-reference.md](references/subagents-reference.md) - Built-in agents, permission modes, hook events, MCP access, memory, resume
- [references/agent-teams-reference.md](references/agent-teams-reference.md) - Team orchestration, task coordination, display modes, troubleshooting

## Decision: Skill vs Subagent

**Use SUBAGENT when:**
- Task produces high-volume output (tests, logs, exploration)
- Need parallel execution (concurrent research tasks)
- Need strict tool restrictions with validation hooks
- Work is self-contained and returns a summary

**Use SKILL when:**
- Reusable instructions/knowledge for main conversation
- Side effects user must control → `disable-model-invocation: true`
- Background knowledge Claude should apply → `user-invocable: false`
- Quick reference or style guides

**Default to skill** - simpler, runs in main context.

**When a skill needs parallel workers**, it has two options: orchestrate an **agent team** internally (when teammates must message each other or you need a known role decomposition — see "Agent Teams in Skills" below and [references/agent-teams-reference.md](references/agent-teams-reference.md)), or use a **Dynamic Workflow** (CC v2.1.154+) — a deterministic JS orchestration script (fan-out → verify → synthesize, loop-until-dry) that keeps intermediate results out of the main context and can be saved as a reusable `/<name>` command. Prefer workflows for deterministic, large-scale, or convergence-driven fan-out; prefer teams for collaborative, role-decomposed work.

## Templates

### Skill Template
Create `.claude/skills/<name>/SKILL.md` (project-level) or `skills/<name>/SKILL.md` (plugin-level):
```yaml
---
name: my-skill
description: What it does. Use when [triggers]. Helps with [use cases].
disable-model-invocation: true  # Add for workflows with side effects
---

Instructions Claude follows when skill is invoked.
```

**Supporting files** go in the skill directory:
```
my-skill/
├── SKILL.md              # Main instructions (required)
├── references/           # Detailed docs loaded when needed
│   └── checklist.md
└── scripts/              # Executable scripts
    └── helper.sh
```

### Subagent Template
Create `.claude/agents/<name>.md` (project-level) or `agents/<name>.md` (plugin-level):
```yaml
---
name: my-agent
description: What it does. Use proactively when [triggers].
tools: Read, Glob, Grep, Bash
model: sonnet
permissionMode: dontAsk  # Add for read-only agents (auto-deny writes)
---

You are a specialist in [domain]. When invoked:
1. [First action]
2. [Second action]
3. Return summary of findings/changes.
```

## Frontmatter Reference

### Skill Fields (SKILL.md)
| Field | Description |
|-------|-------------|
| `name` | Display label. **The slash command comes from the directory name**, not this field. Lowercase, numbers, hyphens, max 64 chars; no "anthropic"/"claude" |
| `description` | **Critical** - triggers auto-discovery. Falls back to first paragraph if omitted. **Put the trigger phrase FIRST**: combined `description` + `when_to_use` is truncated at **1,536 chars** in the listing, and the listing budget is ~1% of context (least-invoked skills drop first on overflow — run `/doctor`) |
| `argument-hint` / `arguments` | Autocomplete hint `[issue-number]`; `arguments` declares named positional args → `$name` substitution |
| `disable-model-invocation` | `true` = only user can invoke; description removed from Claude's context |
| `user-invocable` | `false` = hidden from `/` menu (background knowledge) |
| `allowed-tools` | Pre-approves tools (no prompt) while active — does NOT restrict the pool |
| `disallowed-tools` | **(new)** Removes tools from the pool while active (clears on next user message) — e.g. drop `AskUserQuestion` from autonomous loops |
| `model` | Model override for the **current turn only** (sonnet/opus/haiku/full-id/inherit); resumes session model next prompt |
| `effort` | **(new)** Effort while active: `low`/`medium`/`high`/`xhigh`/`max` (model-dependent) |
| `context` | `fork` = run in isolated subagent (SKILL.md body becomes the task) |
| `agent` | Subagent type when forked (`Explore`, `Plan`, `general-purpose`, or a custom agent) |
| `paths` | **(new)** Glob patterns; auto-activate the skill only when working on matching files |
| `hooks` | Lifecycle hooks (PreToolUse, PostToolUse, Stop…); supports `once: true` |
| `shell` | `bash` (default) or `powershell` for `!`-injected commands |

### Subagent Fields (.md)
| Field | Description |
|-------|-------------|
| `name` | Unique identifier (lowercase, hyphens). Required |
| `description` | **Critical** - when Claude delegates. Required |
| `tools` | Allowlist (inherits all including MCP if omitted). Use `Agent(type1, type2)` (renamed from `Task(...)` in CC v2.1.63) to restrict spawnable agent types |
| `disallowedTools` | Denylist (applied before `tools`; a tool listed in both is removed) |
| `model` | sonnet, opus, haiku, full-id, inherit (default: inherit) |
| `permissionMode` | default, acceptEdits, **`auto`** (new — background classifier, cuts prompts), delegate, dontAsk, bypassPermissions, plan |
| `effort` | **(new)** Per-subagent effort override (`low`/`medium`/`high`/`xhigh`/`max`) |
| `color` / `initialPrompt` | Display color; `initialPrompt` auto-submits as the first turn when the agent is the main session (`--agent`) |
| `maxTurns` | Max agentic turns before stopping |
| `skills` | Preload full skill content at startup |
| `mcpServers` | MCP servers available (name reference or inline config) |
| `memory` | Persistent memory scope: `user`, `project`, or `local` |
| `background` | `true` = always run as background task (concurrent, no MCP) |
| `isolation` | `worktree` = run in temporary git worktree (auto-cleaned if no changes) |
| `hooks` | PreToolUse, PostToolUse, Stop (SubagentStart/SubagentStop in settings.json only) |

### String Substitutions (Skills)
| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed |
| `$ARGUMENTS[N]` or `$N` | Positional argument (0-indexed) |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Absolute path to the skill's own directory — resolve bundled script paths regardless of cwd |
| `${CLAUDE_EFFORT}` | Current effort level (`low`…`max`) |
| `!{backtick}command{backtick}` | Dynamic command output (runs before Claude sees content). Syntax: exclamation + backtick-wrapped shell command |

## Patterns

### Read-Only Reviewer (Subagent)
```yaml
---
name: code-reviewer
description: Reviews code quality. Use proactively after writing code.
tools: Read, Grep, Glob, Bash
model: sonnet
---

Review code for quality, security, and best practices.
Run git diff to see changes. Provide feedback by priority.
```

### Side-Effect Action (Skill)
```yaml
---
name: deploy
description: Deploy to production
disable-model-invocation: true
context: fork
allowed-tools: Bash, Read
---

Deploy $ARGUMENTS:
1. Run tests
2. Build
3. Push to target
```

### Background Knowledge (Skill)
```yaml
---
name: legacy-context
description: Context about legacy system. Use when working with payment code.
user-invocable: false
---

Legacy payment system uses SOAP API, XML config, stored procedures.
Key files: src/payments/legacy-adapter.ts
```

### Team-Orchestrating Skill
```yaml
---
name: parallel-review
description: Parallel code review with specialized reviewers
allowed-tools: Read, Glob, Grep, Agent, Bash, TeamCreate, TeamDelete,
  SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
disable-model-invocation: true
---

1. TeamCreate → TaskCreate (one per reviewer) → spawn teammates (Agent tool, team_name)
2. Wait for findings messages (auto-delivered)
3. Merge, deduplicate, act on results
4. Shutdown teammates → TeamDelete
Fallback: if TeamCreate fails, use sequential Agent subagents
```

### Hook Validation (Subagent)
```yaml
---
name: db-reader
description: Execute read-only SQL queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly.sh"
---
```

Hook script (exit 2 to block):
```bash
#!/bin/bash
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP)\b' >/dev/null; then
  echo "Blocked: Only SELECT allowed" >&2
  exit 2
fi
exit 0
```

### Hook Types

Hooks support three types beyond shell commands:

| Type | Use For | Example |
|------|---------|---------|
| `command` | Shell script validation | `"command": "./scripts/validate.sh"` |
| `prompt` | LLM yes/no decision (uses Haiku) | `"prompt": "Check if all tasks are complete"` |
| `agent` | Multi-turn validation with tool access | `"prompt": "Run tests and verify", "timeout": 120` |

`prompt` and `agent` hooks return structured JSON with `permissionDecision`: `"allow"`, `"deny"`, or `"ask"`.

## Best Practices

### Descriptions Are Critical

Claude uses descriptions for auto-discovery. Follow the **[what] + [when] + [features]** formula:

**Poor:** `"Helps with code"`
**Good:** `"Explains code using diagrams and analogies. Use when describing how code works, teaching about codebases, or answering 'how does this work?' questions."`

Test: ask Claude "When should this skill be used?" — if the answer doesn't match your intent, refine the description.

### Progressive Disclosure

Skills load in 3 stages to optimize context:
1. **Metadata** (~100 tokens/skill) — `name` + `description` always in context
2. **Instructions** (<5k tokens) — SKILL.md body loaded when triggered
3. **Resources** (unlimited) — Supporting files loaded as needed via references

Design skills with this in mind: keep SKILL.md focused; put large docs in supporting files.

### Skill Architecture

**Keep SKILL.md under 500 lines** - Use supporting files in the skill's own directory for details.

**Skills are self-contained** - Each skill directory is independent. There is NO shared directory pattern across skills. Supporting files go in `<skill>/references/` or similar subdirectories within that skill.

**Extended thinking** — Include the word "ultrathink" in skill content to enable extended thinking.

**Reducing duplication across skills:**
1. **Put in CLAUDE.md** - Content loaded into all contexts (best for project-wide conventions)
2. **Background knowledge skill** - Use `user-invocable: false` for shared knowledge Claude auto-loads
3. **Accept duplication** - Self-contained skills are more maintainable than fragile dependencies

### Invocation Control

| Scenario | Frontmatter |
|----------|-------------|
| Side effects (deploy, commit, modify files) | `disable-model-invocation: true` |
| Background knowledge (not a command) | `user-invocable: false` |
| Safe for Claude to auto-invoke | (default - no flags) |

### Tool & Permission Restrictions

**Limit tool access** - Grant only what's needed via `tools` or `allowed-tools`.

**Permission modes for subagents:**
- `default` - Standard prompts
- `dontAsk` - Auto-deny prompts (use for read-only agents)
- `acceptEdits` - Auto-accept file edits
- `delegate` - Coordination-only (for agent team leads, restricts to team management tools)
- `auto` - **(new)** Background classifier auto-approves/denies — cuts worker permission prompts
- `bypassPermissions` - Skip all checks (dangerous)

### Model Selection

Match model to task complexity. Current lineup (May 2026): **Opus 4.8** (`claude-opus-4-8`, $5/$25), **Sonnet 4.6** (`claude-sonnet-4-6`, $3/$15), **Haiku 4.5** (`claude-haiku-4-5`, $1/$5). No Sonnet 4.7 / Haiku 4.6 exist.
- `haiku` - Fast, cheap (exploration, simple validation, tests)
- `sonnet` - Balanced (code review, git operations, implementation)
- `opus` - Complex reasoning, bug detection, critical decisions

**Effort is a separate lever from model** (`low`/`medium`/`high`/`xhigh`/`max`; `xhigh` is Opus 4.8/4.7 only; default `high`). For multi-agent work, the Anthropic-validated split is Opus-lead + Sonnet-workers + Haiku-validators — and raising the **orchestrator's effort** usually beats upgrading worker models. Aliases (`opus`/`sonnet`/`haiku`) auto-track the latest snapshot — prefer them in skills/agents over pinned IDs so they don't go stale.

### Subagent Limits

**Max 3-4 custom subagents** - Too many reduces productivity and confuses delegation.

### Agent Teams in Skills

When a skill needs parallel workers (code review, parallel implementation, competing hypotheses), it can orchestrate an agent team. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. See [references/agent-teams-reference.md](references/agent-teams-reference.md) for full guide.

**When to use teams inside a skill:**
- Workers need to communicate with each other (not just report back to lead)
- Work benefits from domain specialization (security vs reliability vs quality)
- Parallel implementation across non-overlapping file sets that benefits from worktree isolation
- Higher token cost is justified by speed or depth

> **For read-only review fan-out** (reviewers report back to the lead, don't talk to each other — e.g. code-audit, frontend-review, the plan-review review phase), **prefer a Dynamic Workflow** over an agent team: cleaner main context, validated structured findings, no ~7× team token cost, none of the team task-status-lag / no-resume gaps, and saveable as a reusable command. In this project those skills now use Workflow mode as the preferred path with the agent team as fallback. Reserve teams for collaborative or write-heavy work.

**Key rules for team-orchestrating skills:**
1. **Isolate workers that write files** — Implementation workers get git worktrees (`_workers/worker-N/`) with own branch; domain-based assignment allowed. Review-only workers (code-audit, frontend-review) share the main directory safely. **Fallback:** partition by file ownership if worktrees unavailable
2. **Lead handles external writes** — Teammates lack MCP access; lead does Linear/Railway/etc.
3. **Domain specialization** — Assign distinct domains, not "review the code" to everyone
4. **Structured reporting** — Define a findings format so lead can merge and deduplicate
5. **Always include fallback** — If `TeamCreate` fails, fall back to sequential subagents
6. **Cap at ~4 teammates** — Diminishing returns beyond that for most tasks
7. **Don't let workers hand-write generated files** — Reserve CLI generators for the lead

**Required `allowed-tools` for team skills:**
```
TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet, Agent
```
(`Agent` is the subagent-spawning tool — renamed from `Task` in CC v2.1.63; `Task` still aliases.)

**Skill lifecycle with teams:**
1. Pre-flight (verify dependencies)
2. `TeamCreate` → `TaskCreate` (one per work unit) → spawn teammates via the `Agent` tool with `team_name`
3. Assign tasks via `TaskUpdate`
4. Wait for teammate messages (auto-delivered, don't poll)
5. Merge/synthesize findings
6. Act on results (lead handles all external writes)
7. Shutdown teammates → `TeamDelete`

## File Locations

| Type | Project | User (all projects) |
|------|---------|---------------------|
| Skill | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| Subagent | `.claude/agents/<name>.md` | `~/.claude/agents/<name>.md` |

Priority: CLI flag > project > user > plugin

## Official Docs

For complete reference, see:
- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- Agent Teams: https://code.claude.com/docs/en/agent-teams
- Hooks: https://code.claude.com/docs/en/hooks-guide
- Best Practices: https://code.claude.com/docs/en/best-practices

**Local references:** See [references/skills-reference.md](references/skills-reference.md), [references/subagents-reference.md](references/subagents-reference.md), and [references/agent-teams-reference.md](references/agent-teams-reference.md) for detailed lookup tables.
