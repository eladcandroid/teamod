import type { AgentOrigin } from '../../core/claude-code/model.js';
import type { AppState } from '../../core/store.js';
import type { StaleWorktree, WorktreeInfo } from '../../core/other-worktrees.js';
import type { OutsideConversation } from '../../core/workspace-controller.js';
import { formatBytes } from '../../shared/format.js';
import type { ArchivePhase, ArchivePreview } from '../../workspaces/archive.js';
import type { OriginInfo } from '../../workspaces/origin.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Project, Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { ago, back, chrome, empty, findWorkspace, homePath, openWorkspace, page } from './common.js';
import { agoWords, askFirst, findField, loadingWords, openOnce, placesOf, plural, segments, steady, uniqueBy, windowed, worktreeRoute } from './work-common.js';

/**
 * Every worktree in your projects, made here, by sub-agents or outside: who made it, whether it's
 * done, the space it takes. Tick the ones you're done with and archive, free or delete them; each
 * has a page of its own. Cleaning up what sub-agents and other tools left, and bringing in a
 * conversation from outside, live here too.
 */

export type MadeBy =
  | { readonly kind: 'teamod'; readonly label: string }
  | { readonly kind: 'outside'; readonly label: string }
  /** A sub-agent's: what it was asked, the conversation that started it, or that it's gone. */
  | { readonly kind: 'agent'; readonly label: string; readonly task?: string; readonly parentId?: string; readonly orphan?: true };

export interface WorktreeRow {
  readonly ws: Workspace;
  readonly project: Project;
  readonly madeBy: MadeBy;
  /** Its work is done (merged, or nothing that isn't in main yet), in words. */
  readonly work: { readonly done: boolean; readonly label: string };
  /** Archived: whether it can come back (from its archive or its branch). */
  readonly archived?: { readonly restorable: boolean; readonly at?: number };
  readonly size?: number;
  readonly archiving?: ArchivePhase;
}

type Filter = 'all' | 'done' | 'agents' | 'orphaned' | 'outside' | 'archived';

const FILTERS: ReadonlyArray<{ readonly id: Filter; readonly label: string; readonly hint: string }> = [
  { id: 'all', label: 'All', hint: 'Every worktree in your projects' },
  { id: 'done', label: 'Done', hint: 'Merged, or nothing in them that isn’t in main yet' },
  { id: 'agents', label: 'Sub-agents', hint: 'Worktrees sub-agents made for themselves' },
  { id: 'orphaned', label: 'Orphaned', hint: 'Sub-agent worktrees whose conversation is gone' },
  { id: 'outside', label: 'Made Outside', hint: 'By sub-agents, other apps, scripts or by hand' },
  { id: 'archived', label: 'Archived', hint: 'Put away: restore them as they were, or delete them for good' },
];

const ARCHIVING: Readonly<Record<ArchivePhase, string>> = { saving: 'Saving...', compressing: 'Compressing...', removing: 'Removing...' };

function madeByOf(state: AppState, ws: Workspace, origin: AgentOrigin | undefined): MadeBy {
  const from = worktreeOrigin(ws);
  if (from === 'teamod') return { kind: 'teamod', label: 'teamod' };
  if (from === 'external') return { kind: 'outside', label: 'Made outside' };
  if (!origin) return { kind: 'agent', label: 'Sub-agent, origin unknown', orphan: true };
  const parent = origin.workspaceId ? findWorkspace(state, origin.workspaceId) : undefined;
  const task = origin.description ? { task: origin.description } : {};
  if (parent && !parent.archived) return { kind: 'agent', label: `Sub-agent of “${parent.kind === 'main' ? (origin.sessionTitle ?? parent.name) : parent.name}”`, ...task, parentId: parent.id };
  return { kind: 'agent', label: `Sub-agent of “${origin.sessionTitle ?? 'a session'}” (gone)`, ...task, orphan: true };
}

function workOf(state: AppState, ws: Workspace): WorktreeRow['work'] {
  const changed = ws.status?.changed ?? 0;
  if (changed) return { done: false, label: plural(changed, 'uncommitted file') };
  const pr = state.prs[ws.id];
  if (pr?.state === 'MERGED') return { done: true, label: `Merged (#${pr.number})` };
  const ahead = ws.status?.ahead;
  if (ahead === 0) return { done: true, label: 'Nothing new' };
  if (ahead === undefined) return { done: false, label: 'Not checked yet' };
  return { done: false, label: `${plural(ahead, 'commit')} not in main` };
}

/** Every live worktree, biggest first; then the archived ones, the latest first. */
export function worktreeRows(state: AppState): WorktreeRow[] {
  const origins = new Map(state.claudeCode.origins.map((o) => [o.path, o]));
  const live = state.projects
    .flatMap((project) =>
      project.workspaces
        .filter((ws) => ws.kind === 'worktree' && !ws.archived)
        .map((ws): WorktreeRow => {
          const size = state.disk[ws.id];
          const archiving = state.archiving[ws.id];
          return { ws, project, madeBy: madeByOf(state, ws, origins.get(ws.path)), work: workOf(state, ws), ...(size !== undefined ? { size } : {}), ...(archiving ? { archiving } : {}) };
        }),
    )
    .sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.ws.name.localeCompare(b.ws.name));
  const put = state.projects
    .flatMap((project) =>
      project.workspaces
        .filter((ws) => ws.kind === 'worktree' && ws.archived)
        .map((ws): WorktreeRow => {
          const by = worktreeOrigin(ws);
          const madeBy: MadeBy = by === 'teamod' ? { kind: 'teamod', label: 'teamod' } : by === 'agent' ? { kind: 'agent', label: 'Sub-agent' } : { kind: 'outside', label: 'Made outside' };
          return { ws, project, madeBy, work: { done: true, label: 'Archived' }, archived: { restorable: Boolean(ws.archive || ws.branch), ...(ws.archive ? { at: ws.archive.at } : {}) } };
        }),
    )
    .sort((a, b) => (b.archived?.at ?? b.ws.createdAt) - (a.archived?.at ?? a.ws.createdAt) || a.ws.name.localeCompare(b.ws.name));
  return [...live, ...put];
}

export function filterRows(rows: readonly WorktreeRow[], filter: Filter, projectId?: string): WorktreeRow[] {
  return rows.filter((r) => {
    if (projectId && r.project.id !== projectId) return false;
    if ((filter === 'archived') !== Boolean(r.archived)) return false;
    if (filter === 'done') return r.work.done;
    if (filter === 'agents') return r.madeBy.kind === 'agent';
    if (filter === 'orphaned') return r.madeBy.kind === 'agent' && Boolean(r.madeBy.orphan);
    if (filter === 'outside') return r.madeBy.kind !== 'teamod';
    return true;
  });
}

const sizeWords = (bytes: number | undefined): string => (bytes !== undefined ? formatBytes(bytes) : '–');

/** Who made it, in a word or two. */
const madeWords = (by: MadeBy): string => (by.kind === 'teamod' ? 'teamod' : by.kind === 'outside' ? 'Outside' : by.orphan ? 'Sub-agent, gone' : 'Sub-agent');

/** Sizes as they are now, measured at most this often while a page shows them (it walks every worktree's folder). */
const MEASURE_MS = 120_000;
export function measureDisk(ctx: Ctx): Node | undefined {
  const measured = ctx.load('work:measured', () => ctx.call('workbench.measureDisk'), { ttlMs: MEASURE_MS });
  return measured.error ? dim(`Couldn’t measure disk space: ${measured.error}`) : undefined;
}

/** Who can be in the popup: projects that have worktrees. */
function projectPicker(ctx: Ctx, projectId: string | undefined): Node | undefined {
  const projects = ctx.state.projects.filter((p) => p.root && p.workspaces.some((w) => w.kind === 'worktree'));
  if (projects.length < 2) return undefined;
  return ctx.draw.select(
    'worktrees:project',
    [{ value: '', label: 'All Projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    (value) => ctx.go({ name: 'worktrees', params: value ? { project: value } : {} }),
    { label: 'In', value: projectId ?? '' },
  );
}

function worktreeLine(ctx: Ctx, r: WorktreeRow, picked: boolean, tick: () => void): Node {
  const name = r.madeBy.kind === 'agent' ? (r.madeBy.task ?? r.ws.name) : r.ws.name;
  const phase = r.archiving ? ARCHIVING[r.archiving] : undefined;
  return row([
    r.archiving ? dim('   ') : ctx.draw.button(`wt:${r.ws.id}:tick`, picked ? '[x]' : '[ ]', tick, { plain: true, ...(picked ? {} : { dim: true }) }),
    ctx.draw.button(`wt:${r.ws.id}`, name, () => ctx.go(worktreeRoute(r.ws.id)), {
      plain: true,
      spans: [
        span(name),
        span(`  ${r.project.name}  ${madeWords(r.madeBy)}  `, { dim: true }),
        phase
          ? span(phase, { color: 'claude' })
          : r.archived
            ? span(r.archived.restorable ? (r.ws.archive ? 'Comes back as it was' : 'Comes back from its branch') : 'Can’t come back', r.archived.restorable ? { dim: true } : { color: 'warning' })
            : span(r.work.label, r.work.done ? { color: 'success' } : { dim: true }),
        ...(r.archived ? [] : [span(`  ${sizeWords(r.size)}`, { dim: true })]),
      ],
    }),
  ]);
}

export function worktreesPage(ctx: Ctx, projectId: string | undefined): Node {
  const measuring = measureDisk(ctx);
  const [filter, setFilter] = ctx.local<Filter>('worktrees:filter', 'all');
  const [tickedIds, setTicked] = ctx.local<readonly string[]>('worktrees:ticked', []);
  const rows = worktreeRows(ctx.state);
  const shown = filterRows(rows, filter, projectId);
  const picked = shown.filter((r) => tickedIds.includes(r.ws.id) && !r.archiving);
  const window = windowed(ctx, 'worktrees', shown, { keys: true });
  const hint = FILTERS.find((f) => f.id === filter)?.hint ?? '';
  const archivedView = filter === 'archived';
  const live = filterRows(rows, archivedView ? 'all' : filter, projectId);
  const bytes = live.reduce((n, r) => n + (r.size ?? 0), 0);
  const unmeasured = live.filter((r) => r.size === undefined).length;
  const ids = picked.map((r) => r.ws.id).join(',');
  const canClean = ctx.state.projects.some((p) => (!projectId || p.id === projectId) && p.workspaces.some((w) => w.kind === 'worktree' && w.external && !w.archived));
  return page(
    chrome(ctx, placesOf(ctx), 'worktrees'),
    back(ctx),
    dim(archivedView ? `${plural(shown.length, 'archived worktree')}: restore one as it was, or delete it for good` : `${plural(live.length, 'worktree')}, ${formatBytes(bytes)}${unmeasured ? `, measuring ${unmeasured} more` : ''}`),
    measuring,
    segments(
      ctx,
      'filter',
      FILTERS.map((f) => ({ value: f.id, label: `${f.label} ${filterRows(rows, f.id, projectId).length}` })),
      filter,
      setFilter,
    ),
    projectPicker(ctx, projectId),
    shown.length === 0 && empty(rows.length ? `Nothing here. ${hint}.` : 'No worktrees yet. Those made here, by sub-agents or by other tools show up with the space they take.'),
    col(window.shown.map((r) => worktreeLine(ctx, r, tickedIds.includes(r.ws.id), () => setTicked(tickedIds.includes(r.ws.id) ? tickedIds.filter((id) => id !== r.ws.id) : [...tickedIds, r.ws.id])))),
    window.controls,
    picked.length > 0 &&
      row([
        dim(`${picked.length} selected`),
        ...(archivedView
          ? [
              ctx.draw.button('batch:restore', 'Restore', async () => {
                for (const r of picked.filter((x) => x.archived?.restorable)) await ctx.call('workspaces.restore', r.ws.id);
                setTicked([]);
              }, { primary: true, hotkey: 'a' }),
            ]
          : [
              ctx.draw.button('batch:archive', 'Archive', () => askFirst(ctx, 'archive', { ids }), { primary: true, hotkey: 'a' }),
              ctx.draw.button('batch:free', 'Remove Build Files', () => askFirst(ctx, 'free', { ids }), { plain: true, hotkey: 'e' }),
            ]),
        ctx.draw.button('batch:delete', 'Delete', () => askFirst(ctx, 'delete', { ids }), { plain: true, dim: true }),
        ctx.draw.button('batch:clear', 'Deselect', () => setTicked([]), { plain: true, dim: true }),
      ]),
    !picked.length && (canClean || projectId)
      ? row([
          canClean ? ctx.draw.button('worktrees:clean', 'Clean Up', () => ctx.go({ name: 'clean', params: projectId ? { project: projectId } : {} }), { plain: true, dim: true, hotkey: 'c' }) : undefined,
          projectId ? ctx.draw.button('worktrees:import', 'Import a Conversation', () => ctx.go({ name: 'import', params: { project: projectId } }), { plain: true, dim: true, hotkey: 'n' }) : undefined,
        ])
      : undefined,
  );
}

// ---------------------------------------------------------------- one worktree

const dayWords = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** What a worktree made outside is, from git and the other tools' own records. */
function outsideFacts(ctx: Ctx, ws: Workspace): Node {
  const loaded = ctx.load<WorktreeInfo | undefined>(`wt-info:${ws.id}`, async () => (await ctx.call('workspaces.worktreeInfo', ws.id)) as WorktreeInfo | undefined, { ttlMs: 15_000 });
  const info = loaded.value;
  const talked = ctx.state.log.some((l) => l.channel === `ws:${ws.id}` && !/^(t-\d+|import-)/.test(l.id));
  return col([
    loadingWords(loaded, 'Looking...', 'Couldn’t look'),
    info && col([
      line(span(info.origin.label, { weight: 'semibold' })),
      dim(info.origin.detail),
      info.stale ? text(`Safe to remove: ${(info.staleText ?? '').toLowerCase()}.`, { color: 'success' }) : undefined,
      info.missing ? text('Its folder is gone. Git still lists it; removing it tidies that up.', { color: 'warning' }) : undefined,
      dim(`Branch: ${info.branch ?? 'None (detached)'}  Based on: ${info.base}`),
      info.createdAt ? dim(`Made: ${dayWords(info.createdAt)}`) : undefined,
      info.lastCommit ? dim(`Last commit: ${agoWords(info.lastCommit.at)}, ${info.lastCommit.subject}`) : undefined,
      dim(`Compared with its base: ${plural(info.ahead, 'commit')} ahead, ${info.behind} behind${info.merged ? ', all merged' : ''}`),
      dim(`Uncommitted: ${info.changed ? plural(info.changed, 'file') : 'nothing'}`),
      info.creator ? dim(`Made by a session${info.creator.title ? `: “${info.creator.title}”` : ''}${info.creator.cwd ? ` (ran in ${info.creator.cwd})` : ''}`) : undefined,
      info.conversations.length > 0 && dim(`Earlier conversations (${info.conversations.length})`),
      ...uniqueBy(info.conversations, (c) => c.sessionId).slice(0, 20).map((c) =>
        row([
          line(c.title, span(`  ${ago(c.lastModified)}`, { dim: true })),
          !talked && !ws.sessionId
            ? ctx.draw.button(`convo:${c.sessionId}`, 'Show', async () => {
                await ctx.call('workspaces.showConversation', ws.id, c.sessionId);
                openOnce(ctx, ws.id);
              }, { plain: true })
            : undefined,
        ]),
      ),
      info.conversations.length === 0 && dim('No conversation ran in this folder, so there’s nothing to continue.'),
    ]),
  ]);
}

export function worktreePage(ctx: Ctx, id: string): Node {
  const ws = findWorkspace(ctx.state, id);
  if (!ws) return page(chrome(ctx, placesOf(ctx), 'worktrees'), back(ctx), empty('That worktree is gone.'));
  const measuring = measureDisk(ctx);
  const r = worktreeRows(ctx.state).find((x) => x.ws.id === id);
  const plan = ws.archived ? undefined : ctx.load<ArchivePreview | undefined>(`wt-plan:${id}`, async () => (await ctx.call('workspaces.archivePlan', id)) as ArchivePreview | undefined, { ttlMs: 30_000 });
  const parent = r?.madeBy.kind === 'agent' ? r.madeBy.parentId : undefined;
  const outside = ws.kind === 'worktree' && ws.external && !ws.archived;
  return page(
    chrome(ctx, placesOf(ctx), 'worktrees'),
    back(ctx),
    col([title(r?.madeBy.kind === 'agent' ? (r.madeBy.task ?? ws.name) : ws.name), dim([r?.project.name, ws.branch].filter(Boolean).join('  '))]),
    r && line(span('Made by: ', { dim: true }), r.madeBy.label),
    r && line(span('Its work: ', { dim: true }), span(r.work.label, r.work.done ? { color: 'success' } : {})),
    measuring,
    plan?.error ? dim(`Couldn’t look at its build files: ${plan.error}`) : undefined,
    !ws.archived && line(span('Size: ', { dim: true }), sizeWords(r?.size), plan?.value && plan.value.dropBytes ? span(`, ${formatBytes(plan.value.dropBytes)} is build files`, { dim: true }) : undefined),
    plan && plan.value && plan.value.drop.length > 0 ? dim(plan.value.drop.slice(0, 6).map((d) => `${d.path} (${d.what}): ${formatBytes(d.bytes)}`).join('\n')) : undefined,
    dim(homePath(ctx.state, ws.path)),
    r?.archiving ? text(ARCHIVING[r.archiving], { color: 'claude' }) : undefined,
    ws.archived
      ? row([
          r?.archived?.restorable ? ctx.draw.button('wt:restore', 'Restore', () => ctx.call('workspaces.restore', id), { primary: true, hotkey: 'a' }) : dim('Can’t come back: there’s no archive and no branch to make it from.'),
          ctx.draw.button('wt:read', 'Read Its Conversation', () => openWorkspace(ctx, id), { plain: true }),
          ctx.draw.button('wt:delete', 'Delete', () => askFirst(ctx, 'delete', { ids: id }), { plain: true, dim: true }),
        ])
      : col([
          ctx.draw.button('wt:open', 'Open', () => openWorkspace(ctx, id), { primary: true, hotkey: 'a' }),
          row([
            parent ? ctx.draw.button('wt:parent', 'Open the Conversation That Started It', () => openWorkspace(ctx, parent), { plain: true }) : undefined,
            !r?.archiving && ctx.draw.button('wt:archive', 'Archive', () => askFirst(ctx, 'archive', { ids: id }), { plain: true, hotkey: 'e' }),
            !r?.archiving && ctx.draw.button('wt:free', 'Remove Build Files', () => askFirst(ctx, 'free', { ids: id }), { plain: true, ...(plan?.value && !plan.value.dropBytes ? { dim: true } : {}) }),
            !r?.archiving && (outside ? ctx.draw.button('wt:remove-other', 'Remove Worktree', () => askFirst(ctx, 'remove-other', { id }), { plain: true, dim: true }) : ctx.draw.button('wt:delete', 'Delete', () => askFirst(ctx, 'delete', { ids: id }), { plain: true, dim: true })),
          ]),
        ]),
    outside ? outsideFacts(ctx, ws) : undefined,
  );
}

// ---------------------------------------------------------------- cleaning up

const agentsIn = (p: Project): Workspace[] => p.workspaces.filter((w) => !w.archived && worktreeOrigin(w) === 'agent');
const outsideIn = (p: Project): Workspace[] => p.workspaces.filter((w) => w.kind === 'worktree' && w.external && !w.archived);

/** What sub-agents and other tools left, one project at a time: branches stay, and nothing uncommitted goes. */
export function cleanPage(ctx: Ctx, projectId: string | undefined): Node {
  if (!projectId) {
    const projects = ctx.state.projects.filter((p) => p.root && outsideIn(p).length > 0);
    const window = windowed(ctx, 'clean', projects, { keys: true });
    return page(
      chrome(ctx, placesOf(ctx), 'worktrees'),
      back(ctx),
      title('Clean Up Worktrees'),
      dim('What sub-agents and other tools left in your projects.'),
      projects.length === 0 && empty('Nothing to clean up.'),
      ...window.shown.map((p) => {
        const agents = agentsIn(p).length;
        const others = outsideIn(p).length - agents;
        const said = [agents ? plural(agents, 'from a sub-agent', 'from sub-agents') : '', others ? `${others} made outside` : ''].filter(Boolean).join(', ');
        return ctx.draw.button(`clean:${p.id}`, p.name, () => ctx.go({ name: 'clean', params: { project: p.id } }), { plain: true, spans: [span(p.name), span(`  ${said}`, { dim: true })] });
      }),
      window.controls,
    );
  }
  const project = ctx.state.projects.find((p) => p.id === projectId);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'worktrees'), back(ctx), empty('That project is gone.'));
  const measuring = measureDisk(ctx);
  const agents = agentsIn(project);
  const finished = agents.filter((w) => w.status?.changed === 0).length;
  const stale = steady<readonly StaleWorktree[]>(ctx, `stale:${project.id}`, async () => ((await ctx.call('workspaces.staleOthers', project.id)) ?? []) as readonly StaleWorktree[], { ttlMs: 15_000 });
  const safe = stale.value ?? [];
  const [off, setOff] = ctx.local<readonly string[]>(`clean:${project.id}:off`, []);
  const chosen = safe.filter((w) => !off.includes(w.id));
  const frees = chosen.reduce((n, w) => n + (ctx.state.disk[w.id] ?? 0), 0);
  const origins = ctx.load<Readonly<Record<string, OriginInfo>>>(`origins:${project.id}`, async () => ((await ctx.call('workspaces.otherOrigins', project.id)) ?? {}) as Readonly<Record<string, OriginInfo>>, { ttlMs: 30_000 });
  const activity = ctx.load<Readonly<Record<string, number>>>(`activity:${project.id}`, async () => ((await ctx.call('workspaces.otherActivity', project.id)) ?? {}) as Readonly<Record<string, number>>, { ttlMs: 30_000 });
  const others = [...outsideIn(project)].sort((a, b) => (activity.value?.[b.id] ?? b.createdAt) - (activity.value?.[a.id] ?? a.createdAt) || a.name.localeCompare(b.name));
  const window = windowed(ctx, `clean:${project.id}:others`, others, { size: 20 });
  return page(
    chrome(ctx, placesOf(ctx), 'worktrees'),
    back(ctx),
    title(`Clean Up ${project.name}`),
    measuring,
    agents.length > 0 &&
      col([
        dim(`${plural(agents.length, 'worktree')} sub-agents made, ${finished} with no uncommitted changes. Removing them keeps their branches, so no commits are lost.`),
        finished > 0 && ctx.draw.button('clean:agents', `Remove ${plural(finished, 'Finished Worktree')}`, () => askFirst(ctx, 'clean-agents', { project: project.id }), { plain: true }),
      ]),
    loadingWords(stale, 'Looking at the worktrees made outside...', 'Couldn’t look at them'),
    stale.value && safe.length === 0 && others.length > 0 ? dim('Every worktree made outside here still has work of its own, or is still in use.') : undefined,
    safe.length > 0 &&
      col([
        dim(`These can go without losing anything${frees ? `, about ${formatBytes(frees)}` : ''}. Branches stay.`),
        ...safe.slice(0, 40).map((w) =>
          ctx.draw.button(`stale:${w.id}`, w.name, () => setOff(off.includes(w.id) ? off.filter((id) => id !== w.id) : [...off, w.id]), {
            plain: true,
            spans: [span(off.includes(w.id) ? '[ ] ' : '[x] ', off.includes(w.id) ? { dim: true } : {}), span(w.name), span(`  ${w.reasonText}`, { dim: true })],
          }),
        ),
        chosen.length > 0 && ctx.draw.button('clean:others', `Remove ${chosen.length}`, () => askFirst(ctx, 'clean-others', { project: project.id, ids: chosen.map((w) => w.id).join(',') }), { primary: true, hotkey: 'a' }),
      ]),
    others.length > 0 &&
      col([
        dim(`All made outside (${others.length}), the latest first`),
        ...window.shown.map((w) => {
          const at = activity.value?.[w.id];
          return ctx.draw.button(`other:${w.id}`, w.name, () => ctx.go(worktreeRoute(w.id)), { plain: true, spans: [span(w.name), span(`  ${origins.value?.[w.id]?.label ?? 'Made outside'}${at ? `, ${agoWords(at)}` : ''}  ${sizeWords(ctx.state.disk[w.id])}`, { dim: true })] });
        }),
        window.controls,
      ]),
    agents.length === 0 && others.length === 0 && empty('Nothing to clean up here.'),
  );
}

// ---------------------------------------------------------------- bringing a conversation in

/** Where a conversation ran, said from the folder looked in. */
const whereIn = (state: AppState, dir: string, cwd: string): string => (cwd === dir ? '' : cwd.startsWith(`${dir}/`) ? cwd.slice(dir.length + 1) : homePath(state, cwd));

/** A conversation you had outside (a terminal, an IDE): pick one and your agent goes on with it in a new worktree. The original stays as it was. */
export function importPage(ctx: Ctx, projectId: string, dir: string | undefined): Node {
  const project = ctx.state.projects.find((p) => p.id === projectId);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'worktrees'), back(ctx), empty('That project is gone.'));
  const key = `outside:${project.id}:${dir ?? ''}`;
  const loaded = ctx.load<{ readonly dir: string; readonly conversations: readonly OutsideConversation[] }>(key, async () => (await ctx.call('workspaces.outsideConversations', project.id, ...(dir ? [dir] : []))) as { dir: string; conversations: readonly OutsideConversation[] }, { ttlMs: 20_000 });
  const found = loaded.value;
  const all = uniqueBy(found?.conversations ?? [], (c) => c.sessionId);
  const find = findField(ctx, `import:${project.id}`, 'Find a conversation');
  const q = find.query.toLowerCase();
  const shown = q ? all.filter((c) => c.title.toLowerCase().includes(q) || c.cwd.toLowerCase().includes(q)) : all;
  const [picked, setPicked] = ctx.local<string | undefined>(`${key}:picked`, undefined);
  const [choosing, setChoosing] = ctx.local(`${key}:choosing`, false);
  const chosen = all.find((c) => c.sessionId === picked);
  const looking = found?.dir ?? dir ?? project.root;
  const window = windowed(ctx, key, shown, { size: 30, keys: true });
  return page(
    chrome(ctx, placesOf(ctx), 'worktrees'),
    back(ctx, project.name),
    title('Import a Conversation'),
    dim(`Your agent goes on with it in a new worktree of ${project.name}. The original stays as it was.`),
    line(span('From: ', { dim: true }), homePath(ctx.state, looking), span('  and the folders inside it', { dim: true })),
    choosing
      ? ctx.draw.input(
          'import:dir',
          (value) => {
            setChoosing(false);
            const next = value?.trim();
            if (next) ctx.go({ name: 'import', params: { project: project.id, dir: next } });
          },
          { label: 'Folder', value: looking, submitLabel: 'look', autoFocus: true },
        )
      : ctx.draw.button('import:another', 'Choose Another Folder', () => setChoosing(true), { plain: true, dim: true, hotkey: 'e' }),
    loadingWords(loaded, 'Looking for conversations...', 'Couldn’t look for conversations'),
    found && all.length === 0 ? empty('No conversation ran in this folder or inside it. Choose another folder, the one you started it in.') : undefined,
    all.length > 8 && find.node,
    q && shown.length === 0 ? empty(`Nothing matches “${find.query}”.`) : undefined,
    chosen &&
      found &&
      (chosen.wsId
        ? ctx.draw.button('import:open', 'Open Its Worktree', () => openWorkspace(ctx, chosen.wsId!), { primary: true, hotkey: 'a' })
        : ctx.draw.input(
            `import:name:${chosen.sessionId}`,
            async (value) => {
              const id = await ctx.call('workspaces.importOutside', project.id, found.dir, chosen.sessionId, value?.trim() || chosen.title.slice(0, 120));
              setPicked(undefined);
              if (typeof id === 'string') openOnce(ctx, id);
            },
            { label: 'Name', value: chosen.title.slice(0, 120), submitLabel: 'continue in a worktree', autoFocus: true },
          )),
    ...window.shown.map((c) => {
      const where = found ? whereIn(ctx.state, found.dir, c.cwd) : '';
      const facts = [c.wsId ? 'Brought in already' : '', where, `${agoWords(c.lastModified)}`, formatBytes(c.bytes)].filter(Boolean).join('  ');
      return ctx.draw.button(`convo:${c.sessionId}`, c.title, () => setPicked(c.sessionId), { plain: true, spans: [span(c.sessionId === picked ? '> ' : '  '), span(c.title), span(`  ${facts}`, { dim: true })] });
    }),
    window.controls,
  );
}
