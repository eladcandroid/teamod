import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { texToSvg } from '../../companion/math-svg.js';
import { sanitizeSvg } from '../../image/decode.js';
import { isGraphFence, parseGraph, type Graph } from '../../shared/graph-spec.js';
import { formatCell, headingOf } from '../../shared/render/format.js';
import { planCalendar, planGantt, planHeatmap } from '../../shared/render/grid-model.js';
import { richFence } from '../../shared/render/rich-fence.js';
import { TASKS_FENCE, readTaskKeys } from '../../shared/task-refs.js';
import { type Column, parseView, type Row, type View, type ViewFetchResult, viewFenceType } from '../../shared/view-spec.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, span, text, title } from '../tree.js';
import { graphSvg } from './graph-svg.js';
import { calendarSvg, chartSvg, ganttSvg, heatmapSvg } from './svg.js';

export type Segment = { readonly kind: 'md'; readonly text: string } | { readonly kind: 'fence'; readonly lang: string; readonly body: string };

/**
 * An answer's text, split at its code fences. A fence not closed yet (the answer is still coming)
 * stays words, so a half-written block is never parsed.
 */
export function splitAnswer(text: string): Segment[] {
  const out: Segment[] = [];
  const open = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\n`]*)$/gm;
  let at = 0;
  let found: RegExpExecArray | null;
  while ((found = open.exec(text))) {
    const fence = found[2]!;
    const closer = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`, 'm');
    const rest = text.slice(found.index + found[0].length + 1);
    const close = closer.exec(rest);
    if (!close) break;
    if (found.index > at) out.push({ kind: 'md', text: text.slice(at, found.index) });
    const lang = (found[3] ?? '').trim().split(/\s+/)[0] ?? '';
    out.push({ kind: 'fence', lang, body: rest.slice(0, close.index).replace(/\n$/, '') });
    at = found.index + found[0].length + 1 + close.index + close[0].length;
    open.lastIndex = at;
  }
  if (at < text.length) out.push({ kind: 'md', text: text.slice(at) });
  return out.filter((s) => s.kind !== 'md' || s.text.trim());
}

const RICH = /^(teamod-|teamod-|mermaid$|json$|math$|latex$|tex$|console$|terminal$|shell-session$|tree$)/i;

/** Whether an answer holds anything beyond what Markdown draws by itself. */
export const hasRich = (text: string): boolean => splitAnswer(text).some((s) => s.kind === 'fence' && RICH.test(s.lang));

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Pictures already made: a screen draws many times, and a picture doesn't change. */
const PICTURES = new Map<string, { readonly png: string; readonly aspect: number }>();
const MAX_PICTURES = 64;

function pngOf(svg: string): { readonly png: string; readonly aspect: number } {
  const key = hash(svg);
  const found = PICTURES.get(key);
  if (found) return found;
  const drawn = new Resvg(sanitizeSvg(svg), { fitTo: { mode: 'width', value: 1400 }, font: { loadSystemFonts: true } }).render();
  const made = { png: Buffer.from(drawn.asPng()).toString('base64'), aspect: drawn.height / drawn.width };
  PICTURES.set(key, made);
  if (PICTURES.size > MAX_PICTURES) PICTURES.delete(PICTURES.keys().next().value!);
  return made;
}

/** A drawing for this surface: an SVG where it draws them, a picture where it doesn't. */
export function picture(ctx: Pick<Ctx, 'surface' | 'columns'>, svg: string, alt: string): Node {
  if (ctx.surface === 'terminal') {
    const { png, aspect } = pngOf(svg);
    const columns = Math.min(200, Math.max(20, ctx.columns - 2));
    // A cell is about twice as tall as it's wide.
    const rows = Math.max(4, Math.min(60, Math.round(aspect * columns * 0.5)));
    return { k: 'image', key: `pic:${hash(svg)}`, png, columns, rows, alt };
  }
  return { k: 'svg', source: svg, alt, ...(ctx.surface === 'desktop' ? { interactive: true } : {}) };
}

const cellText = (c: Row[string] | undefined, column: Column): string => formatCell(c ?? null, column);

/** Rows as a Markdown table: every surface draws that, and it copies as text. */
function tableNode(columns: readonly Column[], rows: readonly Row[]): Node {
  const shown = columns.filter((c) => !c.hidden).slice(0, 10);
  const head = `| ${shown.map((c) => headingOf(c).replace(/\|/g, '\\|')).join(' | ')} |`;
  const rule = `| ${shown.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${shown.map((c) => cellText(r[c.key], c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
  return md([head, rule, ...body].join('\n'));
}

/** The rows of a view: its own, or a page from its source, which only runs once you say. */
function rowsOf(ctx: Ctx, view: View, key: string): { readonly rows: readonly Row[]; readonly note?: Node; readonly text?: string } {
  if (!view.source) return { rows: view.rows, ...(view.text !== undefined ? { text: view.text } : {}) };
  const [confirmed, setConfirmed] = ctx.local(`view:${key}:confirmed`, false);
  const loaded = ctx.load(
    `view:${key}:${confirmed}`,
    async () => (await ctx.call('view.fetch', view.source, { offset: 0, limit: Math.min(500, view.pageSize) }, confirmed ? { confirm: true } : {})) as ViewFetchResult,
    { ttlMs: view.source.refresh ? view.source.refresh * 1000 : 60_000 },
  );
  if (loaded.error) return { rows: view.rows, note: text(loaded.error, { color: 'error' }) };
  const page = loaded.value;
  if (!page) return { rows: view.rows, note: dim('Loading...') };
  if ('needsApproval' in page) {
    return {
      rows: view.rows,
      note: col([dim(`This view wants to run: ${page.what}`), ctx.draw.button(`view-run:${key}`, 'Run It', () => setConfirmed(true), {})]),
    };
  }
  if ('notKept' in page) return { rows: view.rows };
  return { rows: page.rows, ...(page.text !== undefined ? { text: page.text } : {}) };
}

function statsNode(view: View): Node {
  return col(view.items.map((item) => line(span(`${item.label}: `, { dim: true }), span(String(item.value ?? ''), { weight: 'semibold', ...(item.status === 'good' ? { color: 'success' } : item.status === 'critical' || item.status === 'serious' ? { color: 'error' } : item.status === 'warning' ? { color: 'warning' } : {}) }), item.hint ? span(`  ${item.hint}`, { dim: true }) : undefined)));
}

/** A view block, drawn for this surface. */
function viewNode(ctx: Ctx, view: View, key: string): Node {
  const { rows, note, text: fetched } = rowsOf(ctx, view, key);
  const named = view.title ? title(view.title) : undefined;
  const summary = view.summary ? dim(view.summary) : undefined;
  const altOf = (what: string): string => `${view.title ?? what}: ${rows.length} rows${view.summary ? `. ${view.summary}` : ''}`;
  const body = ((): Node | undefined => {
    try {
      switch (view.type) {
        case 'table':
          return rows.length ? tableNode(view.columns, rows.slice(0, 100)) : dim('No rows.');
        case 'chart':
          return rows.length ? col([picture(ctx, chartSvg(view, view.columns, rows), altOf('Chart')), ctx.surface === 'terminal' && rows.length <= 12 ? tableNode(view.columns, rows) : undefined]) : dim('Nothing to draw.');
        case 'stats':
          return statsNode(view);
        case 'code':
          return code(fetched ?? view.text ?? '', { ...(view.language ? { language: view.language } : {}), ...(view.filename ? { path: view.filename } : {}), startLine: view.startLine });
        case 'colors':
          return col(view.swatches.map((s) => line(span('■ ', { color: s.value }), s.value, s.name ? span(`  ${s.name}`, { dim: true }) : undefined)));
        case 'gantt': {
          const plan = planGantt(view, rows, view.columns);
          return plan ? picture(ctx, ganttSvg(plan), altOf('Gantt')) : dim('Nothing to draw.');
        }
        case 'heatmap': {
          const plan = planHeatmap(view, rows, view.columns);
          return plan ? picture(ctx, heatmapSvg(view, plan), altOf('Heatmap')) : dim('Nothing to draw.');
        }
        case 'calendar': {
          const plan = planCalendar(view, rows, view.columns);
          return plan ? picture(ctx, calendarSvg(view, plan), altOf('Calendar')) : dim('Nothing to draw.');
        }
      }
    } catch (err) {
      return text(`This view could not be drawn: ${err instanceof Error ? err.message : String(err)}`, { color: 'error' });
    }
  })();
  return col([named, summary, note, body]);
}

/** A graph: its drawing, then what a Mac shows on a click, in words. */
function graphNode(ctx: Ctx, graph: Graph, key: string): Node {
  const loaded = ctx.load(`graph:${key}:${ctx.columns}`, () => graphSvg(graph));
  const [open, setOpen] = ctx.local(`graph:${key}:open`, false);
  const alt = `${graph.title ?? 'Graph'}: ${graph.nodes.length} nodes, ${graph.edges.length} lines. ${graph.edges
    .slice(0, 12)
    .map((e) => `${e.from} → ${e.to}`)
    .join(', ')}`;
  const detailed = graph.nodes.filter((n) => n.details || n.sublabel);
  return col([
    graph.title ? title(graph.title) : undefined,
    graph.summary ? dim(graph.summary) : undefined,
    loaded.error ? text(loaded.error, { color: 'error' }) : loaded.value ? picture(ctx, loaded.value, alt) : dim('Laying it out...'),
    detailed.length > 0 || graph.steps.length > 0 ? ctx.draw.button(`graph:${key}:more`, open ? 'Less' : 'Details', () => setOpen(!open), { plain: true, dim: true }) : undefined,
    ...(open
      ? [
          ...graph.steps.map((s, i) => line(span(`${i + 1}. ${s.title}`, { weight: 'semibold' }), s.text ? span(`  ${s.text}`) : undefined)),
          ...detailed.map((n) => line(span(n.label, { weight: 'semibold' }), span(`  ${n.details ?? n.sublabel}`))),
        ]
      : []),
  ]);
}

/** Live cards for the tasks an answer names: the board says what they are, not the answer. */
function tasksNode(ctx: Ctx, body: string): Node {
  const keys = readTaskKeys(body);
  const issues = ctx.state.board.issues;
  return col(
    keys.map((key) => {
      const issue = issues.find((t) => t.key.toUpperCase() === key);
      if (!issue) return dim(`${key}: not on this board.`);
      return ctx.draw.button(`task-card:${key}`, key, () => ctx.show('board', { name: 'task', params: { id: issue.id } }), { plain: true, spans: [span(`${key} `, { dim: true }), span(issue.title), span(`  ${issue.status}`, { dim: true })] });
    }),
  );
}

function fenceNode(ctx: Ctx, lang: string, body: string, peer: boolean): Node {
  const lower = lang.toLowerCase();
  const key = hash(`${lang}\n${body}`);
  const viewType = viewFenceType(lower);
  if (viewType) {
    const parsed = parseView(body, viewType === 'any' ? undefined : viewType);
    if (!parsed.ok) return code(body, { language: 'json' });
    // Someone else's answer doesn't run a source here: its rows only.
    return viewNode(ctx, peer ? { ...parsed.view, source: undefined } as View : parsed.view, key);
  }
  if (isGraphFence(lower)) {
    const parsed = parseGraph(body);
    return parsed.ok ? graphNode(ctx, parsed.graph, key) : code(body, { language: 'json' });
  }
  if (lower === TASKS_FENCE) return tasksNode(ctx, body);
  const rich = richFence(lower, body);
  if (rich?.kind === 'mermaid') {
    if (rich.block.kind === 'graph') {
      const parsed = parseGraph(rich.block.text);
      if (parsed.ok) return graphNode(ctx, parsed.graph, key);
    } else {
      const parsed = parseView(rich.block.text);
      if (parsed.ok) return viewNode(ctx, parsed.view, key);
    }
    return code(body, { language: 'mermaid' });
  }
  if (rich?.kind === 'math') {
    const svg = texToSvg(rich.tex, true);
    return svg ? picture(ctx, svg.svg, rich.tex) : code(rich.tex, { language: 'latex' });
  }
  return code(body, lang ? { language: lang } : {});
}

/**
 * An answer as a pane draws it: words as Markdown, and the blocks an agent uses to show things as
 * what they are. `peer`: the answer came from someone else's computer, so nothing in it may run.
 */
export function richNodes(ctx: Ctx, answer: string, opts: { readonly peer?: boolean } = {}): Node[] {
  return splitAnswer(answer).map((segment) => (segment.kind === 'md' ? md(segment.text) : fenceNode(ctx, segment.lang, segment.body, opts.peer === true)));
}
