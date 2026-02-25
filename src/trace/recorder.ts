/**
 * ClawTrace — Trace Recorder
 *
 * Middleware-style helper that wraps an async skill function and
 * automatically records a SkillTrace entry in the store.
 */

import { TraceStore } from './store';
import {
  SkillTrace,
  MemoryChange,
  CronRecord,
  ToolCall,
  SubAgentCall,
  TraceStatus,
} from '../types';

/** Generate a simple unique ID (timestamp + random suffix). */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class TraceRecorder {
  constructor(private readonly store: TraceStore) {}

  /**
   * Wrap an async skill function with automatic trace recording.
   *
   * Usage:
   *   const result = await recorder.wrap('my-skill', () => mySkillFn(), {
   *     sessionLabel: 'morning-routine',
   *   });
   */
  async wrap<T>(
    skillName: string,
    fn: () => Promise<T>,
    options: {
      sessionLabel?: string;
      toolCalls?: ToolCall[];
      subAgents?: SubAgentCall[];
      costUsd?: number;
    } = {}
  ): Promise<T> {
    const id = generateId();
    const startTime = new Date().toISOString();

    const trace: SkillTrace = {
      id,
      skillName,
      sessionLabel: options.sessionLabel,
      startTime,
      status: 'running' as TraceStatus,
      toolCalls: options.toolCalls,
      subAgents: options.subAgents,
      cost: options.costUsd,
    };

    this.store.appendTrace(trace);

    const startMs = Date.now();
    try {
      const result = await fn();
      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      this.store.updateTrace(id, {
        endTime,
        durationMs,
        status: 'success',
      });

      return result;
    } catch (err) {
      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      this.store.updateTrace(id, {
        endTime,
        durationMs,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  /**
   * Manually record a completed SkillTrace (useful when you cannot wrap).
   */
  recordTrace(params: {
    skillName: string;
    status: TraceStatus;
    startTime: string;
    endTime?: string;
    durationMs?: number;
    sessionLabel?: string;
    error?: string;
    cost?: number;
    toolCalls?: ToolCall[];
    subAgents?: SubAgentCall[];
    parentId?: string;
  }): string {
    const id = generateId();
    const trace: SkillTrace = { id, ...params };
    this.store.appendTrace(trace);
    return id;
  }

  /**
   * Record a memory file change.
   */
  recordMemoryChange(params: {
    agent: string;
    file: string;
    linesAdded: number;
    linesRemoved: number;
    description?: string;
  }): string {
    const id = generateId();
    const change: MemoryChange = {
      id,
      time: new Date().toISOString(),
      ...params,
    };
    this.store.appendMemoryChange(change);
    return id;
  }

  /**
   * Wrap an async cron job function with automatic CronRecord recording.
   */
  async wrapCron<T>(
    jobName: string,
    fn: () => Promise<T>,
    cronExpr?: string
  ): Promise<T> {
    const id = generateId();
    const startTime = new Date().toISOString();

    const record: CronRecord = {
      id,
      jobName,
      cronExpr,
      startTime,
      status: 'running',
    };

    this.store.appendCronRecord(record);

    const startMs = Date.now();
    try {
      const result = await fn();
      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Append a completion record — the "running" entry stays as-is
      // (JSONL is append-only; consumers pick the latest entry for the id)
      this.store.appendCronRecord({
        ...record,
        id: record.id + '-done',
        endTime,
        durationMs,
        status: 'success',
      });

      return result;
    } catch (err) {
      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      this.store.appendCronRecord({
        ...record,
        id: record.id + '-done',
        endTime,
        durationMs,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }
}
