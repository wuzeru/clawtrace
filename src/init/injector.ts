/**
 * ClawTrace — Skill Stats Injector
 *
 * Injects (or updates) a ClawTrace statistics block at the end of an
 * OpenClaw SKILL.md file so that the AI agent can read historical
 * execution data directly from the skill document.
 *
 * The block is delimited by HTML comments so it can be updated in-place
 * on subsequent runs without duplicating the section:
 *
 *   <!-- clawtrace:stats:start -->
 *   ## 📊 ClawTrace Statistics
 *   ...
 *   <!-- clawtrace:stats:end -->
 */

import * as fs from 'fs';
import { SkillTrace } from '../types';

export const STATS_START_MARKER = '<!-- clawtrace:stats:start -->';
export const STATS_END_MARKER = '<!-- clawtrace:stats:end -->';

function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${s}s`;
}

function statusEmoji(status: string): string {
  if (status === 'success') return '✅';
  if (status === 'failed') return '❌';
  return '🔄';
}

/**
 * Build the Markdown statistics block for a skill.
 */
export function buildStatsBlock(traces: SkillTrace[], skillName: string = 'SKILL_NAME'): string {
  const successCount = traces.filter((t) => t.status === 'success').length;
  const failedCount = traces.filter((t) => t.status === 'failed').length;

  const durations = traces
    .filter((t) => t.durationMs !== undefined)
    .map((t) => t.durationMs as number);
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : undefined;

  const lastTrace = [...traces].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  )[0];

  const lastRunStr = lastTrace
    ? `${new Date(lastTrace.startTime).toISOString().slice(11, 16)} UTC ${statusEmoji(lastTrace.status)}`
    : '-';

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  return [
    STATS_START_MARKER,
    '## 📊 ClawTrace Statistics',
    '',
    `_Last updated: ${now}_`,
    '',
    '### ⚠️ 执行后必须上报（MANDATORY）',
    '',
    '> 本技能执行完毕后，无论成功还是失败，**必须**执行以下命令：',
    '> ```bash',
    `> clawtrace record --skill ${skillName} --status <success|failed> --duration <ms>`,
    '> ```',
    '> 如果执行失败，使用 `--status failed --error "<message>"`。',
    '> 如果该技能由父技能触发，添加 `--parent <parentTraceId>` 以关联调用树。',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Runs today | ${traces.length} |`,
    `| ✅ Success | ${successCount} |`,
    `| ❌ Failed | ${failedCount} |`,
    `| ⏱ Avg duration | ${formatDuration(avgDuration)} |`,
    `| 🕐 Last run | ${lastRunStr} |`,
    STATS_END_MARKER,
  ].join('\n');
}

/**
 * Inject or update the ClawTrace statistics block in a SKILL.md file.
 *
 * - If the file already contains a stats block (delimited by the HTML
 *   comment markers), it is replaced in-place.
 * - Otherwise the block is appended at the end of the file.
 *
 * Does nothing if the file does not exist.
 */
export function injectSkillStats(
  skillFilePath: string,
  skillName: string,
  traces: SkillTrace[]
): void {
  if (!fs.existsSync(skillFilePath)) return;

  const statsBlock = buildStatsBlock(traces, skillName);
  let content = fs.readFileSync(skillFilePath, 'utf8');

  const startIdx = content.indexOf(STATS_START_MARKER);
  const endIdx = content.indexOf(STATS_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace the existing stats block
    content =
      content.slice(0, startIdx) +
      statsBlock +
      content.slice(endIdx + STATS_END_MARKER.length);
  } else {
    // Append the stats block with a separator
    const separator =
      content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    content = content + separator + statsBlock + '\n';
  }

  fs.writeFileSync(skillFilePath, content, 'utf8');
}
