import type { LogItem } from '../../core/store.js';
import { isRunning } from '../../core/store.js';
import { agentLabel } from '../../shared/agent-label.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text, title } from '../tree.js';
import { ago, back, chrome, empty, findWorkspace, page, statusOf } from './common.js';

/** How much of a conversation one draw holds: the pane scrolls, and Earlier shows more. */
const PAGE_ITEMS = 30;

function agentItem(item: Extract<LogItem, { type: 'agent' }>): Node {
  const running = isRunning(item.status);
  const steps = item.steps.length;
  const latest = item.steps.at(-1);
  return col([
    line(span(agentLabel(item.agent, undefined, true, { capital: true }), { weight: 'semibold', color: 'claude' }), span(`  ${ago(item.ts)}`, { dim: true }), running && span('  working', { color: 'claude' })),
    steps > 0 && dim(`${steps} step${steps === 1 ? '' : 's'}${running && latest ? `, now: ${latest}` : ''}`),
    item.text ? md(item.text) : undefined,
    item.status === 'error' && text('This run failed.', { color: 'error' }),
    item.status === 'interrupted' && dim('Stopped.'),
  ]);
}

function logItem(item: LogItem): Node | undefined {
  switch (item.type) {
    case 'chat':
      return col([line(span(item.name, { weight: 'semibold' }), span(`  ${ago(item.ts)}`, { dim: true })), md(item.text)]);
    case 'agent':
      return agentItem(item);
    case 'system':
      return dim(item.text);
    case 'shell':
      return col([line(span('$ ', { dim: true }), item.command)]);
    default:
      return undefined;
  }
}

function chat(ctx: Ctx, channel: string): Node {
  const items = ctx.state.log.filter((item) => item.channel === channel);
  const [shown, setShown] = ctx.local(`chat:${channel}:shown`, PAGE_ITEMS);
  const from = Math.max(0, items.length - shown);
  return col(
    [
      from > 0 && ctx.draw.button('earlier', `Earlier (${from})`, () => setShown(shown + PAGE_ITEMS), { plain: true, dim: true }),
      items.length === 0 && empty('Nothing here yet.'),
      ...items.slice(from).map(logItem),
    ],
    { gap: 1 },
  );
}

export const taskPane: Screen = (ctx) => {
  const id = ctx.route.params?.id;
  if (!id) return page(chrome(ctx), empty('Pick a worktree or chat in Work.'));
  const ws = findWorkspace(ctx.state, id);
  if (!ws) return page(chrome(ctx), back(ctx), empty('That worktree is gone.'));
  const channel = `ws:${ws.id}`;
  const running = ctx.state.log.some((item) => item.channel === channel && item.type === 'agent' && isRunning(item.status));
  return page(
    chrome(ctx),
    col([
      row([title(ws.name), ws.branch ? dim(ws.branch) : undefined]),
      line(statusOf(ctx.state, ws)),
    ]),
    running && ctx.draw.button('stop', 'Stop', () => ctx.call('host.stopRun', channel), { hotkey: 'x' }),
    chat(ctx, channel),
  );
};
