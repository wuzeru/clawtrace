/**
 * ClawTrace public API
 */

export { ClawTrace } from './core/clawtrace';
export { TraceStore } from './trace/store';
export { TraceRecorder } from './trace/recorder';
export { detectSkills } from './init/detector';
export { readInitConfig, writeInitConfig } from './init/config';
export { injectSkillStats, buildStatsBlock, STATS_START_MARKER, STATS_END_MARKER } from './init/injector';
export * from './types';
