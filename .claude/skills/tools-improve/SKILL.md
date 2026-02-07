---
name: tools-improve
description: "REQUIRED: Load this skill BEFORE creating, modifying, or reviewing any Claude Code skill or subagent. Contains critical best practices for .claude/skills/ and .claude/agents/ files. Use when: creating agents, creating skills, editing SKILL.md files, editing agent .md files, reviewing skill/agent code, or any work involving Claude Code extensibility."
argument-hint: <skill or agent name>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Tools Improve - Agent & Skill Development Assistant

You create and optimize Claude Code subagents and skills.

## Workflow

1. **Clarify requirements** - What does user want to create/modify?
2. **Decide type** - Skill vs subagent (see Decision section below)
3. **Create/edit file** - Use appropriate template
4. **Update CLAUDE.md** - Add new skill/agent to the SKILLS or SUBAGENTS table
5. **Verify** - Confirm description triggers correctly for auto-discovery

## Reference Docs

For detailed information beyond this file:
- [skills-reference.md](skills-reference.md) - Invocation control matrix, context budget, hooks, nested discovery
- [subagents-reference.md](subagents-reference.md) - Built-in agents, permission modes, hook events, resume
- [agent-teams-reference.md](agent-teams-reference.md) - Team orchestration, task coordination, best practices

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

**When a skill needs parallel workers**, it can orchestrate an **agent team** internally. See "Agent Teams in Skills" under Best Practices and [agent-teams-reference.md](agent-teams-reference.md) for the full guide.

## Templates

### Skill Template
Create `.claude/skills/<name>/SKILL.md`:
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
Create `.claude/agents/<name>.md`:
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
| `name` | Slash command name (defaults to directory) |
| `description` | **Critical** - triggers auto-discovery |
| `argument-hint` | Autocomplete hint: `[issue-number]` |
| `disable-model-invocation` | `true` = only user can invoke |
| `user-invocable` | `false` = hidden from `/` menu |
| `allowed-tools` | Tools without permission prompts |
| `model` | Model override: sonnet, opus, haiku |
| `context` | `fork` = run in isolated subagent |
| `agent` | Subagent type when forked |
| `hooks` | Lifecycle hooks (PreToolUse, PostToolUse) |

### Subagent Fields (.md)
| Field | Description |
|-------|-------------|
| `name` | Unique identifier (lowercase, hyphens) |
| `description` | **Critical** - when Claude delegates |
| `tools` | Allowlist (inherits all if omitted) |
| `disallowedTools` | Denylist from inherited tools |
| `model` | sonnet, opus, haiku, inherit |
| `permissionMode` | default, acceptEdits, dontAsk, bypassPermissions, plan |
| `skills` | Preload skill content at startup |
| `hooks` | PreToolUse, PostToolUse, Stop |

### String Substitutions (Skills)
| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed |
| `$ARGUMENTS[N]` or `$N` | Positional argument (0-indexed) |
| `${CLAUDE_SESSION_ID}` | Current session ID |
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
allowed-tools: Read, Glob, Grep, Task, Bash, TeamCreate, TeamDelete,
  SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
disable-model-invocation: true
---

1. TeamCreate → TaskCreate (one per reviewer) → spawn teammates
2. Wait for findings messages (auto-delivered)
3. Merge, deduplicate, act on results
4. Shutdown teammates → TeamDelete
Fallback: if TeamCreate fails, use sequential Task subagents
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

## Best Practices

### Descriptions Are Critical

Claude uses descriptions for auto-discovery. Always include:
- What it does
- Trigger phrases ("Use when...", "Use proactively after...")
- Specific contexts

### Skill Architecture

**Keep SKILL.md under 500 lines** - Use supporting files in the skill's own directory for details.

**Skills are self-contained** - Each skill directory is independent. There is NO shared directory pattern across skills. Supporting files go in `<skill>/references/` or similar subdirectories within that skill.

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
- `bypassPermissions` - Skip all checks (dangerous)

### Model Selection

Match model to task complexity:
- `haiku` - Fast, cheap (exploration, simple validation, tests)
- `sonnet` - Balanced (code review, git operations, implementation)
- `opus` - Complex reasoning, bug detection, critical decisions

### Subagent Limits

**Max 3-4 custom subagents** - Too many reduces productivity and confuses delegation.

### Agent Teams in Skills

When a skill needs parallel workers (code review, parallel implementation, competing hypotheses), it can orchestrate an agent team. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. See [agent-teams-reference.md](agent-teams-reference.md) for full guide.

**When to use teams inside a skill:**
- Workers need to communicate with each other (not just report back to lead)
- Work benefits from domain specialization (security vs reliability vs quality)
- Parallel implementation across non-overlapping file sets
- Higher token cost is justified by speed or depth

**Key rules for team-orchestrating skills:**
1. **Partition by file ownership** — Never assign the same file to multiple teammates
2. **Lead handles external writes** — Teammates lack MCP access; lead does Linear/Railway/etc.
3. **Domain specialization** — Assign distinct domains, not "review the code" to everyone
4. **Structured reporting** — Define a findings format so lead can merge and deduplicate
5. **Always include fallback** — If `TeamCreate` fails, fall back to sequential subagents
6. **Cap at ~4 teammates** — Diminishing returns beyond that for most tasks
7. **Don't let workers hand-write generated files** — Reserve CLI generators for the lead

**Required `allowed-tools` for team skills:**
```
TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet, Task
```

**Skill lifecycle with teams:**
1. Pre-flight (verify dependencies)
2. `TeamCreate` → `TaskCreate` (one per work unit) → spawn teammates via `Task` with `team_name`
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

**Local references:** See [skills-reference.md](skills-reference.md), [subagents-reference.md](subagents-reference.md), and [agent-teams-reference.md](agent-teams-reference.md) for quick lookup tables.
