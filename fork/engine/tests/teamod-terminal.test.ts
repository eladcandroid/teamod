import { describe, expect, it, vi } from 'vitest';
import type { PtyExit } from '../src/terminal/pty-host.js';
import type { PtyLink } from '../src/terminal/emulator.js';
import { TermHub, bytesOfKey } from '../src/teamod/term-hub.js';
import type { AppState } from '../src/core/store.js';
import { flat, labelled, start, viewport, words } from './teamod-helpers.js';

function fakeLink(): PtyLink & { written: string[]; sizes: Array<[number, number]>; out(data: string): void } {
  const data = new Set<(d: string) => void>();
  const written: string[] = [];
  const sizes: Array<[number, number]> = [];
  return {
    written,
    sizes,
    running: true,
    write: (d) => void written.push(d),
    resize: (c, r) => void sizes.push([c, r]),
    onData: (l) => (data.add(l), () => data.delete(l)),
    onExit: (_l: (e: PtyExit) => void) => () => undefined,
    out: (d) => {
      for (const l of data) l(d);
    },
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

describe('keys', () => {
  it.each([
    [{ key: 'a' }, 'a'],
    [{ key: 'return' }, '\r'],
    [{ key: 'tab' }, '\t'],
    [{ key: 'backspace' }, '\x7f'],
    [{ key: 'up' }, '\x1b[A'],
    [{ key: 'a', ctrl: true }, '\x01'],
    [{ key: 'pageup' }, '\x1b[5~'],
    [{ key: ']', ctrl: true }, '\x1b'],
  ])('%j sends its bytes', (key, bytes) => {
    expect(bytesOfKey(key, false)).toBe(bytes);
  });

  it('sends the arrows a full-screen program asked for', () => {
    expect(bytesOfKey({ key: 'up' }, true)).toBe('\x1bOA');
  });
});

describe('a terminal seen from the session', () => {
  it('draws what the program wrote, and only when it changed', async () => {
    const link = fakeLink();
    const hub = new TermHub(() => link);
    hub.frame('t', 40, 10, 0);
    link.out('hello \x1b[31mred\x1b[0m');
    await settled();
    const first = hub.frame('t', 40, 10, 0);
    expect(first.frame?.rows[0]?.map((s) => s.t).join('')).toContain('hello red');
    expect(first.frame?.rows[0]?.some((s) => s.c !== undefined)).toBe(true);
    expect(hub.frame('t', 40, 10, first.rev).frame).toBeUndefined();
    hub.closeAll();
  });

  it('shows the cursor as an inverted cell', async () => {
    const link = fakeLink();
    const hub = new TermHub(() => link);
    hub.frame('t', 40, 10, 0);
    link.out('ab');
    await settled();
    const rows = hub.frame('t', 40, 10, 0).frame?.rows ?? [];
    expect(rows[0]?.some((s) => s.v === 1)).toBe(true);
    hub.closeAll();
  });

  it('sends each key once, even when the module sends it again after a lost answer', () => {
    const link = fakeLink();
    const hub = new TermHub(() => link);
    hub.keys('t', 1, [{ key: 'a' }], 40, 10);
    hub.keys('t', 2, [{ key: 'a' }, { key: 'b' }], 40, 10);
    hub.keys('t', 2, [{ key: 'a' }, { key: 'b' }], 40, 10);
    expect(link.written).toEqual(['a', 'b']);
    expect(hub.frame('t', 40, 10, 0).acked).toBe(2);
    hub.closeAll();
  });

  it('takes the size of the pane', () => {
    const link = fakeLink();
    const hub = new TermHub(() => link);
    hub.frame('t', 40, 10, 0);
    hub.frame('t', 60, 20, 0);
    expect(link.sizes).toEqual([[60, 20]]);
    hub.closeAll();
  });

  it('stays within what a surface takes, keeping the words of a very colourful screen', async () => {
    const link = fakeLink();
    const hub = new TermHub(() => link);
    hub.frame('t', 200, 60, 0);
    const colourful = Array.from({ length: 200 }, (_, i) => `\x1b[38;5;${i % 200}mx`).join('');
    link.out(`${Array.from({ length: 60 }, () => colourful).join('\r\n')}`);
    await settled();
    const frame = hub.frame('t', 200, 60, 0).frame;
    expect(JSON.stringify(frame?.rows).length).toBeLessThan(100_000);
    expect(frame?.rows[0]?.map((s) => s.t).join('')).toContain('xxx');
    hub.closeAll();
  });

  it('keeps the program running when the screen closes', () => {
    const link = fakeLink();
    const close = vi.fn();
    const hub = new TermHub(() => ({ ...link, close, running: true }));
    hub.frame('t', 40, 10, 0);
    hub.closeOne('t');
    expect(link.written).toEqual([]);
  });
});

const project = { id: 'p1', name: 'alpha', root: '/r/alpha', base: 'main', workspaces: [{ id: 'w1', projectId: 'p1', projectRoot: '/r/alpha', name: 'add-login', path: '/r/w1', kind: 'worktree', branch: 'b', createdAt: 1, external: false }] };

describe('the Changes screen', () => {
  const data = { base: 'main', commits: [], files: [{ path: 'a.ts', added: 2, removed: 1, state: 'modified' }, { path: 'b.ts', added: 1, removed: 0, state: 'added' }] };

  it('loads the review, lists files and draws the selected diff', async () => {
    const t = start({ projects: [project] as unknown as AppState['projects'], review: { workspaceId: 'w1', data, selected: 0, loading: false, diff: '@@ -1 +1 @@\n-a\n+b\n' } } as unknown as Partial<AppState>);
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:changes', undefined, viewport);
    const tree = t.screens.view('work', viewport);
    await t.settle();
    expect(t.calls).toContainEqual(['workspaces.review', ['w1']]);
    expect(words(tree)).toContain('a.ts');
    expect(flat(tree).some((n) => n.k === 'code' && n.diff === true)).toBe(true);
    await t.screens.press('work', 'change:b.ts', undefined, viewport);
    expect(t.calls).toContainEqual(['workspaces.selectFile', [1]]);
  });

  it('commits with your words, or lets the agent write them', async () => {
    const t = start({ projects: [project] as unknown as AppState['projects'], review: { workspaceId: 'w1', data, selected: 0, loading: false } } as unknown as Partial<AppState>);
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:changes', undefined, viewport);
    await t.screens.press('work', 'commit', undefined, viewport);
    await t.screens.press('work', 'commit-message', 'Add login', viewport);
    expect(t.calls).toContainEqual(['workspaces.commit', ['w1', 'Add login']]);
  });

  it('offers Fix Checks only when they fail, and a merge only on an open PR', async () => {
    const pr = { number: 7, url: 'u', state: 'OPEN', title: 'Add login', draft: false, checks: 'failing' };
    const t = start({ projects: [project] as unknown as AppState['projects'], prs: { w1: pr } } as unknown as Partial<AppState>);
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:changes', undefined, viewport);
    const tree = t.screens.view('work', viewport);
    expect(labelled(tree, 'Fix Checks')).toBeDefined();
    expect(labelled(tree, 'Merge')).toBeDefined();
    t.set({ prs: { w1: { ...pr, state: 'MERGED', checks: 'passing' } } } as unknown as Partial<AppState>);
    const merged = t.screens.view('work', viewport);
    expect(labelled(merged, 'Fix Checks')).toBeUndefined();
    expect(labelled(merged, 'Continue After Merge')).toBeDefined();
  });
});

describe('the Files screen', () => {
  const dir = (selfId: string) => ({ [`${selfId}:ws-w1/`]: [{ name: 'src', dir: true, size: 0 }, { name: 'README.md', dir: false, size: 10 }], [`${selfId}:ws-w1/src`]: [{ name: 'a.ts', dir: false, size: 3 }] });

  it('unfolds folders and opens a file as itself', async () => {
    const t = start({ selfId: 'me', projects: [project], dirCache: dir('me') } as unknown as Partial<AppState>);
    t.answers.set('files.read', () => ({ content: 'const a = 1;', truncated: false }));
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:files', undefined, viewport);
    expect(words(t.screens.view('work', viewport))).toContain('README.md');
    await t.screens.press('work', 'dir:src', undefined, viewport);
    expect(words(t.screens.view('work', viewport))).toContain('a.ts');
    await t.screens.press('work', 'file:src/a.ts', undefined, viewport);
    t.screens.view('work', viewport);
    await t.settle();
    expect(flat(t.screens.view('work', viewport)).some((n) => n.k === 'code' && n.source === 'const a = 1;')).toBe(true);
  });

  it('saves an edit through the engine', async () => {
    const t = start({ selfId: 'me', projects: [project], dirCache: dir('me') } as unknown as Partial<AppState>);
    t.answers.set('files.read', () => ({ content: 'old', truncated: false }));
    t.answers.set('files.formatter', () => ({ available: false }));
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:files', undefined, viewport);
    await t.screens.press('work', 'file:README.md', undefined, viewport);
    t.screens.view('work', viewport);
    await t.settle();
    await t.screens.press('work', 'file-edit', undefined, viewport);
    await t.screens.press('work', 'file-edit-box', 'new', viewport);
    expect(t.calls).toContainEqual(['files.save', ['w1', 'README.md', 'new']]);
  });

  it('never offers to edit a file only partly read', async () => {
    const t = start({ selfId: 'me', projects: [project], dirCache: dir('me') } as unknown as Partial<AppState>);
    t.answers.set('files.read', () => ({ content: 'start of it', truncated: true }));
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:files', undefined, viewport);
    await t.screens.press('work', 'file:README.md', undefined, viewport);
    t.screens.view('work', viewport);
    await t.settle();
    expect(labelled(t.screens.view('work', viewport), 'Edit')).toBeUndefined();
  });
});

describe('the Terminal screen', () => {
  it('opens the worktree’s shell and draws it, with keys a surface keeps for itself as presses', async () => {
    const t = start({ projects: [project], terminals: { w1: 'zsh' } } as unknown as Partial<AppState>);
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:terminal', undefined, viewport);
    const tree = t.screens.view('work', viewport);
    await t.settle();
    expect(t.calls.some(([m]) => m === 'terminals.shell')).toBe(true);
    expect(flat(tree).some((n) => n.k === 'term' && n.term === 'w1')).toBe(true);
    expect(labelled(tree, 'Ctrl-C')).toBeDefined();
    expect(labelled(tree, 'Esc')).toBeDefined();
  });

  it('points the editor’s surface elsewhere', async () => {
    const t = start({ projects: [project], terminals: { w1: 'zsh' } } as unknown as Partial<AppState>);
    await t.screens.press('work', 'ws:w1', undefined, viewport);
    await t.screens.press('work', 'place:terminal', undefined, viewport);
    expect(words(t.screens.view('work', { ...viewport, surface: 'vscode' }))).toContain('Claude Code terminal and desktop');
  });
});
