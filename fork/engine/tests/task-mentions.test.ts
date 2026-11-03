import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentBackend, AgentRunInput } from '../src/agent/types.js';
import { AgentHost } from '../src/core/agent-host.js';
import type { Issue } from '../src/core/board/model.js';
import { Store, initialState } from '../src/core/store.js';
import { waitFor } from './helpers.js';
import { TASK_LINK_SCHEME, type TaskMention, explainTaskMentions, linkTaskKeys, matchTasks, splitTaskKeys, taskByKey } from '../src/shared/task-refs.js';
import { readInline } from '../src/shared/render/inline-model.js';
import { stripCode } from '../src/companion/strip.js';
import { suggest } from '../src/ui/suggest.js';
import { gatewayTarget } from '../src/agent/mock.js';

/** "@ACME-24" names a task on the board (ACME-56): suggested as you type, a chip once it's there. */

const t = (key: string, title: string, status = 'todo', open = true): TaskMention => ({ key, title, status, open });
const tasks: TaskMention[] = [
  t('ACME-2', 'Pair a phone'),
  t('ACME-20', 'Dark mode for the board', 'done', false),
  t('ACME-24', 'Fix the login redirect', 'in_progress'),
  t('ACME-240', 'Login with a passkey'),
  t('ACME-9', 'Buy coffee developer option'),
  t('OPS-24', 'Rotate the deploy keys'),
];
const keys = (typed: string): string[] => matchTasks(typed, tasks).map((x) => x.key);

describe('which tasks a typed "@…" may mean', () => {
  it('the very key first, then the keys it starts', () => {
    expect(keys('ACME-24')).toEqual(['ACME-24', 'ACME-240']);
    expect(keys('ACME-2')).toEqual(['ACME-2', 'ACME-240', 'ACME-24', 'ACME-20']);
  });

  it('did you mean: no dash, lower case, or the number alone', () => {
    expect(keys('ACME24')[0]).toBe('ACME-24');
    expect(keys('acme-24')[0]).toBe('ACME-24');
    expect(keys('acme24')[0]).toBe('ACME-24');
    // The number alone: every project's task with that number (Ready ones first), then longer numbers.
    expect(keys('24')).toEqual(['OPS-24', 'ACME-24', 'ACME-240']);
    expect(keys('bl24')[0]).toBe('ACME-24');
  });

  it('a project prefix lists its tasks, Ready ones first, each group by number', () => {
    expect(keys('ACME')).toEqual(['ACME-2', 'ACME-9', 'ACME-240', 'ACME-24', 'ACME-20']);
    expect(keys('ops')).toEqual(['OPS-24']);
  });

  it('words of the title', () => {
    expect(keys('login')).toEqual(['ACME-240', 'ACME-24']);
    expect(keys('coffee')).toEqual(['ACME-9']);
    expect(keys('dark-mode')).toEqual(['ACME-20']);
    expect(keys('ogin')).toEqual(['ACME-240', 'ACME-24']);
  });

  it('Ready tasks first, then those under way, then the Backlog, then closed ones (ACME-575)', () => {
    const board = [
      t('ACME-1', 'Old idea', 'backlog'),
      t('ACME-3', 'Shipped', 'done', false),
      t('ACME-4', 'Being built', 'in_progress'),
      t('ACME-5', 'Ready to go'),
      t('ACME-6', 'Up for review', 'in_review'),
      t('ACME-7', 'Also ready'),
      t('ACME-8', 'Dropped', 'canceled', false),
    ];
    expect(matchTasks('ACME', board, 10).map((x) => x.key)).toEqual(['ACME-5', 'ACME-7', 'ACME-4', 'ACME-6', 'ACME-1', 'ACME-3', 'ACME-8']);
    // The very key typed still comes first, whatever its status.
    expect(matchTasks('ACME-1', [...board, t('ACME-10', 'Ready ten')], 10).map((x) => x.key)).toEqual(['ACME-1', 'ACME-10']);
    // Only six fit: they are the Ready ones.
    const many = Array.from({ length: 12 }, (_, i) => t(`ACME-${i + 1}`, `Task ${i + 1}`, i < 6 ? 'backlog' : 'todo'));
    expect(matchTasks('ACME', many).map((x) => x.key)).toEqual(['ACME-7', 'ACME-8', 'ACME-9', 'ACME-10', 'ACME-11', 'ACME-12']);
  });

  it('nothing for nothing, and never too many', () => {
    expect(keys('')).toEqual([]);
    expect(keys('7')).toEqual([]);
    expect(keys('zzz')).toEqual([]);
    expect(keys('b')).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => t(`ACME-${i + 1}`, `Task ${i + 1}`));
    expect(matchTasks('ACME', many)).toHaveLength(6);
  });

  it('an exact key in any case names its task; anything else names none', () => {
    expect(taskByKey('acme-24', tasks)?.title).toBe('Fix the login redirect');
    expect(taskByKey('ACME24', tasks)).toBeUndefined();
    expect(taskByKey('ACME-99', tasks)).toBeUndefined();
  });
});

describe('the "@" list offers tasks', () => {
  const ctx = { peers: [], selfId: 'me', tasks, friends: [{ name: 'mia', online: true }] };

  it('in a Tasks section after people, each completing to its key', () => {
    const list = suggest('look at @ACME-2', ctx);
    expect(list.map((s) => s.label)).toEqual(['@ACME-2', '@ACME-240', '@ACME-24', '@ACME-20']);
    expect(list[2]).toMatchObject({ value: 'look at @ACME-24 ', hint: 'Fix the login redirect', task: { key: 'ACME-24', status: 'in_progress' } });
    expect(suggest('@bl24', ctx)[0]).toMatchObject({ value: '@ACME-24 ' });
    const mixed = suggest('@mi', { ...ctx, tasks: [t('ACME-3', 'Mirror the menu')] });
    expect(mixed.map((s) => [s.label, Boolean(s.task)])).toEqual([['@mia', false], ['@claude:mia', false], ['@ACME-3', true]]);
  });

  it('the exact key typed is still offered, so Return completes it instead of picking a neighbour', () => {
    expect(suggest('@ACME-24', ctx)[0]).toMatchObject({ label: '@ACME-24', value: '@ACME-24 ' });
    expect(suggest('@ACME-24 ', ctx)).toEqual([]);
  });

  it('no tasks without a board', () => {
    expect(suggest('@ACME-2', { peers: [], selfId: 'me' })).toEqual([]);
  });
});

describe('another project’s tasks in the "@" list (ACME-397)', () => {
  const away = (task: TaskMention): TaskMention => ({ ...task, elsewhere: 'Acme' });
  const board = [t('ACME-24', 'Fix the login redirect'), t('ACME-25', 'Login page polish'), away(t('RAT-4', 'Login with Google')), away(t('RAT-12', 'Billing page')), away(t('RAT-240', 'Rate limits'))];
  const ctx = { peers: [], selfId: 'me', tasks: board, projects: [{ name: 'Acme' }] };
  const labels = (typed: string): string[] => suggest(typed, ctx).map((s) => s.label);

  it('not for the first couple of letters, nor for a number alone', () => {
    expect(labels('@ra')).toEqual(['@Acme']);
    expect(labels('@lo')).toEqual(['@ACME-24', '@ACME-25']);
    expect(labels('@log')).toEqual(['@ACME-24', '@ACME-25']);
    expect(labels('@4')).toEqual([]);
    expect(labels('@24')).toEqual(['@ACME-24']);
  });

  it('its whole prefix, or four letters of a word of the title, offers it, always last', () => {
    expect(labels('@RAT-4')).toEqual(['@RAT-4']);
    expect(labels('@rat12')).toEqual(['@RAT-12']);
    expect(labels('@RAT')).toEqual(['@Acme', '@RAT-4', '@RAT-12', '@RAT-240']);
    expect(labels('@login')).toEqual(['@ACME-24', '@ACME-25', '@RAT-4']);
    expect(suggest('@login', ctx).at(-1)).toMatchObject({ task: { key: 'RAT-4', elsewhere: 'Acme' } });
  });

  it('only a few of them, below this project’s', () => {
    const many = Array.from({ length: 10 }, (_, i) => away(t(`RAT-${i + 1}`, `Task ${i + 1}`)));
    expect(suggest('@RAT', { ...ctx, tasks: many }).filter((s) => s.task)).toHaveLength(3);
  });
});

describe('what Claude reads', () => {
  const find = (key: string) => tasks.find((x) => x.key === key);

  it('keeps "@ACME-24" and says which task it is', () => {
    expect(explainTaskMentions('Look at @ACME-24, and @acme-9.', find)).toBe('Look at @ACME-24 (task: Fix the login redirect), and @acme-9 (task: Buy coffee developer option).');
    expect(explainTaskMentions('(@OPS-24)', find)).toBe('(@OPS-24 (task: Rotate the deploy keys))');
  });

  it('a task is nobody to ask (the demo Claude asks the friend after it instead)', () => {
    expect(gatewayTarget(explainTaskMentions('pick up @ACME-24 next', find))).toBeUndefined();
    expect(gatewayTarget(explainTaskMentions('@ACME-24 is done, @mia have a look', find))?.person).toBe('mia');
  });

  it('leaves unknown keys, e-mail addresses, code and what is already explained alone', () => {
    expect(explainTaskMentions('@ACME-99 and me@ACME-24', find)).toBe('@ACME-99 and me@ACME-24');
    expect(explainTaskMentions('```\n@ACME-24\n```', find)).toBe('```\n@ACME-24\n```');
    const once = explainTaskMentions('@ACME-24', find);
    expect(explainTaskMentions(once, find)).toBe(once);
    expect(explainTaskMentions('no mentions', find)).toBe('no mentions');
  });
});

describe('your Claude, asked about a task', () => {
  it('reads "@ACME-24 (task: …)" while the chat keeps what you wrote', async () => {
    const store = new Store(initialState('room', 'auto'));
    const issue = { id: 'i1', key: 'ACME-24', number: 24, projectId: 'p', title: 'Fix the login redirect', status: 'todo' } as unknown as Issue;
    store.dispatch({ type: 'board_init', state: { enabled: true, issues: [issue], projects: {}, autoTasks: false } });
    const runs: AgentRunInput[] = [];
    const agent: AgentBackend = { run: async (input: AgentRunInput) => (runs.push(input), 'ok') };
    const dir = mkdtempSync(path.join(os.tmpdir(), 'teamod-task-mention-'));
    const host = new AgentHost({
      store,
      selfId: () => 'me',
      send: () => true,
      agent: () => agent,
      shares: {} as never,
      sharing: { recipients: () => [], sharedFor: () => undefined, canPost: () => true } as never,
      people: {} as never,
      questions: { track: () => undefined, ask: async () => ({ kind: 'skip' }), cancelAll: () => undefined, cancelChannel: () => undefined } as never,
      toast: () => undefined,
      system: () => undefined,
      approvalTimeoutMs: () => 60_000,
      refreshUsage: async () => undefined,
      workspaces: { place: () => ({ cwd: dir, additionalDirectories: [], autoEdit: true, onSession: () => undefined }), refreshWorkspace: async () => undefined, manager: { list: [] } } as never,
    });
    await host.onAgentRequest('me', { kind: 'agent_request', requestId: 'r1', prompt: 'finish @ACME-24 today', viaAgent: false, channel: 'ws:w1', urgent: false, plan: false });
    await waitFor(() => runs.length === 1);
    expect(runs[0]!.prompt).toBe('finish @ACME-24 (task: Fix the login redirect) today');
  });
});

describe('bare task keys in an answer', () => {
  const board = new Set(['ACME-72', 'ACME-73']);
  const has = (k: string): boolean => board.has(k);
  const link = (k: string): string => `[${k}](teamod-task:${k})`;

  it('turns a key the board has into a chip, in bold and in a list', () => {
    expect(linkTaskKeys('**ACME-72: image chips**', has)).toBe(`**${link('ACME-72')}: image chips**`);
    expect(linkTaskKeys('- fixed (ACME-73), and ACME-72.', has)).toBe(`- fixed (${link('ACME-73')}), and ${link('ACME-72')}.`);
  });

  it('leaves unknown keys, look-alikes and lower case alone', () => {
    expect(linkTaskKeys('ACME-99, UTF-8, acme-72, XBLG-72, ACME-720', has)).toBe('ACME-99, UTF-8, acme-72, XBLG-72, ACME-720');
  });

  it('leaves code, links, paths, URLs and task: alone', () => {
    const md = ['`ACME-72` and `task:ACME-72`', '[see ACME-72](https://x.dev/ACME-72)', 'docs/ACME-72.md and ACME-72.ts', 'https://x.dev/issues/ACME-72', '```', 'ACME-72', '```', '@ACME-72 and #ACME-72'].join('\n');
    expect(linkTaskKeys(md, has)).toBe(md);
  });

  it('links outside the code on a line that has some', () => {
    expect(linkTaskKeys('ACME-72 fixed in `chat.ts`', has)).toBe(`${link('ACME-72')} fixed in \`chat.ts\``);
  });

  it('with mentions: "@ACME-72" (any case) is a chip too, but not in an address, code or a link (ACME-109)', () => {
    const o = { mentions: true };
    expect(linkTaskKeys('see @ACME-72 and @acme-73.', has, o)).toBe(`see ${link('ACME-72')} and ${link('ACME-73')}.`);
    expect(linkTaskKeys('@ACME-72, ACME-73', has, o)).toBe(`${link('ACME-72')}, ${link('ACME-73')}`);
    expect(linkTaskKeys('me@ACME-72.dev `@ACME-72` [@ACME-72](https://x.dev) @ACME-99', has, o)).toBe('me@ACME-72.dev `@ACME-72` [@ACME-72](https://x.dev) @ACME-99');
    // Without the option "@ACME-72" stays as the Mac's mentions read it.
    expect(linkTaskKeys('@ACME-72', has)).toBe('@ACME-72');
  });

  it('leaves fenced code alone', () => {
    const md = 'ACME-72\n```\nBLG-72\n```\n~~~\n@ACME-73\n~~~';
    expect(linkTaskKeys(md, has, { mentions: true })).toBe(`${link('ACME-72')}\n\`\`\`\nBLG-72\n\`\`\`\n~~~\n@ACME-73\n~~~`);
  });
});

/** The phone's words with chips in them (ACME-109): the same reading, cut into pieces. */
describe('splitTaskKeys', () => {
  const has = (k: string): boolean => k === 'ACME-98' || k === 'ACME-12';

  it('cuts words around the keys the board has', () => {
    expect(splitTaskKeys('ACME-98 is done, @acme-12 next', has, { mentions: true })).toEqual([{ key: 'ACME-98' }, { text: ' is done, ' }, { key: 'ACME-12' }, { text: ' next' }]);
  });

  it('leaves unknown keys and look-alikes as words', () => {
    expect(splitTaskKeys('ACME-7, UTF-8 and ISO-8601', has)).toEqual([{ text: 'ACME-7, UTF-8 and ISO-8601' }]);
    expect(splitTaskKeys('', has)).toEqual([]);
  });

  it('task: in inline code is the inline element’s, not a bare key (shared readInline)', () => {
    expect(splitTaskKeys('`task:ACME-98` and src/ACME-98.ts', has)).toEqual([{ text: '`task:ACME-98` and src/ACME-98.ts' }]);
    expect(readInline('task:ACME-98')).toEqual({ kind: 'task', key: 'ACME-98' });
  });

  it('stripCode keeps `task:KEY` in a sentence for the phone to draw, and folds keys inside code blocks away', () => {
    const prose = stripCode('Fixed `task:ACME-98` and ACME-12.\n\n```ts\nconst k = "ACME-12";\n```\n\n```teamod-tasks\nBLG-98\n```');
    expect(prose.text.split('\n')[0]).toBe('Fixed `task:ACME-98` and ACME-12.');
    expect(prose.code[0]).toEqual({ lang: 'ts', lines: 1 });
    expect(prose.code[1]).toEqual({ lang: 'teamod-tasks', lines: 1, block: { kind: 'tasks', text: 'ACME-98' } });
    // What the phone then links: the bare key, not the code's, not the inline element's.
    expect(linkTaskKeys(prose.text, has)).toContain(`and [ACME-12](${TASK_LINK_SCHEME}ACME-12).`);
    expect(linkTaskKeys(prose.text, has)).toContain('`task:ACME-98`');
  });
});
