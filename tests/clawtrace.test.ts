/**
 * Unit tests for ClawTrace core, TraceStore, and TraceRecorder
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClawTrace } from '../src/core/clawtrace';
import { TraceStore } from '../src/trace/store';
import { TraceRecorder } from '../src/trace/recorder';
import { detectSkills } from '../src/init/detector';
import { readInitConfig, writeInitConfig } from '../src/init/config';
import { injectSkillStats, buildStatsBlock, STATS_START_MARKER, STATS_END_MARKER } from '../src/init/injector';
import { extractSkillCallFromLine, scanSessionLogs, importSessionLogs } from '../src/import/importer';
import { SkillTrace, MemoryChange, CronRecord } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDirs(): { tracesDir: string; memoryChangesDir: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-test-'));
  const tracesDir = path.join(base, 'traces');
  const memoryChangesDir = path.join(base, 'memory-changes');
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(memoryChangesDir, { recursive: true });
  return {
    tracesDir,
    memoryChangesDir,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

function makeClawTrace(): { ct: ClawTrace; cleanup: () => void } {
  const { tracesDir, memoryChangesDir, cleanup } = makeTempDirs();
  const ct = new ClawTrace({ tracesDir, memoryChangesDir });
  return { ct, cleanup };
}

// ---------------------------------------------------------------------------
// TraceStore
// ---------------------------------------------------------------------------
describe('TraceStore', () => {
  let tracesDir: string;
  let memoryChangesDir: string;
  let cleanup: () => void;
  let store: TraceStore;

  beforeEach(() => {
    const dirs = makeTempDirs();
    tracesDir = dirs.tracesDir;
    memoryChangesDir = dirs.memoryChangesDir;
    cleanup = dirs.cleanup;
    store = new TraceStore(tracesDir, memoryChangesDir);
  });

  afterEach(() => cleanup());

  it('should return empty arrays when no files exist', () => {
    expect(store.readTraces()).toEqual([]);
    expect(store.readMemoryChanges()).toEqual([]);
    expect(store.readCronRecords()).toEqual([]);
  });

  it('should append and read a SkillTrace', () => {
    const trace: SkillTrace = {
      id: 'abc123',
      skillName: 'my-skill',
      startTime: new Date().toISOString(),
      status: 'success',
      durationMs: 1500,
      cost: 0.05,
    };
    store.appendTrace(trace);
    const records = store.readTraces();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('abc123');
    expect(records[0].skillName).toBe('my-skill');
    expect(records[0].status).toBe('success');
  });

  it('should append multiple traces and read them all', () => {
    const makeTrace = (id: string, skill: string): SkillTrace => ({
      id,
      skillName: skill,
      startTime: new Date().toISOString(),
      status: 'success',
    });
    store.appendTrace(makeTrace('t1', 'skill-a'));
    store.appendTrace(makeTrace('t2', 'skill-b'));
    const records = store.readTraces();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('should update an existing trace', () => {
    const trace: SkillTrace = {
      id: 'upd1',
      skillName: 'update-skill',
      startTime: new Date().toISOString(),
      status: 'running',
    };
    store.appendTrace(trace);
    const updated = store.updateTrace('upd1', { status: 'success', durationMs: 2000 });
    expect(updated).toBe(true);
    const records = store.readTraces();
    expect(records[0].status).toBe('success');
    expect(records[0].durationMs).toBe(2000);
  });

  it('should return false when updating a non-existent trace', () => {
    const result = store.updateTrace('nonexistent', { status: 'success' });
    expect(result).toBe(false);
  });

  it('should append and read MemoryChange records', () => {
    const change: MemoryChange = {
      id: 'mc1',
      time: new Date().toISOString(),
      agent: 'morning-email',
      file: 'memory/MEMORY.md',
      linesAdded: 3,
      linesRemoved: 0,
    };
    store.appendMemoryChange(change);
    const records = store.readMemoryChanges();
    expect(records).toHaveLength(1);
    expect(records[0].agent).toBe('morning-email');
    expect(records[0].linesAdded).toBe(3);
  });

  it('should read memory changes within last N hours', () => {
    // Record one change from 2 hours ago (should be included with 24h window)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const change: MemoryChange = {
      id: 'recent',
      time: twoHoursAgo,
      agent: 'heartbeat',
      file: 'memory/heartbeat.json',
      linesAdded: 1,
      linesRemoved: 1,
    };
    store.appendMemoryChange(change);
    const recent = store.readMemoryChangesLastHours(24);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent.some((r) => r.id === 'recent')).toBe(true);
  });

  it('should not return memory changes outside the time window', () => {
    // "Old" change recorded 50 hours ago won't be in the last 24h window
    const oldDate = new Date(Date.now() - 50 * 3600_000);
    const change: MemoryChange = {
      id: 'old-change',
      time: oldDate.toISOString(),
      agent: 'old-agent',
      file: 'memory/old.md',
      linesAdded: 5,
      linesRemoved: 0,
    };
    store.appendMemoryChange(change, oldDate);
    const recent = store.readMemoryChangesLastHours(24);
    expect(recent.some((r) => r.id === 'old-change')).toBe(false);
  });

  it('should append and read CronRecord entries', () => {
    const record: CronRecord = {
      id: 'cron1',
      jobName: 'daily-cleanup',
      cronExpr: '0 3 * * *',
      startTime: new Date().toISOString(),
      status: 'success',
      durationMs: 5000,
    };
    store.appendCronRecord(record);
    const records = store.readCronRecords();
    expect(records).toHaveLength(1);
    expect(records[0].jobName).toBe('daily-cleanup');
    expect(records[0].cronExpr).toBe('0 3 * * *');
  });
});

// ---------------------------------------------------------------------------
// TraceRecorder
// ---------------------------------------------------------------------------
describe('TraceRecorder', () => {
  let tracesDir: string;
  let memoryChangesDir: string;
  let cleanup: () => void;
  let store: TraceStore;
  let recorder: TraceRecorder;

  beforeEach(() => {
    const dirs = makeTempDirs();
    tracesDir = dirs.tracesDir;
    memoryChangesDir = dirs.memoryChangesDir;
    cleanup = dirs.cleanup;
    store = new TraceStore(tracesDir, memoryChangesDir);
    recorder = new TraceRecorder(store);
  });

  afterEach(() => cleanup());

  it('should record a successful skill and update its status', async () => {
    await recorder.wrap('my-skill', async () => 'result');
    const traces = store.readTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('success');
    expect(traces[0].skillName).toBe('my-skill');
    expect(traces[0].durationMs).toBeDefined();
  });

  it('should record a failed skill and preserve the error message', async () => {
    await expect(
      recorder.wrap('failing-skill', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const traces = store.readTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('failed');
    expect(traces[0].error).toBe('boom');
  });

  it('should pass through the return value from the wrapped function', async () => {
    const result = await recorder.wrap('pass-through', async () => 42);
    expect(result).toBe(42);
  });

  it('should record session label when provided', async () => {
    await recorder.wrap('labeled-skill', async () => null, {
      sessionLabel: 'morning-routine',
    });
    const traces = store.readTraces();
    expect(traces[0].sessionLabel).toBe('morning-routine');
  });

  it('should support manually recording a trace with recordTrace', () => {
    const id = recorder.recordTrace({
      skillName: 'manual-skill',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 3000,
      cost: 0.07,
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const traces = store.readTraces();
    expect(traces.some((t) => t.id === id)).toBe(true);
    expect(traces.find((t) => t.id === id)?.cost).toBe(0.07);
  });

  it('should record a memory change with recordMemoryChange', () => {
    const id = recorder.recordMemoryChange({
      agent: 'daily-tool-creator',
      file: 'memory/2026-02-24.md',
      linesAdded: 45,
      linesRemoved: 0,
      description: 'wrote daily note',
    });
    expect(typeof id).toBe('string');
    const changes = store.readMemoryChanges();
    expect(changes.some((c) => c.id === id)).toBe(true);
    expect(changes.find((c) => c.id === id)?.linesAdded).toBe(45);
  });

  it('should record a successful cron job with wrapCron', async () => {
    await recorder.wrapCron('nightly-backup', async () => 'done', '0 2 * * *');
    const records = store.readCronRecords();
    // A "done" record is appended
    const doneRecord = records.find((r) => r.jobName === 'nightly-backup' && r.status === 'success');
    expect(doneRecord).toBeDefined();
    expect(doneRecord?.cronExpr).toBe('0 2 * * *');
  });

  it('should record a failed cron job with wrapCron', async () => {
    await expect(
      recorder.wrapCron('bad-cron', async () => {
        throw new Error('cron failed');
      })
    ).rejects.toThrow('cron failed');

    const records = store.readCronRecords();
    const failRecord = records.find((r) => r.jobName === 'bad-cron' && r.status === 'failed');
    expect(failRecord).toBeDefined();
    expect(failRecord?.error).toBe('cron failed');
  });
});

// ---------------------------------------------------------------------------
// ClawTrace — core coordinator
// ---------------------------------------------------------------------------
describe('ClawTrace', () => {
  let ct: ClawTrace;
  let cleanup: () => void;

  beforeEach(() => {
    ({ ct, cleanup } = makeClawTrace());
  });

  afterEach(() => cleanup());

  it('should instantiate with default config', () => {
    // ClawTrace without arguments uses cwd-relative paths; just verify it constructs
    const instance = new ClawTrace({ tracesDir: '/tmp/ct-test', memoryChangesDir: '/tmp/ct-mc-test' });
    expect(instance).toBeDefined();
    fs.rmSync('/tmp/ct-test', { recursive: true, force: true });
    fs.rmSync('/tmp/ct-mc-test', { recursive: true, force: true });
  });

  it('should return an empty DailySummary when no traces exist', () => {
    const summary = ct.getDailySummary();
    expect(summary.totalSkills).toBe(0);
    expect(summary.successCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.totalCost).toBe(0);
  });

  it('should include recorded traces in the daily summary', () => {
    ct.recordTrace({ skillName: 'a', status: 'success', startTime: new Date().toISOString(), cost: 0.10 });
    ct.recordTrace({ skillName: 'b', status: 'failed', startTime: new Date().toISOString() });
    const summary = ct.getDailySummary();
    expect(summary.totalSkills).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.totalCost).toBeCloseTo(0.10);
  });

  it('should correctly compute totalCost from multiple traces', () => {
    ct.recordTrace({ skillName: 'x', status: 'success', startTime: new Date().toISOString(), cost: 0.12 });
    ct.recordTrace({ skillName: 'y', status: 'success', startTime: new Date().toISOString(), cost: 0.08 });
    ct.recordTrace({ skillName: 'z', status: 'success', startTime: new Date().toISOString(), cost: 0.45 });
    const summary = ct.getDailySummary();
    expect(summary.totalCost).toBeCloseTo(0.65);
  });

  it('should group traces into sessions', () => {
    ct.recordTrace({ skillName: 'a', status: 'success', startTime: new Date().toISOString(), sessionLabel: 'morning' });
    ct.recordTrace({ skillName: 'b', status: 'success', startTime: new Date().toISOString(), sessionLabel: 'morning' });
    ct.recordTrace({ skillName: 'c', status: 'failed', startTime: new Date().toISOString() });

    const sessions = ct.getSessions();
    expect(sessions.length).toBe(2);
    const morning = sessions.find((s) => s.label === 'morning');
    expect(morning).toBeDefined();
    expect(morning!.skills).toHaveLength(2);
    const defaultSession = sessions.find((s) => s.label === undefined);
    expect(defaultSession!.skills).toHaveLength(1);
  });

  it('should return undefined for a non-existent session label', () => {
    const session = ct.getSession('nonexistent');
    expect(session).toBeUndefined();
  });

  it('should retrieve an existing session by label', () => {
    ct.recordTrace({ skillName: 'skill1', status: 'success', startTime: new Date().toISOString(), sessionLabel: 'evening' });
    const session = ct.getSession('evening');
    expect(session).toBeDefined();
    expect(session!.label).toBe('evening');
    expect(session!.skills).toHaveLength(1);
  });

  it('should return recent memory changes', () => {
    ct.recordMemoryChange({ agent: 'test-agent', file: 'memory/MEMORY.md', linesAdded: 5, linesRemoved: 0 });
    const changes = ct.getRecentMemoryChanges(24);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.some((c) => c.agent === 'test-agent')).toBe(true);
  });

  it('should return empty array when no memory changes exist', () => {
    expect(ct.getRecentMemoryChanges(1)).toEqual([]);
  });

  it('should return cron history', () => {
    ct.store.appendCronRecord({
      id: 'cr1',
      jobName: 'test-cron',
      startTime: new Date().toISOString(),
      status: 'success',
      durationMs: 1000,
    });
    const records = ct.getCronHistory();
    expect(records.some((r) => r.jobName === 'test-cron')).toBe(true);
  });

  it('should retrieve skill traces by name', () => {
    ct.recordTrace({ skillName: 'target-skill', status: 'success', startTime: new Date().toISOString() });
    ct.recordTrace({ skillName: 'other-skill', status: 'success', startTime: new Date().toISOString() });
    const traces = ct.getSkillTraces('target-skill');
    expect(traces).toHaveLength(1);
    expect(traces[0].skillName).toBe('target-skill');
  });

  it('should return the last skill trace', () => {
    const earlier = new Date(Date.now() - 5000).toISOString();
    const later = new Date().toISOString();
    ct.recordTrace({ skillName: 'my-skill', status: 'success', startTime: earlier, cost: 0.01 });
    ct.recordTrace({ skillName: 'my-skill', status: 'failed', startTime: later, error: 'oops' });
    const last = ct.getLastSkillTrace('my-skill');
    expect(last).toBeDefined();
    // getLastSkillTrace returns the most recent by startTime (descending sort)
    expect(last!.error).toBe('oops');
  });

  it('should return undefined when no trace exists for a skill name', () => {
    expect(ct.getLastSkillTrace('nonexistent-skill')).toBeUndefined();
  });

  it('should wrap an async function and record a trace', async () => {
    const result = await ct.wrap('wrapped-skill', async () => 'hello');
    expect(result).toBe('hello');
    const summary = ct.getDailySummary();
    expect(summary.traces.some((t) => t.skillName === 'wrapped-skill')).toBe(true);
    expect(summary.traces.find((t) => t.skillName === 'wrapped-skill')?.status).toBe('success');
  });

  it('should record a failed wrapped skill', async () => {
    await expect(ct.wrap('err-skill', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    const summary = ct.getDailySummary();
    const t = summary.traces.find((tr) => tr.skillName === 'err-skill');
    expect(t?.status).toBe('failed');
  });

  it('should wrap cron and record it', async () => {
    await ct.wrapCron('my-cron', async () => 42, '0 6 * * *');
    const records = ct.getCronHistory();
    const done = records.find((r) => r.jobName === 'my-cron' && r.status === 'success');
    expect(done).toBeDefined();
    expect(done?.cronExpr).toBe('0 6 * * *');
  });

  it('should include running count in daily summary', () => {
    ct.recordTrace({ skillName: 'in-progress', status: 'running', startTime: new Date().toISOString() });
    const summary = ct.getDailySummary();
    expect(summary.runningCount).toBe(1);
  });

  it('should return traces with tool calls populated', () => {
    ct.recordTrace({
      skillName: 'tool-skill',
      status: 'success',
      startTime: new Date().toISOString(),
      toolCalls: [{ tool: 'web_search', count: 5 }],
    });
    const traces = ct.getSkillTraces('tool-skill');
    expect(traces[0].toolCalls).toBeDefined();
    expect(traces[0].toolCalls![0].tool).toBe('web_search');
    expect(traces[0].toolCalls![0].count).toBe(5);
  });

  it('should return traces with sub-agent calls populated', () => {
    ct.recordTrace({
      skillName: 'parent-skill',
      status: 'success',
      startTime: new Date().toISOString(),
      subAgents: [
        { agentName: 'child-agent', startTime: new Date().toISOString(), status: 'success', durationMs: 1000 },
      ],
    });
    const traces = ct.getSkillTraces('parent-skill');
    expect(traces[0].subAgents).toBeDefined();
    expect(traces[0].subAgents![0].agentName).toBe('child-agent');
  });

  it('should record a trace with parentId', () => {
    const parentId = ct.recordTrace({
      skillName: 'parent-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 5000,
    });
    const childId = ct.recordTrace({
      skillName: 'child-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 2000,
      parentId,
    });
    const traces = ct.getSkillTraces('child-task');
    expect(traces[0].parentId).toBe(parentId);
  });

  it('should auto-discover sub-agent tree from parentId references', () => {
    const parentId = ct.recordTrace({
      skillName: 'parent-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 5000,
    });
    ct.recordTrace({
      skillName: 'child-a',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 2000,
      parentId,
    });
    ct.recordTrace({
      skillName: 'child-b',
      status: 'failed',
      startTime: new Date().toISOString(),
      durationMs: 1500,
      parentId,
    });

    const tree = ct.getTraceTree(parentId);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.agentName).sort()).toEqual(['child-a', 'child-b']);
    expect(tree.find((n) => n.agentName === 'child-a')?.status).toBe('success');
    expect(tree.find((n) => n.agentName === 'child-b')?.status).toBe('failed');
  });

  it('should auto-discover nested sub-agent trees (grandchildren)', () => {
    const parentId = ct.recordTrace({
      skillName: 'root-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 10000,
    });
    const childId = ct.recordTrace({
      skillName: 'middle-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 5000,
      parentId,
    });
    ct.recordTrace({
      skillName: 'leaf-task',
      status: 'success',
      startTime: new Date().toISOString(),
      durationMs: 1000,
      parentId: childId,
    });

    const tree = ct.getTraceTree(parentId);
    expect(tree).toHaveLength(1);
    expect(tree[0].agentName).toBe('middle-task');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].agentName).toBe('leaf-task');
  });

  it('should return empty tree when no children exist', () => {
    const traceId = ct.recordTrace({
      skillName: 'lonely-task',
      status: 'success',
      startTime: new Date().toISOString(),
    });
    const tree = ct.getTraceTree(traceId);
    expect(tree).toEqual([]);
  });

  it('should prefer explicit subAgents over auto-discovered tree', () => {
    const parentId = ct.recordTrace({
      skillName: 'explicit-parent',
      status: 'success',
      startTime: new Date().toISOString(),
      subAgents: [
        { agentName: 'explicit-child', startTime: new Date().toISOString(), status: 'success', durationMs: 500 },
      ],
    });
    ct.recordTrace({
      skillName: 'auto-child',
      status: 'success',
      startTime: new Date().toISOString(),
      parentId,
    });

    const tree = ct.getTraceTree(parentId);
    // Should return the explicit subAgents, not the auto-discovered one
    expect(tree).toHaveLength(1);
    expect(tree[0].agentName).toBe('explicit-child');
  });
});

// ---------------------------------------------------------------------------
// detectSkills
// ---------------------------------------------------------------------------
describe('detectSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-detect-'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('should return empty array when no skill directories exist', () => {
    expect(detectSkills(tmpDir)).toEqual([]);
  });

  it('should detect directory-based skills (skills/<name>/SKILL.md)', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'my-skill', 'SKILL.md'), '');
    fs.mkdirSync(path.join(skillsDir, 'another-skill'));
    fs.writeFileSync(path.join(skillsDir, 'another-skill', 'SKILL.md'), '');

    const skills = detectSkills(tmpDir);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['another-skill', 'my-skill']);
  });

  it('should detect flat .md skill files in skills/ directory', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, 'flat-skill.md'), '');

    const skills = detectSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('flat-skill');
  });

  it('should exclude well-known non-skill md files', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, 'README.md'), '');
    fs.writeFileSync(path.join(skillsDir, 'CHANGELOG.md'), '');
    fs.writeFileSync(path.join(skillsDir, 'AGENTS.md'), '');
    fs.writeFileSync(path.join(skillsDir, 'real-skill.md'), '');

    const skills = detectSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('real-skill');
  });

  it('should skip directories without a SKILL.md', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'incomplete-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'incomplete-skill', 'README.md'), '');

    const skills = detectSkills(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it('should detect skills in src/skills/ directory', () => {
    const skillsDir = path.join(tmpDir, 'src', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'nested-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'nested-skill', 'SKILL.md'), '');

    const skills = detectSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('nested-skill');
  });

  it('should include filePath pointing to SKILL.md for directory-based skills', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'path-skill'), { recursive: true });
    const skillMd = path.join(skillsDir, 'path-skill', 'SKILL.md');
    fs.writeFileSync(skillMd, '');

    const skills = detectSkills(tmpDir);
    expect(skills[0].filePath).toBe(skillMd);
  });
});

// ---------------------------------------------------------------------------
// readInitConfig / writeInitConfig
// ---------------------------------------------------------------------------
describe('init config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-cfg-'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('should return null when config file does not exist', () => {
    expect(readInitConfig(tmpDir)).toBeNull();
  });

  it('should write and read back config correctly', () => {
    writeInitConfig(
      { wrappedSkills: ['skill-a', 'skill-b'], excludedSkills: ['skill-c'], initialized: true },
      tmpDir
    );
    const config = readInitConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.wrappedSkills).toEqual(['skill-a', 'skill-b']);
    expect(config!.excludedSkills).toEqual(['skill-c']);
    expect(config!.initialized).toBe(true);
  });

  it('should return null when config file is malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.clawtrace.json'), '{bad json}', 'utf8');
    expect(readInitConfig(tmpDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ClawTrace.shouldWrap
// ---------------------------------------------------------------------------
describe('ClawTrace.shouldWrap', () => {
  let tmpDir: string;
  let ct: ClawTrace;
  let cleanup: () => void;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-sw-'));
    ({ ct, cleanup } = makeClawTrace());
  });

  afterEach(() => {
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return true when no config file exists (default behaviour)', () => {
    expect(ct.shouldWrap('any-skill', tmpDir)).toBe(true);
  });

  it('should return true for a skill listed in wrappedSkills', () => {
    writeInitConfig(
      { wrappedSkills: ['skill-a'], excludedSkills: ['skill-b'], initialized: true },
      tmpDir
    );
    expect(ct.shouldWrap('skill-a', tmpDir)).toBe(true);
  });

  it('should return false for a skill listed in excludedSkills', () => {
    writeInitConfig(
      { wrappedSkills: ['skill-a'], excludedSkills: ['skill-b'], initialized: true },
      tmpDir
    );
    expect(ct.shouldWrap('skill-b', tmpDir)).toBe(false);
  });

  it('should return false for a skill not in wrappedSkills when config exists', () => {
    writeInitConfig(
      { wrappedSkills: ['skill-a'], excludedSkills: [], initialized: true },
      tmpDir
    );
    expect(ct.shouldWrap('unknown-skill', tmpDir)).toBe(false);
  });

  it('should return true when config exists but initialized is false', () => {
    writeInitConfig(
      { wrappedSkills: [], excludedSkills: ['skill-a'], initialized: false },
      tmpDir
    );
    expect(ct.shouldWrap('skill-a', tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// injectSkillStats / buildStatsBlock
// ---------------------------------------------------------------------------
describe('buildStatsBlock', () => {
  it('should include start and end markers', () => {
    const block = buildStatsBlock([]);
    expect(block).toContain(STATS_START_MARKER);
    expect(block).toContain(STATS_END_MARKER);
  });

  it('should show zero counts when no traces provided', () => {
    const block = buildStatsBlock([]);
    expect(block).toContain('| Runs today | 0 |');
    expect(block).toContain('| ✅ Success | 0 |');
    expect(block).toContain('| ❌ Failed | 0 |');
    expect(block).toContain('| 🕐 Last run | - |');
  });

  it('should count success and failed traces correctly', () => {
    const traces: SkillTrace[] = [
      { id: '1', skillName: 'sk', startTime: '2026-02-25T08:00:00Z', status: 'success', durationMs: 5000 },
      { id: '2', skillName: 'sk', startTime: '2026-02-25T09:00:00Z', status: 'failed', durationMs: 3000 },
      { id: '3', skillName: 'sk', startTime: '2026-02-25T10:00:00Z', status: 'success', durationMs: 7000 },
    ];
    const block = buildStatsBlock(traces);
    expect(block).toContain('| Runs today | 3 |');
    expect(block).toContain('| ✅ Success | 2 |');
    expect(block).toContain('| ❌ Failed | 1 |');
  });

  it('should compute average duration correctly', () => {
    const traces: SkillTrace[] = [
      { id: '1', skillName: 'sk', startTime: '2026-02-25T08:00:00Z', status: 'success', durationMs: 4000 },
      { id: '2', skillName: 'sk', startTime: '2026-02-25T09:00:00Z', status: 'success', durationMs: 8000 },
    ];
    const block = buildStatsBlock(traces);
    // avg = 6000ms = 6s
    expect(block).toContain('| ⏱ Avg duration | 6s |');
  });

  it('should show last run from the most recent trace by startTime', () => {
    const traces: SkillTrace[] = [
      { id: '1', skillName: 'sk', startTime: '2026-02-25T07:00:00Z', status: 'failed' },
      { id: '2', skillName: 'sk', startTime: '2026-02-25T10:30:00Z', status: 'success' },
    ];
    const block = buildStatsBlock(traces);
    expect(block).toContain('10:30 UTC ✅');
  });

  it('should include --parent hint in reporting instructions', () => {
    const block = buildStatsBlock([], 'my-skill');
    expect(block).toContain('--parent <parentTraceId>');
  });
});

describe('injectSkillStats', () => {
  let tmpDir: string;
  let skillFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-inject-'));
    skillFile = path.join(tmpDir, 'SKILL.md');
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('should do nothing when the file does not exist', () => {
    expect(() => injectSkillStats(path.join(tmpDir, 'MISSING.md'), 'sk', [])).not.toThrow();
  });

  it('should append a stats block to an empty file', () => {
    fs.writeFileSync(skillFile, '');
    injectSkillStats(skillFile, 'sk', []);
    const content = fs.readFileSync(skillFile, 'utf8');
    expect(content).toContain(STATS_START_MARKER);
    expect(content).toContain(STATS_END_MARKER);
    expect(content).toContain('## 📊 ClawTrace Statistics');
  });

  it('should append after existing content with a blank line separator', () => {
    fs.writeFileSync(skillFile, '# My Skill\nDoes stuff.\n');
    injectSkillStats(skillFile, 'sk', []);
    const content = fs.readFileSync(skillFile, 'utf8');
    expect(content.startsWith('# My Skill\nDoes stuff.\n')).toBe(true);
    expect(content).toContain(STATS_START_MARKER);
  });

  it('should replace an existing stats block on subsequent calls', () => {
    fs.writeFileSync(skillFile, '# My Skill\n');
    const traces1: SkillTrace[] = [
      { id: '1', skillName: 'sk', startTime: '2026-02-25T08:00:00Z', status: 'success' },
    ];
    injectSkillStats(skillFile, 'sk', traces1);

    const traces2: SkillTrace[] = [
      { id: '1', skillName: 'sk', startTime: '2026-02-25T08:00:00Z', status: 'success' },
      { id: '2', skillName: 'sk', startTime: '2026-02-25T09:00:00Z', status: 'failed' },
    ];
    injectSkillStats(skillFile, 'sk', traces2);

    const content = fs.readFileSync(skillFile, 'utf8');
    // Should appear exactly once
    expect(content.split(STATS_START_MARKER).length).toBe(2);
    expect(content).toContain('| Runs today | 2 |');
  });

  it('should not corrupt content before the stats block', () => {
    const original = '# My Skill\n\nThis skill does important work.\n';
    fs.writeFileSync(skillFile, original);
    injectSkillStats(skillFile, 'sk', []);
    const content = fs.readFileSync(skillFile, 'utf8');
    expect(content.startsWith(original)).toBe(true);
  });

  it('should include MANDATORY reporting instruction prominently', () => {
    fs.writeFileSync(skillFile, '# My Skill\n');
    injectSkillStats(skillFile, 'my-skill', []);
    const content = fs.readFileSync(skillFile, 'utf8');
    expect(content).toContain('MANDATORY');
    // Reporting instruction appears before the stats table
    const mandatoryIdx = content.indexOf('MANDATORY');
    const tableIdx = content.indexOf('| Runs today |');
    expect(mandatoryIdx).toBeLessThan(tableIdx);
  });
});

// ---------------------------------------------------------------------------
// TraceStore.readTracesDateRange
// ---------------------------------------------------------------------------
describe('TraceStore.readTracesDateRange', () => {
  let tracesDir: string;
  let memoryChangesDir: string;
  let cleanup: () => void;
  let store: TraceStore;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-range-'));
    tracesDir = path.join(base, 'traces');
    memoryChangesDir = path.join(base, 'memory-changes');
    fs.mkdirSync(tracesDir, { recursive: true });
    fs.mkdirSync(memoryChangesDir, { recursive: true });
    cleanup = () => fs.rmSync(base, { recursive: true, force: true });
    store = new TraceStore(tracesDir, memoryChangesDir);
  });

  afterEach(() => cleanup());

  it('should return traces across multiple days', () => {
    const day1 = new Date('2026-02-01T10:00:00Z');
    const day2 = new Date('2026-02-03T10:00:00Z');
    store.appendTrace({ id: 't1', skillName: 'skill-a', startTime: day1.toISOString(), status: 'success' }, day1);
    store.appendTrace({ id: 't2', skillName: 'skill-b', startTime: day2.toISOString(), status: 'failed' }, day2);

    const results = store.readTracesDateRange(new Date('2026-02-01'), new Date('2026-02-03'));
    expect(results.map((r) => r.id).sort()).toEqual(['t1', 't2']);
  });

  it('should return empty array when no traces exist in range', () => {
    const results = store.readTracesDateRange(new Date('2026-01-01'), new Date('2026-01-31'));
    expect(results).toEqual([]);
  });

  it('should exclude traces outside the range', () => {
    const inRange = new Date('2026-02-15T10:00:00Z');
    const outOfRange = new Date('2026-01-01T10:00:00Z');
    store.appendTrace({ id: 'in', skillName: 'skill-a', startTime: inRange.toISOString(), status: 'success' }, inRange);
    store.appendTrace({ id: 'out', skillName: 'skill-b', startTime: outOfRange.toISOString(), status: 'success' }, outOfRange);

    const results = store.readTracesDateRange(new Date('2026-02-01'), new Date('2026-02-28'));
    expect(results.map((r) => r.id)).toEqual(['in']);
  });
});

// ---------------------------------------------------------------------------
// ClawTrace.getStatsRange and ClawTrace.getRankings
// ---------------------------------------------------------------------------
describe('ClawTrace multi-day stats', () => {
  let ct: ClawTrace;
  let cleanup: () => void;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-stats-'));
    const tracesDir = path.join(base, 'traces');
    const memoryChangesDir = path.join(base, 'memory-changes');
    fs.mkdirSync(tracesDir, { recursive: true });
    fs.mkdirSync(memoryChangesDir, { recursive: true });
    cleanup = () => fs.rmSync(base, { recursive: true, force: true });
    ct = new ClawTrace({ tracesDir, memoryChangesDir });
  });

  afterEach(() => cleanup());

  it('getStatsRange should aggregate traces across days', () => {
    const day1 = new Date('2026-02-10T08:00:00Z');
    const day2 = new Date('2026-02-11T09:00:00Z');
    ct.store.appendTrace({ id: '1', skillName: 'sk-a', startTime: day1.toISOString(), status: 'success', durationMs: 1000 }, day1);
    ct.store.appendTrace({ id: '2', skillName: 'sk-b', startTime: day2.toISOString(), status: 'failed', durationMs: 2000 }, day2);

    const summary = ct.getStatsRange(new Date('2026-02-10'), new Date('2026-02-11'));
    expect(summary.totalSkills).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.date).toContain('2026-02-10');
    expect(summary.date).toContain('2026-02-11');
  });

  it('getRankings should sort skills by call count descending', () => {
    const day = new Date('2026-02-10T08:00:00Z');
    ct.store.appendTrace({ id: '1', skillName: 'rare', startTime: day.toISOString(), status: 'success' }, day);
    ct.store.appendTrace({ id: '2', skillName: 'popular', startTime: day.toISOString(), status: 'success' }, day);
    ct.store.appendTrace({ id: '3', skillName: 'popular', startTime: day.toISOString(), status: 'failed' }, day);
    ct.store.appendTrace({ id: '4', skillName: 'popular', startTime: day.toISOString(), status: 'success' }, day);

    const rankings = ct.getRankings(new Date('2026-02-10'), new Date('2026-02-10'));
    expect(rankings[0].skillName).toBe('popular');
    expect(rankings[0].callCount).toBe(3);
    expect(rankings[0].successRate).toBe(67);
    expect(rankings[1].skillName).toBe('rare');
    expect(rankings[1].callCount).toBe(1);
  });

  it('getRankings should return empty array when no traces exist', () => {
    const rankings = ct.getRankings(new Date('2026-01-01'), new Date('2026-01-31'));
    expect(rankings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractSkillCallFromLine
// ---------------------------------------------------------------------------
describe('extractSkillCallFromLine', () => {
  it('should return null for non-JSON lines', () => {
    expect(extractSkillCallFromLine('not json', 'sess1')).toBeNull();
  });

  it('should return null for JSON lines without SKILL.md', () => {
    expect(extractSkillCallFromLine('{"type":"message","content":"hello"}', 'sess1')).toBeNull();
  });

  it('should extract skill name from a line referencing skills/<name>/SKILL.md', () => {
    const line = JSON.stringify({
      timestamp: '2026-02-01T08:00:00Z',
      type: 'tool_use',
      input: { path: 'skills/github-project-reviewer/SKILL.md' },
    });
    const result = extractSkillCallFromLine(line, 'sess1');
    expect(result).not.toBeNull();
    expect(result!.skillName).toBe('github-project-reviewer');
    expect(result!.sessionId).toBe('sess1');
    expect(result!.timestamp).toBe('2026-02-01T08:00:00Z');
  });

  it('should fall back to current time when no timestamp in entry', () => {
    const before = new Date();
    const line = JSON.stringify({ tool: 'read', path: 'skills/my-skill/SKILL.md' });
    const result = extractSkillCallFromLine(line, 'sess1');
    const after = new Date();
    expect(result).not.toBeNull();
    const ts = new Date(result!.timestamp);
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  it('should pick up timestamp from nested message object', () => {
    const line = JSON.stringify({
      message: { timestamp: '2026-02-02T10:00:00Z' },
      data: 'skills/nested-skill/SKILL.md',
    });
    const result = extractSkillCallFromLine(line, 'sess1');
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe('2026-02-02T10:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// scanSessionLogs and importSessionLogs
// ---------------------------------------------------------------------------
describe('scanSessionLogs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-sessions-'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('should return empty array when directory does not exist', () => {
    expect(scanSessionLogs('/nonexistent/path/to/sessions')).toEqual([]);
  });

  it('should extract skill calls from session JSONL files', () => {
    const lines = [
      JSON.stringify({ timestamp: '2026-02-01T08:00:00Z', input: { path: 'skills/skill-a/SKILL.md' } }),
      JSON.stringify({ timestamp: '2026-02-01T09:00:00Z', input: { path: 'skills/skill-b/SKILL.md' } }),
      JSON.stringify({ timestamp: '2026-02-01T10:00:00Z', content: 'no skill reference here' }),
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'session-001.jsonl'), lines);

    const results = scanSessionLogs(tmpDir);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.skillName).sort()).toEqual(['skill-a', 'skill-b']);
  });

  it('should filter entries by since date', () => {
    const lines = [
      JSON.stringify({ timestamp: '2026-01-01T08:00:00Z', input: { path: 'skills/old-skill/SKILL.md' } }),
      JSON.stringify({ timestamp: '2026-02-15T08:00:00Z', input: { path: 'skills/new-skill/SKILL.md' } }),
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'session-001.jsonl'), lines);

    const results = scanSessionLogs(tmpDir, new Date('2026-02-01'));
    expect(results).toHaveLength(1);
    expect(results[0].skillName).toBe('new-skill');
  });

  it('should scan multiple JSONL files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'sess-a.jsonl'),
      JSON.stringify({ timestamp: '2026-02-01T08:00:00Z', input: { path: 'skills/skill-x/SKILL.md' } }) + '\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'sess-b.jsonl'),
      JSON.stringify({ timestamp: '2026-02-02T08:00:00Z', input: { path: 'skills/skill-y/SKILL.md' } }) + '\n'
    );

    const results = scanSessionLogs(tmpDir);
    expect(results).toHaveLength(2);
  });
});

describe('importSessionLogs', () => {
  let tmpDir: string;
  let store: TraceStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtrace-import-'));
    const tracesDir = path.join(tmpDir, 'traces');
    const memoryChangesDir = path.join(tmpDir, 'memory-changes');
    fs.mkdirSync(tracesDir, { recursive: true });
    fs.mkdirSync(memoryChangesDir, { recursive: true });
    store = new TraceStore(tracesDir, memoryChangesDir);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('should import new skill calls and return count', () => {
    const sessDir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(sessDir);
    fs.writeFileSync(
      path.join(sessDir, 'sess-001.jsonl'),
      JSON.stringify({ timestamp: '2026-02-01T08:00:00Z', input: { path: 'skills/my-skill/SKILL.md' } }) + '\n'
    );

    const count = importSessionLogs(sessDir, store);
    expect(count).toBe(1);

    const traces = store.readTracesDateRange(new Date('2026-02-01'), new Date('2026-02-01'));
    expect(traces).toHaveLength(1);
    expect(traces[0].skillName).toBe('my-skill');
    expect(traces[0].status).toBe('success');
  });

  it('should skip duplicate imports on re-run', () => {
    const sessDir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(sessDir);
    fs.writeFileSync(
      path.join(sessDir, 'sess-001.jsonl'),
      JSON.stringify({ timestamp: '2026-02-01T08:00:00Z', input: { path: 'skills/my-skill/SKILL.md' } }) + '\n'
    );

    const first = importSessionLogs(sessDir, store);
    expect(first).toBe(1);

    const second = importSessionLogs(sessDir, store);
    expect(second).toBe(0);
  });

  it('ClawTrace.importFromSessions should delegate correctly', () => {
    const sessDir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(sessDir);
    fs.writeFileSync(
      path.join(sessDir, 'sess-001.jsonl'),
      JSON.stringify({ timestamp: '2026-02-05T10:00:00Z', input: { path: 'skills/cool-skill/SKILL.md' } }) + '\n'
    );

    const tracesDir = path.join(tmpDir, 'ct-traces');
    const memDir = path.join(tmpDir, 'ct-mem');
    fs.mkdirSync(tracesDir, { recursive: true });
    fs.mkdirSync(memDir, { recursive: true });
    const ct = new ClawTrace({ tracesDir, memoryChangesDir: memDir });

    const count = ct.importFromSessions(sessDir);
    expect(count).toBe(1);
  });
});
