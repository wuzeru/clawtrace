/**
 * ClawTrace — Init Config Reader/Writer
 *
 * Reads and writes the `.clawtrace.json` configuration file used to persist
 * the user's skill-wrapping preferences set during `clawtrace init`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClawTraceInitConfig } from '../types';

export const CONFIG_FILENAME = '.clawtrace.json';

/**
 * Read the ClawTrace init config from the project root.
 * Returns `null` if the config file does not exist or cannot be parsed.
 */
export function readInitConfig(rootDir: string = process.cwd()): ClawTraceInitConfig | null {
  const configPath = path.join(rootDir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content) as ClawTraceInitConfig;
  } catch {
    return null;
  }
}

/**
 * Write the ClawTrace init config to the project root.
 */
export function writeInitConfig(config: ClawTraceInitConfig, rootDir: string = process.cwd()): void {
  const configPath = path.join(rootDir, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
