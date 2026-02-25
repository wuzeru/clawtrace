# ClawTrace — OpenClaw原生Agent可观测性Skill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> 将 Entire CLI 的可观测性思想融入 OpenClaw，让每个 Skill 执行、Cron 任务、Sub-agent 调用都**自动产生结构化 trace**，实现 OpenClaw 的原生自省能力

---

## 🎯 核心能力

| 能力 | 描述 |
|-----|------|
| **Skill 执行追踪** | 每个 Skill 执行自动记录到 `memory/traces/YYYY-MM-DD.jsonl` |
| **Memory 变更追踪** | 追踪 MEMORY.md / memory/*.md 的每次变更（谁、何时、改了什么）|
| **Cron 执行历史** | 所有 Cron job 执行历史 + 成功率 + 耗时 |
| **Sub-agent 调用树** | main → sub-agent A → sub-agent B 完整执行树 |

---

## 🚀 快速开始

```bash
# 安装
cd projects/2026-02-24-clawtrace
npm install
npm run build

# 查看今天所有 skill 执行
clawtrace today

# 查看最近 24h Memory 变更
clawtrace memory --last 24

# 查看 session 执行树
clawtrace session --label morning-routine

# 查看某个 skill 的最后一次执行详情
clawtrace detail --skill parser-status --last

# 查看 Cron 执行历史
clawtrace cron
```

---

## 📊 CLI 示例输出

### `clawtrace today`

```
📊 2026-02-24 Skill 执行摘要

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
📝 Memory 变更历史 (最近 24h)

• 23:07 [daily-tool-creator] memory/2026-02-24.md (+45/0 lines) "wrote daily note"
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
└─ [08:10] standup-dingtalk (1m30s, $0.05) ✅
```

---

## 🔧 API 使用

### 作为库集成到现有 Skill

```typescript
import { ClawTrace } from 'clawtrace';

const ct = new ClawTrace();

// 方式1: 自动包装 skill 函数
const result = await ct.wrap('my-skill', async () => {
  // 你的 skill 逻辑
  return doSomething();
}, {
  sessionLabel: 'morning-routine',
  costUsd: 0.12,
});

// 方式2: 手动记录
ct.recordTrace({
  skillName: 'my-skill',
  status: 'success',
  startTime: new Date().toISOString(),
  durationMs: 5000,
  cost: 0.05,
});

// 记录 Memory 变更
ct.recordMemoryChange({
  agent: 'my-skill',
  file: 'memory/MEMORY.md',
  linesAdded: 3,
  linesRemoved: 0,
  description: 'updated market section',
});

// 包装 Cron job
await ct.wrapCron('daily-cleanup', async () => {
  // cleanup logic
}, '0 3 * * *');
```

---

## 📂 文件结构

```
projects/2026-02-24-clawtrace/
├── src/
│   ├── cli.ts              # CLI 入口
│   ├── index.ts            # 公共 API
│   ├── core/
│   │   └── clawtrace.ts    # 核心协调器
│   ├── trace/
│   │   ├── store.ts        # JSONL 存储层
│   │   └── recorder.ts     # Trace 记录中间件
│   └── types/
│       └── index.ts        # 类型定义
├── tests/
│   └── clawtrace.test.ts   # 单元测试
├── package.json
├── tsconfig.json
└── jest.config.js
```

数据存储位置：
```
memory/traces/YYYY-MM-DD.jsonl          # Skill 执行记录 + Cron 记录
memory/memory-changes/YYYY-MM-DD.jsonl  # Memory 变更记录
```

---

## 📋 JSONL 数据格式

### Skill Trace
```json
{
  "id": "lf2k3a-x7p9qr",
  "skillName": "morning-data-collection",
  "sessionLabel": "morning-routine",
  "startTime": "2026-02-24T08:00:00.000Z",
  "endTime": "2026-02-24T08:03:42.000Z",
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
  "time": "2026-02-24T09:15:00.000Z",
  "agent": "morning-email",
  "file": "memory/MEMORY.md",
  "linesAdded": 3,
  "linesRemoved": 0,
  "description": "updated 金融市场 section"
}
```

---

## 🔧 配置

```typescript
const ct = new ClawTrace({
  tracesDir: 'memory/traces',          // JSONL 文件存储目录
  memoryChangesDir: 'memory/memory-changes',  // Memory 变更存储目录
});
```

零配置：默认使用 `process.cwd()/memory/traces` 和 `process.cwd()/memory/memory-changes`。

---

## 🧪 测试

```bash
npm test
```

---

## 📝 参考

- 灵感来源: [Entire CLI](https://github.com/gitentire/entire) — Git-based observability for AI agents
- 我们现有系统: OpenClaw Skills / Cron / Memory
- 参考架构: Datadog APM, Honeycomb, OpenTelemetry

---

**开发者**: Forge  
**日期**: 2026-02-24  
**版本**: v1.0.0
