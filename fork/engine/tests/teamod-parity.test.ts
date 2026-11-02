import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/core/commands.js';
import { METHODS, type Method } from '../src/ipc/api.js';
import { COMMAND_DROPS, MENUS, SURFACE, UI_ACTIONS, mayCall } from '../src/teamod/coverage.js';
import { parityDoc } from '../src/teamod/parity-doc.js';

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'types' || entry.name === 'tests') return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
  });

const WIRED_IN = [...filesIn('src/teamod').filter((f) => !/coverage\.ts$|parity-doc\.ts$/.test(f)), ...(statSync('../mod', { throwIfNoEntry: false }) ? filesIn('../mod/hooks') : [])];
const source = WIRED_IN.map((f) => readFileSync(f, 'utf8')).join('\n');
const isWired = (method: string): boolean => source.includes(`'${method}'`);

const uiActions = (): string[] => {
  const src = readFileSync('src/ui/workspace-models.ts', 'utf8');
  const block = src.slice(src.indexOf('export type UiAction ='), src.indexOf('export interface Model'));
  return [...new Set([...block.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]!))];
};
const menuKinds = (): string[] =>
  [...new Set(['menus.ts', 'work-menus.ts', 'invite-menus.ts'].flatMap((f) => [...readFileSync(`src/ui/${f}`, 'utf8').matchAll(/kind: '([a-z_]+)'/g)].map((m) => m[1]!)))];

describe('where teamod shows each method', () => {
  it('decides every API method', () => {
    expect(METHODS.filter((m) => !Object.hasOwn(SURFACE, m))).toEqual([]);
    expect(Object.keys(SURFACE).filter((m) => !(METHODS as readonly string[]).includes(m))).toEqual([]);
  });

  it('gives a reason for each one it drops', () => {
    const dropped = Object.entries(SURFACE).flatMap(([m, s]) => ('dropped' in s ? [[m, s.dropped] as const] : []));
    expect(dropped.filter(([, reason]) => reason.trim().length < 10)).toEqual([]);
    expect(dropped.length).toBeGreaterThan(40);
  });

  it('marks a method done only when the source calls it', () => {
    const lying = METHODS.filter((m) => {
      const s = SURFACE[m];
      if ('dropped' in s || s.on === 'internal') return false;
      return !s.todo && !isWired(m);
    });
    expect(lying).toEqual([]);
  });

  it('marks a method todo only while the source does not call it', () => {
    const stale = METHODS.filter((m) => {
      const s = SURFACE[m];
      return 'on' in s && s.todo === true && isWired(m);
    });
    expect(stale).toEqual([]);
  });

  it('lets the mod call nothing dropped or unknown', () => {
    expect(mayCall('companion.pair.start')).toBe(false);
    expect(mayCall('stripe.connect')).toBe(false);
    expect(mayCall('toString')).toBe(false);
    expect(mayCall('projects.add' satisfies Method)).toBe(true);
  });
});

describe('what never comes from a model', () => {
  it('leaves the choices that are a person’s to the panes and the band', () => {
    // Asserted again at the tool seam (ACME src/teamod/session-tools): these are presses, never tools.
    for (const method of ['host.answerApproval', 'gateway.decide', 'people.setTrust', 'questions.answer'] satisfies Method[]) {
      const s = SURFACE[method];
      expect('on' in s && ['band', 'team'].includes(s.on)).toBe(true);
    }
  });
});

describe('the rest of the ways in', () => {
  it('decides every slash command: each works through /teamod unless dropped', () => {
    const names = new Set(COMMANDS.map((c) => c.name));
    expect(Object.keys(COMMAND_DROPS).filter((name) => !names.has(name))).toEqual([]);
  });

  it('decides every UI action', () => {
    expect(uiActions().filter((a) => !Object.hasOwn(UI_ACTIONS, a))).toEqual([]);
  });

  it('decides every menu', () => {
    expect(menuKinds().filter((k) => !Object.hasOwn(MENUS, k))).toEqual([]);
  });
});

describe('fork/PARITY.md', () => {
  it('is what the tables say (regenerate: npx tsx src/teamod/parity-doc.ts)', () => {
    expect(readFileSync('../PARITY.md', 'utf8')).toBe(parityDoc());
  });
});
