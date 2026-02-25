#!/usr/bin/env node
/**
 * ClawTrace CLI — Native observability tool for OpenClaw agents
 *
 * Commands:
 *   clawtrace init                               Detect skills and configure wrapping
 *   clawtrace inject [--skill <name>]            Inject run statistics into SKILL.md files
 *   clawtrace today                              Show today's skill executions
 *   clawtrace memory [--last <hours>]            Show memory change history
 *   clawtrace session [--label <name>]           Show session execution tree
 *   clawtrace detail --skill <name> [--last]     Show detail for a skill
 *   clawtrace cron                               Show cron job history
 *   clawtrace record --skill <name> --status <s> Record a completed trace
 *                   [--parent <traceId>]       Link to parent trace for sub-agent tree
 *   clawtrace import --sessions <dir>            Import history from OpenClaw session logs
 *                   [--since <date>]
 *   clawtrace stats [--range 7d|30d|all]         Show cross-day aggregate statistics
 *   clawtrace rank  [--range 7d|30d|all]         Show skill usage ranking
 */

import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { ClawTrace, SkillRankEntry } from './core/clawtrace';
import { detectSkills } from './init/detector';
import { readInitConfig, writeInitConfig } from './init/config';
import { injectSkillStats } from './init/injector';
import { SkillTrace, MemoryChange, CronRecord, TraceSession, TraceStatus } from './types';

const program = new Command();

program
  .name('clawtrace')
  .description('Native observability tool for OpenClaw agents — Skill tracing + Memory changes + Cron history')
  .version('1.1.0');

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function statusIcon(status: TraceStatus): string {
  if (status === 'success') return '✅';
  if (status === 'failed') return '❌';
  return '🔄';
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${s}s`;
}

function formatCost(cost?: number): string {
  if (cost === undefined) return '-';
  return `$${cost.toFixed(2)}`;
}

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function printTraceTable(traces: SkillTrace[]): void {
  if (traces.length === 0) {
    console.log(chalk.yellow('No skill executions found.'));
    return;
  }

  const col1 = Math.max(30, ...traces.map((t) => t.skillName.length)) + 2;

  const header =
    'Skill'.padEnd(col1) + 'Status'.padEnd(10) + 'Duration'.padEnd(12) + 'Cost';
  console.log(chalk.blue(header));
  console.log(chalk.gray('─'.repeat(header.length + 4)));

  for (const t of traces) {
    const icon = statusIcon(t.status);
    console.log(
      t.skillName.padEnd(col1) +
        `${icon}  `.padEnd(10) +
        formatDuration(t.durationMs).padEnd(12) +
        formatCost(t.cost)
    );
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// `clawtrace today`
// ---------------------------------------------------------------------------
program
  .command('today')
  .description('Show today\'s skill execution summary')
  .action(() => {
    const ct = new ClawTrace();
    const summary = ct.getDailySummary();

    console.log(chalk.blue(`\n📊 ${summary.date} Skill Execution Summary\n`));
    printTraceTable(summary.traces);

    const totalLine =
      `Total: ${summary.totalSkills} skill(s), ` +
      `${summary.successCount} success, ` +
      `${summary.failedCount} failed` +
      (summary.runningCount > 0 ? `, ${summary.runningCount} running` : '') +
      ` | Cost: ${formatCost(summary.totalCost)}`;
    console.log(chalk.cyan(totalLine));
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace memory [--last <hours>]`
// ---------------------------------------------------------------------------
program
  .command('memory')
  .description('Show memory file change history')
  .option('--last <hours>', 'Hours to look back (default: 24)', '24')
  .action((options: { last: string }) => {
    const hours = parseInt(options.last, 10) || 24;
    const ct = new ClawTrace();
    const changes = ct.getRecentMemoryChanges(hours);

    console.log(chalk.blue(`\n📝 Memory Change History (last ${hours}h)\n`));

    if (changes.length === 0) {
      console.log(chalk.yellow('No memory changes found.'));
      console.log('');
      return;
    }

    for (const c of changes) {
      const time = formatTime(c.time);
      const added = c.linesAdded > 0 ? chalk.green(`+${c.linesAdded}`) : '';
      const removed = c.linesRemoved > 0 ? chalk.red(`-${c.linesRemoved}`) : '';
      const diff = [added, removed].filter(Boolean).join('/') || chalk.gray('no changes');
      const desc = c.description ? ` "${c.description}"` : '';
      console.log(
        `• ${chalk.gray(time)} [${chalk.cyan(c.agent)}] ${c.file} (${diff} lines)${desc}`
      );
    }
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace session [--label <name>]`
// ---------------------------------------------------------------------------
program
  .command('session')
  .description('Show skill execution tree grouped by session')
  .option('--label <name>', 'Filter to a specific session label')
  .action((options: { label?: string }) => {
    const ct = new ClawTrace();

    if (options.label) {
      const session = ct.getSession(options.label);
      if (!session) {
        console.log(chalk.yellow(`No session found with label "${options.label}".`));
        return;
      }
      printSession(session);
    } else {
      const sessions = ct.getSessions();
      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found for today.'));
        return;
      }
      console.log(chalk.blue(`\n🌅 Sessions (${new Date().toISOString().slice(0, 10)})\n`));
      for (const s of sessions) {
        printSession(s);
      }
    }
  });

function printSession(session: TraceSession): void {
  const label = session.label ?? 'default';
  const start = formatTime(session.startTime);
  const end = formatTime(session.endTime);
  const range = end !== '-' ? `${start}-${end}` : `${start}-…`;
  console.log(chalk.blue(`\n🌅 ${label} (${range})`));

  for (const skill of session.skills) {
    const icon = statusIcon(skill.status);
    const dur = formatDuration(skill.durationMs);
    const cost = formatCost(skill.cost);
    console.log(
      `├─ [${chalk.gray(formatTime(skill.startTime))}] ${chalk.white(skill.skillName)} ` +
        `(${dur}, ${cost}) ${icon}`
    );
    if (skill.toolCalls && skill.toolCalls.length > 0) {
      for (const tc of skill.toolCalls) {
        console.log(`│  ├─ ${tc.tool} × ${tc.count} calls`);
      }
    }
    if (skill.error) {
      console.log(`│  └─ ${chalk.red('Error: ' + skill.error)}`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// `clawtrace detail --skill <name> [--last]`
// ---------------------------------------------------------------------------
program
  .command('detail')
  .description('Show detail for a specific skill\'s last execution')
  .requiredOption('--skill <name>', 'Skill name to inspect')
  .option('--last', 'Show only the most recent trace (default behaviour)', false)
  .action((options: { skill: string; last: boolean }) => {
    const ct = new ClawTrace();
    const traces = options.last
      ? ([ct.getLastSkillTrace(options.skill)].filter(Boolean) as SkillTrace[])
      : ct.getSkillTraces(options.skill);

    if (traces.length === 0) {
      console.log(chalk.yellow(`No trace found for skill "${options.skill}".`));
      return;
    }

    console.log(chalk.blue(`\n🔍 Skill Detail: ${options.skill}\n`));

    for (const t of traces) {
      const icon = statusIcon(t.status);
      console.log(`${icon} [${chalk.gray(formatTime(t.startTime))}] ${chalk.white(t.skillName)}`);
      console.log(chalk.gray(`  ID:       ${t.id}`));
      console.log(chalk.gray(`  Status:   ${t.status}`));
      console.log(chalk.gray(`  Duration: ${formatDuration(t.durationMs)}`));
      console.log(chalk.gray(`  Cost:     ${formatCost(t.cost)}`));
      if (t.sessionLabel) {
        console.log(chalk.gray(`  Session:  ${t.sessionLabel}`));
      }
      if (t.error) {
        console.log(chalk.red(`  Error:    ${t.error}`));
      }
      if (t.toolCalls && t.toolCalls.length > 0) {
        console.log(chalk.gray('  Tool calls:'));
        for (const tc of t.toolCalls) {
          console.log(chalk.gray(`    • ${tc.tool} × ${tc.count}`));
        }
      }
      if (t.subAgents && t.subAgents.length > 0) {
        console.log(chalk.gray('  Sub-agents:'));
        printSubAgentTree(t.subAgents, '    ');
      } else {
        // Auto-discover sub-agent tree from parentId references
        const autoTree = ct.getTraceTree(t.id);
        if (autoTree.length > 0) {
          console.log(chalk.gray('  Sub-agents (auto-discovered):'));
          printSubAgentTree(autoTree, '    ');
        }
      }
      console.log('');
    }
  });

function printSubAgentTree(agents: import('./types').SubAgentCall[], indent: string): void {
  for (const a of agents) {
    const icon = statusIcon(a.status);
    console.log(
      chalk.gray(
        `${indent}${icon} ${a.agentName} (${formatDuration(a.durationMs)})`
      )
    );
    if (a.children && a.children.length > 0) {
      printSubAgentTree(a.children, indent + '  ');
    }
  }
}

// ---------------------------------------------------------------------------
// `clawtrace cron`
// ---------------------------------------------------------------------------
program
  .command('cron')
  .description('Show today\'s cron job execution history')
  .action(() => {
    const ct = new ClawTrace();
    const records = ct.getCronHistory();

    console.log(chalk.blue('\n⏰ Cron Execution History\n'));

    if (records.length === 0) {
      console.log(chalk.yellow('No cron records found for today.'));
      console.log('');
      return;
    }

    const col1 = Math.max(25, ...records.map((r: CronRecord) => r.jobName.length)) + 2;
    console.log(
      chalk.blue('Job'.padEnd(col1) + 'Status'.padEnd(10) + 'Duration'.padEnd(12) + 'Cron')
    );
    console.log(chalk.gray('─'.repeat(60)));

    for (const r of records) {
      console.log(
        r.jobName.padEnd(col1) +
          `${statusIcon(r.status)}  `.padEnd(10) +
          formatDuration(r.durationMs).padEnd(12) +
          (r.cronExpr ?? '-')
      );
    }
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace record --skill <name> --status <s> [options]`
// ---------------------------------------------------------------------------
program
  .command('record')
  .description('Manually record a skill trace entry')
  .requiredOption('--skill <name>', 'Skill name')
  .requiredOption('--status <status>', 'Execution status: success | failed | running')
  .option('--duration <ms>', 'Duration in milliseconds')
  .option('--cost <usd>', 'Estimated cost in USD')
  .option('--session <label>', 'Session label')
  .option('--error <message>', 'Error message (for failed traces)')
  .option('--parent <traceId>', 'Parent trace ID (for sub-agent tree auto-discovery)')
  .action((options: {
    skill: string;
    status: string;
    duration?: string;
    cost?: string;
    session?: string;
    error?: string;
    parent?: string;
  }) => {
    const allowedStatuses = ['success', 'failed', 'running'];
    if (!allowedStatuses.includes(options.status)) {
      console.error(chalk.red(`❌ Invalid status "${options.status}". Use: success | failed | running`));
      process.exit(1);
    }

    const ct = new ClawTrace();
    const now = new Date().toISOString();
    const durationMs = options.duration ? parseInt(options.duration, 10) : undefined;
    const cost = options.cost ? parseFloat(options.cost) : undefined;

    const id = ct.recordTrace({
      skillName: options.skill,
      status: options.status as TraceStatus,
      startTime: now,
      durationMs,
      sessionLabel: options.session,
      error: options.error,
      cost,
      parentId: options.parent,
    });

    console.log(id);
  });

// ---------------------------------------------------------------------------
// `clawtrace init`
// ---------------------------------------------------------------------------
program
  .command('init')
  .description('Detect skills in the project and configure which ones to wrap')
  .option('--root <dir>', 'Project root directory (defaults to cwd)')
  .action(async (options: { root?: string }) => {
    const rootDir = options.root ?? process.cwd();

    console.log(chalk.blue('\n🔍 Scanning for skills in the project...\n'));

    const skills = detectSkills(rootDir);

    if (skills.length === 0) {
      console.log(chalk.yellow('No skill files found.'));
      console.log(
        chalk.gray(
          'ClawTrace looks for SKILL.md files (or *.md files) in: skills/, src/skills/, skill/, src/skill/'
        )
      );
      console.log(
        chalk.gray(
          'Add your OpenClaw skill directories (each with a SKILL.md) there, then re-run `clawtrace init`.'
        )
      );
      console.log('');
      return;
    }

    console.log(chalk.green(`Found ${skills.length} skill(s):\n`));
    for (const s of skills) {
      const rel = s.filePath.startsWith(rootDir)
        ? s.filePath.slice(rootDir.length + 1)
        : s.filePath;
      console.log(`  • ${chalk.white(s.name.padEnd(35))} ${chalk.gray(rel)}`);
    }
    console.log('');
    console.log(chalk.cyan('For each skill, choose whether to wrap it with ClawTrace tracing.'));
    console.log(chalk.gray('(Press Enter to accept the default shown in uppercase)\n'));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Buffer lines already queued (handles piped / non-TTY stdin) and resolve
    // pending question promises as new lines arrive.
    const lineBuffer: string[] = [];
    const lineWaiters: Array<(line: string) => void> = [];
    rl.on('line', (line) => {
      if (lineWaiters.length > 0) {
        lineWaiters.shift()!(line);
      } else {
        lineBuffer.push(line);
      }
    });

    const ask = (question: string): Promise<string> => {
      process.stdout.write(question);
      if (lineBuffer.length > 0) {
        const line = lineBuffer.shift()!;
        process.stdout.write(line + '\n');
        return Promise.resolve(line);
      }
      return new Promise((resolve) => lineWaiters.push(resolve));
    };

    const wrappedSkills: string[] = [];
    const excludedSkills: string[] = [];

    for (const skill of skills) {
      const answer = await ask(`Wrap ${chalk.white(skill.name)}? (${chalk.green('Y')}/n): `);
      const skip = answer.trim().toLowerCase() === 'n';
      if (skip) {
        excludedSkills.push(skill.name);
      } else {
        wrappedSkills.push(skill.name);
      }
    }

    rl.close();
    console.log('');

    writeInitConfig({ wrappedSkills, excludedSkills, initialized: true }, rootDir);

    console.log(chalk.green('✅ Configuration saved to .clawtrace.json\n'));
    if (wrappedSkills.length > 0) {
      console.log(`  ${chalk.green('Wrapped:')}  ${wrappedSkills.join(', ')}`);
    }
    if (excludedSkills.length > 0) {
      console.log(`  ${chalk.yellow('Skipped:')}  ${excludedSkills.join(', ')}`);
    }
    console.log('');
    console.log(
      chalk.gray(
        'Use ct.shouldWrap(skillName) in your skill code to check this configuration.'
      )
    );
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace inject [--skill <name>] [--root <dir>]`
// ---------------------------------------------------------------------------
program
  .command('inject')
  .description("Inject today's run statistics into SKILL.md files so agents can read them")
  .option('--skill <name>', 'Inject stats only for this skill name')
  .option('--root <dir>', 'Project root directory (defaults to cwd)')
  .action((options: { skill?: string; root?: string }) => {
    const rootDir = options.root ?? process.cwd();
    const ct = new ClawTrace();

    const skills = detectSkills(rootDir);

    if (skills.length === 0) {
      console.log(chalk.yellow('\nNo skill files found to update.'));
      console.log(
        chalk.gray(
          'ClawTrace looks for SKILL.md files in: skills/, src/skills/, skill/, src/skill/'
        )
      );
      console.log('');
      return;
    }

    const targets = options.skill
      ? skills.filter((s) => s.name === options.skill)
      : skills;

    if (targets.length === 0) {
      console.log(chalk.yellow(`\nSkill "${options.skill}" not found.`));
      console.log('');
      return;
    }

    console.log(chalk.blue('\n📝 Injecting ClawTrace statistics into SKILL.md files...\n'));

    let updated = 0;
    for (const skill of targets) {
      const traces = ct.getSkillTraces(skill.name);
      injectSkillStats(skill.filePath, skill.name, traces);
      const rel = skill.filePath.startsWith(rootDir)
        ? skill.filePath.slice(rootDir.length + 1)
        : skill.filePath;
      console.log(`  ✅ ${chalk.white(skill.name.padEnd(35))} ${chalk.gray(rel)}`);
      updated++;
    }

    console.log('');
    console.log(chalk.green(`Updated ${updated} skill file(s) with today's statistics.`));
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace import --sessions <dir> [--since <date>]`
// ---------------------------------------------------------------------------
program
  .command('import')
  .description('Import historical skill calls from OpenClaw session JSONL logs')
  .requiredOption('--sessions <dir>', 'Path to the directory containing *.jsonl session files')
  .option('--since <date>', 'Only import entries on or after this date (YYYY-MM-DD)')
  .action((options: { sessions: string; since?: string }) => {
    let since: Date | undefined;
    if (options.since) {
      since = new Date(options.since);
      if (isNaN(since.getTime())) {
        console.error(chalk.red(`❌ Invalid date "${options.since}". Use YYYY-MM-DD format.`));
        process.exit(1);
      }
      since.setUTCHours(0, 0, 0, 0);
    }

    console.log(chalk.blue('\n📥 Importing from OpenClaw session logs...\n'));
    console.log(chalk.gray(`  Directory: ${options.sessions}`));
    if (since) console.log(chalk.gray(`  Since:     ${since.toISOString().slice(0, 10)}`));
    console.log('');

    const ct = new ClawTrace();
    const imported = ct.importFromSessions(options.sessions, since);

    if (imported === 0) {
      console.log(chalk.yellow('No new traces found (all entries already imported or directory empty).'));
    } else {
      console.log(chalk.green(`✅ Imported ${imported} new trace(s) into memory/traces/.`));
    }
    console.log('');
  });

// ---------------------------------------------------------------------------
// Helper: parse --range flag into a `since` Date
// ---------------------------------------------------------------------------
function parseRange(range: string): Date {
  const now = new Date();
  if (range === 'all') {
    // Go back 10 years as a practical "all time" horizon
    return new Date(Date.UTC(now.getUTCFullYear() - 10, 0, 1));
  }
  const match = range.match(/^(\d+)d$/);
  if (!match) {
    console.error(chalk.red(`❌ Invalid range "${range}". Use: 7d, 30d, all`));
    process.exit(1);
  }
  const days = parseInt(match[1], 10);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - days + 1);
  since.setUTCHours(0, 0, 0, 0);
  return since;
}

// ---------------------------------------------------------------------------
// `clawtrace stats [--range 7d|30d|all]`
// ---------------------------------------------------------------------------
program
  .command('stats')
  .description('Show aggregate skill execution statistics across a date range')
  .option('--range <range>', 'Date range: 7d, 30d, or all (default: 7d)', '7d')
  .action((options: { range: string }) => {
    const since = parseRange(options.range);
    const ct = new ClawTrace();
    const summary = ct.getStatsRange(since);

    console.log(chalk.blue(`\n📊 Skill Statistics (${summary.date})\n`));
    printTraceTable(summary.traces);

    const totalLine =
      `Total: ${summary.totalSkills} execution(s), ` +
      `${summary.successCount} success, ` +
      `${summary.failedCount} failed` +
      (summary.runningCount > 0 ? `, ${summary.runningCount} running` : '') +
      ` | Cost: ${formatCost(summary.totalCost)}`;
    console.log(chalk.cyan(totalLine));
    console.log('');
  });

// ---------------------------------------------------------------------------
// `clawtrace rank [--range 7d|30d|all]`
// ---------------------------------------------------------------------------
program
  .command('rank')
  .description('Show skill usage ranking sorted by call count')
  .option('--range <range>', 'Date range: 7d, 30d, or all (default: 30d)', '30d')
  .action((options: { range: string }) => {
    const since = parseRange(options.range);
    const ct = new ClawTrace();
    const rankings = ct.getRankings(since);

    const rangeLabel = options.range === 'all' ? '全部时间' : `过去 ${options.range}`;
    console.log(chalk.blue(`\n📊 技能使用排名（${rangeLabel}）\n`));

    if (rankings.length === 0) {
      console.log(chalk.yellow('No skill executions found in the selected range.'));
      console.log('');
      return;
    }

    const col1 = Math.max(30, ...rankings.map((r: SkillRankEntry) => r.skillName.length)) + 2;
    const header =
      '排名'.padEnd(6) +
      '技能'.padEnd(col1) +
      '调用次数'.padEnd(12) +
      '成功率'.padEnd(10) +
      '平均耗时';
    console.log(chalk.blue(header));
    console.log(chalk.gray('─'.repeat(header.length + 4)));

    rankings.forEach((r: SkillRankEntry, idx: number) => {
      const rank = String(idx + 1).padEnd(6);
      const successStr = `${r.successRate}%`.padEnd(10);
      const dur = r.avgDurationMs !== undefined ? formatDuration(r.avgDurationMs) : '-';
      console.log(
        rank +
          r.skillName.padEnd(col1) +
          String(r.callCount).padEnd(12) +
          successStr +
          dur
      );
    });
    console.log('');
  });

program.parse(process.argv);
