import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildGraphAppend } from '../agent/graph-prompt.js';
import { buildViewAppend } from '../agent/view-prompt.js';

/**
 * What a Claude Code session is told about the blocks teamod draws: a run's own teaching, without
 * the show tool, which is a run's. Written to a file at setup, because a thread's system prompt
 * must read the same from its first request, before any bridge is up.
 */
export function sessionBrief(): string {
  return `${buildViewAppend(false)}\n${buildGraphAppend(false)}`
    .split('\n')
    .filter((text) => !text.includes('mcp__teamod_view__'))
    .join('\n')
    .replaceAll('the teamod app', 'teamod')
    .trim();
}

export function writeBrief(home: string): void {
  writeFileSync(path.join(home, 'brief.txt'), `${sessionBrief()}\n`, { mode: 0o600 });
}
