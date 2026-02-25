# ClawTrace — Project Summary

## 🎯 Project Background

**Approach**: Combining existing capabilities
**Inspiration**: Entire CLI — Git-based observability for AI agents
**Integration target**: OpenClaw (AI Agent platform — Skills / Cron / Sub-agents / Memory)

## 💡 Core Value

Brings the observability ideas of Entire CLI into OpenClaw, so that every Skill execution, Cron job, and Sub-agent call **automatically produces a structured trace**.

## 🔧 Technical Implementation

### Architecture

```
ClawTrace (Core Coordinator)
├── TraceStore       — JSONL file read/write (memory/traces/, memory/memory-changes/)
├── TraceRecorder    — Middleware wrapping (wrap/wrapCron/recordMemoryChange)
└── CLI              — 6 sub-commands (today/memory/session/detail/cron/record)
```

### Data Flow

```
Skill execution → recorder.wrap() → TraceStore.appendTrace()
                                  → TraceStore.updateTrace() (on complete)
                                  → memory/traces/YYYY-MM-DD.jsonl
```

### Storage Format

- `memory/traces/YYYY-MM-DD.jsonl` — Skill execution records + Cron records (JSONL, lightweight)
- `memory/memory-changes/YYYY-MM-DD.jsonl` — Memory change records

## 📊 Implemented Capabilities

| Capability | Command | Description |
|-----------|---------|-------------|
| Skill Execution Tracing | `clawtrace today` | View today's skill execution summary |
| Session Tree | `clawtrace session` | Grouped execution tree by session |
| Skill Detail | `clawtrace detail --skill <name>` | Execution details for a single skill |
| Memory Changes | `clawtrace memory --last 24` | Memory change history for the last N hours |
| Cron History | `clawtrace cron` | Cron job execution history |
| Manual Record | `clawtrace record --skill <name>` | Manually write a trace record |

## 🧪 Test Coverage

- TraceStore: 9 tests (CRUD, time-window filtering, Cron records)
- TraceRecorder: 8 tests (wrap success/failure, recordMemoryChange, wrapCron)
- ClawTrace: 19 tests (DailySummary, Sessions, SkillTraces, wrap, cost totals)
- Total: **36 unit tests**

## 🔗 Capability Mapping

| From Entire CLI | OpenClaw Existing Capability | Integrated Result |
|----------------|------------------------------|-------------------|
| Session/tool call trace | Skill execution chain | Full end-to-end skill tracing |
| Git checkpoint concept | memory/*.md | Memory diff tracking |
| Multi-agent tracing | Sub-agent spawn | Sub-agent call tree |
| Timeline visualization | Cron system | Cron execution history dashboard |
