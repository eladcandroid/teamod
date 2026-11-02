import { planChart } from '../../shared/render/chart-model.js';
import { formatCell, formatNumber, isNumeric, toDate } from '../../shared/render/format.js';
import { along, barTone, type CalendarPlan, type GanttPlan, type HeatPlan, scaleColor, scaleOf } from '../../shared/render/grid-model.js';
import type { Cell, Column, Row, View } from '../../shared/view-spec.js';

/**
 * The drawings a pane shows, as SVG. The Mac draws these with React; here each is a plain function
 * of the same pure plans (shared/render), so they read the same and a test can hold them to a
 * golden file. Colours are soft and sit on either theme: nothing is drawn behind them.
 */

export const PALETTE = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64', '#73daca'] as const;
const INK = '#8a8f98';
const RULE = '#8a8f9833';

const TONES: Readonly<Record<string, string>> = { mint: '#73daca', sky: '#7dcfff', rose: '#f7768e', butter: '#e0af68', lavender: '#bb9af7', neutral: '#8a8f98' };

/** Text as SVG takes it. What's drawn can come from anyone: nothing in it may become markup. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const svgOf = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="11">${body}</svg>`;

const label = (x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end' = 'start', fill = INK): string => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`;

const num = (c: Cell | undefined): number | undefined => (typeof c === 'number' && Number.isFinite(c) ? c : undefined);

/** A round top for an axis, and its steps. */
function niceTicks(min: number, max: number, want = 5): { readonly ticks: readonly number[]; readonly low: number; readonly high: number } {
  const lo = Math.min(0, min);
  const hi = max > lo ? max : lo + 1;
  const raw = (hi - lo) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const low = Math.floor(lo / step) * step;
  const high = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = low; t <= high + step / 2; t += step) ticks.push(t);
  return { ticks, low, high };
}

function xText(c: Cell | undefined, time: boolean, column: Column | undefined): string {
  if (time) {
    const d = toDate(c ?? null);
    if (d) return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }
  return column ? formatCell(c ?? null, column) : String(c ?? '');
}

function legend(names: readonly string[], colors: readonly string[], width: number, y: number): string {
  let x = 0;
  let out = '';
  for (const [i, name] of names.entries()) {
    const text = clip(name, 24);
    if (x + 20 + text.length * 6 > width) break;
    out += `<rect x="${x}" y="${y - 8}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}"/>${label(x + 14, y, text)}`;
    x += 26 + text.length * 6;
  }
  return out;
}

function pieSvg(view: View, columns: readonly Column[], rows: readonly Row[], width: number, height: number, colors: readonly string[]): string {
  const plan = planChart(view, columns, rows);
  const key = plan.series[0]?.key;
  const slices = plan.rows.map((r) => ({ name: String(r[plan.x] ?? ''), value: Math.max(0, num(r[key ?? '']) ?? 0) })).filter((s) => s.value > 0);
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) return svgOf(width, 60, label(0, 20, 'Nothing to draw.'));
  const radius = Math.min(height, width * 0.5) / 2 - 12;
  const cx = radius + 8;
  const cy = height / 2;
  const hole = view.chart === 'donut' ? radius * 0.58 : 0;
  let angle = -Math.PI / 2;
  let body = '';
  slices.forEach((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const end = angle + Math.min(sweep, Math.PI * 2 - 0.0001);
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, r: number): string => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
    const path = hole ? `M ${p(angle, radius)} A ${radius} ${radius} 0 ${large} 1 ${p(end, radius)} L ${p(end, hole)} A ${hole} ${hole} 0 ${large} 0 ${p(angle, hole)} Z` : `M ${cx} ${cy} L ${p(angle, radius)} A ${radius} ${radius} 0 ${large} 1 ${p(end, radius)} Z`;
    body += `<path d="${path}" fill="${colors[i % colors.length]}"/>`;
    angle = end;
  });
  const lx = cx + radius + 24;
  slices.slice(0, Math.floor((height - 8) / 18)).forEach((s, i) => {
    const y = 18 + i * 18;
    body += `<rect x="${lx}" y="${y - 9}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}"/>${label(lx + 15, y, `${clip(s.name, 26)}  ${Math.round((s.value / total) * 100)}%`)}`;
  });
  return svgOf(width, height, body);
}

/** A chart view: line, area, bar, scatter, pie or donut. */
export function chartSvg(view: View, columns: readonly Column[], rows: readonly Row[], width = 640, height = view.height ?? 280): string {
  const colors = view.colors?.length ? view.colors : PALETTE;
  if (view.chart === 'pie' || view.chart === 'donut') return pieSvg(view, columns, rows, width, height, colors);
  const plan = planChart(view, columns, rows);
  const series = plan.series;
  if (!plan.rows.length || !series.length) return svgOf(width, 60, label(0, 20, 'Nothing to draw.'));
  const stacked = view.stacked && (view.chart === 'bar' || view.chart === 'area');
  const totals = plan.rows.map((r) => series.reduce((n, s) => n + (num(r[s.key]) ?? 0), 0));
  const values = plan.rows.flatMap((r) => series.map((s) => num(r[s.key]) ?? 0));
  const { ticks, low, high } = niceTicks(Math.min(...values), stacked ? Math.max(...totals) : Math.max(...values));
  const showLegend = view.legend ?? series.length > 1;
  const top = showLegend ? 26 : 8;
  const left = 54;
  const bottom = 26;
  const right = 12;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const y = (v: number): number => top + plotH - ((v - low) / (high - low || 1)) * plotH;
  const n = plan.rows.length;
  const isBar = view.chart === 'bar';
  const x = (i: number): number => (isBar ? left + ((i + 0.5) / n) * plotW : left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2));
  let body = showLegend ? legend(series.map((s) => s.label), colors, width, 12) : '';
  for (const t of ticks) {
    if (view.grid) body += `<line x1="${left}" x2="${width - right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${RULE}"/>`;
    body += label(left - 6, y(t) + 4, plan.yColumn && isNumeric(plan.yColumn) ? formatCell(t, plan.yColumn) : formatNumber(t, { compact: true }), 'end');
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  plan.rows.forEach((r, i) => {
    if (i % every === 0) body += label(x(i), height - 8, clip(xText(r[plan.x], plan.time, plan.xColumn), 12), 'middle');
  });
  if (isBar) {
    const slot = plotW / n;
    const bandW = Math.max(1.5, (slot * 0.72) / (stacked ? 1 : series.length));
    plan.rows.forEach((r, i) => {
      let base = 0;
      series.forEach((s, k) => {
        const v = num(r[s.key]) ?? 0;
        const from = stacked ? base : 0;
        const to = from + v;
        base = to;
        const bx = stacked ? x(i) - bandW / 2 : x(i) - (bandW * series.length) / 2 + k * bandW;
        const y1 = y(Math.max(from, to));
        const h = Math.max(0.5, Math.abs(y(from) - y(to)));
        body += `<rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${bandW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${s.color ?? colors[k % colors.length]}"/>`;
      });
    });
    return svgOf(width, height, body);
  }
  series.forEach((s, k) => {
    const color = s.color ?? colors[k % colors.length]!;
    const points = plan.rows.flatMap((r, i) => {
      const v = num(r[s.key]);
      return v === undefined ? [] : [{ x: x(i), y: y(v) }];
    });
    if (view.chart === 'scatter') {
      for (const p of points) body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}"/>`;
      return;
    }
    const path = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    if (view.chart === 'area' && points.length) {
      body += `<path d="${path} L ${points.at(-1)!.x.toFixed(1)} ${y(Math.max(low, 0)).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${y(Math.max(low, 0)).toFixed(1)} Z" fill="${color}" fill-opacity="0.22"/>`;
    }
    body += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    if (view.dots ?? points.length <= 24) for (const p of points) body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${color}"/>`;
  });
  return svgOf(width, height, body);
}

export function ganttSvg(plan: GanttPlan, width = 640): string {
  const nameW = 120;
  const rowH = 24;
  const bars = plan.lanes.flatMap((lane) => lane.bars.map((bar) => ({ lane: lane.name, bar })));
  const height = 28 + bars.length * rowH + plan.lanes.length * 4;
  const x = (t: number): number => nameW + along(plan, t) * (width - nameW - 8);
  let body = '';
  for (const tick of plan.ticks) body += `<line x1="${x(tick.t).toFixed(1)}" x2="${x(tick.t).toFixed(1)}" y1="20" y2="${height}" stroke="${RULE}"/>${label(x(tick.t), 12, tick.label, 'middle')}`;
  if (plan.today !== undefined) body += `<line x1="${x(plan.today).toFixed(1)}" x2="${x(plan.today).toFixed(1)}" y1="20" y2="${height}" stroke="#f7768e"/>`;
  let y = 28;
  for (const lane of plan.lanes) {
    for (const bar of lane.bars) {
      body += label(0, y + 12, clip(bar.label, 19));
      const color = TONES[barTone(bar.status)] ?? INK;
      if (bar.milestone) {
        const cx = x(bar.start);
        body += `<path d="M ${cx.toFixed(1)} ${y + 2} l 7 7 l -7 7 l -7 -7 Z" fill="${color}"/>`;
      } else {
        const from = x(bar.start);
        const w = Math.max(3, x(bar.end) - from);
        body += `<rect x="${from.toFixed(1)}" y="${y + 3}" width="${w.toFixed(1)}" height="14" rx="3" fill="${color}" fill-opacity="0.35"/>`;
        body += `<rect x="${from.toFixed(1)}" y="${y + 3}" width="${(w * (bar.progress ?? 0)).toFixed(1)}" height="14" rx="3" fill="${color}"/>`;
      }
      y += rowH;
    }
    y += 4;
  }
  return svgOf(width, height, body);
}

export function heatmapSvg(view: View, plan: HeatPlan, width = 640, dark = true): string {
  const scale = scaleOf(view, dark);
  const nameW = 90;
  const cell = Math.max(8, Math.min(32, Math.floor((width - nameW) / Math.max(1, plan.xs.length))));
  const height = 22 + plan.ys.length * cell;
  let body = '';
  plan.xs.forEach((name, i) => {
    if (cell >= 22 || i % Math.ceil(22 / cell) === 0) body += label(nameW + i * cell + cell / 2, 12, clip(name, 6), 'middle');
  });
  plan.ys.forEach((name, j) => {
    body += label(0, 22 + j * cell + cell / 2 + 4, clip(name, 14));
    plan.xs.forEach((_, i) => {
      const v = plan.cells[j]?.[i] ?? null;
      body += `<rect x="${nameW + i * cell}" y="${22 + j * cell}" width="${cell - 2}" height="${cell - 2}" rx="2" fill="${scaleColor(v, plan.min, plan.max, scale)}"/>`;
    });
  });
  return svgOf(Math.min(width, nameW + plan.xs.length * cell + 4), height, body);
}

export function calendarSvg(view: View, plan: CalendarPlan, width = 640, dark = true): string {
  const scale = scaleOf(view, dark);
  const cell = Math.max(8, Math.min(14, Math.floor((width - 4) / Math.max(1, plan.weeks.length))));
  const height = 18 + cell * 7;
  let body = '';
  for (const month of plan.months) body += label(month.week * cell, 11, month.label);
  plan.weeks.forEach((week, w) => {
    week.forEach((day, d) => {
      if (day.value === undefined && !day.date) return;
      body += `<rect x="${w * cell}" y="${18 + d * cell}" width="${cell - 2}" height="${cell - 2}" rx="2" fill="${scaleColor(day.value ?? null, plan.min, plan.max, scale)}"/>`;
    });
  });
  return svgOf(plan.weeks.length * cell + 2, height, body);
}
