import { needsYou } from '../../companion/needs-you.js';
import type { NeedsYou } from '../../companion/protocol.js';
import type { AppState, DomainState } from '../../core/store.js';
import { isRunning } from '../../core/store.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, col, dim, line, row, span, text } from '../tree.js';
import { card, openWorkspace } from './common.js';

/**
 * Put an answer where the item's `answer` says: args[1].answers['Which store?'], say. Copies as it
 * goes: the args belong to the item in the state.
 */
export function withAnswer(args: readonly unknown[], slot: ReadonlyArray<string | number>, value: unknown): unknown[] {
  const out = structuredClone(args) as unknown[];
  let at: Record<string | number, unknown> = out as unknown as Record<string | number, unknown>;
  for (const step of slot.slice(0, -1)) {
    at[step] ??= {};
    at = at[step] as Record<string | number, unknown>;
  }
  at[slot.at(-1)!] = value;
  return out;
}

/** A question's options and words: send what's picked the way its `answer` says. */
function answering(ctx: Ctx, need: NeedsYou): Node | undefined {
  const answer = need.answer;
  if (!answer) return undefined;
  const send = (values: readonly string[]): Promise<unknown> => ctx.call(answer.method, ...withAnswer(answer.args, answer.slot, answer.list ? values : values.join(answer.join ?? ', ')));
  const [picked, setPicked] = ctx.local<readonly string[]>(`need:${need.id}:picked`, []);
  const choices = answer.picks ? (need.choices ?? []) : [];
  return col([
    choices.length > 0 &&
      row(
        choices.map((choice, i) =>
          ctx.draw.button(
            `need:${need.id}:choice:${i}`,
            need.multi ? `${picked.includes(choice.label) ? '[x]' : '[ ]'} ${choice.label}` : choice.label,
            () => (need.multi ? setPicked(picked.includes(choice.label) ? picked.filter((p) => p !== choice.label) : [...picked, choice.label]) : send([choice.label])),
            {},
          ),
        ),
      ),
    need.multi && picked.length > 0 && ctx.draw.button(`need:${need.id}:send`, answer.label ?? 'Send', () => send(picked), { primary: true, hotkey: 's' }),
    answer.text &&
      ctx.surface !== 'mobile' &&
      ctx.draw.input(
        `need:${need.id}:words`,
        async (value) => {
          if (value?.trim()) await send([value.trim()]);
        },
        { placeholder: 'Or say it in your own words', submitLabel: answer.label?.toLowerCase() ?? 'send' },
      ),
  ]);
}

/** Where a need's conversation opens: `conv:ws:<id>` is a worktree or chat. */
const workspaceOf = (need: NeedsYou): string | undefined => (need.topic?.startsWith('conv:ws:') ? need.topic.slice('conv:ws:'.length) : undefined);

const KEYS = ['a', 'd', 'w', 'e'] as const;

/** At most `max` characters, cut at a word with an ellipsis. */
const clipped = (words: string, max: number): string => {
  if (words.length <= max) return words;
  const cut = words.slice(0, Math.max(1, max - 1));
  const at = cut.lastIndexOf(' ');
  return `${at > max / 2 ? cut.slice(0, at) : cut}…`;
};

/**
 * One waiting item as a compact card: who and what they want on top (and "1 of 2"), the detail on
 * one dim line, then its answers with the main one to press. Kept short: it sits above the prompt.
 */
function item(ctx: Ctx, need: NeedsYou, index: number, total: number, go: (to: number) => void): Node {
  const open = workspaceOf(need);
  const [expanded, setExpanded] = ctx.local(`need:${need.id}:expanded`, false);
  // Inside the card's border and padding, less the counter.
  const width = Math.max(20, ctx.columns - 4 - (total > 1 ? 10 : 0));
  const detail = need.detail ?? '';
  const brief = clipped(detail.split('\n').filter((l) => l.trim()).slice(0, 2).join(' '), width);
  const head = expanded ? need.title : clipped(need.title, 2 * width - (need.from?.length ?? 0) - 2);
  const more = detail.length > 0 ? brief !== detail : head !== need.title;
  return card(
    [
      row(
        [
          line(span('● ', { color: 'warning' }), need.from ? span(need.from, { weight: 'bold' }) : undefined, need.from ? span('  ') : undefined, span(head)),
          total > 1 ? text(`${index + 1} of ${total}`, { dim: true }) : undefined,
        ],
        { justify: 'space-between', wrap: false },
      ),
      detail.length > 0 && dim(expanded ? detail : brief),
      answering(ctx, need),
      row(
        [
          ...need.actions.map((action, i) => ctx.draw.button(`need:${need.id}:act:${i}`, action.label, () => ctx.call(action.method, ...action.args), { hotkey: KEYS[i]!, ...(action.tone === 'main' ? { primary: true } : {}) })),
          row(
            [
              more || expanded ? ctx.draw.button(`need:${need.id}:more`, expanded ? 'Less' : 'More', () => setExpanded(!expanded), { plain: true, dim: true, hotkey: 'm' }) : undefined,
              open ? ctx.draw.button(`need:${need.id}:open`, 'Open', () => openWorkspace(ctx, open), { plain: true, dim: true, hotkey: 'o' }) : undefined,
              need.topic?.startsWith('sentinel:') ? ctx.draw.button(`need:${need.id}:sentinel`, 'Open', () => ctx.show('sentinel', { name: 'page', params: { id: need.topic!.slice('sentinel:'.length) } }), { plain: true, dim: true, hotkey: 'o' }) : undefined,
              total > 1 ? ctx.draw.button('need:next', 'Next', () => go((index + 1) % total), { plain: true, dim: true, hotkey: 'n' }) : undefined,
              ctx.draw.button(`need:${need.id}:dismiss`, 'Dismiss', () => ctx.call('needs.dismiss', need.id), { plain: true, dim: true, hotkey: 'x' }),
            ],
            { gap: 2 },
          ),
        ],
        { gap: 2 },
      ),
    ],
    { tone: 'warn' },
  );
}

/** What waits for you, above the prompt, one at a time. Nothing waiting: no band at all. */
export const bandView: Screen = (ctx) => {
  const needs = needsYou(ctx.state as unknown as DomainState);
  const [wanted, setWanted] = ctx.local('band:at', 0);
  const at = Math.min(wanted, Math.max(0, needs.length - 1));
  const need = needs[at];
  return need ? item(ctx, need, at, needs.length, setWanted) : { k: 'box', children: [] };
};

/** Whether anything waits. */
export const bandActive = (state: AppState): boolean => needsYou(state as unknown as DomainState).length > 0;

/** The status line: what's working and what waits. */
export function statusLine(state: AppState): string | undefined {
  const working = new Set(state.log.filter((item) => item.type === 'agent' && isRunning(item.status) && item.channel.startsWith('ws:')).map((item) => item.channel)).size;
  const waiting = needsYou(state as unknown as DomainState).length;
  const parts = [working ? `${working} working` : undefined, waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you` : undefined].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}
