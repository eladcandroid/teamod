import { MAX_RUN_AT_ONCE, type Recipe, type Sentinel, type SentinelDraft, activeSentinelChat, lastRunOf, pausedWords, scheduleSentence } from '../../core/sentinel/model.js';
import { ASSISTANT_TITLE } from '../../shared/assistant.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, row, span, text, title } from '../tree.js';
import { actions, ago, back, card, empty, meta, page, pill, section } from './common.js';
import { field, leave, loadNote, marked, openRun, openSentinel, pick, runPill, top, windowed } from './sentinel-common.js';
import { MAC_SCOPE, type Need, type Show, describedName, filterSentinels, footLine, groupSentinels, headlineOf, needsOf, nextText, recipeWhen, scopesOf, troubleOf } from './sentinel-model.js';

/** Sentinel's first page: what needs you and every sentinel as a row leading with what it found; and New Sentinel. */

const projectsOf = (ctx: Ctx): ReadonlyArray<{ readonly id: string; readonly name: string }> => ctx.state.projects.filter((p) => p.root && !p.error);

/** Say this to the Sentinel chat that's open, and go there. */
export async function askChat(ctx: Ctx, words: string): Promise<void> {
  const said = words.trim();
  if (!said) return;
  await ctx.call('session.submit', said, { channel: activeSentinelChat(ctx.state.sentinel.chats) });
  ctx.go({ name: 'chat' });
}

interface Filters {
  readonly scope: string;
  readonly show: Show;
  readonly query: string;
}

const filtersOf = (ctx: Ctx): { readonly now: Filters; set(next: Partial<Filters>): void } => {
  const [now, setNow] = ctx.local<Filters>('sn:list:filters', { scope: '', show: 'all', query: '' });
  return { now, set: (next) => setNow({ ...now, ...next }) };
};

/** A sentinel's state as a pill: On, Paused (and why), or why it can't watch. */
function statePill(ctx: Ctx, s: Sentinel): Span {
  const trouble = troubleOf(ctx.state.sentinel, s);
  if (s.paused) return pill(pausedWords(s) ?? 'Paused', s.pausedWhy ? 'warn' : 'quiet');
  if (trouble) return pill(`Can’t watch: ${trouble}`, 'error');
  return pill('On', 'ok');
}

/** A sentinel's card: its name, then whether it's on and when it runs, then what it found last. */
function sentinelCard(ctx: Ctx, s: Sentinel, now: number): Node {
  const state = ctx.state.sentinel;
  const last = lastRunOf(state, s.id);
  const sentence = scheduleSentence(s.trigger, (id) => state.items.find((i) => i.id === id)?.name);
  const next = state.nextAt[s.id];
  const trouble = !s.paused && troubleOf(state, s);
  return card(
    [
      ctx.draw.button(`sn:${s.id}`, s.name, () => openSentinel(ctx, s.id), { plain: true, spans: [span(s.name, { weight: 'bold' })] }),
      meta(statePill(ctx, s), sentence, !s.paused && next !== undefined && `next ${nextText(next, now)}`),
      last ? meta(runPill(last.state), span(headlineOf(last)), ago(last.startedAt, now)) : dim('Hasn’t run yet'),
    ],
    trouble ? { tone: 'error' } : {},
  );
}

/** One thing waiting for you, as a card with the one thing to do about it. */
function needCard(ctx: Ctx, need: Need): Node {
  const open = need.kind === 'merge' ? () => openRun(ctx, need.run) : () => openSentinel(ctx, need.sentinel.id);
  return card(
    [
      ctx.draw.button(`need:${need.key}`, need.title, open, { plain: true, spans: [span(need.title, { weight: 'bold' })] }),
      dim(need.detail),
      need.kind === 'merge'
        ? actions(
            ctx.draw.button(`need:${need.key}:merge`, 'Merge', async () => {
              await ctx.call('sentinel.decide', need.run.id, 'merge');
              ctx.effect({ toast: need.run.pr ? `Merged #${need.run.pr.number}` : 'Merged' });
            }, { plain: true, spans: [span('Merge', { color: 'warning', weight: 'bold' })] }),
            ctx.draw.button(`need:${need.key}:skip`, 'Not Now', async () => {
              await ctx.call('sentinel.decide', need.run.id, 'skip');
              ctx.effect({ toast: need.run.pr ? `#${need.run.pr.number} stays open` : 'Not now' });
            }, { plain: true, dim: true }),
          )
        : need.kind !== 'trouble' &&
          actions(
            ctx.draw.button(`need:${need.key}:on`, need.kind === 'failing' ? 'Resume' : 'Turn On', () => ctx.call('sentinel.pause', need.sentinel.id, false), {
              plain: true,
              spans: [span(need.kind === 'failing' ? 'Resume' : 'Turn On', { color: 'warning', weight: 'bold' })],
            }),
          ),
    ],
    { tone: need.kind === 'trouble' ? 'error' : 'warn' },
  );
}

/** Nothing set up yet: say what it is, and offer the ways in. */
function firstVisit(ctx: Ctx): Node {
  const ideas = [
    { id: 'suggest', label: 'Suggest Some for Me', prompt: 'I’m new to Sentinel. Look at my projects and what they use, and suggest three watchers that would help me, each in one plain line. Set them up, with a board for their numbers, when I say yes.' },
    { id: 'dashboard', label: 'Make Me a Dashboard', prompt: 'Make me a dashboard with the numbers that matter for my projects, and set up what keeps them fresh.' },
    { id: 'brief', label: 'A Morning Brief', prompt: 'Every weekday morning, tell me on my phone what changed in my projects and what needs me first.' },
    { id: 'site', label: 'Watch My Website', prompt: 'Check my website every 5 minutes and tell me the moment it stops answering, and when it’s back.' },
    { id: 'tests', label: 'Fix Failing Tests', prompt: 'When the tests fail on GitHub for one of my projects, have the agent fix it and open a pull request for me to merge.' },
  ];
  return col([
    card(
      [
        text('A sentinel runs the agent, a script or a service on a schedule or when something happens, and leaves a report. Say what you want to see; nothing runs until you turn it on.'),
        col([ctx.draw.input('first:words', async (value) => askChat(ctx, value ?? ''), { placeholder: 'Every morning, tell me what changed and what needs me first', rows: 2, submitLabel: 'ask' })], { top: 1 }),
      ],
      { title: 'Let your agent keep an eye on things', tone: 'accent' },
    ),
    section('Ideas', ideas.map((idea) => ctx.draw.button(`first:${idea.id}`, idea.label, () => askChat(ctx, idea.prompt), { plain: true, spans: marked(idea.label) }))),
    actions(
      undefined,
      ctx.draw.button('first:recipes', 'Every recipe', () => ctx.go({ name: 'new', params: { way: 'recipe' } }), { plain: true, dim: true, hotkey: 'r' }),
      ctx.draw.button('first:build', 'Build one step by step', () => ctx.go({ name: 'new', params: { way: 'build' } }), { plain: true, dim: true, hotkey: 'u' }),
    ),
  ]);
}

/** The sentinels' cards, under a heading for each project when there's more than one. */
function sentinelSections(ctx: Ctx, shown: ReadonlyArray<{ readonly item: Sentinel; readonly group: string }>, groups: ReadonlyArray<{ readonly name: string; readonly items: readonly Sentinel[] }>, total: number, now: number): Node[] {
  const runs: Array<{ name: string; cards: Node[] }> = [];
  for (const { item, group } of shown) {
    const last = runs.at(-1);
    if (last && last.name === group) last.cards.push(sentinelCard(ctx, item, now));
    else runs.push({ name: group, cards: [sentinelCard(ctx, item, now)] });
  }
  if (groups.length <= 1) return [section('Sentinels', [col(runs.flatMap((r) => r.cards), { gap: 1 })], total)];
  return runs.map((r) => section(r.name, [col(r.cards, { gap: 1 })], groups.find((g) => g.name === r.name)?.items.length));
}

export function listPage(ctx: Ctx): Node {
  const state = ctx.state.sentinel;
  const now = Date.now();
  const filters = filtersOf(ctx);
  const projects = projectsOf(ctx);
  const scopes = scopesOf(state.items, projects);
  // A project that no longer has sentinels falls back to all of them.
  const scope = scopes.some((x) => x.value === filters.now.scope) ? filters.now.scope : '';
  const shown = filterSentinels(state.items, { ...(scope ? { scope } : {}), show: filters.now.show, query: filters.now.query });
  const groups = groupSentinels(shown, projects);
  const ordered = groups.flatMap((g) => g.items.map((item) => ({ item, group: g.name })));
  const rows = windowed(ctx, 'list', ordered);
  const needs = windowed(ctx, 'needs', needsOf(state, scope || undefined), { page: 10 });
  const filtered = scope !== '' || filters.now.show !== 'all' || filters.now.query !== '';
  const waiting = needsOf(state, scope || undefined).length;
  return page(
    top(ctx, 'sentinels'),
    row([ctx.draw.button('new', 'New Sentinel', () => ctx.go({ name: 'new' }), { primary: true, hotkey: 'n' }), state.items.length > 0 && ctx.draw.button('more', 'More', () => ctx.go({ name: 'list-more' }), { plain: true, dim: true, hotkey: 'm' })], { gap: 3 }),
    state.items.length === 0 && firstVisit(ctx),
    needs.shown.length > 0 && section('Needs you', [col([needs.before, ...needs.shown.map((need) => needCard(ctx, need)), needs.after], { gap: 1 })], waiting),
    filtered && row([dim(`Showing ${shown.length} of ${state.items.length}`), ctx.draw.button('filters:clear', 'Show All', () => filters.set({ scope: '', show: 'all', query: '' }), { plain: true })], { gap: 2 }),
    state.items.length > 0 && ordered.length === 0 && empty('No sentinels match that.'),
    rows.before,
    ...(ordered.length > 0 ? sentinelSections(ctx, rows.shown, groups, ordered.length, now) : []),
    rows.after,
    state.items.length > 0 && dim(footLine(state.items, state.runs, now)),
  );
}

/** The list's own settings, out of the way: which sentinels it shows, and how many agents run at once. */
export function listMorePage(ctx: Ctx): Node {
  const state = ctx.state.sentinel;
  const filters = filtersOf(ctx);
  const scopes = scopesOf(state.items, projectsOf(ctx));
  return page(
    top(ctx, 'sentinels'),
    back(ctx, 'Sentinels'),
    card(
      [
        field(ctx, 'find', 'Find', filters.now.query, (value) => filters.set({ query: value.trim() }), { placeholder: 'A sentinel’s name, trigger or steps', submitLabel: 'find' }),
        pick(ctx, 'scope', 'Project', scopes, filters.now.scope, (scope) => filters.set({ scope })),
        pick(ctx, 'show', 'Show', [{ value: 'all', label: 'All' }, { value: 'watching', label: 'Watching' }, { value: 'paused', label: 'Paused' }], filters.now.show, (show) => filters.set({ show: show as Show })),
      ],
      { title: 'Which sentinels the list shows' },
    ),
    card(
      [
        pick(ctx, 'run-at-once', 'Run at once', Array.from({ length: MAX_RUN_AT_ONCE }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 at a time' : `${i + 1} at once` })), String(state.runAtOnce), (n) => ctx.call('sentinel.setRunAtOnce', Number(n))),
        dim('How many agent steps run together, across all your sentinels.'),
      ],
      { title: 'Agents at once' },
    ),
  );
}

type Way = 'describe' | 'recipe' | 'build';
const WAYS: ReadonlyArray<{ readonly value: Way; readonly label: string; readonly hotkey: string; readonly line: string }> = [
  { value: 'describe', label: 'Describe it', hotkey: 'e', line: 'Say what it should do; your agent writes it.' },
  { value: 'recipe', label: 'Recipe', hotkey: 'r', line: 'Start from one that works, then change anything.' },
  { value: 'build', label: 'Build it yourself', hotkey: 'u', line: 'A name and a project; you add when it runs and its steps.' },
];

/**
 * New Sentinel: three ways in. Every one makes a paused sentinel and opens its page, for you to look
 * over and turn on: nothing here can start one.
 */
export function newPage(ctx: Ctx): Node {
  const asked = ctx.route.params?.way as Way | undefined;
  const [way, setWay] = ctx.local<Way>(`sn:new:way:${asked ?? ''}`, asked ?? 'describe');
  const filters = filtersOf(ctx);
  const [where, setWhere] = ctx.local(`sn:new:where`, filters.now.scope || MAC_SCOPE);
  const projects = projectsOf(ctx);
  const projectId = where === MAC_SCOPE || !projects.some((p) => p.id === where) ? null : where;
  const place = projectId ? (projects.find((p) => p.id === projectId)?.name ?? ASSISTANT_TITLE) : ASSISTANT_TITLE;
  const make = async (draft: SentinelDraft): Promise<Sentinel> => {
    const made = (await ctx.call('sentinel.create', { ...draft, projectId })) as Sentinel | undefined;
    if (!made?.id) throw new Error('Couldn’t make it');
    return made;
  };
  /** Off this page and onto what was made: Back goes where you came from. */
  const open = (id: string): void => {
    leave(ctx, (route) => route.name === 'new');
    openSentinel(ctx, id);
  };
  return page(
    top(ctx, 'sentinels'),
    back(ctx, 'Sentinels'),
    col([title('New Sentinel'), dim('A sentinel runs on a schedule or when you press Run, does its steps in order, and leaves a report. It starts paused: you look it over, then turn it on.')]),
    row(
      WAYS.map((w) =>
        ctx.draw.button(`way:${w.value}`, w.label, () => setWay(w.value), { plain: true, hotkey: w.hotkey, spans: w.value === way ? [span(`● ${w.label}`, { color: 'claude', weight: 'bold' })] : [span(`○ ${w.label}`, { dim: true })] }),
      ),
      { gap: 3 },
    ),
    card(
      [
        dim(WAYS.find((w) => w.value === way)?.line ?? ''),
        pick(ctx, 'where', 'Where', [{ value: MAC_SCOPE, label: ASSISTANT_TITLE }, ...projects.map((p) => ({ value: p.id, label: p.name }))], projectId ?? MAC_SCOPE, setWhere),
        way === 'describe' &&
          ctx.draw.input(
            'new:words',
            async (value) => {
              const words = value?.trim();
              if (!words) return;
              const made = await make({ name: describedName(words), trigger: { kind: 'manual' }, steps: [] });
              open(made.id);
              // An empty, paused sentinel, then your agent fills it in from the words.
              await ctx.call('sentinel.ask', made.id, words);
            },
            { label: 'What should it do?', placeholder: 'Every weekday morning, read yesterday’s commits and open issues, write me a brief, and create tasks for anything that looks urgent', rows: 4, submitLabel: 'write it', autoFocus: true },
          ),
        way === 'describe' && dim(`Your agent sets it up in ${place}, looking at the project first when that helps.`),
        way === 'build' &&
          ctx.draw.input(
            'new:name',
            async (value) => {
              const name = value?.trim();
              if (!name) return;
              const made = await make({ name, trigger: { kind: 'manual' }, steps: [] });
              open(made.id);
            },
            { label: 'Name', placeholder: 'Morning brief', submitLabel: 'make it', autoFocus: true },
          ),
        way === 'build' && dim(`In ${place}; it runs when you press Run until you give it a schedule.`),
      ],
      { title: WAYS.find((w) => w.value === way)?.label ?? '' },
    ),
    way === 'recipe' && recipes(ctx, make, open),
  );
}

/** The recipes, as rows: picking one makes it, filled in and paused, with the one that runs after it when it has one. */
function recipes(ctx: Ctx, make: (draft: SentinelDraft) => Promise<Sentinel>, open: (id: string) => void): Node {
  const loaded = ctx.load('sentinel:recipes', async () => (await ctx.call('sentinel.recipes')) as readonly Recipe[] | undefined);
  const all = loaded.value ?? [];
  const recipeRow = (r: Recipe): Node =>
    col([
      ctx.draw.button(
        `recipe:${r.id}`,
        r.name,
        async () => {
          const made = await make(r.sentinel);
          if (r.then) await make({ ...r.then.sentinel, trigger: { kind: 'after', sentinelId: made.id, on: r.then.on } });
          open(made.id);
        },
        { plain: true, spans: [span('› ', { dim: true }), span(r.name, { weight: 'bold' }), span(`  ${recipeWhen(r)}`, { dim: true })] },
      ),
      dim(`  ${r.line}`),
    ]);
  const plain = all.filter((r) => r.group !== 'numbers');
  const numbers = all.filter((r) => r.group === 'numbers');
  return col([
    loadNote(loaded, 'Reading the recipes...'),
    plain.length > 0 && section('Recipes', [col(plain.map(recipeRow), { gap: 1, top: 1 })], plain.length),
    numbers.length > 0 && section('Keep the numbers', [dim('They show on the sentinel’s page and your dashboards.'), col(numbers.map(recipeRow), { gap: 1, top: 1 })], numbers.length),
  ]);
}
