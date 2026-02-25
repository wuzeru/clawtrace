/**
 * ClawTrace — JSONL Trace Store
 *
 * Handles reading and writing trace records to daily JSONL files:
 *   <tracesDir>/YYYY-MM-DD.jsonl          (SkillTrace entries)
 *   <memoryChangesDir>/YYYY-MM-DD.jsonl   (MemoryChange entries)
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillTrace, MemoryChange, CronRecord } from '../types';

export class TraceStore {
  private tracesDir: string;
  private memoryChangesDir: string;

  constructor(tracesDir: string, memoryChangesDir: string) {
    this.tracesDir = tracesDir;
    this.memoryChangesDir = memoryChangesDir;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private dateKey(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private tracesFilePath(dateKey: string): string {
    return path.join(this.tracesDir, `${dateKey}.jsonl`);
  }

  private memoryChangesFilePath(dateKey: string): string {
    return path.join(this.memoryChangesDir, `${dateKey}.jsonl`);
  }

  private appendLine(filePath: string, record: unknown): void {
    this.ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  }

  private readLines<T>(filePath: string): T[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  // ---------------------------------------------------------------------------
  // Skill Traces
  // ---------------------------------------------------------------------------

  /** Append a SkillTrace record to the daily JSONL file. */
  appendTrace(trace: SkillTrace, date?: Date): void {
    const filePath = this.tracesFilePath(this.dateKey(date));
    this.appendLine(filePath, trace);
  }

  /** Read all SkillTrace records for a given date (defaults to today). */
  readTraces(date?: Date): SkillTrace[] {
    const filePath = this.tracesFilePath(this.dateKey(date));
    return this.readLines<SkillTrace>(filePath);
  }

  /**
   * Update (replace) an existing trace record identified by id.
   * Rewrites the entire JSONL file with the updated record.
   */
  updateTrace(id: string, updates: Partial<SkillTrace>, date?: Date): boolean {
    const filePath = this.tracesFilePath(this.dateKey(date));
    const records = this.readLines<SkillTrace>(filePath);
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    records[idx] = { ...records[idx], ...updates };
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Memory Changes
  // ---------------------------------------------------------------------------

  /** Append a MemoryChange record to the daily JSONL file. */
  appendMemoryChange(change: MemoryChange, date?: Date): void {
    const filePath = this.memoryChangesFilePath(this.dateKey(date));
    this.appendLine(filePath, change);
  }

  /** Read all MemoryChange records for a given date (defaults to today). */
  readMemoryChanges(date?: Date): MemoryChange[] {
    const filePath = this.memoryChangesFilePath(this.dateKey(date));
    return this.readLines<MemoryChange>(filePath);
  }

  /**
   * Read MemoryChange records from the past N hours.
   */
  readMemoryChangesLastHours(hours: number): MemoryChange[] {
    const cutoff = new Date(Date.now() - hours * 3600_000);
    const results: MemoryChange[] = [];

    // Look at today and yesterday to cover the rolling window
    const days = [new Date(), new Date(Date.now() - 86_400_000)];
    for (const day of days) {
      const records = this.readMemoryChanges(day);
      for (const r of records) {
        if (new Date(r.time) >= cutoff) {
          results.push(r);
        }
      }
    }

    return results.sort((a, b) => a.time.localeCompare(b.time));
  }

  // ---------------------------------------------------------------------------
  // Cron Records — stored alongside skill traces for simplicity
  // ---------------------------------------------------------------------------

  /** Append a CronRecord to the daily JSONL file. */
  appendCronRecord(record: CronRecord, date?: Date): void {
    const filePath = this.tracesFilePath(this.dateKey(date));
    this.appendLine(filePath, { _type: 'cron', ...record });
  }

  /** Read all CronRecord entries for a given date. */
  readCronRecords(date?: Date): CronRecord[] {
    const filePath = this.tracesFilePath(this.dateKey(date));
    return this.readLines<CronRecord & { _type?: string }>(filePath)
      .filter((r) => r._type === 'cron')
      .map(({ _type: _t, ...rest }) => rest as CronRecord);
  }
}
