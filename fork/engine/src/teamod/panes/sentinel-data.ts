import { type DocumentRead, type MetricColumn, documentLook, kindWords, sizeWords } from '../../core/sentinel/columns.js';
import { type MetricLine, formatMetric } from '../../core/sentinel/metrics.js';
import type { MetricSeries, Sentinel } from '../../core/sentinel/model.js';
import type { SentinelData } from '../../core/sentinel/sentinels.js';
import type { Row } from '../../shared/view-spec.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, row, span, title } from '../tree.js';
import { ago, back, empty, page, peerText } from './common.js';
import { loadNote, openRun, top, webLink, windowed } from './sentinel-common.js';
import { METRIC_KIND_WORDS, cellWords, prettyJson, shownColumns, sparkline, whenText } from './sentinel-model.js';

/** What a sentinel keeps, to look at and take out: its numbers' histories, its tables' rows, its runs' files. */

const loadData = (ctx: Ctx, id: string) => ctx.load<SentinelData | undefined>(`sentinel:data:${id}`, async () => (await ctx.call('sentinel.dataList', id)) as SentinelData | undefined, { ttlMs: 15_000 });
const loadMetric = (ctx: Ctx, id: string, name: string) => ctx.load<{ readonly metric: MetricSeries; readonly lines: readonly MetricLine[] } | undefined>(`sentinel:metric:${id}:${name}`, async () => (await ctx.call('sentinel.metricRead', id, name)) as { readonly metric: MetricSeries; readonly lines: readonly MetricLine[] } | undefined, { ttlMs: 15_000 });

const exportMetric = (ctx: Ctx, id: string, name: string, format: 'csv' | 'json') => async (): Promise<void> => {
  await ctx.call('sentinel.dataExport', id, { metric: name, format });
  ctx.effect({ toast: 'Saved in Downloads › teamod' });
};

/** Everything it keeps: each number with how much, each run that kept files. */
export function dataPage(ctx: Ctx, s: Sentinel): Node {
  const loaded = loadData(ctx, s.id);
  const data = loaded.value;
  const now = Date.now();
  const metrics = windowed(ctx, `data:metrics:${s.id}`, data?.metrics ?? []);
  const runs = windowed(ctx, `data:runs:${s.id}`, data?.runs ?? [], { page: 20 });
  const nothing = data && !data.metrics.length && !data.runs.length;
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    col([title('Kept data'), data ? dim(`Files are kept ${data.keepsDays} days.`) : undefined]),
    loadNote(loaded, 'Reading what it keeps...'),
    nothing && empty('It keeps nothing yet.'),
    metrics.before,
    ...metrics.shown.map((m) =>
      ctx.draw.button(`data:metric:${m.name}`, m.label, () => ctx.go(m.kind === 'rows' ? { name: 'rows', params: { id: s.id, name: m.name } } : { name: 'metric', params: { id: s.id, name: m.name } }), {
        plain: true,
        spans: [span(m.label), span(`  ${METRIC_KIND_WORDS[m.kind]}  ${m.kind === 'rows' ? `${(m.rows ?? 0).toLocaleString()} rows over ${m.lines.toLocaleString()} ${m.lines === 1 ? 'run' : 'runs'}` : `${m.lines.toLocaleString()} ${m.lines === 1 ? 'run' : 'runs'}`}${m.first ? ` · since ${ago(m.first)}` : ''}`, { dim: true })],
      }),
    ),
    metrics.after,
    data && data.metrics.length > 0 && ctx.draw.button('data:reveal', 'Show Its Numbers in Finder', () => ctx.call('sentinel.dataReveal', s.id), { plain: true, dim: true, hotkey: 'f' }),
    data && data.runs.length > 0 && title('Files from its runs'),
    runs.before,
    ...runs.shown.map((r) =>
      ctx.draw.button(`data:run:${r.runId}`, r.headline || 'A run', () => ctx.go({ name: 'files', params: { id: s.id, run: r.runId } }), {
        plain: true,
        spans: [span(`${whenText(r.at, now)}  `, { dim: true }), span(`${r.files.length} ${r.files.length === 1 ? 'file' : 'files'}`), span(r.headline ? `  ${r.headline}` : '', { dim: true })],
      }),
    ),
    runs.after,
  );
}

/** One run's files, each opens here; and taking them out. */
export function filesPage(ctx: Ctx, s: Sentinel, runId: string): Node {
  const loaded = loadData(ctx, s.id);
  const run = loaded.value?.runs.find((r) => r.runId === runId);
  const files = windowed(ctx, `files:${runId}`, run?.files ?? []);
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title('Its files'), run ? dim(`${whenText(run.at, Date.now())}${run.headline ? ` · ${run.headline}` : ''}`) : undefined]),
    loadNote(loaded, 'Reading its files...'),
    loaded.value && !run && empty('This run kept no files, or they’ve gone.'),
    files.before,
    ...files.shown.map((f) =>
      ctx.draw.button(`file:${f.name}`, f.label, () => ctx.go({ name: 'document', params: { source: 'run', id: s.id, metric: runId, column: '', name: f.name } }), {
        plain: true,
        spans: [span(f.label), span(`  ${sizeWords(f.size)}`, { dim: true })],
      }),
    ),
    files.after,
    run &&
      row([
        ctx.draw.button('files:save', 'Save to Downloads', async () => {
          await ctx.call('sentinel.dataExport', s.id, { runId });
          ctx.effect({ toast: 'Saved in Downloads › teamod' });
        }, { hotkey: 'e' }),
        ctx.draw.button('files:reveal', 'Show in Finder', () => ctx.call('sentinel.dataReveal', s.id, runId), { plain: true, dim: true, hotkey: 'f' }),
        ctx.draw.button('files:run', 'Open the Run', () => openRun(ctx, { id: runId, sentinelId: s.id }), { plain: true, dim: true, hotkey: 'i' }),
      ]),
  );
}

/** A metric's whole history (two years at most), newest first: a number's every run, a list's or output's last ones. */
export function metricPage(ctx: Ctx, s: Sentinel, name: string): Node {
  const loaded = loadMetric(ctx, s.id, name);
  const inState = ctx.state.sentinel.metrics?.[s.id]?.[name];
  const metric = loaded.value?.metric ?? inState;
  // Newest first, each once: a key is drawn from when it was kept and by which run.
  const lines = [...new Map((loaded.value?.lines ?? []).map((l) => [`${l.runId}:${l.at}`, l])).values()].reverse();
  const shown = windowed(ctx, `metric:${s.id}:${name}`, lines, { page: metric?.kind === 'output' ? 5 : 40 });
  const now = Date.now();
  const values = lines.flatMap((l) => (typeof l.value === 'number' ? [l.value] : [])).reverse();
  const spark = sparkline(values, Math.max(8, ctx.columns - 8));
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title(metric?.label ?? name), lines.length > 0 && dim(`${lines.length.toLocaleString()} ${lines.length === 1 ? 'run' : 'runs'}, since ${ago(lines.at(-1)!.at)}. Newest first.`)]),
    loadNote(loaded, 'Reading it...'),
    !loaded.loading && !loaded.error && lines.length === 0 && empty('Nothing kept yet.'),
    spark ? dim(spark) : undefined,
    row([
      ctx.draw.button('metric:csv', 'Export CSV', exportMetric(ctx, s.id, name, 'csv'), { hotkey: 'e' }),
      ctx.draw.button('metric:json', 'Export JSON', exportMetric(ctx, s.id, name, 'json'), { hotkey: 'j' }),
      ctx.draw.button('metric:reveal', 'Show in Finder', () => ctx.call('sentinel.dataReveal', s.id), { plain: true, dim: true, hotkey: 'f' }),
    ]),
    shown.before,
    ...shown.shown.map((l) => metricLine(ctx, s, name, metric, l, now)),
    shown.after,
  );
}

function metricLine(ctx: Ctx, s: Sentinel, name: string, metric: MetricSeries | undefined, l: MetricLine, now: number): Node {
  if (l.output) return col([dim(whenText(l.at, now)), l.output.format === 'markdown' ? md(peerText(l.output.text)) : code(l.output.text)]);
  const key = `metric:line:${l.runId}:${l.at}`;
  if (l.rows) return ctx.draw.button(key, `${l.rows.length} rows`, () => ctx.go({ name: 'rows', params: { id: s.id, name, run: l.runId } }), { plain: true, spans: [span(`${whenText(l.at, now)}  `, { dim: true }), span(`${l.rows.length} rows`)] });
  const words = l.series ? `${l.series.length} points  ${sparkline(l.series.map((p) => p.y), 16)}` : l.value !== undefined ? formatMetric(l.value, metric?.unit ?? 'count') : '';
  return ctx.draw.button(key, words, () => openRun(ctx, { id: l.runId, sentinelId: s.id }), { plain: true, spans: [span(`${whenText(l.at, now)}  `, { dim: true }), span(words)] });
}

/**
 * A table's rows as they read here: the latest are in the state, and only those can open a document
 * or run an action, since the engine reads those from there; a past run's come from its file.
 */
function tableOf(ctx: Ctx, s: Sentinel, name: string, runId: string | undefined) {
  const metric = ctx.state.sentinel.metrics?.[s.id]?.[name];
  const latest = !runId || metric?.rowsRunId === runId;
  const loaded = latest ? undefined : loadMetric(ctx, s.id, name);
  const past = loaded?.value?.lines.find((l) => l.runId === runId);
  const rows = (latest ? metric?.rows : past?.rows) ?? [];
  const columns = shownColumns({ rows, ...(latest ? { ...(metric?.columns ? { columns: metric.columns } : {}), ...(metric?.columnTypes ? { columnTypes: metric.columnTypes } : {}) } : past?.columns ? { columns: past.columns } : {}) });
  return { metric, latest, loaded, rows, columns };
}

/** A table's rows: each opens. */
export function rowsPage(ctx: Ctx, s: Sentinel, name: string, runId: string | undefined): Node {
  const { metric, latest, loaded, rows, columns } = tableOf(ctx, s, name, runId);
  const shown = windowed(ctx, `rows:${s.id}:${name}:${runId ?? ''}`, rows.map((r, at) => ({ r, at })));
  const most = Math.max(2, Math.floor(ctx.columns / 20));
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title(metric?.label ?? name), dim(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}${metric?.rowsAt && latest ? ` · ${ago(metric.rowsAt)}` : ''}`)]),
    loaded ? loadNote(loaded, 'Reading its rows...') : undefined,
    !loaded?.loading && rows.length === 0 && empty('No rows kept here.'),
    columns.length > 0 && rows.length > 0 && dim(columns.slice(0, most).map((c) => c.label).join(' · ')),
    shown.before,
    ...shown.shown.map(({ r, at }) => {
      const words = columns.slice(0, most).map((c) => clip(cellWords((r as Record<string, unknown>)[c.key], c.type), 40)).join(' · ') || `Row ${at + 1}`;
      return ctx.draw.button(`rows:${at}`, words, () => ctx.go({ name: 'row', params: { id: s.id, name, at: String(at), ...(runId ? { run: runId } : {}) } }), { plain: true });
    }),
    shown.after,
  );
}

const clip = (words: string, max: number): string => {
  const one = words.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** One row: each column on its own line; a document opens, an action runs its sentinel with this row. */
export function rowPage(ctx: Ctx, s: Sentinel, name: string, at: number, runId: string | undefined): Node {
  const { metric, latest, loaded, rows, columns } = tableOf(ctx, s, name, runId);
  const r = rows[at];
  if (!r) return page(top(ctx, 'sentinels'), back(ctx), (loaded ? loadNote(loaded, 'Reading the row...') : undefined) ?? empty('That row is gone.'));
  const shown = windowed(ctx, `row:${s.id}:${name}`, columns);
  return page(top(ctx, 'sentinels'), back(ctx, metric?.label ?? name), title(metric?.label ?? name), shown.before, ...shown.shown.map((c) => cellRow(ctx, s, name, c, r, latest)), shown.after);
}

function cellRow(ctx: Ctx, s: Sentinel, metric: string, c: { readonly key: string; readonly label: string; readonly type?: MetricColumn }, r: Row, latest: boolean): Node {
  const cell = (r as Record<string, unknown>)[c.key];
  const words = cellWords(cell, c.type);
  const kind = c.type?.type;
  if (latest && cell !== null && cell !== undefined && cell !== '') {
    if (kind === 'html' || kind === 'file' || kind === 'storage') {
      return ctx.draw.button(`cell:${c.key}`, words, () => ctx.go({ name: 'document', params: { source: kind === 'storage' ? 'storage' : 'kept', id: s.id, metric, column: c.key, name: String(cell) } }), { plain: true, spans: [span(`${c.label}  `, { dim: true }), span(words)] });
    }
    if (kind === 'action') {
      return ctx.draw.button(`cell:${c.key}`, words, async () => {
        await ctx.call('sentinel.runRow', s.id, metric, c.key, r);
        ctx.effect({ toast: `${words}: running` });
      }, { plain: true, spans: [span(`${c.label}  `, { dim: true }), span(words)] });
    }
    if (kind === 'url' && typeof cell === 'string' && /^https?:\/\//i.test(cell)) return row([dim(c.label), webLink(cell, words)]);
  }
  return line(span(`${c.label}  `, { dim: true }), span(words));
}

/**
 * A document in the engine's viewer: Markdown, JSON or text as they read, a web page as its source
 * (nothing in it runs here), a picture when the surface draws one. A kind it can't show says what it
 * is, how big, and where it's from, with Open in Default App and Show in Finder.
 */
export function documentPage(ctx: Ctx, p: Readonly<Record<string, string>>): Node {
  const source = p.source ?? 'kept';
  const id = p.id ?? '';
  const metric = p.metric ?? '';
  const column = p.column ?? '';
  const name = p.name ?? '';
  const storage = source === 'storage';
  const run = source === 'run';
  const loaded = ctx.load<(DocumentRead & { readonly bucket?: string; readonly path?: string }) | undefined>(`sentinel:document:${source}:${id}:${metric}:${column}:${name}`, async () => {
    const read = storage ? ctx.call('sentinel.storageDocument', id, metric, column, name) : run ? ctx.call('sentinel.runFile', metric, name) : ctx.call('sentinel.document', id, metric, column, name);
    return (await read) as DocumentRead | undefined;
  });
  const doc = loaded.value;
  const shownName = doc?.name ?? name.split('/').pop() ?? name;
  const [signed, setSigned] = ctx.local<{ readonly url: string; readonly at: number } | undefined>(`sn:document:signed:${name}`, undefined);
  const open = (how: 'open' | 'reveal') => () => (storage ? ctx.call('sentinel.storageOpen', id, metric, column, name, how) : run ? ctx.call('sentinel.runFileOpen', metric, name, how) : ctx.call('sentinel.documentOpen', id, metric, column, name, how));
  const look = doc && !doc.tooBig ? documentLook(doc.mime) : undefined;
  const words = doc?.text;
  const picture = look === 'image' && doc?.base64 && doc.mime === 'image/png' && doc.size < 2 * 1024 * 1024 ? doc.base64 : undefined;
  const drawn = picture !== undefined || (words !== undefined && (look === 'markdown' || look === 'json' || look === 'html' || look === 'text'));
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title(shownName), doc ? dim(`${kindWords(doc.name, doc.mime)} · ${sizeWords(doc.size)}${doc.at ? ` · ${doc.bucket ? 'listed' : 'kept'} ${ago(doc.at)}` : ''}`) : undefined, doc?.bucket ? dim(`In Storage: ${doc.bucket}/${doc.path}`) : undefined]),
    loadNote(loaded, storage ? 'Fetching it from Storage...' : 'Loading...'),
    row([
      ctx.draw.button('doc:open', 'Open in Default App', open('open'), { hotkey: 'e' }),
      ctx.draw.button('doc:reveal', 'Show in Finder', open('reveal'), { plain: true, dim: true, hotkey: 'f' }),
      storage &&
        ctx.draw.button('doc:sign', 'Link for the Browser', async () => {
          const got = (await ctx.call('sentinel.signStorage', id, metric, column, name)) as { readonly url: string } | undefined;
          if (got?.url) setSigned({ url: got.url, at: Date.now() });
        }, { plain: true, dim: true, hotkey: 'i' }),
    ]),
    // Signed for about a minute, and never kept past it.
    signed && Date.now() - signed.at < 55_000 ? webLink(signed.url, 'Open it in your browser (good for about a minute)') : undefined,
    doc?.tooBig ? dim('It’s too big to show here: open it in its app, or find it in Finder.') : undefined,
    look === 'markdown' && words !== undefined ? md(peerText(words)) : undefined,
    look === 'json' && words !== undefined ? code(prettyJson(words), { language: 'json' }) : undefined,
    look === 'html' && words !== undefined ? col([dim('A web page, shown as its source: nothing in it runs here.'), code(words, { language: 'html' })]) : undefined,
    look === 'text' && words !== undefined ? code(words) : undefined,
    picture ? { k: 'image', key: 'doc:image', png: picture, columns: Math.min(ctx.columns, 60), rows: Math.min(ctx.rows, 20), alt: shownName } : undefined,
    doc && !doc.tooBig && !drawn ? dim('It can’t be shown here: open it in its app, or find it in Finder.') : undefined,
    doc?.cut ? dim('Only the start is shown here: open it to see the rest.') : undefined,
  );
}
