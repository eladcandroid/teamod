import ElkBundled from 'elkjs/lib/elk.bundled.js';
import { type ElkOutput, GROUP_HEAD, KIND_NAME, STATUS_INFO, backEdges, elkGraph, inlineAspect, roundedPath, routesOf } from '../../shared/render/graph-model.js';
import type { Graph, GraphNode } from '../../shared/graph-spec.js';
import { esc } from './svg.js';

/** The bundled build is CommonJS: its default is the class. */
const ELK = ElkBundled as unknown as new () => { layout(graph: unknown): Promise<unknown> };

const NODE_W = 188;
const NODE_H = 56;
const INK = '#8a8f98';
const STROKE = '#8a8f9866';

const TONE: Readonly<Record<string, string>> = { muted: '#8a8f98', claude: '#d97757', info: '#7aa2f7', ok: '#73daca', warn: '#e0af68', error: '#f7768e' };

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Absolute places: ELK gives a group's children relative to it. */
function absolute(out: ElkOutput): Map<string, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const at = new Map<string, { x: number; y: number; width: number; height: number }>();
  const walk = (node: ElkOutput, ox: number, oy: number): void => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      at.set(child.id, { x, y, width: child.width ?? 0, height: child.height ?? 0 });
      walk(child, x, y);
    }
  };
  walk(out, 0, 0);
  return at;
}

function nodeSvg(node: GraphNode, box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): string {
  const tone = node.status ? (TONE[STATUS_INFO[node.status].tone] ?? INK) : INK;
  if (node.type === 'group') {
    return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="#8a8f9812" stroke="${STROKE}" stroke-dasharray="4 3"/><text x="${box.x + 12}" y="${box.y + GROUP_HEAD / 2 + 4}" fill="${INK}" font-weight="600">${esc(clip(node.label, Math.floor(box.width / 7)))}</text>`;
  }
  const chars = Math.floor(box.width / 6.6);
  const sub = node.sublabel ?? (node.type ? KIND_NAME[node.type] : undefined);
  return [
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="#8a8f981a" stroke="${node.emphasis ? '#7aa2f7' : STROKE}"/>`,
    node.status ? `<circle cx="${box.x + box.width - 12}" cy="${box.y + 13}" r="4" fill="${tone}"/>` : '',
    `<text x="${box.x + 10}" y="${box.y + 24}" fill="currentColor" font-weight="600" font-size="12">${esc(clip(node.label, chars))}</text>`,
    sub ? `<text x="${box.x + 10}" y="${box.y + 41}" fill="${INK}">${esc(clip(sub, chars))}</text>` : '',
  ].join('');
}

/**
 * A graph as an SVG, laid out by ELK as the Mac lays it out (shared/render/graph-model.ts). No
 * script and no interaction here: what a node says in full goes beside it in words.
 */
export async function graphSvg(graph: Graph, width = 640): Promise<string> {
  const sizes = new Map(graph.nodes.map((n) => [n.id, { width: NODE_W, height: NODE_H }]));
  const input = elkGraph(graph, sizes, graph.direction, inlineAspect(width));
  const elk = new ELK();
  const out = (await elk.layout(input)) as ElkOutput;
  const back = backEdges(graph);
  const routes = routesOf(out, back);
  const at = absolute(out);
  const viewW = Math.ceil(out.width ?? width);
  const viewH = Math.ceil(out.height ?? 200);
  // Parents first, so a group sits behind what's in it.
  const groups = graph.nodes.filter((n) => n.type === 'group');
  const leaves = graph.nodes.filter((n) => n.type !== 'group');
  let body = `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="${INK}"/></marker></defs>`;
  for (const node of groups) {
    const box = at.get(node.id);
    if (box) body += nodeSvg(node, box);
  }
  for (const edge of graph.edges) {
    const route = routes.get(edge.id);
    if (!route) continue;
    const dashed = edge.kind === 'async' || edge.kind === 'depends';
    body += `<path d="${roundedPath(route.points)}" fill="none" stroke="${edge.emphasis ? '#7aa2f7' : INK}" stroke-width="1.4" ${dashed ? 'stroke-dasharray="5 4" ' : ''}marker-end="url(#arrow)"/>`;
    if (edge.label && route.label) body += `<text x="${route.label.x}" y="${route.label.y + 4}" text-anchor="middle" fill="${INK}">${esc(clip(edge.label, 30))}</text>`;
  }
  for (const node of leaves) {
    const box = at.get(node.id);
    if (box) body += nodeSvg(node, box);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}" color="#c9ced6" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="11">${body}</svg>`;
}
