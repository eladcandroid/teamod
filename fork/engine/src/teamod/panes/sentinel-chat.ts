import { FIRST_SENTINEL_CHAT, type SentinelChat, sentinelChatChannel, sentinelChatTitle } from '../../core/sentinel/model.js';
import type { LogItem } from '../../core/store.js';
import { isRunning } from '../../core/store.js';
import { agentLabel } from '../../shared/agent-label.js';
import { queueIn } from '../../ui/compose.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text, title } from '../tree.js';
import { ago, back, card, empty, meta, page, peerText, pill, section } from './common.js';
import { askRoute } from './sentinel-asks.js';
import { attention, marked, openSentinel, top, windowed } from './sentinel-common.js';

/**
 * The Sentinel chat: conversations with your own agent about the whole of Sentinel. Each is a normal
 * conversation by its channel: what's said goes with `session.submit`, what comes back is in the log.
 * Also a run's session, read here when it isn't a worktree's or a project chat's.
 */

type AgentItem = Extract<LogItem, { type: 'agent' }>;

const PAGE_ITEMS = 30;

function agentCard(ctx: Ctx, item: AgentItem): Node {
  const running = isRunning(item.status);
  const latest = item.steps.at(-1);
  const steps = item.steps.length;
  // A sentinel your agent names opens from here, as a pill does on the Mac.
  const named = [...new Set([...item.text.matchAll(/sentinel:([\w-]+)/g)].map((m) => m[1]!))].flatMap((id) => ctx.state.sentinel.items.filter((s) => s.id === id));
  return col([
    line(span(`✦ ${agentLabel(item.agent, undefined, true, { capital: true })}`, { weight: 'bold', color: 'claude' }), span(`  ${ago(item.ts)}`, { dim: true }), running && span(item.status === 'queued' ? '  waiting its turn' : '  working', { color: 'claude' })),
    steps > 0 && dim(`${steps} step${steps === 1 ? '' : 's'}${running && latest ? `, now: ${latest}` : ''}`),
    item.text ? md(peerText(item.text)) : undefined,
    item.status === 'error' && text('This run failed.', { color: 'error' }),
    item.status === 'denied' && dim('Declined.'),
    item.status === 'interrupted' && dim('Stopped.'),
    named.length > 0 && row(named.map((s) => ctx.draw.button(`named:${item.id}:${s.id}`, `Open ${s.name}`, () => openSentinel(ctx, s.id), { plain: true, spans: [span('› ', { dim: true }), span('Open'), span(` ${s.name}`)] })), { gap: 2 }),
  ]);
}

function logRow(ctx: Ctx, item: LogItem): Node | undefined {
  switch (item.type) {
    case 'chat':
      return col([line(span(item.name, { weight: 'bold' }), span(`  ${ago(item.ts)}`, { dim: true })), md(item.byAgent ? peerText(item.text) : item.text)]);
    case 'agent':
      return agentCard(ctx, item);
    case 'system':
      return dim(item.text);
    case 'shell':
      return line(span('$ ', { dim: true }), item.command);
    default:
      return undefined;
  }
}

/** A conversation, its newest part: Earlier goes back. */
function conversation(ctx: Ctx, channel: string, nothing: Node): Node {
  const items = ctx.state.log.filter((item) => item.channel === channel && !(item.type === 'agent' && item.status === 'queued'));
  const shown = windowed(ctx, `chat:${channel}`, items, { page: PAGE_ITEMS, newest: true });
  return col([shown.before, items.length === 0 && nothing, ...shown.shown.map((item) => logRow(ctx, item)), shown.after], { gap: 1 });
}

/** What waits its turn, with Remove for your own. */
function queued(ctx: Ctx, channel: string): Node | undefined {
  const list = queueIn(ctx.state, channel, ctx.state.selfId);
  if (!list.length) return undefined;
  const shown = windowed(ctx, `queue:${channel}`, list, { page: 20 });
  return card([shown.before, ...shown.shown.map((q) => row([text(q.prompt.split('\n')[0]?.slice(0, 80) || 'A message'), q.yours ? ctx.draw.button(`queue:${q.requestId}:drop`, 'Remove', () => ctx.call('host.cancelQueued', q.requestId), { plain: true, dim: true }) : undefined], { gap: 2 })), shown.after], { title: [span(`Waiting (${list.length})`, { weight: 'bold' })] });
}

/** What the empty chat offers: what your agent makes here, with a few first asks. */
const FIRST_ASKS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly prompt: string }> = [
  { id: 'suggest', label: 'Suggest Some for Me', prompt: 'Look at my projects and what they use, and suggest three things you could build for me (a dashboard, a watcher or a pipeline), each in one plain line. Set them up when I say yes.' },
  { id: 'found', label: 'What Did They Find?', prompt: 'What did my sentinels find this week? Lead with anything that needs me.' },
  { id: 'prs', label: 'Watch My Open Pull Requests', prompt: 'Make me a dashboard of my open pull requests across my projects, by project, kept fresh every hour.' },
  { id: 'numbers', label: 'Put My Numbers on a Dashboard', prompt: 'Make me a dashboard with the numbers that matter for my projects, and set up what keeps them fresh.' },
];

const chatsOf = (ctx: Ctx): readonly SentinelChat[] => {
  const chats = ctx.state.sentinel.chats?.chats ?? [];
  return chats.length ? chats : [{ id: FIRST_SENTINEL_CHAT, channel: sentinelChatChannel(FIRST_SENTINEL_CHAT), createdAt: 0 }];
};

/** One chat, open: the conversation, what it waits on you for, and the box. None named: the one that's open. */
export function chatPage(ctx: Ctx, named: string | undefined): Node {
  const chats = chatsOf(ctx);
  const active = ctx.state.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT;
  const id = named ?? (chats.some((c) => c.id === active) ? active : chats[0]!.id);
  if (!chats.some((c) => c.id === id)) return page(top(ctx, 'chat'), back(ctx), empty('That chat is gone.'));
  const channel = sentinelChatChannel(id);
  const running = ctx.state.log.some((item) => item.channel === channel && item.type === 'agent' && isRunning(item.status) && item.status !== 'queued');
  const send = async (words: string): Promise<void> => {
    const said = words.trim();
    if (said) await ctx.call('session.submit', said, { channel });
  };
  return page(
    top(ctx, 'chat'),
    back(ctx, named ? 'Chats' : 'Back'),
    row(
      [
        title(sentinelChatTitle(channel, ctx.state.log)),
        running && line(pill('working', 'accent')),
        chats.length > 1 && ctx.draw.button('chats', `Chats (${chats.length})`, () => ctx.go({ name: 'chats' }), { plain: true, dim: true, hotkey: 'h' }),
        ctx.draw.button('chat:more', 'More', () => ctx.go({ name: 'chat-more', params: { chat: id } }), { plain: true, dim: true, hotkey: 'm' }),
      ],
      { gap: 3 },
    ),
    running && ctx.draw.button('chat:stop', 'Stop', () => ctx.call('host.stopRun', channel), { plain: true, hotkey: 'x', spans: [span('■ ', { color: 'error' }), span('Stop')] }),
    conversation(
      ctx,
      channel,
      col([
        card([text('Say what you want to see or keep an eye on, in your own words. Your agent sets it up; nothing runs until you turn it on.')], { title: 'Your agent, for Sentinel', tone: 'accent' }),
        section('Ideas', FIRST_ASKS.map((ask) => ctx.draw.button(`first:${ask.id}`, ask.label, () => send(ask.prompt), { plain: true, spans: marked(ask.label) }))),
      ]),
    ),
    queued(ctx, channel),
    attention(ctx, channel),
    ctx.draw.input(`chat:${id}:box`, (value) => send(value ?? ''), { placeholder: running ? 'Your agent is working: this waits its turn' : 'Ask your agent about your sentinels and dashboards', rows: 2, submitLabel: running ? 'queue' : 'send', autoFocus: true }),
  );
}

/** Every chat: one opens (and stays the open one), New Chat makes another. */
export function chatsPage(ctx: Ctx): Node {
  const chats = chatsOf(ctx);
  const active = ctx.state.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT;
  const shown = windowed(ctx, 'chats', chats);
  return page(
    top(ctx, 'chat'),
    back(ctx, 'Chat'),
    newChat(ctx, { primary: true }),
    shown.before,
    ...shown.shown.map((c) => {
      const items = ctx.state.log.filter((l) => l.channel === c.channel);
      const running = items.some((l) => l.type === 'agent' && isRunning(l.status));
      const last = [...items].reverse().find((l) => (l.type === 'chat' || l.type === 'agent') && l.text.trim());
      const words = last && 'text' in last ? last.text.split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 80) : undefined;
      const name = sentinelChatTitle(c.channel, ctx.state.log);
      return card(
        [
          ctx.draw.button(`open-chat:${c.id}`, name, async () => {
            await ctx.call('sentinel.chatOpen', c.id);
            ctx.go({ name: 'chat', params: { chat: c.id } });
          }, { plain: true, spans: [span(name, { weight: 'bold' })] }),
          (c.id === active || running) && meta(c.id === active && pill('open', 'ok'), running && pill('working', 'accent')),
          words ? dim(words) : undefined,
        ],
        c.id === active ? { tone: 'accent' } : {},
      );
    }),
    shown.after,
  );
}

const newChat = (ctx: Ctx, style: { readonly primary?: true; readonly plain?: true } = {}): Node =>
  ctx.draw.button('chat:new', 'New Chat', async () => {
    const made = (await ctx.call('sentinel.chatNew')) as { readonly id: string } | undefined;
    if (made?.id) ctx.go({ name: 'chat', params: { chat: made.id } });
  }, { hotkey: 'n', ...style, ...(style.plain ? { spans: marked('New Chat', '+') } : {}) });

/** What's advanced about a chat. */
export function chatMorePage(ctx: Ctx, id: string): Node {
  const channel = sentinelChatChannel(id);
  const has = ctx.state.log.some((l) => l.channel === channel);
  return page(
    top(ctx, 'chat'),
    back(ctx, 'Chat'),
    card(
      [
        newChat(ctx, { plain: true }),
        ctx.draw.button('chats', 'All Chats', () => ctx.go({ name: 'chats' }), { plain: true, hotkey: 'h', spans: marked('All Chats') }),
        has && ctx.draw.button('chat:clear', 'Clear...', () => ctx.go(askRoute('chat-clear', { chat: id })), { plain: true, hotkey: 'e', spans: marked('Clear...') }),
        ctx.draw.button('chat:delete', 'Delete Chat...', () => ctx.go(askRoute('chat', { chat: id })), { plain: true, hotkey: 'x', spans: [span('› ', { dim: true }), span('Delete Chat...', { color: 'error' })] }),
      ],
      { title: sentinelChatTitle(channel, ctx.state.log) },
    ),
  );
}

/** A conversation with no screen of its own (a run's on Your Mac), read here: what your agent did, said and asks. */
export function sessionPage(ctx: Ctx, channel: string): Node {
  const running = ctx.state.log.some((item) => item.channel === channel && item.type === 'agent' && isRunning(item.status));
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    title('The agent’s session'),
    conversation(ctx, channel, dim(running ? 'The agent is starting...' : 'This session has nothing to show')),
    attention(ctx, channel),
  );
}
