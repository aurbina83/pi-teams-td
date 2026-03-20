# TD-Aware Agents for pi-teams

**IMPORTANT:** Before using these agents, read the td task management skill:
```
~/.agents/skills/td-task-management/SKILL.md
```

This skill contains the authoritative guidance on:
- **Writing good issues** (bugs, features, tasks with proper details)
- **Using --acceptance criteria**
- **Linking files**
- **Structured handoffs**
- **Full TDQ query language**

These agents are designed to work WITH the skill, not replace it.

## Agents

| Agent | Role | Best For |
|-------|------|----------|
| **td-implementer** | Executes tasks, logs decisions | Building features, fixing bugs |
| **td-reviewer** | Reviews code with detailed feedback | Quality gates, security audits |
| **td-coordinator** | Creates epics, manages dependencies | Sprint planning, orchestration |
| **td-scout** | Investigates code, links files | Research, exploration |

## Quick Start

### 1. Install td

```bash
# Via Homebrew
brew install tausiq/tap/td

# Or see: https://github.com/tausiq/td
```

### 2. Initialize td in Your Project

```bash
cd your-project
td init
```

### 3. Use Predefined Teams

```bash
# Create a feature team
"Create a team named 'auth-refactor' from 'feature-team'"

# Or spawn agents manually
"Spawn td-coordinator in the current folder"
"Spawn td-implementer in the current folder"
```

## Example Workflow

### 1. Coordinator Creates Epic

```bash
td epic create "User Authentication System" --priority P0
# Output: Created td-abc123

td create "Implement OAuth2 flow" --type feature --epic td-abc123 --priority P1
td create "Add JWT tokens" --type feature --epic td-abc123 --depends-on <oauth-id>
```

### 2. Implementer Picks Up Work

```bash
td usage --new-session
td start td-xyz789
td log "Started OAuth implementation"
# ... implement ...
td log --decision "Using Authorization Code flow with PKCE"
td link td-xyz789 src/auth/oauth.ts
td handoff --done "OAuth flow done" --remaining "JWT tokens" --decision "..."
td review td-xyz789
```

### 3. Reviewer Approves or Rejects

```bash
td reviewable
td show td-xyz789
td files td-xyz789

# If issues found:
td comment td-xyz789 "## Feedback"
td comment td-xyz789 "Missing input validation at line 42"
td reject td-xyz789 --reason "Missing input validation"

# If good:
td approve td-xyz789
```

## Teams

| Team | Agents | Use Case |
|------|--------|----------|
| `dev-sprint` | scout + coordinator + implementer + reviewer | Full feature development |
| `investigation` | scout + coordinator | Research and exploration |
| `code-review` | reviewer + coordinator | Review sessions |
| `feature-team` | coordinator + 2x implementer + reviewer | Parallel feature work |
| `bug-squad` | coordinator + implementer + reviewer | Priority bug fixes |
| `architecture` | scout + coordinator | Design and planning |

## Key Features

- **Session Isolation**: Reviewers cannot approve their own work (different terminal session)
- **Structured Handoffs**: Done/Remaining/Decisions/Uncertainties captured
- **File Tracking**: `td link` attaches files to issues with SHA checksums
- **Boards**: Query-based views for sprint planning and status tracking
- **Dependencies**: Critical path analysis, blocking relationships
- **Epic Hierarchy**: Group related work under parent issues

## Example: Full Feature Flow

```bash
# 1. Coordinator creates epic and tasks
td epic create "Payments V2" --priority P1
td create "Stripe integration" --epic <epic-id> --type feature
td create "Payment UI" --epic <epic-id> --type feature --depends-on <stripe-id>

# 2. Implementer works on Stripe
td start <stripe-id>
# ... implement ...
td log --decision "Using Stripe Elements for PCI compliance"
td handoff --done "Stripe done" --remaining "UI integration" --decision "..."
td review <stripe-id>

# 3. Reviewer approves
td approve <stripe-id>

# 4. Implementer unblocked for UI
td start <ui-id>
# ... implement ...
td review <ui-id>

# 5. Coordinator monitors
td critical-path
td board show "In Progress"
```

## Learn More

- [td skill](../../skills/td-task-management/SKILL.md) - Full td documentation
- [td repository](https://github.com/tausiq/td) - td CLI source
