import type { AgentRef } from '../../protocol.js';
import { defaultAgentOf } from '../../protocol.js';
import { teammatesOf } from '../../core/team/model.js';
import { isOpen, showsOn } from '../../core/board/model.js';
import { agentName } from '../../shared/agent-label.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../../ui/agent-choice.js';
import type { Project } from '../../workspaces/types.js';
import type { Ctx, Loaded, Route } from '../screens.js';
import { type Node, type Span, code, col, dim, line, md, row, span, text } from '../tree.js';
import { type Place, back, chrome, empty, findWorkspace, openWorkspace, page, peerText } from './common.js';

/** The places of the Board screen. The keys w k t o l g and b are the top row's. */
export const PLACES: readonly Place[] = [
  { id: 'tasks', label: 'Tasks', hotkey: 's', route: { name: 'tasks' } },
  { id: 'plans', label: 'Plans', hotkey: 'p', route: { name: 'plans' } },
  { id: 'issues', label: 'Issues', hotkey: 'i', route: { name: 'issues' } },
  { id: 'actions', label: 'Actions', hotkey: 'a', route: { name: 'actions' } },
];

/** A view's one main action, and its More, on the same keys everywhere. */
export const MAIN_KEY = 'r';
export const MORE_KEY = 'm';

export const top = (ctx: Ctx, here: string): Node => chrome(ctx, PLACES, here);

/** A page under one of the places: the top, the way back, and what it says. */
export const subPage = (ctx: Ctx, here: string, backTo: string, ...children: ReadonlyArray<Node | false | undefined | null>): Node => page(top(ctx, here), back(ctx, backTo), ...children);

export const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error: /, '') : String(err));

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export type WrittenPart = { readonly prose: string } | { readonly source: string; readonly language?: string };

/**
 * Markdown cut at its code fences. A fence is drawn as code, so nothing in it can be a link, and
 * `fns[i](x)` there stays as written; everything else goes through `peerText`.
 */
export function writtenParts(raw: string): WrittenPart[] {
  const parts: WrittenPart[] = [];
  let prose: string[] = [];
  let fence: { readonly mark: string; readonly language?: string; readonly lines: string[] } | undefined;
  const endProse = (): void => {
    const words = prose.join('\n');
    if (words.trim()) parts.push({ prose: peerText(words) });
    prose = [];
  };
  const endFence = (): void => {
    if (fence) parts.push({ source: fence.lines.join('\n'), ...(fence.language ? { language: fence.language } : {}) });
    fence = undefined;
  };
  for (const text of raw.replace(/\r\n/g, '\n').split('\n')) {
    const m = FENCE.exec(text);
    if (fence) {
      if (m && m[1]![0] === fence.mark[0] && m[1]!.length >= fence.mark.length && !m[2]!.trim()) endFence();
      else fence.lines.push(text);
    } else if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      endProse();
      const language = m[2]!.trim().split(/\s+/)[0];
      fence = { mark: m[1]!, ...(language ? { language } : {}), lines: [] };
    } else {
      prose.push(text);
    }
  }
  endFence();
  endProse();
  return parts;
}

/** What someone wrote (a brief, a comment, a GitHub issue), ready to draw and never acted on. */
export function written(raw: string): Node {
  const nodes = writtenParts(raw).map((part) => ('prose' in part ? md(part.prose) : code(part.source, part.language ? { language: part.language } : {})));
  return nodes.length === 1 ? nodes[0]! : col(nodes, { gap: 1 });
}

/** A link to the web, the only place one of ours goes. */
export const webLink = (href: string, words: string): Node | undefined => (/^https?:\/\//i.test(href) ? { k: 'link', href, text: words } : undefined);

/** How many rows one press brings, and how many a draw holds at most. */
export const ROWS_STEP = 50;
export const ROWS_MAX = 100;

export interface Window<T> {
  readonly rows: readonly T[];
  /** Earlier rows, once the list has moved past them. */
  readonly earlier?: Node;
  readonly more?: Node;
}

/** A long list, a part at a time: More brings the next rows, and a draw never holds more than `ROWS_MAX`. */
export function windowed<T>(ctx: Ctx, key: string, items: readonly T[], step = ROWS_STEP, words: { readonly more?: string; readonly earlier?: string } = {}): Window<T> {
  const [end, setEnd] = ctx.local(`${key}:end`, step);
  const to = Math.min(items.length, Math.max(end, step));
  const from = Math.max(0, to - ROWS_MAX);
  return {
    rows: items.slice(from, to),
    ...(from > 0 ? { earlier: ctx.draw.button(`${key}:earlier`, `${words.earlier ?? 'Earlier'} (${from})`, () => setEnd(Math.max(step, to - step)), { plain: true, dim: true }) } : {}),
    ...(to < items.length ? { more: ctx.draw.button(`${key}:more`, `${words.more ?? 'More'} (${items.length - to})`, () => setEnd(to + step), { plain: true, dim: true }) } : {}),
  };
}

/** One of a few, in a row: the one that's on stands out. */
export function choices<T extends string>(ctx: Ctx, key: string, options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly hotkey?: string }>, current: T | undefined, pick: (value: T) => unknown): Node {
  return row(options.map((o) => ctx.draw.button(`${key}:${o.value}`, o.label, () => pick(o.value), { plain: true, ...(o.hotkey ? { hotkey: o.hotkey } : {}), ...(o.value === current ? {} : { dim: true }) })));
}

export const toggle = (ctx: Ctx, key: string, label: string, on: boolean, flip: () => unknown): Node => ctx.draw.button(key, `${on ? '[x]' : '[ ]'} ${label}`, flip, { plain: true });

/** A field's name above what it holds. */
export const field = (label: string, ...children: ReadonlyArray<Node | false | undefined | null>): Node => col([dim(label), ...children]);

/** A property: its name, then its value; a press opens what changes it, when something does. */
export function prop(ctx: Ctx, key: string, label: string, value: string | readonly Span[], press?: () => unknown): Node {
  const said = typeof value === 'string' ? [span(value)] : value;
  const spans = [span(`${label}  `, { dim: true }), ...said];
  return press ? ctx.draw.button(key, `${label}: ${said.map((s) => s.t).join('')}`, press, { plain: true, spans }) : line(...spans);
}

/** Something that can't be undone: the press asks first, in place, and says what goes. */
export function asking(ctx: Ctx, key: string, opts: { readonly label: string; readonly question: string; readonly detail?: string; readonly confirm: string; readonly danger?: boolean; readonly run: () => unknown }): Node {
  const [open, setOpen] = ctx.local(`ask:${key}`, false);
  const danger = (words: string): { readonly spans?: readonly Span[] } => (opts.danger ? { spans: [span(words, { color: 'error' })] } : {});
  if (!open) return ctx.draw.button(key, opts.label, () => setOpen(true), { plain: true, ...danger(opts.label) });
  return col([
    text(opts.question, { weight: 'semibold' }),
    opts.detail ? dim(opts.detail) : undefined,
    row([
      ctx.draw.button(
        `${key}:yes`,
        opts.confirm,
        async () => {
          setOpen(false);
          await opts.run();
        },
        { plain: true, ...danger(opts.confirm) },
      ),
      ctx.draw.button(`${key}:no`, 'Cancel', () => setOpen(false), { plain: true, dim: true }),
    ]),
  ]);
}

// ---- agents

export const myAgent = (ctx: Ctx): AgentRef => defaultAgentOf(ctx.state.self);

/** Everyone who can do a piece of work: your agent first, then each agent and model; one not set up here says why. */
export function agentRows(ctx: Ctx, key: string, current: AgentRef | undefined, pick: (agent: AgentRef | undefined) => unknown): Node[] {
  const now = current ? choiceForAgent(current) : '';
  return [
    ctx.draw.button(`${key}:yours`, `Your agent (${agentName(myAgent(ctx))})`, () => pick(undefined), { plain: true, ...(now === '' ? {} : { dim: true }) }),
    ...agentChoices(ctx.state.runtimes, ctx.state.models).map((choice) =>
      choice.disabled
        ? line(span(choice.label, { dim: true }), choice.why ? span(`  ${choice.why}`, { dim: true }) : undefined)
        : ctx.draw.button(`${key}:${choice.value}`, choice.label, () => pick(agentForChoice(choice.value, ctx.state.runtimes)), { plain: true, ...(choice.value === now ? {} : { dim: true }) }),
    ),
  ];
}

// ---- which project

export const realProjects = (ctx: Ctx): readonly Project[] => ctx.state.projects.filter((p) => p.root && !p.error);

/** The project of the worktree you last looked at, if any. */
export function lookedProject(ctx: Ctx): string {
  const view = ctx.state.view;
  return view?.kind === 'workspace' ? (findWorkspace(ctx.state, view.id)?.projectId ?? '') : '';
}

const PLACE_NAMES: ReadonlySet<string> = new Set(PLACES.map((p) => p.route.name));

interface PickedProject {
  readonly id: string;
  /** Where you were when you picked it: going to work elsewhere moves the Board along with you. */
  readonly whenIn: string;
}

/** The project a place shows: the one asked for, the one you picked, the one you're in, the busiest, the first. */
export function projectHere(ctx: Ctx): { readonly projects: readonly Project[]; readonly here: Project | undefined } {
  const projects = realProjects(ctx);
  const looked = lookedProject(ctx);
  const [picked] = ctx.local<PickedProject>('board:project', { id: '', whenIn: '' });
  const known = (id: string | undefined): Project | undefined => (id ? projects.find((p) => p.id === id) : undefined);
  const openIn = (p: Project): number => ctx.state.board.issues.filter((i) => showsOn(i, p.id) && isOpen(i.status)).length;
  const busiest = [...projects].sort((a, b) => openIn(b) - openIn(a))[0];
  // A place's own list follows your pick; a page under it (a new plan, a project's pull requests) is about the project it names.
  const asked = PLACE_NAMES.has(ctx.route.name) ? undefined : known(ctx.route.params?.project);
  return { projects, here: asked ?? (picked.whenIn === looked ? known(picked.id) : undefined) ?? known(looked) ?? busiest };
}

/** Show this project in the places from now on. */
export function pickProject(ctx: Ctx, id: string): void {
  const [, setPicked] = ctx.local<PickedProject>('board:project', { id: '', whenIn: '' });
  setPicked({ id, whenIn: lookedProject(ctx) });
}

/** Which project this place shows, and the press that changes it (nothing to change with only one). */
export function projectSwitch(ctx: Ctx, projects: readonly Project[], here: Project): Node {
  const name = line(span(here.name, { weight: 'semibold' }));
  if (projects.length < 2) return name;
  return ctx.draw.button('project:pick', here.name, () => ctx.go({ name: 'pick-project', params: { here: here.id, place: ctx.route.name } }), { plain: true, hotkey: 'c', spans: [span(here.name, { weight: 'semibold' }), span('  Change', { dim: true })] });
}

export function pickProjectPage(ctx: Ctx): Node {
  const projects = realProjects(ctx);
  const list = windowed(ctx, 'pick-project', projects);
  return subPage(
    ctx,
    ctx.route.params?.place ?? 'tasks',
    'Back',
    list.earlier,
    ...list.rows.map((p) =>
      ctx.draw.button(
        `pick:${p.id}`,
        p.name,
        () => {
          pickProject(ctx, p.id);
          ctx.nav.back(ctx.pane);
        },
        { plain: true, ...(p.id === ctx.route.params?.here ? {} : { dim: true }) },
      ),
    ),
    list.more,
    projects.length === 0 && empty('No projects yet.'),
  );
}

/** Who else sees a project's tasks: teammates on its board, or Linear. Their names, or nothing when it's only you. */
export function sharedWith(ctx: Ctx, projectId: string): string | undefined {
  const mates = teammatesOf(ctx.state.team, projectId).map((m) => m.name);
  const all = [...mates, ...(ctx.state.board.sync?.[projectId] ? ['Linear'] : [])];
  return all.length ? (all.length === 1 ? all[0] : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`) : undefined;
}

/** A worktree that just started: the engine may have gone there first. */
export function openStarted(ctx: Ctx, id: string): void {
  const at = ctx.nav.routeOf(ctx.pane);
  if (at.screen !== 'task' || at.params?.id !== id) openWorkspace(ctx, id);
}

/** A form is done and leads on to `route`: Back then skips the form, whether or not the engine got there first. */
export function leadOn(ctx: Ctx, form: string, route: Route): void {
  const same = (r: Route): boolean => r.name === route.name && r.params?.id === route.params?.id;
  for (let at = ctx.nav.routeOf(ctx.pane); ctx.nav.canGoBack(ctx.pane) && (at.name === form || same(at)); at = ctx.nav.routeOf(ctx.pane)) ctx.nav.back(ctx.pane);
  ctx.go(route);
}

// ---- values from GitHub

export interface Asked<T> extends Loaded<T> {
  /** Ask GitHub again, keeping what's shown until it answers. */
  readonly refresh: () => void;
}

/** A value read through gh: kept while it's fresh, with a way to ask again that doesn't blank the page. */
export function fromGitHub<T>(ctx: Ctx, key: string, ttlMs: number, ask: (force: boolean) => Promise<T>): Asked<T> {
  const [forced, setForced] = ctx.local(`${key}:force`, false);
  const loaded = ctx.load<T>(
    key,
    async () => {
      try {
        return await ask(forced);
      } finally {
        if (forced) setForced(false);
      }
    },
    { ttlMs: forced ? -1 : ttlMs },
  );
  return { ...loaded, refresh: () => setForced(true) };
}

/** What a value from GitHub says while there's none: asking, or what went wrong and Try Again. */
export function readingWords(ctx: Ctx, key: string, loaded: Asked<unknown>, asked: string, failed: string): Node | undefined {
  if (loaded.value !== undefined) return loaded.error ? dim(`Couldn’t ask again: ${loaded.error}`) : undefined;
  if (!loaded.error) return dim(asked);
  return col([text(failed, { color: 'error' }), dim(loaded.error), ctx.draw.button(`${key}:retry`, 'Try Again', () => ctx.refresh(key), { plain: true })]);
}

export type Readable = { readonly kind: 'none' } | { readonly kind: 'no_gh'; readonly repo: { readonly owner: string; readonly repo: string } } | { readonly kind: 'error'; readonly message: string };

/** Why there's nothing to list: no repository, gh not set up, or GitHub said no. */
export function notReadable(ctx: Ctx, list: Readable, what: string, refresh: () => void): Node {
  const again = (words: string): Node => ctx.draw.button('github:again', words, refresh, { plain: true });
  switch (list.kind) {
    case 'none':
      return col([text('This project isn’t on GitHub.'), dim(`${what} come from the GitHub repository a project’s origin remote points to. Push it to GitHub, or pick another project.`)]);
    case 'no_gh':
      return col([text('Connect GitHub'), dim(`${list.repo.owner}/${list.repo.repo} is read with GitHub’s command-line tool, signed in as you. Set it up once (brew install gh, then gh auth login), then check again.`), again('Check Again')]);
    case 'error':
      return col([text(`Couldn’t read the ${what.toLowerCase()}`, { color: 'error' }), dim(list.message), again('Try Again')]);
  }
}

const watching = new Map<string, NodeJS.Timeout>();

/**
 * Draw again in a while: a pane only draws when something changes, and a run on GitHub changes
 * nothing here. A view no longer shown isn't drawn, so its next look never comes and this ends.
 */
export function drawAgain(ctx: Ctx, key: string, ms: number): void {
  if (watching.has(key)) return;
  const timer = setTimeout(() => {
    watching.delete(key);
    ctx.refresh(`watch:${key}`);
  }, ms);
  timer.unref?.();
  watching.set(key, timer);
}
