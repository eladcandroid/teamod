import { type Dashboard, type Tile, metricOf, outputLook, outputRows, tileCompare, tileMetrics, tileOutput, tileStateIn } from '../../core/sentinel/dashboard-model.js';
import { formatMetric } from '../../core/sentinel/metrics.js';
import { type RunDetail, firstLine } from '../../core/sentinel/model.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, span, text } from '../tree.js';
import { ago, peerText } from './common.js';
import { numberWords, outputTable, prettyJson, rowsTable, sparkline, tileNote, toneStyle } from './sentinel-model.js';

export interface TileBodyOptions {
  /** The tile's own page: all it has to say, not a board's short version. */
  readonly full?: boolean;
}

const firstLines = (words: string, most: number): { readonly words: string; readonly cut: boolean } => {
  const lines = words.split('\n');
  return lines.length > most ? { words: lines.slice(0, most).join('\n'), cut: true } : { words, cut: false };
};

/**
 * What a tile shows, as words and a small line of unicode blocks. All of a tile's drawing is here, so
 * rich charts can take this one function's place: a number with its change and its points, a series
 * as its points, a table's first rows, a step's latest output, a sentinel's last line or report. A
 * tile that can't draw says why quietly (paused, gone, a draft, waiting for its first run).
 */
export function tileBody(ctx: Ctx, d: Dashboard, tile: Tile, opts: TileBodyOptions = {}): Node {
  const s = ctx.state.sentinel;
  const state = tileStateIn(s, tile);
  const note = tileNote(state);
  const spark = Math.max(8, Math.min(48, ctx.columns - 12));
  if (tile.kind === 'divider') return col([]);
  if (state === 'gone') return dim('gone');
  if (tile.kind === 'number') {
    const m = metricOf(s, tile.metric);
    if (!m) return dim(note ?? 'gone');
    const w = numberWords(m, tileCompare(d, tile));
    const points = sparkline(w.trend, spark);
    return col([
      line(span(w.value, { weight: 'semibold' }), w.unit ? span(` ${w.unit}`, { dim: true }) : undefined, w.change ? span(`  ${w.change}`, toneStyle(w.tone)) : undefined, span(`  ${w.vs}`, { dim: true }), note ? span(`  ${note}`, { dim: true }) : undefined),
      points ? dim(points) : undefined,
    ]);
  }
  if (tile.kind === 'series') {
    const ms = tileMetrics(s, tile);
    if (!ms.length) return dim(note ?? 'gone');
    const first = ms[0]!;
    // A kept array draws its latest points; numbers draw their points over time.
    if (first.kind === 'series') {
      const points = first.series ?? [];
      const a = points[0];
      const z = points.at(-1);
      return col([
        points.length > 1 ? dim(sparkline(points.map((p) => p.y), spark)) : undefined,
        a && z ? dim(`${a.x}  to  ${z.x}, last ${formatMetric(z.y, first.unit)}`) : dim(note ?? 'No points yet.'),
        ...(opts.full ? points.slice(0, 60).map((p) => line(span(`${p.x}  `, { dim: true }), span(formatMetric(p.y, first.unit)))) : []),
        opts.full && points.length > 60 ? dim(`and ${points.length - 60} more`) : undefined,
      ]);
    }
    return col(
      ms.map((m) => {
        const last = m.points.at(-1);
        const points = sparkline(m.points.map((p) => p.value), spark);
        return line(ms.length > 1 ? span(`${m.label}  `) : undefined, span(last ? formatMetric(last.value, m.unit) : '—', { weight: 'semibold' }), points ? span(`  ${points}`, { dim: true }) : undefined);
      }),
    );
  }
  if (tile.kind === 'table') {
    const m = metricOf(s, tile.metric);
    if (!m?.rows) return dim(note ?? 'gone');
    const limit = opts.full ? 40 : tile.height === 2 ? 14 : 6;
    const table = rowsTable(m, { limit, most: Math.max(2, Math.floor(ctx.columns / 16)), own: tile.columns });
    return col([table ? md(table) : undefined, dim(`${m.rows.length} ${m.rows.length === 1 ? 'row' : 'rows'}${m.rowsAt ? ` · ${ago(m.rowsAt)}` : ''}${note ? ` · ${note}` : ''}`)]);
  }
  if (tile.kind === 'output') {
    const o = tileOutput(s, tile);
    if (!o) return dim(note ?? 'No output yet: it shows after its step runs');
    const look = outputLook(o, tile.show);
    const most = opts.full ? 400 : tile.height === 2 ? 16 : 8;
    let body: Node;
    if (look === 'table') {
      let rows: Array<Record<string, unknown>> | undefined;
      try {
        rows = outputRows(JSON.parse(o.text));
      } catch {
        rows = undefined;
      }
      const table = rows ? outputTable(rows) : undefined;
      body = table ? md(rowsTable(table, { limit: opts.full ? 40 : 6, most: Math.max(2, Math.floor(ctx.columns / 16)) })) : code(firstLines(o.text, most).words);
    } else if (look === 'tree') {
      body = code(firstLines(prettyJson(o.text), most).words, { language: 'json' });
    } else if (look === 'markdown') {
      body = md(peerText(firstLines(o.text, most).words));
    } else {
      body = code(firstLines(o.text, most).words);
    }
    const shortened = o.cut ? 'shortened: the run has all of it' : !opts.full && firstLines(o.text, most).cut ? 'open it for the rest' : undefined;
    return col([body, dim([o.at ? ago(o.at) : undefined, shortened, note].filter(Boolean).join(' · '))]);
  }
  // A sentinel's last line, or its last report.
  const last = [...s.runs].reverse().find((r) => r.sentinelId === tile.sentinelId && r.endedAt);
  if (state === 'draft') return dim('A draft: it runs once you turn it on');
  if (!last) return dim(note ?? 'No runs yet');
  const report = tile.text === 'report' ? ctx.load<RunDetail | undefined>(`sentinel:report:${last.id}`, async () => (await ctx.call('sentinel.runGet', last.id)) as RunDetail | undefined) : undefined;
  const said = report?.value?.report;
  return col([
    said ? md(peerText(firstLines(said, opts.full ? 400 : 12).words)) : text(firstLine(last.headline || 'It ran', 400)),
    report?.error ? text(report.error, { color: 'error' }) : undefined,
    dim(`${ago(last.endedAt ?? last.startedAt)}${note ? ` · ${note}` : ''}`),
  ]);
}
