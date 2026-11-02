import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_DROPS, type Place, SURFACE } from './coverage.js';

const PLACES: ReadonlyArray<readonly [Place, string]> = [
  ['work', 'Work pane'],
  ['task', 'Task pane'],
  ['team', 'Team pane'],
  ['board', 'Board pane'],
  ['sentinel', 'Sentinel pane'],
  ['settings', 'Settings pane'],
  ['band', 'Needs You band'],
  ['command', '`/teamod` verb'],
  ['internal', 'Internal'],
];

/** The readable form of src/teamod/coverage.ts. A test keeps the two the same. */
export function parityDoc(): string {
  const entries = Object.entries(SURFACE);
  const lines: string[] = [
    '# Parity with teamod',
    '',
    'Generated from `engine/src/teamod/coverage.ts` by `npx tsx src/teamod/parity-doc.ts` in `engine/`. `engine/tests/teamod-parity.test.ts` holds it to the code: a method counts as done only when the mod or bridge source names it.',
    '',
    '## Summary',
    '',
    '| Where | Done | To do |',
    '|---|---|---|',
  ];
  for (const [place, label] of PLACES) {
    const here = entries.filter(([, s]) => 'on' in s && s.on === place);
    lines.push(`| ${label} | ${here.filter(([, s]) => !('todo' in s && s.todo)).length} | ${here.filter(([, s]) => 'todo' in s && s.todo).length} |`);
  }
  const dropped = entries.flatMap(([method, s]) => ('dropped' in s ? [[method, s.dropped] as const] : []));
  lines.push(`| Dropped | ${dropped.length} | |`, '', '## Dropped, and why', '');
  const reasons = new Map<string, string[]>();
  for (const [method, reason] of dropped) reasons.set(reason, [...(reasons.get(reason) ?? []), method]);
  for (const [reason, methods] of reasons) lines.push(`- ${reason} (${methods.length}): ${methods.map((m) => `\`${m}\``).join(', ')}`);
  lines.push('', '## Slash commands dropped', '');
  for (const [name, reason] of Object.entries(COMMAND_DROPS)) lines.push(`- \`/${name}\`: ${reason}`);
  lines.push('', '## Still to do', '');
  for (const [place, label] of PLACES) {
    const todo = entries.filter(([, s]) => 'on' in s && s.on === place && s.todo).map(([m]) => m);
    if (todo.length) lines.push(`- ${label} (${todo.length}): ${todo.map((m) => `\`${m}\``).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'PARITY.md'), parityDoc());
}
