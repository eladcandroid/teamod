import { CHART_TILE_KINDS, OUTPUT_SHOWS, TILE_WIDTHS, WIDTH_WORDS, type Dashboard, type MetricRef, type OutputShow, type StepRef, type Tile, type TileWidth, GRID_COLUMNS, dashboardMarkdown, dashboardSentinels, inReadingOrder, layoutTiles, metricOf, tileOutput, tileSentinelOf, tileStateIn } from '../../core/sentinel/dashboard-model.js';
import { COMPARE, COMPARE_LABEL, COMPARE_WORDS, type Compare } from '../../core/sentinel/metrics.js';
import type { MetricKind } from '../../core/sentinel/model.js';
import { ASSISTANT_TITLE } from '../../shared/assistant.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { Ctx, Route } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { actions, back, card, empty, meta, page, section } from './common.js';
import { askRoute } from './sentinel-asks.js';
import { attention, field, leave, marked, openChannel, openRun, openSentinel, pick, top, windowed } from './sentinel-common.js';
import { LOOK_WORDS, NEW_SOURCES, type NewSourceId, TILE_SIZES, type TileLook, type TileSizeId, askLine, draftsOf, looksFor, metricChoices, namedLine, nameIn, newSourceAsk, outputStepChoices, refreshLine, sizeFor, tileCaption, tileWords } from './sentinel-model.js';
import { tileBody } from './sentinel-tile.js';

/** The dashboards: your boards of tiles, each number a sentinel keeps where you put it. Tiles sit on the Mac's grid of six columns; here they read in order, with Move in place of a drag. */

const boardRoute = (id: string): Route => ({ name: 'board', params: { board: id } });

export function dashboardsPage(ctx: Ctx): Node {
  const s = ctx.state.sentinel;
  const boards = s.dashboards ?? [];
  const [naming, setNaming] = ctx.local('sn:boards:naming', false);
  const shown = windowed(ctx, 'boards', boards);
  return page(
    top(ctx, 'dashboards'),
    naming
      ? ctx.draw.input(
          'board:new-name',
          async (value) => {
            setNaming(false);
            const name = value?.trim();
            if (!name) return;
            const made = (await ctx.call('dashboard.create', name)) as Dashboard | undefined;
            if (made?.id) ctx.go(boardRoute(made.id));
          },
          { label: 'Name', placeholder: 'Overview', submitLabel: 'make it', autoFocus: true },
        )
      : ctx.draw.button('board:new', 'New Board', () => setNaming(true), { primary: true, hotkey: 'n' }),
    boards.length === 0 && card([text('Put a number here: revenue, open pull requests, how fast your site answers, what your agent wrote this morning. It updates each time its sentinel runs.')], { title: 'Your dashboards', tone: 'accent' }),
    boards.length > 0 &&
      section(
        'Boards',
        [
          shown.before,
          col(
            shown.shown.map((d) => {
              const refreshing = s.refreshing?.[d.id];
              return card([
                ctx.draw.button(`board:${d.id}`, d.name, () => ctx.go(boardRoute(d.id)), { plain: true, spans: [span(d.name, { weight: 'bold' })] }),
                meta(`${d.tiles.length} ${d.tiles.length === 1 ? 'tile' : 'tiles'}`, COMPARE_WORDS[d.compare], refreshing && span(refreshLine(refreshing), { color: 'claude' })),
              ]);
            }),
            { gap: 1 },
          ),
          shown.after,
        ],
        boards.length,
      ),
  );
}

/** A tile on a board: its name opens it, what it shows under that. */
function tileRow(ctx: Ctx, d: Dashboard, tile: Tile): Node {
  const s = ctx.state.sentinel;
  const cap = tileCaption(s, tile);
  const open = (): void => ctx.go({ name: 'tile', params: { board: d.id, tile: tile.id } });
  if (tile.kind === 'divider') return col([ctx.draw.button(`tile:${tile.id}`, cap.title || 'Divider', open, { plain: true, spans: [span('━━ ', { dim: true }), span(cap.title || 'Divider', { weight: 'bold' })] })], { top: 1 });
  return card([
    ctx.draw.button(`tile:${tile.id}`, cap.title, open, { plain: true, spans: [span(cap.title, { weight: 'bold' }), cap.from && cap.from !== cap.title ? span(`  ${cap.from}`, { dim: true }) : span('')] }),
    tileBody(ctx, d, tile),
  ]);
}

/** The project a tile's sentinel works in, for Group by Project. */
function tileProjectName(ctx: Ctx, tile: Tile): string {
  const s = ctx.state.sentinel;
  const sid = tileSentinelOf(tile);
  const item = sid ? s.items.find((i) => i.id === sid) : undefined;
  if (!item) return 'Gone';
  return ctx.state.projects.find((p) => p.id === item.projectId)?.name ?? ASSISTANT_TITLE;
}

/** Your agent building this board (Add by description): its last line and answer, what it waits on you for, and the draft sentinels it set up. */
function askAndDrafts(ctx: Ctx, d: Dashboard): Node | undefined {
  const s = ctx.state.sentinel;
  const ask = s.dashboardAsks?.[d.id];
  const said = askLine(ask, ask?.state === 'writing' ? activityOf(ctx.state.log, ask.channel) : undefined);
  const drafts = draftsOf(s, d.id);
  if (!ask && !drafts.length) return undefined;
  return col([
    ask && said && row([text(namedLine(said.text, nameIn(s)), said.who === 'failed' ? { color: 'error' } : said.who === 'agent' ? { color: 'claude' } : { dim: true }), ctx.draw.button('board:ask-chat', 'Open Chat', () => openChannel(ctx, ask.channel), { plain: true, dim: true })]),
    ask && attention(ctx, ask.channel),
    ...drafts.map((x) =>
      card(
        [
          text(`Your agent set up ${x.name} to fetch it. It’s a draft: nothing runs until you turn it on.`),
          actions(
            ctx.draw.button(`draft:${x.id}:on`, 'Turn On', () => ctx.call('sentinel.pause', x.id, false), { plain: true, spans: [span('Turn On', { color: 'warning', weight: 'bold' })] }),
            ctx.draw.button(`draft:${x.id}:review`, 'Review', () => openSentinel(ctx, x.id), { plain: true, dim: true }),
          ),
        ],
        { title: [span('● Draft', { color: 'warning', weight: 'bold' })], tone: 'warn' },
      ),
    ),
  ], { gap: 1 });
}

export function boardPage(ctx: Ctx, d: Dashboard): Node {
  const s = ctx.state.sentinel;
  const refreshing = s.refreshing?.[d.id];
  const runnable = dashboardSentinels(d).filter((sid) => s.items.some((i) => i.id === sid && !i.paused));
  const [grouped] = ctx.local(`sn:board:grouped`, false);
  const ordered = inReadingOrder(d.tiles);
  const named = ordered.map((tile) => ({ tile, group: tileProjectName(ctx, tile) }));
  const tiles = grouped ? [...named].filter((x) => x.tile.kind !== 'divider').sort((a, b) => a.group.localeCompare(b.group)) : named;
  const shown = windowed(ctx, `tiles:${d.id}`, tiles);
  let group: string | undefined;
  return page(
    top(ctx, 'dashboards'),
    back(ctx, 'Dashboards'),
    col([title(d.name), meta(`${d.tiles.length} ${d.tiles.length === 1 ? 'tile' : 'tiles'}`, COMPARE_WORDS[d.compare])]),
    row(
      [
        ctx.draw.button('board:add', 'Add to the Board', () => ctx.go({ name: 'add', params: { board: d.id } }), { primary: true, hotkey: 'a' }),
        refreshing
          ? text(refreshLine(refreshing), { color: 'claude' })
          : runnable.length > 0
            ? ctx.draw.button('board:refresh', 'Refresh', () => ctx.call('dashboard.refresh', d.id), { plain: true, hotkey: 'r' })
            : undefined,
        ctx.draw.button('board:more', 'More', () => ctx.go({ name: 'board-more', params: { board: d.id } }), { plain: true, dim: true, hotkey: 'm' }),
      ],
      { gap: 3 },
    ),
    !refreshing && d.tiles.length > 0 && runnable.length === 0 && dim('Its sentinels are paused or gone: nothing to refresh.'),
    askAndDrafts(ctx, d),
    d.tiles.length === 0 && empty('Nothing on this board yet. Add a number, a chart or what your agent wrote.'),
    shown.before,
    col(
      shown.shown.flatMap(({ tile, group: name }) => {
        const heading = grouped && name !== group ? line(span(name, { weight: 'bold' }), span(`  ${named.filter((x) => x.group === name && x.tile.kind !== 'divider').length}`, { dim: true })) : undefined;
        group = name;
        return [heading, tileRow(ctx, d, tile)];
      }),
      { gap: 1 },
    ),
    shown.after,
  );
}

/** What's advanced about a board. */
export function boardMorePage(ctx: Ctx, d: Dashboard): Node {
  const s = ctx.state.sentinel;
  const [grouped, setGrouped] = ctx.local(`sn:board:grouped`, false);
  const [naming, setNaming] = ctx.local('sn:board:naming-new', false);
  return page(
    top(ctx, 'dashboards'),
    back(ctx, d.name),
    card(
      [
        field(ctx, 'board:name', 'Name', d.name, (value) => (value.trim() ? ctx.call('dashboard.update', d.id, { name: value.trim() }) : undefined)),
        pick(ctx, 'board:compare', 'Compare every tile with', COMPARE.map((c) => ({ value: c, label: COMPARE_LABEL[c] })), d.compare, (compare) => ctx.call('dashboard.update', d.id, { compare: compare as Compare })),
        pick(ctx, 'board:grouped', 'Group by project', [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], grouped ? 'yes' : 'no', (value) => setGrouped(value === 'yes')),
      ],
      { title: d.name },
    ),
    col([
    ctx.draw.button('board:copy', 'Copy as Markdown', () => ctx.effect({ copy: dashboardMarkdown(d, (t) => tileWords(s, d, t)), toast: `Copied ${d.name} as Markdown` }), { plain: true, hotkey: 'e', spans: marked('Copy as Markdown') }),
    naming
      ? ctx.draw.input(
          'board:new-name',
          async (value) => {
            setNaming(false);
            const name = value?.trim();
            if (!name) return;
            const made = (await ctx.call('dashboard.create', name)) as Dashboard | undefined;
            if (made?.id) {
              leave(ctx, (route) => route.name === 'board-more');
              ctx.go(boardRoute(made.id));
            }
          },
          { label: 'Name', placeholder: 'A new board', submitLabel: 'make it', autoFocus: true },
        )
      : ctx.draw.button('board:new', 'New Board', () => setNaming(true), { plain: true, hotkey: 'n', spans: marked('New Board', '+') }),
    ctx.draw.button('board:delete', 'Delete Board...', () => ctx.go(askRoute('board', { board: d.id })), { plain: true, hotkey: 'x', spans: [span('› ', { dim: true }), span('Delete Board...', { color: 'error' })] }),
    ]),
  );
}

/** A spot on the Mac's grid, in words. */
const spotWords = (at: { readonly col: number; readonly row: number }): string => `Row ${at.row + 1}, column ${at.col + 1} of ${GRID_COLUMNS}`;

/** A tile in full: what it shows, Move in place of a drag, and where it comes from. */
export function tilePage(ctx: Ctx, d: Dashboard, tile: Tile): Node {
  const s = ctx.state.sentinel;
  const places = layoutTiles(d.tiles);
  const at = places.get(tile.id);
  // The row under every other tile: it may go there, and one below, as a drag may.
  const bottom = Math.max(0, ...[...places.entries()].flatMap(([id, p]) => (id === tile.id ? [] : [p.row + p.h])));
  const cap = tileCaption(s, tile);
  const move = (col: number, row: number) => () => ctx.call('dashboard.moveTile', d.id, tile.id, { col, row });
  const metric = tile.metric ?? tile.metrics?.[0];
  const m = metricOf(s, metric);
  const output = tileOutput(s, tile);
  const state = tileStateIn(s, tile);
  const sentinelId = tileSentinelOf(tile);
  const draft = state === 'draft' && sentinelId;
  return page(
    top(ctx, 'dashboards'),
    back(ctx, d.name),
    card(
      [
        cap.from ? dim(cap.from) : undefined,
        tileBody(ctx, d, tile, { full: true }),
        draft ? actions(ctx.draw.button('tile:turn-on', 'Turn On', () => ctx.call('sentinel.pause', sentinelId, false), { primary: true, hotkey: 'p' })) : undefined,
      ],
      { title: cap.title || 'Divider', ...(draft ? { tone: 'warn' as const } : {}) },
    ),
    at &&
      card(
        [
          dim(spotWords(at)),
          row([
            at.row > 0 && ctx.draw.button('tile:up', 'Move Up', move(at.col, at.row - 1), { plain: true, hotkey: 'u', spans: [span('↑ ', { dim: true }), span('Move Up')] }),
            at.row <= bottom && ctx.draw.button('tile:down', 'Move Down', move(at.col, at.row + 1), { plain: true, hotkey: 'j', spans: [span('↓ ', { dim: true }), span('Move Down')] }),
            tile.kind !== 'divider' && at.col > 0 && ctx.draw.button('tile:left', 'Move Left', move(at.col - 1, at.row), { plain: true, hotkey: 'h', spans: [span('‹ ', { dim: true }), span('Move Left')] }),
            tile.kind !== 'divider' && at.col + at.w < GRID_COLUMNS && ctx.draw.button('tile:right', 'Move Right', move(at.col + 1, at.row), { plain: true, hotkey: 'i', spans: [span('› ', { dim: true }), span('Move Right')] }),
          ], { gap: 2 }),
        ],
        { title: 'Its place' },
      ),
    row([
      m && metric && m.kind !== 'rows' && ctx.draw.button('tile:read', 'Over Time', () => ctx.go({ name: 'metric', params: { id: metric.sentinelId, name: metric.metric } }), { plain: true, hotkey: 'e' }),
      m && metric && m.kind === 'rows' && ctx.draw.button('tile:rows', 'Its Rows', () => ctx.go({ name: 'rows', params: { id: metric.sentinelId, name: metric.metric } }), { plain: true, hotkey: 'e' }),
      output?.runId && sentinelId ? ctx.draw.button('tile:run', 'Open the Run', () => openRun(ctx, { id: output.runId, sentinelId }), { plain: true, hotkey: 'f' }) : undefined,
      ctx.draw.button('tile:more', 'More', () => ctx.go({ name: 'tile-more', params: { board: d.id, tile: tile.id } }), { plain: true, dim: true, hotkey: 'm' }),
    ]),
  );
}

const SHOW_WORDS: Readonly<Record<OutputShow, string>> = { auto: 'As it reads', markdown: 'Markdown', tree: 'A JSON tree', table: 'A table', text: 'Plain text' };

/** A tile's own say: its title, size, what it compares with, how it draws; and taking it off the board. */
export function tileMorePage(ctx: Ctx, d: Dashboard, tile: Tile): Node {
  const s = ctx.state.sentinel;
  const update = (patch: Record<string, unknown>): Promise<unknown> => ctx.call('dashboard.updateTile', d.id, tile.id, patch);
  const cap = tileCaption(s, tile);
  const sentinelId = tileSentinelOf(tile);
  return page(
    top(ctx, 'dashboards'),
    back(ctx, cap.title || 'Tile'),
    card([
    field(ctx, 'tile:title', 'Title', tile.title ?? '', (value) => update({ title: value.trim() }), { placeholder: cap.title }),
    tile.kind !== 'divider' && pick(ctx, 'tile:width', 'Width', TILE_WIDTHS.map((w) => ({ value: String(w), label: WIDTH_WORDS[w] })), String(tile.width), (w) => update({ width: Number(w) as TileWidth })),
    tile.kind !== 'divider' && pick(ctx, 'tile:height', 'Height', [{ value: '1', label: 'Normal' }, { value: '2', label: 'Tall' }], String(tile.height ?? 1), (h) => update({ height: Number(h) })),
    (tile.kind === 'number' || tile.kind === 'series') && pick(ctx, 'tile:compare', 'Compare', [{ value: '', label: `As the board (${COMPARE_WORDS[d.compare]})` }, ...COMPARE.map((c) => ({ value: c, label: `Pin: ${COMPARE_LABEL[c]}` }))], tile.compare ?? '', (c) => update({ compare: c || null })),
    tile.kind === 'series' && pick(ctx, 'tile:chart', 'Draw as', CHART_TILE_KINDS.map((k) => ({ value: k, label: k === 'line' ? 'Lines' : k === 'area' ? 'Areas' : 'Bars' })), tile.chart ?? 'line', (chart) => update({ chart })),
    tile.kind === 'output' && pick(ctx, 'tile:show', 'Show as', OUTPUT_SHOWS.map((k) => ({ value: k, label: SHOW_WORDS[k] })), tile.show ?? 'auto', (show) => update({ show })),
    tile.kind === 'text' && pick(ctx, 'tile:text', 'Shows', [{ value: 'headline', label: 'Its last headline' }, { value: 'report', label: 'Its last report' }], tile.text ?? 'headline', (value) => update({ text: value })),
    ], { title: cap.title || 'Divider' }),
    col([
    sentinelId && cap.state !== 'gone' ? ctx.draw.button('tile:sentinel', 'Open Its Sentinel', () => openSentinel(ctx, sentinelId), { plain: true, hotkey: 'e', spans: marked('Open Its Sentinel') }) : undefined,
    ctx.draw.button('tile:remove', 'Remove Tile...', () => ctx.go(askRoute('tile', { board: d.id, tile: tile.id })), { plain: true, hotkey: 'x', spans: [span('› ', { dim: true }), span('Remove Tile...', { color: 'error' })] }),
    ]),
  );
}

// ---------------------------------------------------------------- adding

/** Off the pages of adding, back to the board. */
const off = (ctx: Ctx): void => leave(ctx, (route) => route.name === 'add' || route.name === 'add-new' || route.name === 'add-pick');

/** Add to the board: one box to say what you want to see; or pick what's kept, somewhere new, or a heading. */
export function addPage(ctx: Ctx, d: Dashboard): Node {
  const s = ctx.state.sentinel;
  const projectName = (id: string | undefined): string => ctx.state.projects.find((p) => p.id === id)?.name ?? ASSISTANT_TITLE;
  const metrics = metricChoices(s, projectName, d);
  const steps = outputStepChoices(s, projectName);
  type Row = { readonly key: string; readonly label: string; readonly hint: string; readonly go: Route['params'] };
  const kept: Row[] = [
    ...metrics.map((c): Row => ({ key: `metric:${c.sentinelId}:${c.name}`, label: c.label, hint: [c.project, c.sentinel, c.value, c.onIt ? 'on this board' : undefined].filter(Boolean).join(' · '), go: { kind: 'metric', sentinel: c.sentinelId, metric: c.name } })),
    ...steps.map((c): Row => ({ key: `step:${c.sentinelId}:${c.stepId}`, label: c.label, hint: [c.project, c.sentinel, c.hint].join(' · '), go: { kind: 'step', sentinel: c.sentinelId, step: c.stepId } })),
    ...s.items.map((i): Row => ({ key: `report:${i.id}`, label: i.name, hint: `${projectName(i.projectId)} · its latest report`, go: { kind: 'report', sentinel: i.id } })),
  ];
  const shown = windowed(ctx, `add:${d.id}`, kept);
  return page(
    top(ctx, 'dashboards'),
    back(ctx, d.name),
    card(
      [
        ctx.draw.input(
          'add:words',
          async (value) => {
            const words = value?.trim();
            if (!words) return;
            await ctx.call('dashboard.ask', d.id, words);
            off(ctx);
            ctx.effect({ toast: 'Your agent is putting it together' });
          },
          { placeholder: 'Say what you want to see, or pick it below: “revenue per day”, “open pull requests”', rows: 2, submitLabel: 'ask your agent', autoFocus: true },
        ),
        dim('Your agent puts it together from what your sentinels keep. When nothing fetches it yet, it sets up a sentinel that does: a draft you look over and turn on first.'),
      ],
      { title: `Add to ${d.name}`, tone: 'accent' },
    ),
    section(
      'Already kept',
      [
        kept.length === 0 && dim('Nothing is kept yet. Pick somewhere new, or say what you want above.'),
        shown.before,
        ...shown.shown.map((c) =>
          ctx.draw.button(`pick:${c.key}`, c.label, () => ctx.go({ name: 'add-pick', params: { board: d.id, ...c.go } }), { plain: true, spans: [span('› ', { dim: true }), span(c.label), span(`  ${c.hint}`, { dim: true })] }),
        ),
        shown.after,
      ],
      kept.length,
    ),
    section(
      'From somewhere new',
      NEW_SOURCES.map((src) => ctx.draw.button(`new:${src.id}`, src.label, () => ctx.go({ name: 'add-new', params: { board: d.id, source: src.id } }), { plain: true, spans: [span('+ ', { dim: true }), span(src.label), span(`  ${src.hint}`, { dim: true })] })),
    ),
    section('Other', [ctx.draw.button('heading', 'A Heading Across the Board', () => ctx.go({ name: 'add-pick', params: { board: d.id, kind: 'heading' } }), { plain: true, spans: [span('+ ', { dim: true }), span('A Heading Across the Board')] })]),
  );
}

/** Somewhere new: say what from it, and your agent sets up the sentinel that fetches it (paused), and adds its tile. */
export function addNewPage(ctx: Ctx, d: Dashboard, sourceId: string): Node {
  const source = NEW_SOURCES.find((x) => x.id === sourceId);
  if (!source) return page(top(ctx, 'dashboards'), back(ctx), empty('That is no longer there.'));
  const send = async (words: string): Promise<void> => {
    if (!words.trim()) return;
    await ctx.call('dashboard.ask', d.id, newSourceAsk(source.id as NewSourceId, words));
    off(ctx);
    ctx.effect({ toast: 'Your agent is putting it together' });
  };
  return page(
    top(ctx, 'dashboards'),
    back(ctx, `Add to ${d.name}`),
    card(
      [
        ctx.draw.input('add:what', (value) => send(value ?? ''), { placeholder: source.ideas[0], submitLabel: 'ask your agent', autoFocus: true }),
        dim('Your agent sets up the sentinel that fetches it (paused, for you to turn on) with your project’s own keys, and adds its tile here.'),
      ],
      { title: `What from ${source.label}?` },
    ),
    section('Ideas', source.ideas.map((idea, i) => ctx.draw.button(`idea:${i}`, idea, () => send(idea), { plain: true, spans: marked(idea) }))),
  );
}

/** How a picked thing shows: its look, its size, its title. */
export function addPickPage(ctx: Ctx, d: Dashboard, p: Readonly<Record<string, string>>): Node {
  const s = ctx.state.sentinel;
  const kind = p.kind;
  const ref: MetricRef | undefined = kind === 'metric' && p.sentinel && p.metric ? { sentinelId: p.sentinel, metric: p.metric } : undefined;
  const stepRef: StepRef | undefined = kind === 'step' && p.sentinel && p.step ? { sentinelId: p.sentinel, stepId: p.step } : undefined;
  const metric = metricOf(s, ref);
  const metricKind: MetricKind = metric?.kind ?? 'number';
  const looks: readonly TileLook[] = kind === 'metric' ? looksFor(metricKind) : kind === 'heading' ? [] : ['text'];
  const key = `sn:add:${JSON.stringify(p)}`;
  const [lookPicked, setLook] = ctx.local<TileLook | undefined>(`${key}:look`, undefined);
  const look: TileLook = lookPicked && looks.includes(lookPicked) ? lookPicked : (looks[0] ?? 'text');
  const [sizePicked, setSize] = ctx.local<TileSizeId | undefined>(`${key}:size`, undefined);
  const size = TILE_SIZES.find((t) => t.id === (sizePicked ?? sizeFor(look))) ?? TILE_SIZES[0];
  const own = { width: size.w, ...(size.h === 2 ? { height: 2 } : {}) };
  const tileOf = (name: string): Record<string, unknown> | undefined => {
    const titled = { ...own, ...(name ? { title: name } : {}) };
    if (kind === 'heading') return name ? { kind: 'divider', title: name } : undefined;
    if (kind === 'report' && p.sentinel) return { kind: 'text', sentinelId: p.sentinel, text: 'report', ...titled };
    if (stepRef) return { kind: 'output', step: stepRef, ...titled };
    if (!ref) return undefined;
    if (look === 'number') return { kind: 'number', metric: ref, ...titled };
    if (look === 'table') return { kind: 'table', metric: ref, ...titled };
    if (look === 'text') return { kind: 'output', metric: ref, ...titled };
    return { kind: 'series', ...(metric?.kind === 'series' ? { metric: ref } : { metrics: [ref] }), chart: look === 'bars' ? 'bar' : 'line', ...titled };
  };
  const add = async (name: string): Promise<void> => {
    const tile = tileOf(name.trim());
    if (!tile) return;
    await ctx.call('dashboard.addTile', d.id, tile);
    off(ctx);
  };
  const placeholder = kind === 'heading' ? 'Money' : (metric?.label ?? '');
  return page(
    top(ctx, 'dashboards'),
    back(ctx, `Add to ${d.name}`),
    card(
      [
        looks.length > 1 && pick(ctx, 'add:look', 'Show it as', looks.map((l) => ({ value: l, label: LOOK_WORDS[l] })), look, (l) => setLook(l as TileLook)),
        kind !== 'heading' && pick(ctx, 'add:size', 'Size', TILE_SIZES.map((t) => ({ value: t.id, label: t.label })), size.id, (id) => setSize(id as TileSizeId)),
        ctx.draw.input('add:title', (value) => add(value ?? ''), { label: kind === 'heading' ? 'Heading' : 'Title', placeholder, submitLabel: 'add', autoFocus: true }),
        kind !== 'heading' && actions(ctx.draw.button('add:yes', `Add to ${d.name}`, () => add(''), { primary: true, hotkey: 'y' })),
      ],
      { title: kind === 'heading' ? 'A heading across the board' : (metric?.label ?? (stepRef ? s.items.find((i) => i.id === stepRef.sentinelId)?.steps.find((x) => x.id === stepRef.stepId)?.name : s.items.find((i) => i.id === p.sentinel)?.name) ?? 'A tile') },
    ),
    dim(kind === 'heading' ? 'Press Enter to add it.' : 'Move it into place afterwards, from the tile.'),
  );
}
