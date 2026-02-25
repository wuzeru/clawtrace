/**
 * ClawTrace — OpenClaw Session Log Importer
 *
 * Scans OpenClaw agent session JSONL files and extracts historical
 * skill call records by detecting reads of `skills/<name>/SKILL.md`.
 *
 * Extracted records are written into the ClawTrace traces store so they
 * become visible to all other commands (today, stats, rank, inject, …).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { TraceStore } from '../trace/store';
import { SkillTrace } from '../types';

/** A single imported skill call extracted from a session log entry. */
export interface ImportedSkillCall {
  skillName: string;
  /** ISO-8601 timestamp of the session log entry */
  timestamp: string;
  /** Session file name (used as sessionLabel) */
  sessionId: string;
}

// Regex that matches any path containing skills/<name>/SKILL.md
// Captures the skill name (no slashes, at least one char).
const SKILL_MD_RE = /skills\/([^/\s"']+)\/SKILL\.md/;

/**
 * Extract skill name and timestamp from a single raw JSONL line.
 * Returns `null` when the line does not reference a SKILL.md read.
 *
 * Handles several common OpenClaw session log formats:
 *  - Anthropic-style tool_use content blocks
 *  - Generic event objects with a `path` / `file` / `input.path` field
 *  - Any JSON object whose serialised form contains the path pattern
 */
export function extractSkillCallFromLine(
  line: string,
  sessionId: string
): ImportedSkillCall | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // Quick path: skip lines that don't mention SKILL.md at all
  if (!trimmed.includes('SKILL.md')) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const match = trimmed.match(SKILL_MD_RE);
  if (!match) return null;

  const skillName = match[1];

  // Extract timestamp from common fields
  const timestamp = pickTimestamp(obj) ?? new Date().toISOString();

  return { skillName, timestamp, sessionId };
}

/** Attempt to extract an ISO timestamp from a parsed JSON value. */
function pickTimestamp(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;

  const candidates = [
    record['timestamp'],
    record['time'],
    record['created_at'],
    record['start_time'],
    record['ts'],
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && isValidIso(c)) return c;
    if (typeof c === 'number') return new Date(c).toISOString();
  }

  // Recurse into `message` and `event` sub-objects (one level deep)
  for (const key of ['message', 'event']) {
    const sub = record[key];
    if (sub && typeof sub === 'object') {
      const found = pickTimestamp(sub);
      if (found) return found;
    }
  }

  return null;
}

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(Date.parse(s));
}

/**
 * Scan all `.jsonl` files in `sessionsDir` (non-recursively) and return
 * every skill call found.  Pass `since` to filter out entries before a
 * given date.
 */
export function scanSessionLogs(
  sessionsDir: string,
  since?: Date
): ImportedSkillCall[] {
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(sessionsDir, f));

  const results: ImportedSkillCall[] = [];

  for (const filePath of files) {
    const sessionId = path.basename(filePath, '.jsonl');
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const call = extractSkillCallFromLine(line, sessionId);
      if (!call) continue;
      if (since && new Date(call.timestamp) < since) continue;
      results.push(call);
    }
  }

  return results;
}

/** Generate a stable, unique ID from a session call (avoids duplicates on re-import). */
function stableId(call: ImportedSkillCall): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${call.sessionId}:${call.timestamp}:${call.skillName}`)
    .digest('hex')
    .slice(0, 16);
  return `import-${hash}`;
}

/**
 * Import skill calls from OpenClaw session logs into the ClawTrace store.
 *
 * Already-imported records (same stable ID) are skipped.
 * Returns the number of newly written traces.
 */
export function importSessionLogs(
  sessionsDir: string,
  store: TraceStore,
  since?: Date
): number {
  const calls = scanSessionLogs(sessionsDir, since);

  // Build a set of IDs already present across affected dates to avoid duplicates
  const existingIds = new Set<string>();
  if (calls.length > 0) {
    const earliest = calls.reduce(
      (min, c) => (c.timestamp < min ? c.timestamp : min),
      calls[0].timestamp
    );
    const sinceDate = since ?? new Date(earliest);
    const existing = store.readTracesDateRange(sinceDate, new Date());
    for (const t of existing) {
      existingIds.add(t.id);
    }
  }

  let written = 0;
  for (const call of calls) {
    const id = stableId(call);
    if (existingIds.has(id)) continue;

    const trace: SkillTrace = {
      id,
      skillName: call.skillName,
      sessionLabel: call.sessionId,
      startTime: call.timestamp,
      status: 'success',
    };

    // Write into the correct daily file based on the call's timestamp
    store.appendTrace(trace, new Date(call.timestamp));
    existingIds.add(id);
    written++;
  }

  return written;
}
