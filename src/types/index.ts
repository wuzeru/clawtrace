/**
 * ClawTrace — Type definitions
 *
 * Data models for Skill execution traces, Memory change records,
 * Cron job history, and Sub-agent call trees.
 */

// ---------------------------------------------------------------------------
// Tool call within a skill execution
// ---------------------------------------------------------------------------
export interface ToolCall {
  /** Name of the tool (e.g. "web_search", "web_fetch", "exec") */
  tool: string;
  /** Number of times the tool was invoked */
  count: number;
  /** Optional human-readable details */
  details?: string;
}

// ---------------------------------------------------------------------------
// Sub-agent invocation node (recursive tree)
// ---------------------------------------------------------------------------
export interface SubAgentCall {
  /** Agent / skill name */
  agentName: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: TraceStatus;
  /** Nested sub-agents spawned by this agent */
  children?: SubAgentCall[];
}

// ---------------------------------------------------------------------------
// Core trace status
// ---------------------------------------------------------------------------
export type TraceStatus = 'running' | 'success' | 'failed';

// ---------------------------------------------------------------------------
// Skill execution trace record — one entry in the JSONL store
// ---------------------------------------------------------------------------
export interface SkillTrace {
  /** Unique trace identifier (uuid-like) */
  id: string;
  skillName: string;
  /** Optional session grouping label */
  sessionLabel?: string;
  /** ISO-8601 start timestamp */
  startTime: string;
  /** ISO-8601 end timestamp (absent while running) */
  endTime?: string;
  /** Wall-clock duration in milliseconds */
  durationMs?: number;
  status: TraceStatus;
  /** Error message if status === 'failed' */
  error?: string;
  /** Estimated USD cost */
  cost?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgentCall[];
}

// ---------------------------------------------------------------------------
// Memory change record — tracks writes to memory/*.md / MEMORY.md
// ---------------------------------------------------------------------------
export interface MemoryChange {
  id: string;
  /** ISO-8601 timestamp */
  time: string;
  /** Skill / agent that made the change */
  agent: string;
  /** Relative path of the memory file (e.g. "memory/2026-02-24.md") */
  file: string;
  linesAdded: number;
  linesRemoved: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Cron job execution record
// ---------------------------------------------------------------------------
export interface CronRecord {
  id: string;
  jobName: string;
  /** Cron expression (e.g. "0 8 * * *") */
  cronExpr?: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: TraceStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// A logical session — groups multiple skill traces under a label
// ---------------------------------------------------------------------------
export interface TraceSession {
  id: string;
  label?: string;
  startTime: string;
  endTime?: string;
  skills: SkillTrace[];
}

// ---------------------------------------------------------------------------
// Configuration for ClawTrace
// ---------------------------------------------------------------------------
export interface ClawTraceConfig {
  /**
   * Base directory where JSONL trace files are written.
   * Defaults to "memory/traces" relative to cwd.
   */
  tracesDir?: string;
  /**
   * Base directory where memory-change JSONL files are written.
   * Defaults to "memory/memory-changes" relative to cwd.
   */
  memoryChangesDir?: string;
}

// ---------------------------------------------------------------------------
// Init config — persisted in .clawtrace.json after `clawtrace init`
// ---------------------------------------------------------------------------
export interface ClawTraceInitConfig {
  /** Skill names that should be wrapped with ClawTrace tracing. */
  wrappedSkills: string[];
  /** Skill names explicitly excluded from wrapping. */
  excludedSkills: string[];
  /** Whether `clawtrace init` has been completed at least once. */
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Summary displayed by `clawtrace today`
// ---------------------------------------------------------------------------
export interface DailySummary {
  date: string;
  traces: SkillTrace[];
  totalSkills: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
  totalCost: number;
}
