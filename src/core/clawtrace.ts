/**
 * ClawTrace — Core Coordinator
 *
 * Public API surface that combines the TraceStore and TraceRecorder,
 * and provides higher-level query methods used by the CLI.
 */

import * as path from 'path';
import { TraceStore } from '../trace/store';
import { TraceRecorder } from '../trace/recorder';
import { readInitConfig } from '../init/config';
import {
  ClawTraceConfig,
  DailySummary,
  SkillTrace,
  MemoryChange,
  CronRecord,
  TraceSession,
  ToolCall,
  SubAgentCall,
  TraceStatus,
} from '../types';

export class ClawTrace {
  readonly store: TraceStore;
  readonly recorder: TraceRecorder;

  constructor(config: ClawTraceConfig = {}) {
    const tracesDir = config.tracesDir ?? path.join(process.cwd(), 'memory', 'traces');
    const memoryChangesDir =
      config.memoryChangesDir ?? path.join(process.cwd(), 'memory', 'memory-changes');

    this.store = new TraceStore(tracesDir, memoryChangesDir);
    this.recorder = new TraceRecorder(this.store);
  }

  // ---------------------------------------------------------------------------
  // Skill tracing
  // ---------------------------------------------------------------------------

  /**
   * Wrap an async skill function with automatic trace recording.
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
    return this.recorder.wrap(skillName, fn, options);
  }

  /**
   * Manually record a completed SkillTrace.
   * Returns the generated trace id.
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
    return this.recorder.recordTrace(params);
  }

  // ---------------------------------------------------------------------------
  // Daily summary — `clawtrace today`
  // ---------------------------------------------------------------------------

  /**
   * Build a DailySummary for a given date (defaults to today).
   */
  getDailySummary(date?: Date): DailySummary {
    const d = date ?? new Date();
    const dateStr = d.toISOString().slice(0, 10);
    const traces = this.store.readTraces(d);

    const successCount = traces.filter((t) => t.status === 'success').length;
    const failedCount = traces.filter((t) => t.status === 'failed').length;
    const runningCount = traces.filter((t) => t.status === 'running').length;
    const totalCost = traces.reduce((sum, t) => sum + (t.cost ?? 0), 0);

    return {
      date: dateStr,
      traces,
      totalSkills: traces.length,
      successCount,
      failedCount,
      runningCount,
      totalCost,
    };
  }

  // ---------------------------------------------------------------------------
  // Session view — `clawtrace session`
  // ---------------------------------------------------------------------------

  /**
   * Group today's (or a given date's) traces into sessions by sessionLabel.
   * Traces without a label go into a catch-all "default" session.
   */
  getSessions(date?: Date): TraceSession[] {
    const traces = this.store.readTraces(date);
    const map = new Map<string, SkillTrace[]>();

    for (const t of traces) {
      const key = t.sessionLabel ?? 'default';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    const sessions: TraceSession[] = [];
    for (const [label, skillTraces] of map) {
      const sorted = [...skillTraces].sort((a, b) =>
        a.startTime.localeCompare(b.startTime)
      );
      sessions.push({
        id: label,
        label: label === 'default' ? undefined : label,
        startTime: sorted[0]?.startTime ?? new Date().toISOString(),
        endTime: sorted[sorted.length - 1]?.endTime,
        skills: sorted,
      });
    }

    return sessions;
  }

  /**
   * Get a single session by label (searches today by default).
   */
  getSession(label: string, date?: Date): TraceSession | undefined {
    return this.getSessions(date).find(
      (s) => (s.label ?? 'default') === label
    );
  }

  // ---------------------------------------------------------------------------
  // Memory changes — `clawtrace memory`
  // ---------------------------------------------------------------------------

  /** Get memory changes from the past N hours. */
  getRecentMemoryChanges(hours: number = 24): MemoryChange[] {
    return this.store.readMemoryChangesLastHours(hours);
  }

  /** Record a memory file change. Returns the generated id. */
  recordMemoryChange(params: {
    agent: string;
    file: string;
    linesAdded: number;
    linesRemoved: number;
    description?: string;
  }): string {
    return this.recorder.recordMemoryChange(params);
  }

  // ---------------------------------------------------------------------------
  // Cron history — `clawtrace cron`
  // ---------------------------------------------------------------------------

  /**
   * Get cron job execution records for a given date (defaults to today).
   */
  getCronHistory(date?: Date): CronRecord[] {
    return this.store.readCronRecords(date);
  }

  /**
   * Wrap an async cron job function with automatic recording.
   */
  async wrapCron<T>(
    jobName: string,
    fn: () => Promise<T>,
    cronExpr?: string
  ): Promise<T> {
    return this.recorder.wrapCron(jobName, fn, cronExpr);
  }

  // ---------------------------------------------------------------------------
  // Skill detail — `clawtrace detail`
  // ---------------------------------------------------------------------------

  /**
   * Get all traces for a named skill (most recent date first).
   */
  getSkillTraces(skillName: string, date?: Date): SkillTrace[] {
    return this.store
      .readTraces(date)
      .filter((t) => t.skillName === skillName)
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  /**
   * Get the most recent trace for a named skill.
   */
  getLastSkillTrace(skillName: string, date?: Date): SkillTrace | undefined {
    return this.getSkillTraces(skillName, date)[0];
  }

  /**
   * Build a sub-agent tree for a given trace by finding all traces that
   * reference it (directly or transitively) via `parentId`.
   *
   * Returns SubAgentCall[] representing the children tree. If the trace
   * already has explicit `subAgents`, those are returned as-is. Otherwise,
   * the tree is auto-assembled from JSONL records with matching parentId.
   */
  getTraceTree(traceId: string, date?: Date): SubAgentCall[] {
    const allTraces = this.store.readTraces(date);
    const root = allTraces.find((t) => t.id === traceId);

    // If the root trace already has explicit subAgents, return them
    if (root?.subAgents && root.subAgents.length > 0) {
      return root.subAgents;
    }

    // Build tree from parentId references
    const buildChildren = (parentId: string): SubAgentCall[] => {
      const children = allTraces.filter((t) => t.parentId === parentId);
      return children.map((child) => ({
        agentName: child.skillName,
        startTime: child.startTime,
        endTime: child.endTime,
        durationMs: child.durationMs,
        status: child.status,
        children: buildChildren(child.id),
      }));
    };

    return buildChildren(traceId);
  }

  // ---------------------------------------------------------------------------
  // Init config — `clawtrace init`
  // ---------------------------------------------------------------------------

  /**
   * Check whether a named skill should be wrapped based on the `.clawtrace.json`
   * config written by `clawtrace init`.
   *
   * - If no config file exists (init not yet run), returns `true` so that
   *   existing integrations continue to work unchanged.
   * - If the config exists, returns `true` only when the skill appears in
   *   `wrappedSkills`.
   */
  shouldWrap(skillName: string, rootDir?: string): boolean {
    const config = readInitConfig(rootDir);
    if (!config || !config.initialized) return true;
    return config.wrappedSkills.includes(skillName);
  }
}
