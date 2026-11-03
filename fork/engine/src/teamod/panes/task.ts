import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LogItem } from '../../core/store.js';
import { isRunning } from '../../core/store.js';
import { agentLabel } from '../../shared/agent-label.js';
import { type LinkedImage, splitImages } from '../../shared/attachment-links.js';
import { steeredMessages } from '../../shared/claude-notices.js';
import type { StepPage, StepRecord, StepSummary } from '../../shared/steps.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../../ui/agent-choice.js';
import { queueIn } from '../../ui/compose.js';
import { stateOf } from '../../ui/workspace-models.js';
import type { EnvChange } from '../../workspaces/env.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, type Span, code, col, dim, line, md, row, span, text } from '../tree.js';
import { type Place, actions, ago, back, card, chrome, empty, findWorkspace, page, section } from './common.js';
import { changesPage, commitPage, historyPage, mergePage, mergePrPage, prPage } from './task-changes.js';
import { filePage, filesPage, scratchPage } from './task-files.js';
import { agentOutputPage, agentPage, agentStepPage, agentTaskPage, agentsPage } from './task-agents.js';
import { scriptsPage, terminalPage, visualPage } from './task-terminal.js';
import { brandWords } from '../brand.js';
import { richNodes } from '../rich/rich.js';

/** How much of a conversation one draw holds: the pane scrolls, and Earlier shows more. */
const PAGE_ITEMS = 30;

type AgentItem = Extract<LogItem, { type: 'agent' }>;
type ChatItem = Extract<LogItem, { type: 'chat' }>;

const placesOf = (id: string): readonly Place[] => [
  { id: 'chat', label: 'Chat', hotkey: 'c', route: { name: 'ws', params: { id } } },
  { id: 'changes', label: 'Changes', hotkey: 'h', route: { name: 'changes', params: { id } } },
  { id: 'files', label: 'Files', hotkey: 'f', route: { name: 'files', params: { id } } },
  { id: 'terminal', label: 'Terminal', hotkey: 'm', route: { name: 'terminal', params: { id } } },
  { id: 'agents', label: 'Agents', hotkey: 'a', route: { name: 'agents', params: { id } } },
];

const stepWords = (step: StepSummary): string => step.label ?? step.doing ?? step.title;

const DOT = span(' · ', { dim: true });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const kept = <T>(list: ReadonlyArray<T | false | undefined | null | ''>): T[] => list.filter((x): x is T => Boolean(x));

/** Who said it and when, small: `elad · 9m`. */
const whoLine = (who: readonly Span[], ts: number, ...rest: ReadonlyArray<Span | false | undefined>): Node => line(...who, DOT, span(ago(ts), { dim: true }), ...rest);

/** One run: who, how long ago, its steps folded to one dim line, then what it said. */
function agentItem(ctx: Ctx, ws: Workspace, item: AgentItem): Node {
  const running = isRunning(item.status);
  const steps = item.steps.length;
  const latest = item.steps.at(-1);
  const channel = `ws:${ws.id}`;
  const subs = item.subagents.filter((s) => s.kind !== 'background');
  const background = item.subagents.filter((s) => s.kind === 'background');
  const claude = { color: 'claude' } as const;
  return col([
    whoLine(
      [span('✦ ', claude), span(agentLabel(item.agent, undefined, true, { capital: true }), { weight: 'semibold', color: 'claude' })],
      item.ts,
      running && DOT,
      running && span(item.status === 'queued' ? 'waiting its turn' : 'working', claude),
    ),
    steps > 0 &&
      ctx.draw.button(`steps:${item.id}`, plural(steps, 'step'), () => ctx.go({ name: 'steps', params: { id: ws.id, channel, item: item.id } }), {
        plain: true,
        dim: true,
        spans: kept([span('▸ ', { dim: true }), span(plural(steps, 'step'), { dim: true }), running && latest && DOT, running && latest && span('now: ', { dim: true }), running && latest && span(latest, { dim: true })]),
      }),
    subs.length > 0 && line(span(plural(subs.length, 'sub-agent'), { dim: true }), DOT, span(`${subs.filter((s) => s.status === 'running').length} running`, { dim: true })),
    background.length > 0 && dim(`${background.length} in the background`),
    ...(item.text ? richNodes(ctx, item.text) : []),
    item.status === 'error' && text('This run failed.', { color: 'error' }),
    item.status === 'denied' && dim('Declined.'),
    item.status === 'interrupted' && dim('Stopped.'),
  ]);
}

/** An image in a message: its name, and Open; drawn where the surface can. */
function imageRow(ctx: Ctx, itemId: string, index: number, image: LinkedImage): Node {
  const [shown, setShown] = ctx.local(`image:${itemId}:${index}`, false);
  const loaded = shown ? ctx.load(`image:${image.href}`, async () => (await ctx.call('attachments.read', image.owner, image.file)) as { readonly mime: string; readonly data: string }) : undefined;
  return col([
    row([
      dim(image.label),
      ctx.draw.button(`image-show:${itemId}:${index}`, shown ? 'Hide' : 'Show', () => setShown(!shown), { plain: true, dim: true }),
      ctx.draw.button(`image-open:${itemId}:${index}`, 'Open', () => ctx.call('attachments.open', image.owner, image.file), { plain: true, dim: true }),
    ]),
    loaded?.value && ctx.surface === 'terminal' && loaded.value.mime === 'image/png' ? { k: 'image' as const, key: `img:${image.href}`, png: loaded.value.data, columns: Math.min(100, Math.max(10, ctx.columns - 2)), rows: 16, alt: image.label } : undefined,
  ]);
}

/** Your message: words, and, for your own, Edit (rewind or fork from here). */
function chatItem(ctx: Ctx, ws: Workspace, item: ChatItem, waiting: ReturnType<typeof steeredMessages>['waiting']): Node {
  const mine = !item.byAgent && item.from === ctx.state.selfId;
  const steer = waiting.get(item.id);
  const split = splitImages(item.text);
  const edit =
    mine && ws.kind !== 'main' && !ws.archived
      ? ctx.draw.button(`edit:${item.id}`, 'Edit', () => ctx.go({ name: 'edit', params: { id: ws.id, line: item.id } }), { plain: true, dim: true })
      : undefined;
  return col([
    row([whoLine([span(item.name, { weight: 'semibold' })], item.ts), edit], { justify: 'space-between' }),
    md(split.text),
    ...split.images.map((image, i) => imageRow(ctx, item.id, i, image)),
    steer &&
      row([
        dim(steer.waiting === 'stopping' ? 'Your agent stops its step to read this' : 'Sent. Waiting for your agent to read it'),
        steer.waiting === 'next_step' ? ctx.draw.button(`steer-now:${item.id}`, 'Send Now', () => ctx.call('host.steerNow', steer.request), { plain: true }) : undefined,
      ], { gap: 2 }),
  ]);
}

function logItem(ctx: Ctx, ws: Workspace, item: LogItem, waiting: ReturnType<typeof steeredMessages>['waiting']): Node | undefined {
  switch (item.type) {
    case 'chat':
      return chatItem(ctx, ws, item, waiting);
    case 'agent':
      return agentItem(ctx, ws, item);
    case 'system':
      return dim(brandWords(item.text));
    case 'shell':
      return line(span('$ ', { dim: true }), item.command);
    default:
      return undefined;
  }
}

/** What waits its turn, with what you can do about each. */
function queueRows(ctx: Ctx, channel: string): Node | undefined {
  const queued = queueIn(ctx.state, channel, ctx.state.selfId);
  if (!queued.length) return undefined;
  const [, setDraft] = ctx.local(`composer:${channel}:draft`, '');
  return section(
    'Waiting',
    queued.map((q, i) =>
      row([
        line(span('◌ ', { dim: true }), span(q.prompt.split('\n')[0]?.slice(0, 80) || 'A message')),
        q.yours ? ctx.draw.button(`q:${q.requestId}:now`, 'Steer', () => ctx.call('host.promote', q.requestId), { plain: true }) : undefined,
        q.yours && i > 0 ? ctx.draw.button(`q:${q.requestId}:up`, 'Up', () => ctx.call('host.reorderQueued', q.requestId, i - 1), { plain: true, dim: true }) : undefined,
        q.yours && i < queued.length - 1 ? ctx.draw.button(`q:${q.requestId}:down`, 'Down', () => ctx.call('host.reorderQueued', q.requestId, i + 1), { plain: true, dim: true }) : undefined,
        q.yours ? ctx.draw.button(`q:${q.requestId}:next`, 'Next', () => ctx.call('host.sendNext', q.requestId), { plain: true, dim: true }) : undefined,
        q.yours
          ? ctx.draw.button(
              `q:${q.requestId}:edit`,
              'Edit',
              async () => {
                await ctx.call('host.cancelQueued', q.requestId);
                setDraft(q.prompt);
              },
              { plain: true, dim: true },
            )
          : undefined,
        q.yours ? ctx.draw.button(`q:${q.requestId}:drop`, 'Remove', () => ctx.call('host.cancelQueued', q.requestId), { plain: true, dim: true }) : undefined,
      ], { gap: 2 }),
    ),
    queued.length,
  );
}

/** A side question's answer, above the box, never in the chat. */
function btwCard(ctx: Ctx, channel: string): Node | undefined {
  const btw = ctx.state.btw[channel];
  if (!btw) return undefined;
  return card(
    [
      line(span(btw.question)),
      btw.state === 'thinking' && dim('Thinking...'),
      btw.text ? md(btw.text) : undefined,
      btw.state === 'failed' && text(btw.error ?? 'That did not work.', { color: 'error' }),
      actions(ctx.draw.button('btw:close', 'Close', () => ctx.call('session.btwDismiss', channel), { plain: true, dim: true })),
    ],
    { title: 'By the way' },
  );
}

function contextMeter(ctx: Ctx, channel: string): string | undefined {
  const info = ctx.state.context[channel];
  if (!info || !info.window) return undefined;
  const percent = Math.round((info.used / info.window) * 100);
  return info.compacting ? 'Compacting...' : `${percent}% of context`;
}

/** The picture on the clipboard, as base64 PNG (macOS; elsewhere attach it by path). */
async function clipboardPng(run: typeof execFile = execFile): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const file = path.join(os.tmpdir(), `teamod-paste-${process.pid}.png`);
  const script = ['set p to POSIX file ' + JSON.stringify(file), 'set f to open for access p with write permission', 'set eof f to 0', 'write (the clipboard as «class PNGf») to f', 'close access f'];
  const ran = await new Promise<boolean>((resolve) => {
    run('osascript', script.flatMap((l) => ['-e', l]), (err) => resolve(!err));
  });
  if (!ran) return undefined;
  try {
    return readFileSync(file).toString('base64');
  } finally {
    rmSync(file, { force: true });
  }
}

interface Attached {
  readonly n: number;
  readonly chip: string;
  readonly file: string;
}

/** The box you write in, and the few things beside it. */
function composer(ctx: Ctx, ws: Workspace, channel: string, running: boolean): Node {
  const [mode, setMode] = ctx.local<'send' | 'steer' | 'btw'>(`composer:${channel}:mode`, 'send');
  const [images, setImages] = ctx.local<readonly Attached[]>(`composer:${channel}:images`, []);
  const [attaching, setAttaching] = ctx.local(`composer:${channel}:attaching`, false);
  const [draft, setDraft] = ctx.local(`composer:${channel}:draft`, '');
  const planOn = ctx.state.planMode[channel] === true;
  const meter = contextMeter(ctx, channel);
  const placeholder = mode === 'btw' ? 'Ask on the side; it stays out of the chat' : mode === 'steer' ? 'Your agent reads this at its next step' : running ? 'Your agent is working: this waits its turn' : planOn ? 'Describe the work: your agent plans first' : 'Message your agent, or /command';
  const send = async (value?: string): Promise<void> => {
    const words = value?.trim();
    if (!words) return;
    if (mode === 'btw') {
      setMode('send');
      await ctx.call('session.btw', channel, words);
      return;
    }
    // Image chips become links to the images (the engine keeps them) before the message goes.
    const typed = images.length ? `${images.map((a) => a.chip).join(' ')} ${words}` : words;
    const outgoing = images.length ? ((await ctx.call('attachments.expand', typed, channel)) as string) : typed;
    setImages([]);
    setDraft('');
    setMode('send');
    await ctx.call('session.submit', outgoing, { channel, ...(mode === 'steer' ? { urgent: true } : {}) });
  };
  if (ws.archived) {
    return card([dim('Archived. Its branch and files are kept.'), actions(ctx.draw.button('restore', 'Restore', () => ctx.call('workspaces.restore', ws.id), { primary: true }))]);
  }
  return col([
    ctx.draw.input(`composer:${channel}:box`, send, { placeholder, rows: 2, ...(draft ? { value: draft } : {}), submitLabel: mode === 'btw' ? 'ask' : mode === 'steer' ? 'steer' : running ? 'queue' : 'send' }),
    images.length > 0 && dim(`Attached: ${images.map((a) => a.file).join(', ')}`),
    attaching &&
      ctx.draw.input(
        'attach-path',
        async (value) => {
          setAttaching(false);
          const file = value?.trim();
          if (file) setImages([...images, (await ctx.call('attachments.addFile', file)) as Attached]);
        },
        { label: 'Image', placeholder: '/path/to/picture.png', submitLabel: 'attach', autoFocus: true },
      ),
    row([
      running && ctx.draw.button('mode:steer', mode === 'steer' ? 'Steering' : 'Steer', () => setMode(mode === 'steer' ? 'send' : 'steer'), { plain: true, hotkey: 'r', ...(mode === 'steer' ? {} : { dim: true }) }),
      ws.askOnly !== true && ctx.draw.button('mode:plan', planOn ? 'Plan' : 'Act', () => ctx.call('session.setPlanMode', channel, !planOn), { plain: true, hotkey: 'p', ...(planOn ? {} : { dim: true }) }),
      ctx.draw.button('mode:btw', 'Side question', () => setMode(mode === 'btw' ? 'send' : 'btw'), { plain: true, ...(mode === 'btw' ? {} : { dim: true }) }),
      ctx.draw.button('attach', 'Image', () => setAttaching(true), { plain: true, dim: true }),
      ctx.draw.button(
        'paste-image',
        'Paste Image',
        async () => {
          const png = await clipboardPng();
          if (!png) return ctx.effect({ toast: 'There’s no picture on the clipboard.' });
          setImages([...images, (await ctx.call('attachments.add', 'png', png)) as Attached]);
        },
        { plain: true, dim: true },
      ),
      ctx.draw.button('model', ws.agent?.model ?? ws.model ?? ws.agent?.label ?? 'Model', () => ctx.go({ name: 'model', params: { id: ws.id } }), { plain: true, dim: true }),
      ctx.draw.button('more', 'More', () => ctx.go({ name: 'more', params: { id: ws.id } }), { plain: true, dim: true }),
      meter ? dim(meter) : undefined,
    ], { gap: 2 }),
  ]);
}

function chat(ctx: Ctx, ws: Workspace, channel: string): Node {
  const items = ctx.state.log.filter((item) => item.channel === channel);
  const steered = steeredMessages(items);
  const shown = items.filter((item) => !steered.notes.has(item.id) && !(item.type === 'agent' && item.status === 'queued'));
  const [limit, setLimit] = ctx.local(`chat:${channel}:shown`, PAGE_ITEMS);
  const from = Math.max(0, shown.length - limit);
  return col(
    [
      from > 0 && ctx.draw.button('earlier', `Earlier (${from})`, () => setLimit(limit + PAGE_ITEMS), { plain: true, dim: true }),
      shown.length === 0 && empty('Nothing here yet.'),
      ...shown.slice(from).map((item) => logItem(ctx, ws, item, steered.waiting)),
    ],
    { gap: 1 },
  );
}

const inputText = (input: Readonly<Record<string, unknown>> | undefined): string | undefined => {
  if (!input) return undefined;
  if (typeof input.command === 'string') return input.command;
  return JSON.stringify(input, null, 2);
};

/** One step in full: what went in, what came back. */
function stepPage(ctx: Ctx, ws: Workspace, channel: string, itemId: string, stepId: string): Node {
  const key = `step:${channel}:${itemId}:${stepId}`;
  const loaded = ctx.load(key, async () => (await ctx.call('agent.step', channel, itemId, stepId)) as StepRecord | undefined, { ttlMs: 2000 });
  const step = loaded.value;
  const input = inputText(step?.input);
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Steps'),
    loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
    !step && dim(loaded.loading ? 'Loading...' : 'Details of this step aren’t kept here.'),
    step &&
      card(
        [
          step.text ? md(step.text) : undefined,
          step.isError && text('It failed.', { color: 'error' }),
          step.truncated && dim('Cut to fit.'),
        ],
        { title: stepWords(step), ...(step.isError ? { tone: 'error' as const } : {}) },
      ),
    input ? section('Input', [code(input)]) : undefined,
    step?.output ? section('Output', [code(step.output)]) : undefined,
  );
}

/** A step's mark: running, failed, or done. */
const stepMark = (status: string | undefined): Span =>
  status === 'running' ? span('… ', { color: 'claude' }) : status === 'error' ? span('✗ ', { color: 'error' }) : span('· ', { dim: true });

/** A run's steps, oldest first, each one opens. */
function stepsPage(ctx: Ctx, ws: Workspace, channel: string, itemId: string): Node {
  const stepId = ctx.route.params?.step;
  if (stepId) return stepPage(ctx, ws, channel, itemId, stepId);
  const loaded = ctx.load(`steps:${channel}:${itemId}`, async () => (await ctx.call('agent.steps', channel, itemId)) as StepPage, { ttlMs: 1500 });
  const steps = loaded.value?.steps ?? [];
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    section(
      'Steps',
      [
        loaded.value?.missing && dim('The details of this run aren’t kept on this computer.'),
        steps.length === 0 && !loaded.value?.missing ? dim(loaded.loading ? 'Loading...' : 'No steps yet.') : undefined,
        ...steps.map((step) =>
          ctx.draw.button(`step:${step.id}`, stepWords(step), () => ctx.go({ name: 'steps', params: { id: ws.id, channel, item: itemId, step: step.id } }), {
            plain: true,
            spans: kept([stepMark(step.status), span(stepWords(step)), step.parent && span('  sub-agent', { dim: true })]),
          }),
        ),
      ],
      steps.length || undefined,
    ),
  );
}

/** Edit a message you sent: rewind this conversation to it, or fork a new one from it. */
function editPage(ctx: Ctx, ws: Workspace, lineId: string): Node {
  const item = ctx.state.log.find((l) => l.id === lineId);
  if (item?.type !== 'chat') return page(chrome(ctx, placesOf(ws.id)), back(ctx), empty('That message is gone.'));
  const [how, setHow] = ctx.local<'here' | 'fork'>(`edit:${lineId}:how`, 'here');
  const choice = (key: string, label: string, hotkey: string, on: boolean, pick: () => void): Node =>
    ctx.draw.button(key, label, pick, { plain: true, hotkey, ...(on ? { spans: [span('● ', { color: 'claude' }), span(label, { weight: 'semibold' })] } : { dim: true, spans: [span('○ ', { dim: true }), span(label, { dim: true })] }) });
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    card(
      [
        row([choice('edit:here', 'Rewind', 'r', how === 'here', () => setHow('here')), choice('edit:fork', 'Fork', 'f', how === 'fork', () => setHow('fork'))], { gap: 3 }),
        dim(how === 'here' ? 'Rewinds this conversation and its files to here, then sends your new words.' : 'Keeps this conversation as it is, and starts a copy from here with your new words.'),
      ],
      { title: 'Edit this message' },
    ),
    ctx.draw.input(
      `edit:${lineId}:box`,
      async (value) => {
        if (!value?.trim()) return;
        await ctx.call('workspaces.editPrompt', ws.id, lineId, value, how);
        ctx.nav.back(ctx.pane);
      },
      { value: item.text, rows: 4, submitLabel: how === 'here' ? 'rewind and send' : 'fork and send', autoFocus: true },
    ),
  );
}

/** Which agent and model this conversation runs on. */
function modelPage(ctx: Ctx, ws: Workspace, channel: string): Node {
  const choices = agentChoices(ctx.state.runtimes, ctx.state.models);
  const current = choiceForAgent(ws.agent ?? (ws.model ? { runtime: 'claude', label: 'Claude', model: ws.model } : undefined));
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    card(
      choices.map((choice) =>
        choice.disabled
          ? line(span(`  ${choice.label}`, { dim: true }), choice.why ? span(`  ${choice.why}`, { dim: true }) : undefined)
          : ctx.draw.button(
              `model:${choice.value}`,
              choice.label,
              async () => {
                if (choice.runtime === (ws.agent?.runtime ?? 'claude')) await ctx.call('workbench.setModel', channel, choice.model);
                else await ctx.call('workbench.setAgent', channel, agentForChoice(choice.value, ctx.state.runtimes));
                ctx.nav.back(ctx.pane);
              },
              {
                plain: true,
                ...(choice.value === current
                  ? { spans: [span('● ', { color: 'claude' }), span(choice.label, { weight: 'semibold' })] }
                  : { dim: true, spans: [span('○ ', { dim: true }), span(choice.label, { dim: true })] }),
              },
            ),
      ),
      { title: 'Agent and model' },
    ),
  );
}

/** What changed in its env files, by key only: values are never drawn. */
function envList(changes: readonly EnvChange[]): Node {
  return col(changes.map((change) => dim(`${change.file}: ${change.binary ? 'changed' : [...change.added.map((k) => `+${k}`), ...change.changed.map((k) => `~${k}`), ...change.removed.map((k) => `-${k}`)].join(' ')}`)));
}

/** Before a worktree goes away: env files changed there would go with it. */
function removePage(ctx: Ctx, ws: Workspace): Node {
  ctx.load(`remove:${ws.id}`, () => ctx.call('workspaces.prepareRemoval', ws.id));
  const changes = ctx.state.envChanges[ws.id] ?? [];
  return card(
    [
      dim('Its branch and files are kept. You can restore it.'),
      changes.length > 0 &&
        col(
          [
            text('Env files changed here would stay behind:', { color: 'warning' }),
            envList(changes),
            row([ctx.draw.button('env-back', 'Copy to the Main Folder', () => ctx.call('workspaces.applyEnvBack', ws.id), {}), ctx.draw.button('env-save', 'Keep a Copy in teamod', () => ctx.call('workspaces.saveEnvInTeamod', ws.id), {})], { gap: 2 }),
          ],
          { top: 1 },
        ),
      actions(
        ctx.draw.button(
          'archive-go',
          'Archive',
          async () => {
            await ctx.call('workspaces.archive', ws.id);
            ctx.show('work');
          },
          { primary: true },
        ),
      ),
    ],
    { title: [span('Archive', { weight: 'bold' }), span(` ${ws.name}`, { weight: 'bold' })], ...(changes.length > 0 ? { tone: 'warn' as const } : {}) },
  );
}

/** What's advanced about a conversation, out of the way. */
function morePage(ctx: Ctx, ws: Workspace, channel: string): Node {
  const [forking, setForking] = ctx.local(`more:${ws.id}:forking`, false);
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    card(
      [
        ctx.draw.button('compact', 'Compact', () => ctx.call(ws.kind === 'chat' ? 'session.compact' : 'workspaces.compact', ws.kind === 'chat' ? channel : ws.id), { plain: true }),
        ws.kind !== 'main'
          ? forking
            ? ctx.draw.input(
                'fork-name',
                async (value) => {
                  setForking(false);
                  if (value?.trim()) await ctx.call('workspaces.fork', ws.id, value.trim());
                },
                { label: 'Name', placeholder: 'A name for the copy', submitLabel: 'fork', autoFocus: true },
              )
            : ctx.draw.button('fork', 'Fork', () => setForking(true), { plain: true })
          : undefined,
        ctx.draw.button('finder', 'Show in Finder', () => ctx.call('workspaces.openInFinder', ws.id), { plain: true }),
        !ws.archived && ws.kind === 'worktree' ? ctx.draw.button('archive', 'Archive', () => ctx.go({ name: 'remove', params: { id: ws.id } }), { plain: true }) : undefined,
        ctx.draw.button('copy-answer', 'Copy Last Answer', () => ctx.call('session.copyLastAnswer'), { plain: true }),
        ctx.draw.button('refresh', 'Refresh', () => ctx.call('workspaces.refresh', ws.id), { plain: true }),
        ctx.draw.button('stop-everywhere', 'Stop Your Agent Everywhere', () => ctx.call('session.stopAgent'), { plain: true }),
      ],
      { title: ws.name },
    ),
  );
}

/** The worktree at the top of its chat: name, state in a colored pill, branch, and Stop while it works. */
function headerCard(ctx: Ctx, ws: Workspace, channel: string, running: boolean): Node {
  const st = stateOf(ctx.state, ws, 0);
  const color = st.tone === 'error' ? 'error' : st.tone === 'warn' ? 'warning' : st.tone === 'ok' ? 'success' : st.tone === 'claude' || st.tone === 'info' ? 'claude' : undefined;
  const style = color ? { color } : { dim: true };
  const askOnly = ws.askOnly && ws.kind !== 'chat';
  return card(
    [
      line(span(`${st.icon} `, style), span(st.label, style), ws.branch ? DOT : undefined, ws.branch ? span(`⌥ ${ws.branch}`, { dim: true }) : undefined),
      askOnly && dim('Questions only: your agent won’t change anything in main.'),
      (running || askOnly) &&
        actions(
          running && ctx.draw.button('stop', 'Stop', () => ctx.call('host.stopRun', channel), { hotkey: 'x' }),
          askOnly && ctx.draw.button('continue', 'Continue in New Worktree', () => ctx.call('workspaces.continueInWorktree', ws.id), { plain: true }),
        ),
    ],
    { title: ws.name, ...(st.tone === 'error' ? { tone: 'error' as const } : st.tone === 'warn' ? { tone: 'warn' as const } : {}) },
  );
}

export const taskPane: Screen = (ctx) => {
  const id = ctx.route.params?.id;
  if (!id) return page(chrome(ctx), empty('Pick a worktree or chat in Work.'));
  const ws = findWorkspace(ctx.state, id);
  if (!ws) return page(chrome(ctx), back(ctx), empty('That worktree is gone.'));
  const channel = `ws:${ws.id}`;
  const params = ctx.route.params ?? {};
  if (ctx.route.name === 'steps' && params.item) return stepsPage(ctx, ws, params.channel ?? channel, params.item);
  if (ctx.route.name === 'edit' && params.line) return editPage(ctx, ws, params.line);
  if (ctx.route.name === 'model') return modelPage(ctx, ws, channel);
  if (ctx.route.name === 'more') return morePage(ctx, ws, channel);
  const within = (here: string | undefined, body: Node, backTo?: string): Node => page(chrome(ctx, placesOf(ws.id), here), backTo ? back(ctx, backTo) : undefined, body);
  if (ctx.route.name === 'agents') return within('agents', agentsPage(ctx, ws));
  if (ctx.route.name === 'cc-agent' && params.session && params.agent) return within(undefined, agentPage(ctx, ws, params.session, params.agent), 'Agents');
  if (ctx.route.name === 'cc-step' && params.session && params.agent && params.seq) return within(undefined, agentStepPage(ctx, params.session, params.agent, Number(params.seq)), 'Sub-agent');
  if (ctx.route.name === 'cc-output' && params.session && params.agent && params.path) return within(undefined, agentOutputPage(ctx, params.session, params.agent, params.path), 'Sub-agent');
  if (ctx.route.name === 'cc-task' && params.session && params.task) return within(undefined, agentTaskPage(ctx, params.session, params.agent, params.task), 'Agents');
  if (ctx.route.name === 'visual' && params.n) return within(undefined, visualPage(ctx, ws, Number(params.n)), 'Terminal');
  if (ctx.route.name === 'scripts') return within(undefined, scriptsPage(ctx, ws), 'Terminal');
  if (ctx.route.name === 'remove') return within(undefined, removePage(ctx, ws), 'More');
  if (ctx.route.name === 'changes') return within('changes', changesPage(ctx, ws));
  if (ctx.route.name === 'merge') return within(undefined, mergePage(ctx, ws), 'Changes');
  if (ctx.route.name === 'merge-pr') return within(undefined, mergePrPage(ctx, ws), 'Changes');
  if (ctx.route.name === 'pr') return within(undefined, prPage(ctx, ws), 'Changes');
  if (ctx.route.name === 'history') return within(undefined, historyPage(ctx, ws), 'Changes');
  if (ctx.route.name === 'commit' && params.hash) return within(undefined, commitPage(ctx, ws, params.hash), 'History');
  if (ctx.route.name === 'files') return within('files', filesPage(ctx, ws));
  if (ctx.route.name === 'file' && params.path) return within(undefined, filePage(ctx, ws, params.path), 'Files');
  if (ctx.route.name === 'scratch') return within(undefined, scratchPage(ctx, ws), 'Files');
  if (ctx.route.name === 'terminal') return within('terminal', terminalPage(ctx, ws));
  const running = ctx.state.log.some((item) => item.channel === channel && item.type === 'agent' && isRunning(item.status) && item.status !== 'queued');
  ctx.load(`env:${ws.id}`, () => ctx.call('workspaces.checkEnv', ws.id));
  const envAsks = ctx.state.envAsks[ws.id] ?? [];
  return page(
    chrome(ctx, placesOf(ws.id), 'chat'),
    headerCard(ctx, ws, channel, running),
    envAsks.length > 0 &&
      card(
        [
          text('Env files changed here, and the main folder doesn’t have them:'),
          envList(envAsks),
          actions(
            ctx.draw.button('env-copy', 'Copy to the Main Folder', () => ctx.call('workspaces.applyEnvBack', ws.id), ws.archived ? {} : { primary: true }),
            ctx.draw.button('env-keep', 'Keep Here Only', () => ctx.call('workspaces.keepEnvHere', ws.id), { plain: true, dim: true }),
          ),
        ],
        { tone: 'warn' },
      ),
    chat(ctx, ws, channel),
    queueRows(ctx, channel),
    btwCard(ctx, channel),
    composer(ctx, ws, channel, running),
  );
};
