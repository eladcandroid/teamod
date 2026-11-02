import { describe, expect, it } from 'vitest';
import { parseGraph, type Graph } from '../src/shared/graph-spec.js';
import { parseView, type View } from '../src/shared/view-spec.js';
import { graphSvg } from '../src/teamod/rich/graph-svg.js';
import { hasRich, richNodes, splitAnswer } from '../src/teamod/rich/rich.js';
import { calendarSvg, chartSvg, esc, ganttSvg, heatmapSvg } from '../src/teamod/rich/svg.js';
import { planCalendar, planGantt, planHeatmap } from '../src/shared/render/grid-model.js';
import type { Ctx } from '../src/teamod/screens.js';
import { Draw, type Node } from '../src/teamod/tree.js';
import { flat, words } from './teamod-helpers.js';
import { initialState } from '../src/core/store.js';
import type { AppState } from '../src/core/store.js';

const view = (spec: unknown): View => {
  const parsed = parseView(JSON.stringify(spec));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.view;
};

const months = [
  { month: 'Jan', sales: 10, costs: 4 },
  { month: 'Feb', sales: 14, costs: 6 },
  { month: 'Mar', sales: 9, costs: 5 },
];

const chart = (kind: string, extra: object = {}): View => view({ type: 'chart', chart: kind, x: 'month', data: months, ...extra });

const fence = (lang: string, body: unknown): string => `\`\`\`${lang}\n${typeof body === 'string' ? body : JSON.stringify(body)}\n\`\`\``;

/** A screen's context with what these drawings use, and calls recorded. */
function context(surface: 'terminal' | 'desktop' = 'terminal', answers: Record<string, unknown> = {}): { ctx: Ctx; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const memory = new Map<string, unknown>();
  const ctx = {
    surface,
    columns: 80,
    rows: 40,
    state: initialState('room') as unknown as AppState,
    draw: new Draw(),
    call: async (method: string, ...args: unknown[]) => {
      calls.push([method, args]);
      return answers[method];
    },
    load: (key: string, loader: () => Promise<unknown>) => {
      if (memory.has(key)) return { value: memory.get(key), loading: false };
      void loader().then((value) => memory.set(key, value));
      return { loading: true };
    },
    local: (_key: string, initial: unknown) => [initial, () => undefined],
    effect: () => undefined,
    show: () => undefined,
  } as unknown as Ctx;
  return { ctx, calls };
}

describe('splitting an answer', () => {
  it('finds fences among the words', () => {
    const parts = splitAnswer(`Before.\n\n${fence('json', '{"a":1}')}\n\nAfter.`);
    expect(parts.map((p) => p.kind)).toEqual(['md', 'fence', 'md']);
    expect(parts[1]).toEqual({ kind: 'fence', lang: 'json', body: '{"a":1}' });
  });

  it('leaves a fence still being written as words, so nothing half-sent is parsed', () => {
    const parts = splitAnswer('Before.\n\n```teamod-view\n{"type":"chart","data":[');
    expect(parts).toEqual([{ kind: 'md', text: 'Before.\n\n```teamod-view\n{"type":"chart","data":[' }]);
    expect(hasRich('```teamod-view\n{"type":')).toBe(false);
  });

  it('leaves ordinary code to the engine', () => {
    expect(hasRich(fence('ts', 'const a = 1;'))).toBe(false);
    expect(hasRich('No fence here.')).toBe(false);
    expect(hasRich(fence('teamod-view', '{}'))).toBe(true);
    expect(hasRich(fence('mermaid', 'graph TD; A-->B'))).toBe(true);
  });
});

describe('drawing what someone else wrote', () => {
  it('escapes it, so words can never become markup', () => {
    expect(esc(`<script>'"&`)).toBe('&lt;script&gt;&#39;&quot;&amp;');
    const svg = chartSvg(view({ type: 'chart', chart: 'bar', x: 'name', data: [{ name: '<script>alert(1)</script>', v: 1 }] }), [{ key: 'name', type: 'text' }, { key: 'v', type: 'number' }] as never, [{ name: '<script>alert(1)</script>', v: 1 }]);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script');
  });

  it('does not run a source from an answer that came from someone else', async () => {
    const { ctx, calls } = context();
    richNodes(ctx, fence('teamod-view', { type: 'table', source: { kind: 'command', command: 'rm -rf ~' }, data: [{ a: 1 }] }), { peer: true });
    expect(calls).toEqual([]);
  });

  it('asks before a view of your own runs a command', async () => {
    const { ctx, calls } = context('terminal', { 'view.fetch': { needsApproval: true, what: 'ls -la' } });
    const answer = fence('teamod-view', { type: 'table', source: { kind: 'command', command: 'ls -la' } });
    richNodes(ctx, answer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[0]?.[0]).toBe('view.fetch');
    expect(calls[0]?.[1]?.[2]).toEqual({});
    ctx.draw.handlers.clear();
    const tree = richNodes(ctx, answer);
    expect(tree.flatMap(flat).some((n) => n.k === 'button' && n.label === 'Run It')).toBe(true);
    expect(tree.map(words).join('\n')).toContain('ls -la');
  });
});

describe('charts', () => {
  it.each(['line', 'area', 'bar', 'scatter', 'pie', 'donut'])('draws a %s', (kind) => {
    const v = chart(kind);
    const svg = chartSvg(v, v.columns, v.rows);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/<(path|rect|circle)/);
    expect(svg).toContain(kind === 'pie' || kind === 'donut' ? 'Jan' : 'Feb');
  });

  it('says so when there is nothing to draw', () => {
    const v = view({ type: 'chart', chart: 'line', x: 'month', columns: [{ key: 'month' }, { key: 'sales', type: 'number' }], data: [{ month: 'Jan', sales: 1 }] });
    expect(chartSvg(v, v.columns, [])).toContain('Nothing to draw.');
  });

  it('stays the same for the same data', () => {
    const v = chart('line');
    expect(chartSvg(v, v.columns, v.rows)).toBe(chartSvg(v, v.columns, v.rows));
  });
});

describe('the other drawings', () => {
  it('draws a gantt', () => {
    const v = view({ type: 'gantt', label: 'task', start: 'from', end: 'to', data: [{ task: 'Design', from: '2026-01-01', to: '2026-01-10' }, { task: 'Build', from: '2026-01-05', to: '2026-02-01' }] });
    const plan = planGantt(v, v.rows, v.columns);
    expect(plan).toBeDefined();
    expect(ganttSvg(plan!)).toContain('Design');
  });

  it('draws a heatmap', () => {
    const v = view({ type: 'heatmap', x: 'day', y: 'who', value: 'n', data: [{ day: 'Mon', who: 'a', n: 1 }, { day: 'Tue', who: 'a', n: 5 }] });
    const plan = planHeatmap(v, v.rows, v.columns);
    expect(plan).toBeDefined();
    expect(heatmapSvg(v, plan!)).toContain('Mon');
  });

  it('draws a calendar', () => {
    const v = view({ type: 'calendar', x: 'day', value: 'n', data: [{ day: '2026-03-01', n: 2 }, { day: '2026-03-02', n: 5 }] });
    const plan = planCalendar(v, v.rows, v.columns);
    expect(plan).toBeDefined();
    expect(calendarSvg(v, plan!)).toContain('<rect');
  });

  it('lays out a graph, with its groups and lines', async () => {
    const parsed = parseGraph(JSON.stringify({ title: 'Flow', nodes: [{ id: 'g', type: 'group', label: 'Back end' }, { id: 'a', label: 'Web', group: 'g' }, { id: 'b', label: '<Database>' }], edges: [{ from: 'a', to: 'b', label: 'reads' }] }));
    if (!parsed.ok) throw new Error(parsed.error);
    const svg = await graphSvg(parsed.graph as Graph);
    expect(svg).toContain('Web');
    expect(svg).toContain('Back end');
    expect(svg).toContain('reads');
    expect(svg).toContain('&lt;Database&gt;');
    expect(svg).toContain('marker-end');
  });
});

describe('an answer on each surface', () => {
  const picture = (nodes: readonly Node[]): Node[] => nodes.flatMap(flat).filter((n) => n.k === 'image' || n.k === 'svg');

  it('is a real picture on the terminal, and an SVG on desktop', () => {
    const answer = `Sales went up.\n\n${fence('teamod-view', { type: 'chart', chart: 'bar', x: 'month', data: months })}`;
    const onTerminal = picture(richNodes(context('terminal').ctx, answer));
    expect(onTerminal[0]?.k).toBe('image');
    if (onTerminal[0]?.k === 'image') {
      expect(Buffer.from(onTerminal[0].png, 'base64').subarray(1, 4).toString()).toBe('PNG');
      expect(onTerminal[0].alt).toContain('3 rows');
    }
    expect(picture(richNodes(context('desktop').ctx, answer))[0]?.k).toBe('svg');
  });

  it('keeps a small chart’s numbers as words on the terminal, for when pictures can’t show', () => {
    const answer = fence('teamod-view', { type: 'chart', chart: 'bar', x: 'month', data: months });
    expect(richNodes(context('terminal').ctx, answer).map(words).join('\n')).toContain('Feb');
  });

  it('draws tables, stats and code as text every surface has', () => {
    const { ctx } = context();
    expect(richNodes(ctx, fence('teamod-view', { type: 'table', data: [{ name: 'a|b', n: 1 }] })).map(words).join('\n')).toContain('a\\|b');
    expect(richNodes(ctx, fence('teamod-view', { type: 'stats', items: [{ label: 'Users', value: 12 }] })).map(words).join('\n')).toContain('Users');
    expect(richNodes(ctx, fence('teamod-view', { type: 'code', code: 'x = 1', language: 'py' })).flatMap(flat).some((n) => n.k === 'code' && n.source === 'x = 1')).toBe(true);
  });

  it('falls back to the block itself when it does not parse', () => {
    expect(richNodes(context().ctx, fence('teamod-view', '{"type":')).flatMap(flat).some((n) => n.k === 'code')).toBe(true);
  });

  it('reads task cards from the live board, not from the answer', () => {
    const { ctx } = context();
    const state = { ...ctx.state, board: { ...ctx.state.board, issues: [{ id: 'i1', key: 'TM-1', title: 'Real title', status: 'todo' }] } } as unknown as AppState;
    const nodes = richNodes({ ...ctx, state }, fence('teamod-tasks', 'TM-1 a made-up title\nTM-9'));
    const said = nodes.map(words).join('\n');
    expect(said).toContain('Real title');
    expect(said).not.toContain('made-up');
    expect(said).toContain('TM-9: not on this board');
  });

  it('draws math as a picture', () => {
    expect(picture(richNodes(context('terminal').ctx, fence('math', 'x^2')))[0]?.k).toBe('image');
  });

  it('draws a mermaid flowchart through the graph path', () => {
    const nodes = richNodes(context().ctx, fence('mermaid', 'graph TD\n  A[Start] --> B[End]'));
    expect(nodes.map(words).join('\n')).toContain('Laying it out');
  });
});
