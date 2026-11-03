import { type Dialogue, type DialogueMode, agentTurns, isOver } from '../../core/dialogues/model.js';
import { speakerName } from '../../core/dialogues/prompt.js';
import { dialogueHeader } from '../../core/dialogues/view.js';
import { type AgentRef, defaultAgentOf } from '../../protocol.js';
import { agentChoices, agentForChoice } from '../../ui/agent-choice.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text } from '../tree.js';
import { type Tone, ago, back, card, empty, meta, page, pill, section } from './common.js';
import { choice, listOf, nameButton, peerMd, tick, top } from './team-common.js';

/**
 * Dialogues: agents talking turn by turn, chaired by the engine. You start one, set its caps, answer
 * Continue? and stop it; what an agent says is only ever drawn.
 */

/** Who talks, by name, joined by a dot: names stay as they are in any language. */
const whoOf = (d: Dialogue): string => d.participants.map((_, i) => speakerName(d, i)).join(' · ');

const toneOf = (d: Dialogue): Tone => {
  const tone = dialogueHeader(d).tone;
  return tone === 'failed' ? 'error' : tone === 'live' ? 'accent' : tone === 'waiting' ? 'warn' : 'quiet';
};

export function dialoguesPage(ctx: Ctx): Node {
  const all = Object.values(ctx.state.dialogues).sort((a, b) => Number(isOver(a)) - Number(isOver(b)) || b.updatedAt - a.updatedAt);
  return page(
    top(ctx, 'dialogues'),
    ctx.draw.button('dialogues:new', 'New Dialogue', () => ctx.go({ name: 'dialogue-new' }), { primary: true, hotkey: 'a' }),
    all.length === 0 && empty('No dialogues yet. Two or more agents talk turn by turn, and you set how far they go.'),
    all.length > 0 &&
      section('Dialogues', [
        listOf(ctx, 'dialogues:list', all, (d) => {
          const h = dialogueHeader(d);
          const tone = toneOf(d);
          return card(
            [
              nameButton(ctx, `dialogue:${d.id}`, h.topic.replace(/\s+/g, ' ').slice(0, 70), () => ctx.go({ name: 'dialogue', params: { id: d.id } })),
              meta(pill(h.status, tone), whoOf(d), ago(d.updatedAt)),
            ],
            tone === 'warn' ? { tone: 'warn' } : {},
          );
        }),
      ], all.length),
  );
}

/** One dialogue: its caps while proposed, its turns, and Start, Continue or Stop. */
export function dialoguePage(ctx: Ctx, id: string): Node {
  const d = ctx.state.dialogues[id];
  if (!d) return page(top(ctx, 'dialogues'), back(ctx, 'Dialogues'), empty('That dialogue is gone.'));
  const h = dialogueHeader(d);
  const [turns, setTurns] = ctx.local(`dialogue:${id}:turns`, '');
  const [budget, setBudget] = ctx.local(`dialogue:${id}:budget`, '');
  const [limit, setLimit] = ctx.local(`dialogue:${id}:shown`, 30);
  const wanted = Math.min(limit, d.turns.length);
  const from = d.turns.length - wanted;
  const shown = d.turns.slice(from, from + 100);
  const later = d.turns.length - (from + shown.length);
  const start = (): Promise<unknown> => {
    const n = Number(turns);
    const k = Number(budget);
    return ctx.call('dialogues.confirm', id, { ...(n > 0 ? { turnCap: Math.min(200, Math.floor(n)) } : {}), ...(budget.trim() === '' ? {} : k > 0 ? { budget: Math.round(k * 1000) } : { budget: null }) });
  };
  return page(
    top(ctx, 'dialogues'),
    back(ctx, 'Dialogues'),
    card(
      [
        meta(pill(h.status, toneOf(d)), h.progress, h.budget),
        meta(h.mode, whoOf(d)),
        d.status === 'proposed' &&
          col(
            [
              d.mode === 'cross-reference' ? undefined : ctx.draw.input(`dialogue:${id}:turn-cap`, (value) => setTurns(value?.trim() ?? ''), { label: 'Turns', placeholder: String(d.turnCap), submitLabel: 'keep', ...(turns ? { value: turns } : {}) }),
              ctx.draw.input(`dialogue:${id}:budget-cap`, (value) => setBudget(value?.trim() ?? ''), { label: 'Budget (k tokens)', placeholder: d.budget ? String(Math.round(d.budget / 1000)) : 'none', submitLabel: 'keep', ...(budget ? { value: budget } : {}) }),
            ],
            { top: 1 },
          ),
        h.actions.length > 0 &&
          row(
            h.actions.map((a) =>
        a === 'start'
          ? ctx.draw.button('dialogue:start', 'Start', start, { primary: true, hotkey: 'a' })
          : a === 'continue'
            ? ctx.draw.button('dialogue:continue', 'Continue', () => ctx.call('dialogues.continue', id), { primary: true, hotkey: 'a' })
            : ctx.draw.button(`dialogue:${a}`, a === 'cancel' ? 'Cancel' : 'Stop', () => ctx.call('dialogues.stop', id), { plain: true, hotkey: 'x' }),
            ),
            { gap: 2, top: 1 },
          ),
      ],
      { title: h.topic.replace(/\s+/g, ' ').slice(0, 200), ...(toneOf(d) === 'warn' ? { tone: 'warn' as const } : toneOf(d) === 'error' ? { tone: 'error' as const } : {}) },
    ),
    from > 0 && ctx.draw.button('dialogue:earlier', `Earlier (${from})`, () => setLimit(wanted + 30), { plain: true, dim: true }),
    d.turns.length === 0 && d.status !== 'proposed' ? dim('No turns yet.') : undefined,
    col(
      shown.map((turn) =>
        col([
          line(span(turn.by === 'person' ? (turn.name ?? 'A person') : speakerName(d, turn.by), { weight: 'bold', ...(turn.by === 'person' ? {} : { color: 'claude' }) }), span(`  ${ago(turn.at)}`, { dim: true }), turn.by === 'person' ? undefined : span(`  turn ${turn.n}`, { dim: true })),
          md(peerMd(turn.text.slice(0, 40_000))),
        ]),
      ),
      { gap: 1 },
    ),
    later > 0 && ctx.draw.button('dialogue:later', `Later (${later})`, () => setLimit(Math.max(30, wanted - 30)), { plain: true, dim: true }),
    d.result && d.status === 'ended' ? col([dim('The reconciled answer is the last turn.')]) : undefined,
    !isOver(d) &&
      d.status !== 'proposed' &&
      ctx.draw.input(
        `dialogue:${id}:say`,
        async (value) => {
          const words = value?.trim();
          if (words) await ctx.call('dialogues.interject', id, words.slice(0, 16_000));
        },
        { placeholder: 'Say something into it: the next agent’s turn reads it', rows: 2, submitLabel: 'say' },
      ),
    isOver(d) && dim(`${agentTurns(d)} turn${agentTurns(d) === 1 ? '' : 's'}, ${d.used} tokens.`),
  );
}

type Who = AgentRef & { readonly owner?: string; readonly peer?: string };

/** Who can talk: your agents that run here, and your teammates' default ones. */
function whoCan(ctx: Ctx): ReadonlyArray<{ readonly value: string; readonly label: string; readonly agent: Who }> {
  const st = ctx.state;
  const mine = agentChoices(st.runtimes, st.models)
    .filter((c) => !c.disabled)
    .map((c) => ({ value: c.value, label: `Your ${c.label}`, agent: agentForChoice(c.value, st.runtimes) as Who }));
  const selfIds = new Set([st.selfId, st.self?.peerId]);
  const inRoom = st.peers.filter((p) => !selfIds.has(p.peerId) && !p.guest && p.agent);
  const friends = st.network.enabled ? st.network.friends.filter((f) => !inRoom.some((p) => p.peerId === f.peerId)) : [];
  const theirs = [...inRoom.map((p) => ({ peerId: p.peerId, name: p.name, agent: defaultAgentOf(p) })), ...friends.map((f) => ({ peerId: f.peerId, name: f.name, agent: defaultAgentOf(undefined) }))];
  return [...mine, ...theirs.map((p) => ({ value: `peer:${p.peerId}`, label: `${p.name}’s ${p.agent.label}`, agent: { ...p.agent, owner: p.name, peer: p.peerId } }))];
}

const MODES: ReadonlyArray<readonly [DialogueMode, string, string]> = [
  ['talk', 'Talk', 'A conversation, read-only.'],
  ['cross-reference', 'Cross-reference', 'One answers, the other critiques, the first reconciles. Two agents.'],
  ['work', 'Work', 'Full tools in one worktree: pick it under Where.'],
];

/** A new dialogue: who, how, where, and its topic. It waits for you to confirm its caps. */
export function dialogueNewPage(ctx: Ctx): Node {
  const st = ctx.state;
  const options = whoCan(ctx);
  const [chosen, setChosen] = ctx.local<readonly string[]>('dialogue-new:who', []);
  const [mode, setMode] = ctx.local<DialogueMode>('dialogue-new:mode', 'talk');
  const [where, setWhere] = ctx.local('dialogue-new:where', 'room');
  const worktrees = st.projects.flatMap((p) => p.workspaces.filter((w) => !w.archived && w.kind === 'worktree').map((w) => ({ value: `ws:${w.id}`, label: `${p.name} › ${w.name}` })));
  const picked = options.filter((o) => chosen.includes(o.value));
  const needs = mode === 'cross-reference' ? (picked.length === 2 ? undefined : 'Cross-reference is between two agents.') : picked.length < 2 ? 'Pick at least two agents.' : picked.length > 4 ? 'A dialogue has at most four agents.' : mode === 'work' && !where.startsWith('ws:') ? 'A work dialogue runs in one worktree: pick it under Where.' : undefined;
  return page(
    top(ctx, 'dialogues'),
    back(ctx, 'Dialogues'),
    text('New Dialogue', { weight: 'bold' }),
    section('Who talks', [
      listOf(ctx, 'dialogue-new:options', options, (o) =>
        tick(ctx, `dialogue-new:${o.value}`, o.label, chosen.includes(o.value), () => setChosen(chosen.includes(o.value) ? chosen.filter((v) => v !== o.value) : [...chosen, o.value])),
      ),
      dim('A teammate’s agent takes each turn as a request to them, under their rules.'),
    ], picked.length || undefined),
    section('How', [row(MODES.map(([m, label]) => choice(ctx, `dialogue-new:mode:${m}`, label, mode === m, () => setMode(m))), { gap: 2 }), dim(MODES.find(([m]) => m === mode)?.[2] ?? '')]),
    section('Where its thread lives', [choice(ctx, 'dialogue-new:where:room', 'The room', where === 'room', () => setWhere('room')), listOf(ctx, 'dialogue-new:worktrees', worktrees, (w) => choice(ctx, `dialogue-new:where:${w.value}`, w.label, where === w.value, () => setWhere(w.value)))]),
    needs ? text(needs, { color: 'warning' }) : undefined,
    !needs &&
      ctx.draw.input(
        'dialogue-new:topic',
        async (value) => {
          const topic = value?.trim();
          if (!topic) return;
          const made = (await ctx.call('dialogues.start', { channel: where, agents: picked.map((o) => o.agent), topic: topic.slice(0, 8000), mode })) as Dialogue | undefined;
          setChosen([]);
          ctx.go(made?.id ? { name: 'dialogue', params: { id: made.id } } : { name: 'dialogues' });
        },
        { label: 'Topic', placeholder: 'What should they talk about?', rows: 2, submitLabel: 'propose', autoFocus: true },
      ),
  );
}
