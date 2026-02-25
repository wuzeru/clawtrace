/**
 * ClawTrace — Skill Detector
 *
 * Scans the project for OpenClaw skill definitions in common skill
 * directories (skills/, src/skills/, etc.).
 *
 * OpenClaw skills are Markdown files.  Two layouts are supported:
 *   1. Directory-based — skills/<name>/SKILL.md  (name = directory name)
 *   2. Flat file       — skills/<name>.md         (name = filename without extension)
 */

import * as fs from 'fs';
import * as path from 'path';

/** Candidate directories to scan for skills (relative to project root). */
const SKILL_DIRS = ['skills', 'src/skills', 'skill', 'src/skill'];

/**
 * Well-known Markdown files that are NOT skill definitions and should be
 * excluded from flat-file detection.
 */
const EXCLUDED_MD_FILES = new Set([
  'README.md',
  'CHANGELOG.md',
  'LICENSE.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'MEMORY.md',
  'USER.md',
]);

export interface DetectedSkill {
  /** Skill name derived from the directory or file name. */
  name: string;
  /** Absolute path to the SKILL.md (or .md) file. */
  filePath: string;
}

/**
 * Scan the project for OpenClaw skill definitions and return a list of
 * detected skills.  Looks in common skill directories relative to `rootDir`.
 */
export function detectSkills(rootDir: string = process.cwd()): DetectedSkill[] {
  const results: DetectedSkill[] = [];

  for (const dir of SKILL_DIRS) {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Directory-based skill: skills/<name>/SKILL.md
        const skillMdPath = path.join(fullDir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          results.push({ name: entry.name, filePath: skillMdPath });
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Flat-file skill: skills/<name>.md
        if (!EXCLUDED_MD_FILES.has(entry.name)) {
          const name = path.basename(entry.name, '.md');
          results.push({ name, filePath: path.join(fullDir, entry.name) });
        }
      }
    }
  }

  return results;
}
