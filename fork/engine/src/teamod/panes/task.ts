import type { LogItem } from '../../core/store.js';
import { isRunning } from '../../core/store.js';
import { agentLabel } from '../../shared/agent-label.js';
import { steeredMessages } from '../../shared/claude-notices.js';
import type { StepPage, StepRecord, StepSummary } from '../../shared/steps.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../../ui/agent-choice.js';
import { queueIn } from '../../ui/compose.js';
import type { Workspace } from '../../workspaces/types.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, code, col, dim, line, md, row, span, text, title } from '../tree.js';
import { type Place, ago, back, chrome, empty, findWorkspace, page, statusOf } from './common.js';
import { changesPage, commitPage, historyPage, mergePage, mergePrPage, prPage } from './task-changes.js';
import { filePage, filesPage, scratchPage } from './task-files.js';
import { terminalPage } from './task-terminal.js';

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

/** One run's card: who, what it's doing, how to open its steps, and what it said. */
function agentItem(ctx: Ctx, ws: Workspace, item: AgentItem): Node {
  const running = isRunning(item.status);
  const steps = item.steps.length;
  const latest = item.steps.at(-1);
  const channel = `ws:${ws.id}`;
  const subs = item.subagents.filter((s) => s.kind !== 'background');
  const background = item.subagents.filter((s) => s.kind === 'background');
  return col([
    line(
      span(agentLabel(item.agent, undefined, true, { capital: true }), { weight: 'semibold', color: 'claude' }),
      span(`  ${ago(item.ts)}`, { dim: true }),
      running && span(item.status === 'queued' ? '  waiting its turn' : '  working', { color: 'claude' }),
    ),
    steps > 0 &&
      ctx.draw.button(`steps:${item.id}`, `${steps} step${steps === 1 ? '' : 's'}`, () => ctx.go({ name: 'steps', params: { id: ws.id, channel, item: item.id } }), {
        plain: true,
        dim: true,
        spans: [span(`${steps} step${steps === 1 ? '' : 's'}${running && latest ? `, now: ${latest}` : ''}`, { dim: true })],
      }),
    subs.length > 0 && dim(`${subs.length} sub-agent${subs.length === 1 ? '' : 's'}, ${subs.filter((s) => s.status === 'running').length} running`),
    background.length > 0 && dim(`${background.length} in the background`),
    item.text ? md(item.text) : undefined,
    item.status === 'error' && text('This run failed.', { color: 'error' }),
    item.status === 'denied' && dim('Declined.'),
    item.status === 'interrupted' && dim('Stopped.'),
  ]);
}

/** Your message: words, and, for your own, Edit (rewind or fork from here). */
function chatItem(ctx: Ctx, ws: Workspace, item: ChatItem, waiting: ReturnType<typeof steeredMessages>['waiting']): Node {
  const mine = !item.byAgent && item.from === ctx.state.selfId;
  const steer = waiting.get(item.id);
  return col([
    line(span(item.name, { weight: 'semibold' }), span(`  ${ago(item.ts)}`, { dim: true })),
    md(item.text),
    steer &&
      row([
        dim(steer.waiting === 'stopping' ? 'Your agent stops its step to read this' : 'Sent. Waiting for your agent to read it'),
        steer.waiting === 'next_step' ? ctx.draw.button(`steer-now:${item.id}`, 'Send Now', () => ctx.call('host.steerNow', steer.request), { plain: true }) : undefined,
      ]),
    mine && ws.kind !== 'main' && !ws.archived
      ? ctx.draw.button(`edit:${item.id}`, 'Edit', () => ctx.go({ name: 'edit', params: { id: ws.id, line: item.id } }), { plain: true, dim: true })
      : undefined,
  ]);
}

function logItem(ctx: Ctx, ws: Workspace, item: LogItem, waiting: ReturnType<typeof steeredMessages>['waiting']): Node | undefined {
  switch (item.type) {
    case 'chat':
      return chatItem(ctx, ws, item, waiting);
    case 'agent':
      return agentItem(ctx, ws, item);
    case 'system':
      return dim(item.text);
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
  return col([
    dim(`Waiting (${queued.length})`),
    ...queued.map((q, i) =>
      row([
        text(q.prompt.split('\n')[0]?.slice(0, 80) || 'A message'),
        q.yours ? ctx.draw.button(`q:${q.requestId}:now`, 'Steer', () => ctx.call('host.promote', q.requestId), { plain: true }) : undefined,
        q.yours && i > 0 ? ctx.draw.button(`q:${q.requestId}:up`, 'Up', () => ctx.call('host.reorderQueued', q.requestId, i - 1), { plain: true, dim: true }) : undefined,
        q.yours && i < queued.length - 1 ? ctx.draw.button(`q:${q.requestId}:down`, 'Down', () => ctx.call('host.reorderQueued', q.requestId, i + 1), { plain: true, dim: true }) : undefined,
        q.yours ? ctx.draw.button(`q:${q.requestId}:next`, 'Next', () => ctx.call('host.sendNext', q.requestId), { plain: true, dim: true }) : undefined,
        q.yours ? ctx.draw.button(`q:${q.requestId}:drop`, 'Remove', () => ctx.call('host.cancelQueued', q.requestId), { plain: true, dim: true }) : undefined,
      ]),
    ),
  ]);
}

/** A side question's answer, above the box, never in the chat. */
function btwCard(ctx: Ctx, channel: string): Node | undefined {
  const btw = ctx.state.btw[channel];
  if (!btw) return undefined;
  return col([
    row([line(span('By the way: ', { dim: true }), btw.question), ctx.draw.button('btw:close', 'Close', () => ctx.call('session.btwDismiss', channel), { plain: true, dim: true })]),
    btw.state === 'thinking' && dim('Thinking...'),
    btw.text ? md(btw.text) : undefined,
    btw.state === 'failed' && text(btw.error ?? 'That did not work.', { color: 'error' }),
  ]);
}

function contextMeter(ctx: Ctx, channel: string): string | undefined {
  const info = ctx.state.context[channel];
  if (!info || !info.window) return undefined;
  const percent = Math.round((info.used / info.window) * 100);
  return info.compacting ? 'Compacting...' : `${percent}% of context`;
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
    setMode('send');
    await ctx.call('session.submit', outgoing, { channel, ...(mode === 'steer' ? { urgent: true } : {}) });
  };
  if (ws.archived) {
    return row([dim('Archived.'), ctx.draw.button('restore', 'Restore', () => ctx.call('workspaces.restore', ws.id), { primary: true })]);
  }
  return col([
    ctx.draw.input(`composer:${channel}:box`, send, { placeholder, rows: 2, submitLabel: mode === 'btw' ? 'ask' : mode === 'steer' ? 'steer' : running ? 'queue' : 'send' }),
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
      ctx.draw.button('model', ws.agent?.model ?? ws.model ?? ws.agent?.label ?? 'Model', () => ctx.go({ name: 'model', params: { id: ws.id } }), { plain: true, dim: true }),
      ctx.draw.button('more', 'More', () => ctx.go({ name: 'more', params: { id: ws.id } }), { plain: true, dim: true }),
      meter ? dim(meter) : undefined,
    ]),
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
    step && title(stepWords(step)),
    step?.text ? md(step.text) : undefined,
    input ? col([dim('In'), code(input)]) : undefined,
    step?.output ? col([dim('Out'), code(step.output)]) : undefined,
    step?.truncated && dim('Cut to fit.'),
    step?.isError && text('It failed.', { color: 'error' }),
  );
}

/** A run's steps, oldest first, each one opens. */
function stepsPage(ctx: Ctx, ws: Workspace, channel: string, itemId: string): Node {
  const stepId = ctx.route.params?.step;
  if (stepId) return stepPage(ctx, ws, channel, itemId, stepId);
  const loaded = ctx.load(`steps:${channel}:${itemId}`, async () => (await ctx.call('agent.steps', channel, itemId)) as StepPage, { ttlMs: 1500 });
  const steps = loaded.value?.steps ?? [];
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    title('Steps'),
    loaded.value?.missing && dim('The details of this run aren’t kept on this computer.'),
    steps.length === 0 && !loaded.value?.missing ? dim(loaded.loading ? 'Loading...' : 'No steps yet.') : undefined,
    ...steps.map((step) =>
      ctx.draw.button(`step:${step.id}`, stepWords(step), () => ctx.go({ name: 'steps', params: { id: ws.id, channel, item: itemId, step: step.id } }), {
        plain: true,
        spans: [span(step.status === 'running' ? '… ' : step.status === 'error' ? '! ' : '  ', step.status === 'error' ? { color: 'error' } : { dim: true }), span(stepWords(step)), span(step.parent ? '  sub-agent' : '', { dim: true })],
      }),
    ),
  );
}

/** Edit a message you sent: rewind this conversation to it, or fork a new one from it. */
function editPage(ctx: Ctx, ws: Workspace, lineId: string): Node {
  const item = ctx.state.log.find((l) => l.id === lineId);
  if (item?.type !== 'chat') return page(chrome(ctx, placesOf(ws.id)), back(ctx), empty('That message is gone.'));
  const [how, setHow] = ctx.local<'here' | 'fork'>(`edit:${lineId}:how`, 'here');
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    title('Edit this message'),
    dim(how === 'here' ? 'Rewinds this conversation and its files to here, then sends your new words.' : 'Keeps this conversation as it is, and starts a copy from here with your new words.'),
    row([
      ctx.draw.button('edit:here', 'Rewind', () => setHow('here'), { plain: true, hotkey: 'r', ...(how === 'here' ? {} : { dim: true }) }),
      ctx.draw.button('edit:fork', 'Fork', () => setHow('fork'), { plain: true, hotkey: 'f', ...(how === 'fork' ? {} : { dim: true }) }),
    ]),
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
    title('Agent and model'),
    ...choices.map((choice) =>
      choice.disabled
        ? line(span(choice.label, { dim: true }), choice.why ? span(`  ${choice.why}`, { dim: true }) : undefined)
        : ctx.draw.button(
            `model:${choice.value}`,
            choice.label,
            async () => {
              if (choice.runtime === (ws.agent?.runtime ?? 'claude')) await ctx.call('workbench.setModel', channel, choice.model);
              else await ctx.call('workbench.setAgent', channel, agentForChoice(choice.value, ctx.state.runtimes));
              ctx.nav.back(ctx.pane);
            },
            { plain: true, ...(choice.value === current ? {} : { dim: true }) },
          ),
    ),
  );
}

/** What's advanced about a conversation, out of the way. */
function morePage(ctx: Ctx, ws: Workspace, channel: string): Node {
  const [forking, setForking] = ctx.local(`more:${ws.id}:forking`, false);
  return page(
    chrome(ctx, placesOf(ws.id)),
    back(ctx, 'Chat'),
    title(ws.name),
    ctx.draw.button('compact', 'Compact', () => ctx.call('session.compact', channel), { plain: true }),
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
    !ws.archived && ws.kind === 'worktree' ? ctx.draw.button('archive', 'Archive', () => ctx.call('workspaces.archive', ws.id), { plain: true }) : undefined,
    ctx.draw.button('copy-answer', 'Copy Last Answer', () => ctx.call('session.copyLastAnswer'), { plain: true }),
  );
}

/** Sub-agents and background work: every card's, newest first. */
function agentsPage(ctx: Ctx, ws: Workspace, channel: string): Node {
  const cards = ctx.state.log.filter((item): item is AgentItem => item.channel === channel && item.type === 'agent' && item.subagents.length > 0).reverse();
  const agents = cards.flatMap((card) => card.subagents.map((sub) => ({ card, sub })));
  return page(
    chrome(ctx, placesOf(ws.id), 'agents'),
    agents.length === 0 && empty('No sub-agents here yet.'),
    ...agents.map(({ card, sub }) =>
      ctx.draw.button(`agent:${card.id}:${sub.id}`, sub.title, () => ctx.go({ name: 'steps', params: { id: ws.id, channel, item: card.id } }), {
        plain: true,
        spans: [span(sub.status === 'running' ? '… ' : sub.status === 'failed' ? '! ' : '  ', sub.status === 'failed' ? { color: 'error' } : { dim: true }), span(sub.title), span(`  ${sub.kind === 'background' ? 'background' : `${sub.steps.length} steps`}`, { dim: true })],
      }),
    ),
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
  if (ctx.route.name === 'agents') return agentsPage(ctx, ws, channel);
  const within = (here: string | undefined, body: Node, backTo?: string): Node => page(chrome(ctx, placesOf(ws.id), here), backTo ? back(ctx, backTo) : undefined, body);
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
  return page(
    chrome(ctx, placesOf(ws.id), 'chat'),
    col([row([title(ws.name), ws.branch ? dim(ws.branch) : undefined]), line(statusOf(ctx.state, ws))]),
    ws.askOnly && ws.kind !== 'chat'
      ? row([dim('Questions only: your agent won’t change anything in main.'), ctx.draw.button('continue', 'Continue in New Worktree', () => ctx.call('workspaces.continueInWorktree', ws.id), { plain: true })])
      : undefined,
    running && ctx.draw.button('stop', 'Stop', () => ctx.call('host.stopRun', channel), { hotkey: 'x' }),
    chat(ctx, ws, channel),
    queueRows(ctx, channel),
    btwCard(ctx, channel),
    composer(ctx, ws, channel, running),
  );
};
