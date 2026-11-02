import { type LogItem, isRunning } from '../../core/store.js';
import { agentLabel } from '../../shared/agent-label.js';
import { ASSISTANT_TITLE, type AssistantChat, activeAssistantChannel, assistantChatTitle, tabChats } from '../../shared/assistant.js';
import { failureText } from '../../shared/run-failure.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text } from '../tree.js';
import { ago, back, chrome, empty, page } from './common.js';
import { askFirst, placesOf, plural, windowed } from './work-common.js';

/**
 * Your Mac: your own agent for the whole computer, tied to no project or worktree. Several chats,
 * one open: the same one your other screens talk to.
 */

/** How much of a chat one draw holds. */
const PAGE_ITEMS = 30;

function chatItem(item: LogItem): Node | undefined {
  switch (item.type) {
    case 'chat':
      return col([line(span(item.name, { weight: 'semibold' }), span(`  ${ago(item.ts)}`, { dim: true })), md(item.text)]);
    case 'agent': {
      const running = isRunning(item.status);
      return col([
        line(span(agentLabel(item.agent, undefined, true, { capital: true }), { weight: 'semibold', color: 'claude' }), span(`  ${ago(item.ts)}`, { dim: true }), running ? span(item.status === 'queued' ? '  waiting its turn' : '  working', { color: 'claude' }) : undefined),
        item.steps.length > 0 ? dim(`${plural(item.steps.length, 'step')}${running && item.steps.at(-1) ? `, now: ${item.steps.at(-1)}` : ''}`) : undefined,
        item.subagents.length > 0 ? dim(plural(item.subagents.length, 'sub-agent')) : undefined,
        item.text && item.status !== 'error' ? md(item.text) : undefined,
        item.status === 'error' ? text(failureText(item.text) || 'This run failed.', { color: 'error' }) : undefined,
        item.status === 'denied' ? dim('Declined.') : undefined,
        item.status === 'interrupted' ? dim('Stopped.') : undefined,
      ]);
    }
    case 'system':
      return dim(item.text);
    case 'shell':
      return line(span('$ ', { dim: true }), item.command);
    default:
      return undefined;
  }
}

function chatTabs(ctx: Ctx, chats: readonly AssistantChat[], active: string): Node {
  const window = windowed(ctx, 'assistant:tabs', chats, { size: 20 });
  return col([
    row(
      window.shown.map((c) => {
        const words = assistantChatTitle(c.channel, ctx.state.log);
        return ctx.draw.button(`chat:${c.id}`, words, () => ctx.call('assistant.openChat', c.id), { plain: true, ...(c.id === active ? {} : { dim: true }), spans: [span(words, c.id === active ? { weight: 'semibold' } : { dim: true })] });
      }),
      { gap: 2 },
    ),
    window.controls,
  ]);
}

export function assistantPage(ctx: Ctx): Node {
  const assistant = ctx.state.assistant;
  const channel = activeAssistantChannel(assistant);
  const chats = tabChats(assistant);
  const items = ctx.state.log.filter((item) => item.channel === channel);
  const running = items.some((item) => item.type === 'agent' && isRunning(item.status) && item.status !== 'queued');
  const shown = items.filter((item) => !(item.type === 'agent' && item.status === 'queued'));
  // A page at a time, counted from the newest: `back` is how many newer ones are off the page.
  const [wanted, setBack] = ctx.local(`assistant:${channel}:back`, 0);
  const newer = Math.min(wanted, Math.max(0, shown.length - 1));
  const to = shown.length - newer;
  const from = Math.max(0, to - PAGE_ITEMS);
  const open = chats.find((c) => c.channel === channel);
  const deletable = Boolean(open) && (chats.length > 1 || items.length > 0);
  return page(
    chrome(ctx, placesOf(ctx), 'assistant'),
    back(ctx),
    chats.length > 0 && chatTabs(ctx, chats, assistant.active),
    row([
      ctx.draw.button('assistant:new', 'New Chat', () => ctx.call('assistant.newChat'), { plain: true, hotkey: 'n' }),
      deletable && open ? ctx.draw.button('assistant:delete', 'Delete This Chat', () => askFirst(ctx, 'delete-chat', { chat: open.id }), { plain: true, dim: true }) : undefined,
    ]),
    running && ctx.draw.button('assistant:stop', 'Stop', () => ctx.call('host.stopRun', channel), { hotkey: 'x' }),
    from > 0 && ctx.draw.button('assistant:earlier', `Earlier (${from})`, () => setBack(newer + PAGE_ITEMS), { plain: true, dim: true, hotkey: 'q' }),
    shown.length === 0 && empty(`${ASSISTANT_TITLE} isn’t tied to any project: ask it anything about this computer.`),
    col(shown.slice(from, to).map(chatItem), { gap: 1 }),
    newer > 0 && ctx.draw.button('assistant:later', `Later (${newer})`, () => setBack(Math.max(0, newer - PAGE_ITEMS)), { plain: true, dim: true, hotkey: 'j' }),
    ctx.draw.input(
      `assistant:box:${channel}`,
      async (value) => {
        const words = value?.trim();
        if (words) await ctx.call('session.submit', words, { channel });
      },
      { placeholder: running ? 'Your agent is working: this waits its turn' : 'Message your agent', rows: 2, submitLabel: running ? 'queue' : 'send' },
    ),
  );
}
