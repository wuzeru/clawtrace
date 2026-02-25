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

## 🚀 Quick Start

```bash
# Install
npm install
npm run build

# Show today's skill executions
clawtrace today

# Show memory changes in the last 24h
clawtrace memory --last 24

# Show session execution tree
clawtrace session --label morning-routine

# Show the last execution details for a skill
clawtrace detail --skill parser-status --last

# Show cron job history
clawtrace cron
```

---

## 🗂️ OpenClaw Integration Guide

### Does ClawTrace require special directories?

**No manual setup is needed.** ClawTrace automatically creates all required directories the first time it writes a record:

```
<your-openclaw-project>/
├── memory/                          ← OpenClaw's standard memory directory
│   ├── MEMORY.md                    ← Your existing memory file (unchanged)
│   ├── traces/                      ← Auto-created by ClawTrace
│   │   └── YYYY-MM-DD.jsonl         ← Daily skill execution records
│   └── memory-changes/              ← Auto-created by ClawTrace
│       └── YYYY-MM-DD.jsonl         ← Daily memory change records
```

ClawTrace writes its data inside OpenClaw's standard `memory/` directory so that all agent state (memory files **and** execution traces) lives in one place.

### Step-by-step: Adding ClawTrace to an OpenClaw Skill

**1. Install the package in your OpenClaw project**

```bash
npm install clawtrace
```

**2. Import and instantiate inside your Skill**

```typescript
import { ClawTrace } from 'clawtrace';

// Zero-config: reads/writes to <cwd>/memory/traces and <cwd>/memory/memory-changes
const ct = new ClawTrace();
```

**3. Wrap your Skill function**

```typescript
// ClawTrace records start/end time, duration, status, and cost automatically
const result = await ct.wrap('my-skill', async () => {
  // your existing Skill logic here
  return doSomething();
}, {
  sessionLabel: 'morning-routine',  // optional
  costUsd: 0.12,                    // optional
});
```

**4. (Optional) Record memory file changes**

```typescript
ct.recordMemoryChange({
  agent: 'my-skill',
  file: 'memory/MEMORY.md',
  linesAdded: 5,
  linesRemoved: 0,
  description: 'updated market data section',
});
```

**5. (Optional) Use a custom directory path**

If your OpenClaw project has a non-standard layout, pass explicit paths:

```typescript
const ct = new ClawTrace({
  tracesDir: '/path/to/project/memory/traces',
  memoryChangesDir: '/path/to/project/memory/memory-changes',
});
```

### Running the CLI inside an OpenClaw project

Run `clawtrace` commands from the **root directory** of your OpenClaw project so that the default `memory/` paths resolve correctly:

```bash
cd /path/to/your-openclaw-project

# View today's executions
clawtrace today

# View memory changes in the past 24 hours
clawtrace memory --last 24
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
import { ClawTrace } from 'clawtrace';

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
