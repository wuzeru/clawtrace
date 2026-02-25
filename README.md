# ClawTrace — Native Observability Skill for OpenClaw Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> Brings the observability ideas of Entire CLI into OpenClaw, so that every Skill execution, Cron job, and Sub-agent call **automatically produces a structured trace**, enabling native introspection for OpenClaw.

---

## 🎯 Core Capabilities

| Capability | Description |
|-----------|-------------|
| **Skill Execution Tracing** | Every Skill execution is automatically recorded to `memory/traces/YYYY-MM-DD.jsonl` |
| **Memory Change Tracking** | Tracks every change to MEMORY.md / memory/*.md (who, when, what changed) |
| **Cron Execution History** | Full history of all Cron job executions + success rate + duration |
| **Sub-agent Call Tree** | Complete execution tree: main → sub-agent A → sub-agent B |

---

## 🚀 Complete Walkthrough: From Install to Statistics

Below is the full end-to-end flow. Assume you have an existing OpenClaw project with skills defined as Markdown files.

### Step 0 — Your starting project layout

```
my-openclaw-project/
├── skills/
│   ├── morning-data-collection/
│   │   └── SKILL.md                 ← OpenClaw skill definition
│   ├── morning-email-briefing/
│   │   └── SKILL.md
│   └── parser-status/
│       └── SKILL.md
├── memory/
│   └── MEMORY.md
└── package.json
```

### Step 1 — Install ClawTrace

```bash
cd my-openclaw-project
npm install @banliang/clawtrace
```

### Step 2 — Detect skills and configure

```bash
npx clawtrace init
```

Output:

```
🔍 Scanning for skills in the project...

Found 3 skill(s):

  • morning-data-collection             skills/morning-data-collection/SKILL.md
  • morning-email-briefing              skills/morning-email-briefing/SKILL.md
  • parser-status                       skills/parser-status/SKILL.md

For each skill, choose whether to wrap it with ClawTrace tracing.
(Press Enter to accept the default shown in uppercase)

Wrap morning-data-collection? (Y/n): y
Wrap morning-email-briefing? (Y/n): n
Wrap parser-status? (Y/n): y

✅ Configuration saved to .clawtrace.json

  Wrapped:  morning-data-collection, parser-status
  Skipped:  morning-email-briefing
```

This creates `.clawtrace.json` with your preferences.

### Step 3 — Inject reporting instructions into SKILL.md

```bash
npx clawtrace inject
```

Output:

```
📝 Injecting ClawTrace statistics into SKILL.md files...

  ✅ morning-data-collection             skills/morning-data-collection/SKILL.md
  ✅ morning-email-briefing              skills/morning-email-briefing/SKILL.md
  ✅ parser-status                       skills/parser-status/SKILL.md

Updated 3 skill file(s) with today's statistics.
```

Each `SKILL.md` now has a block like this appended at the end:

```markdown
<!-- clawtrace:stats:start -->
## 📊 ClawTrace Statistics

_Last updated: 2026-02-25 09:30 UTC_

| Metric | Value |
|--------|-------|
| Runs today | 0 |
| ✅ Success | 0 |
| ❌ Failed | 0 |
| ⏱ Avg duration | - |
| 🕐 Last run | - |

### 📝 Execution Reporting

> **After executing this skill, report the result by running:**
> ```bash
> clawtrace record --skill morning-data-collection --status success --duration <ms>
> ```
> If the execution failed, use `--status failed --error "<message>"`.
<!-- clawtrace:stats:end -->
```

**Key insight:** Since ClawTrace is a third-party package, it **cannot** modify OpenClaw's internal scheduling code. Instead, the injected instructions tell the AI agent to self-report. When the agent reads the SKILL.md, it sees the reporting instruction and runs `clawtrace record` after executing the skill.

### Step 4 — Execution happens (agent or manual)

The AI agent reads the `SKILL.md`, executes the skill, and follows the reporting instruction. You can also simulate this manually:

```bash
# Simulate a successful skill execution (12.5 seconds)
npx clawtrace record --skill morning-data-collection --status success --duration 12500

# Simulate a failed execution
npx clawtrace record --skill parser-status --status failed --duration 800 --error "API timeout"

# Record another successful run
npx clawtrace record --skill morning-data-collection --status success --duration 15000
```

Each call appends a trace entry to `memory/traces/2026-02-25.jsonl`.

### Step 5 — View statistics via CLI

```bash
npx clawtrace today
```

Output:

```
📊 2026-02-25 Skill Execution Summary

Skill                          Status    Duration    Cost
──────────────────────────────────────────────────────────
morning-data-collection        ✅         12s         -
morning-data-collection        ✅         15s         -
parser-status                  ❌         0s          -

Total: 3 skill(s), 2 success, 1 failed, 0 running | Cost: $0.00
```

Other CLI views:

```bash
# Show memory changes in the last 24h
npx clawtrace memory --last 24

# Show session execution tree
npx clawtrace session --label morning-routine

# Show the last execution details for a skill
npx clawtrace detail --skill parser-status --last
```

### Step 6 — Refresh stats in SKILL.md

```bash
npx clawtrace inject
```

Now each `SKILL.md` shows updated statistics (e.g., "Runs today: 2, ✅ Success: 2") — the AI agent sees fresh data on its next read.

### Complete feedback loop

```
clawtrace inject → writes instructions + stats into SKILL.md
                        ↓
AI agent reads SKILL.md → executes skill → runs `clawtrace record`
                        ↓
clawtrace record → appends trace to memory/traces/YYYY-MM-DD.jsonl
                        ↓
clawtrace inject → reads JSONL → updates stats in SKILL.md
```

No modification of OpenClaw's source code is required — the SKILL.md document itself is the interface to the agent.

### Final project layout

```
my-openclaw-project/
├── skills/
│   ├── morning-data-collection/
│   │   └── SKILL.md                 ← Now includes stats + reporting instructions
│   ├── morning-email-briefing/
│   │   └── SKILL.md
│   └── parser-status/
│       └── SKILL.md
├── memory/
│   ├── MEMORY.md                    ← Unchanged
│   ├── traces/                      ← Auto-created by ClawTrace
│   │   └── 2026-02-25.jsonl         ← Daily skill execution records
│   └── memory-changes/              ← Auto-created by ClawTrace
│       └── 2026-02-25.jsonl         ← Daily memory change records
├── .clawtrace.json                  ← Created by `clawtrace init`
└── package.json
```

---

## 🗂️ Advanced Usage

### Programmatic API (for custom orchestrators)

If you have your own orchestration code that calls skills, you can also use the TypeScript API directly:

```typescript
import { ClawTrace } from '@banliang/clawtrace';
const ct = new ClawTrace();

const result = await ct.wrap('my-skill', async () => {
  return doSomething();
}, { sessionLabel: 'morning-routine' });
```

### Running the CLI inside an OpenClaw project

Run `clawtrace` commands from the **root directory** of your OpenClaw project so that the default `memory/` paths resolve correctly:

```bash
cd /path/to/your-openclaw-project

# View today's executions
npx clawtrace today

# View memory changes in the past 24 hours
npx clawtrace memory --last 24
```

---

## 📊 CLI Example Output

### `clawtrace today`

```
📊 2026-01-01 Skill Execution Summary

Skill                          Status    Duration    Cost
──────────────────────────────────────────────────────────
morning-data-collection        ✅         3m 42s      $0.12
morning-email-briefing         ✅         2m 15s      $0.08
daily-tool-creator             🔄         8m 30s      $0.45
parser-status                  ❌         0m 12s      $0.01

Total: 4 skill(s), 2 success, 1 failed, 1 running | Cost: $0.66
```

### `clawtrace memory --last 24`

```
📝 Memory Change History (last 24h)

• 23:07 [daily-tool-creator] memory/2026-01-01.md (+45/0 lines) "wrote daily note"
• 09:15 [morning-email] memory/MEMORY.md (+3/0 lines)
• 08:30 [heartbeat] memory/heartbeat.json (+1/-1 lines)
```

### `clawtrace session --label morning-routine`

```
🌅 morning-routine (08:00-09:30)
├─ [08:00] data-collection (3m42s, $0.12) ✅
│  ├─ web_search × 8 calls
│  ├─ web_fetch × 3 calls
├─ [08:05] email-briefing (2m15s, $0.08) ✅
└─ [08:10] standup-report (1m30s, $0.05) ✅
```

---

## 🔧 API Usage

### Integrate as a Library into an Existing Skill

```typescript
import { ClawTrace } from '@banliang/clawtrace';

const ct = new ClawTrace();

// Option 1: Automatically wrap a skill function
const result = await ct.wrap('my-skill', async () => {
  // your skill logic
  return doSomething();
}, {
  sessionLabel: 'morning-routine',
  costUsd: 0.12,
});

// Option 2: Record manually
ct.recordTrace({
  skillName: 'my-skill',
  status: 'success',
  startTime: new Date().toISOString(),
  durationMs: 5000,
  cost: 0.05,
});

// Record a memory change
ct.recordMemoryChange({
  agent: 'my-skill',
  file: 'memory/MEMORY.md',
  linesAdded: 3,
  linesRemoved: 0,
  description: 'updated market section',
});

// Wrap a Cron job
await ct.wrapCron('daily-cleanup', async () => {
  // cleanup logic
}, '0 3 * * *');
```

---

## 📂 File Structure

```
clawtrace/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── index.ts            # Public API
│   ├── core/
│   │   └── clawtrace.ts    # Core coordinator
│   ├── trace/
│   │   ├── store.ts        # JSONL storage layer
│   │   └── recorder.ts     # Trace recording middleware
│   └── types/
│       └── index.ts        # Type definitions
├── tests/
│   └── clawtrace.test.ts   # Unit tests
├── package.json
├── tsconfig.json
└── jest.config.js
```

Data storage locations:
```
memory/traces/YYYY-MM-DD.jsonl          # Skill execution records + Cron records
memory/memory-changes/YYYY-MM-DD.jsonl  # Memory change records
```

---

## 📋 JSONL Data Formats

### Skill Trace
```json
{
  "id": "lf2k3a-x7p9qr",
  "skillName": "morning-data-collection",
  "sessionLabel": "morning-routine",
  "startTime": "2026-01-01T08:00:00.000Z",
  "endTime": "2026-01-01T08:03:42.000Z",
  "durationMs": 222000,
  "status": "success",
  "cost": 0.12,
  "toolCalls": [
    { "tool": "web_search", "count": 8 },
    { "tool": "web_fetch", "count": 3 }
  ]
}
```

### Memory Change
```json
{
  "id": "mc-abc123",
  "time": "2026-01-01T09:15:00.000Z",
  "agent": "morning-email",
  "file": "memory/MEMORY.md",
  "linesAdded": 3,
  "linesRemoved": 0,
  "description": "updated market section"
}
```

---

## 🔧 Configuration

```typescript
const ct = new ClawTrace({
  tracesDir: 'memory/traces',                   // Directory for JSONL trace files
  memoryChangesDir: 'memory/memory-changes',    // Directory for memory change files
});
```

Zero-config: defaults to `process.cwd()/memory/traces` and `process.cwd()/memory/memory-changes`.

---

## 🧪 Testing

```bash
npm test
```

---

## 📝 References

- Inspiration: [Entire CLI](https://github.com/gitentire/entire) — Git-based observability for AI agents
- Integration target: OpenClaw Skills / Cron / Memory
- Reference architectures: Datadog APM, Honeycomb, OpenTelemetry

---

**Version**: v1.0.0
