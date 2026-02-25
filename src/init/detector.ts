/**
 * ClawTrace — Skill Detector
 *
 * Scans the project for TypeScript/JavaScript skill files in common
 * OpenClaw skill directories (skills/, src/skills/, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Candidate directories to scan for skills (relative to project root). */
const SKILL_DIRS = ['skills', 'src/skills', 'skill', 'src/skill'];

/** File extensions recognised as skill files. */
const SKILL_EXTENSIONS = ['.ts', '.js'];

export interface DetectedSkill {
  /** Skill name derived from the file name (without extension). */
  name: string;
  /** Absolute path to the skill file. */
  filePath: string;
}

/**
 * Scan the project for skill files and return a list of detected skills.
 * Looks in common skill directories relative to `rootDir`.
 */
export function detectSkills(rootDir: string = process.cwd()): DetectedSkill[] {
  const results: DetectedSkill[] = [];

  for (const dir of SKILL_DIRS) {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = listFilesRecursive(fullDir);
    for (const file of files) {
      const ext = path.extname(file);
      if (!SKILL_EXTENSIONS.includes(ext)) continue;
      if (isExcluded(path.basename(file))) continue;

      const name = path.basename(file, ext);
      results.push({ name, filePath: file });
    }
  }

  return results;
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function isExcluded(basename: string): boolean {
  if (basename === 'index.ts' || basename === 'index.js') return true;
  if (basename.endsWith('.test.ts') || basename.endsWith('.test.js')) return true;
  if (basename.endsWith('.spec.ts') || basename.endsWith('.spec.js')) return true;
  if (basename.endsWith('.d.ts')) return true;
  return false;
}
