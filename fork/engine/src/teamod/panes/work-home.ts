import type { GhPull, PullsList } from '../../core/issues/model.js';
import type { AgentRef } from '../../protocol.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../../ui/agent-choice.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { StashUpdateOutcome, UpdateOutcome } from '../../workspaces/sync.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Project, ProjectSync, Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, line, row, span, text, title } from '../tree.js';
import { type Tone, actions, back, card, chrome, empty, homePath, meta, openWorkspace, page, pill, section } from './common.js';
import { CARD_LIMIT, activeOf, agoWords, askFirst, backTo, isReady, openOnce, placesOf, plural, windowed, workspaceCard, workspaceRow } from './work-common.js';

/**
 * A project's home: how its main folder stands against origin, the box that starts work, what's in
 * progress, its open pull requests, its scripts and what was put away.
 */

// ---------------------------------------------------------------- main against origin

interface MainLine {
  readonly label: string;
  readonly style: Omit<Span, 't'>;
  readonly dirty?: string;
  readonly elsewhere?: string;
  readonly canUpdate?: boolean;
}

const OK: Omit<Span, 't'> = { color: 'success' };
const WARN: Omit<Span, 't'> = { color: 'warning' };
const QUIET: Omit<Span, 't'> = { dim: true };

/** How the default branch compares with its remote, as of the last fetch, and where the main folder is when it's elsewhere. */
function mainLineOf(sync: ProjectSync): MainLine {
  const where = sync.onDefault ? 'main' : 'the main folder';
  const extra = { ...(sync.dirty ? { dirty: `${plural(sync.dirty, 'uncommitted change')} in ${where}` } : {}), ...(sync.onDefault ? {} : { elsewhere: `The main folder is on ${sync.current ?? 'a detached HEAD'}` }) };
  const up = sync.upstream;
  if (!up) return { label: 'Not tracking a remote branch', style: QUIET, ...extra };
  if (!sync.local) return { label: `Only on ${up} so far`, style: {}, canUpdate: true, ...extra };
  if (!sync.ahead && !sync.behind) return { label: `Up to date with ${up}`, style: OK, ...extra };
  const label = sync.ahead && sync.behind ? `${sync.ahead} ahead, ${sync.behind} behind ${up}` : sync.ahead ? `${sync.ahead} ahead of ${up}` : `${sync.behind} behind ${up}`;
  return { label, style: sync.ahead ? WARN : {}, ...(sync.behind ? { canUpdate: true } : {}), ...extra };
}

const toneOf = (style: Omit<Span, 't'>): Tone => (style === OK ? 'ok' : style === WARN ? 'warn' : style === QUIET ? 'quiet' : 'info');

/** Main against origin in a glance, for a project's card: `main · ✓ Up to date` or `main · ↓ 2`. */
export function syncParts(sync: ProjectSync | undefined): Span[] {
  if (!sync) return [];
  const branch = span(sync.branch, { dim: true });
  if (sync.fetching) return [branch, pill('Fetching...', 'quiet', '◌')];
  if (!sync.upstream) return [branch, pill('No remote', 'quiet', '○')];
  if (!sync.local) return [branch, pill('New on the remote', 'info', '↓')];
  if (!sync.ahead && !sync.behind) return [branch, pill('Up to date', 'ok', '✓')];
  const arrows = [sync.ahead ? `↑ ${sync.ahead}` : '', sync.behind ? `↓ ${sync.behind}` : ''].filter(Boolean).join('  ');
  return [branch, span(arrows, sync.ahead ? { color: 'warning' } : { color: 'claude' })];
}

/** What an update came back with that needs you (the rest the engine already said). */
type Asking =
  | { readonly kind: 'dirty'; readonly files: readonly string[]; readonly behind: number }
  /** `inMain`: stuck in the main folder's own files, so the agent works there (else in a worktree). */
  | { readonly kind: 'agent'; readonly heading: string; readonly message: string; readonly inMain?: boolean }
  | { readonly kind: 'conflicts'; readonly files: readonly string[]; readonly message: string }
  | { readonly kind: 'switch'; readonly dirty: number };

const fetchAsking = (message: string, detail?: string): Asking => ({ kind: 'agent', heading: 'Couldn’t fetch', message: detail && !message.includes(detail) ? `${message} Git said: ${detail}` : message });

function askingOf(out: UpdateOutcome | StashUpdateOutcome, branch: string): Asking | undefined {
  if ('restored' in out && !out.restored) {
    return { kind: 'conflicts', files: out.conflicts ?? [], message: `${branch} is up to date, but putting your changes back conflicted with the new commits. Your changes are safe in the stash “${out.stash?.message ?? 'teamod'}”, and the files have conflict markers.` };
  }
  switch (out.kind) {
    case 'dirty':
      return { kind: 'dirty', files: out.files, behind: out.behind };
    case 'diverged':
      return { kind: 'agent', heading: `${out.branch} and ${out.upstream} have both moved on`, message: `${out.branch} has ${plural(out.ahead, 'commit')} not on ${out.upstream}, and ${out.upstream} has ${plural(out.behind, 'new commit')}. Bringing them together takes a merge or a rebase.` };
    case 'busy':
      return { kind: 'agent', inMain: true, heading: `A ${out.operation} is stopped halfway in main`, message: `The main folder is in the middle of a ${out.operation} (there are conflicts to resolve). Your agent can finish it and then update ${branch}.` };
    case 'failed':
      return { kind: 'agent', heading: `Couldn’t update ${branch}`, message: out.message };
    case 'fetch_failed':
      return fetchAsking(out.message, out.detail);
    default:
      return undefined;
  }
}

/** Files named in a question: the first few are enough to recognize. */
const someFiles = (files: readonly string[]): Node | undefined => (files.length ? dim(`${files.slice(0, 8).join(', ')}${files.length > 8 ? ` and ${files.length - 8} more` : ''}`) : undefined);

/** What can't simply fast-forward asks: set your changes aside, move them to a worktree, or let your agent do it. */
function askingCard(ctx: Ctx, project: Project, sync: ProjectSync, asking: Asking, setAsking: (next: Asking | undefined) => void, upstream: string): Node {
  const branch = sync.branch;
  const cancel = (label = 'Cancel'): Node => ctx.draw.button('sync:cancel', label, () => setAsking(undefined), { plain: true, dim: true });
  const decide = (out: UpdateOutcome | StashUpdateOutcome | undefined): void => setAsking(out ? askingOf(out, branch) : undefined);
  const agent = async (): Promise<void> => {
    const said = asking.kind === 'agent' ? `${asking.heading}: ${asking.message}` : asking.kind === 'conflicts' ? asking.message : undefined;
    setAsking(undefined);
    await ctx.call('git.askClaude', project.id, ...(said ? [said.slice(0, 2000)] : []));
  };
  const switchTo = async (mode: 'clean' | 'stash' | 'move'): Promise<void> => {
    setAsking(undefined);
    const out = (await ctx.call('git.switchToDefault', project.id, mode)) as { kind: string; files?: readonly string[]; message?: string } | undefined;
    if (out?.kind === 'dirty') setAsking({ kind: 'switch', dirty: out.files?.length || sync.dirty || 1 });
    else if (out?.kind === 'conflicts') setAsking({ kind: 'conflicts', files: out.files ?? [], message: out.message ?? '' });
    else if (out?.kind === 'failed') throw new Error(out.message ?? `Couldn’t switch to ${branch}`);
  };
  switch (asking.kind) {
    case 'dirty':
      return col([
        text('Your uncommitted changes are in the way', { weight: 'semibold', color: 'warning' }),
        dim(`${upstream} has ${plural(asking.behind, 'new commit')}, and some change files you’ve edited in main. The engine can stash your changes, update, and put them back, or move them to a worktree of their own first.`),
        someFiles(asking.files),
        actions(
          ctx.draw.button('sync:stash', 'Stash and Update', async () => {
            setAsking(undefined);
            decide((await ctx.call('git.stashAndUpdate', project.id)) as StashUpdateOutcome | undefined);
          }, { primary: true }),
          ctx.draw.button('sync:move', 'Move to Worktree', async () => {
            setAsking(undefined);
            const out = (await ctx.call('git.moveAndUpdate', project.id)) as { readonly outcome: UpdateOutcome } | undefined;
            decide(out?.outcome);
          }, { plain: true }),
          cancel(),
        ),
      ]);
    case 'agent':
      return col([
        text(asking.heading, { weight: 'semibold', color: 'warning' }),
        dim(asking.message),
        dim(asking.inMain ? 'Your agent can do it in the main folder: it may only sync git there, keeps your changes, never pushes, and explains what it did.' : 'Your agent works it out in a worktree of its own, leaves the main folder and your changes alone, never pushes, and tells you the step left, if any.'),
        actions(ctx.draw.button('sync:agent', 'Let Your Agent Handle It', agent, { primary: true }), cancel()),
      ]);
    case 'conflicts':
      return col([
        text('Your changes conflicted with the update', { weight: 'semibold', color: 'warning' }),
        dim(asking.message),
        someFiles(asking.files),
        actions(ctx.draw.button('sync:agent', 'Let Your Agent Handle It', agent, { primary: true }), cancel('I’ll Handle It')),
      ]);
    case 'switch':
      return col([
        text(`Switch the main folder to ${branch}?`, { weight: 'semibold' }),
        dim(`It has ${plural(asking.dirty, 'uncommitted change')} on ${sync.current ?? 'a detached HEAD'}. Move ${sync.current ?? 'that work'} and its changes to a worktree of their own (recommended), or bring the changes along to ${branch}.`),
        actions(
          ctx.draw.button('sync:switch-move', 'Move to Worktree', () => switchTo('move'), { primary: true }),
          ctx.draw.button('sync:switch-stash', 'Bring Them Along', () => switchTo('stash'), { plain: true }),
          cancel(),
        ),
      ]);
  }
}

/** Under the project's name: main against origin, Update main, Fetch and when it last did. */
function mainSync(ctx: Ctx, project: Project): Node | undefined {
  const sync = project.sync;
  if (!sync) return undefined;
  const key = `sync:${project.id}`;
  const [asking, setAsking] = ctx.local<Asking | undefined>(`${key}:asking`, undefined);
  const [busy, setBusy] = ctx.local(`${key}:busy`, false);
  const mainLine = mainLineOf(sync);
  const branch = sync.branch;
  const upstream = sync.upstream ?? `origin/${branch}`;
  const diverged = sync.ahead > 0 && sync.behind > 0;
  const showUpdate = Boolean(sync.upstream) && (mainLine.canUpdate || diverged || Boolean(sync.operation));
  const updating = project.workspaces.find((w) => w.purpose === 'sync_main' && !w.archived && activityOf(ctx.state.log, `ws:${w.id}`).running);
  const update = async (): Promise<void> => {
    setBusy(true);
    try {
      const out = (await ctx.call('git.updateMain', project.id)) as UpdateOutcome | undefined;
      setAsking(out ? askingOf(out, branch) : undefined);
    } finally {
      setBusy(false);
    }
  };
  const switchNow = async (): Promise<void> => {
    if (sync.dirty) {
      setAsking({ kind: 'switch', dirty: sync.dirty });
      return;
    }
    const out = (await ctx.call('git.switchToDefault', project.id, 'clean')) as { kind: string; files?: readonly string[]; message?: string } | undefined;
    if (out?.kind === 'dirty') setAsking({ kind: 'switch', dirty: out.files?.length || 1 });
    else if (out?.kind === 'failed') throw new Error(out.message ?? `Couldn’t switch to ${branch}`);
  };
  const fetched = sync.fetching ? 'Fetching...' : sync.fetchedAt ? `fetched ${agoWords(sync.fetchedAt)}` : 'never fetched';
  const trouble = !sync.fetchError ? undefined : sync.fetchError.reason === 'auth' ? 'Sign-in needed to fetch' : sync.fetchError.reason === 'offline' ? 'Couldn’t reach the remote' : 'Couldn’t fetch';
  return card([
    line(pill(mainLine.label, toneOf(mainLine.style)), mainLine.dirty ? span(`  ${mainLine.dirty}`, WARN) : undefined),
    Boolean(mainLine.elsewhere) &&
      row([
        line(span(`${mainLine.elsewhere}. `, WARN), span(`Updating and History here are about ${branch}.`, QUIET)),
        ctx.draw.button('sync:switch', `Switch to ${branch}`, switchNow, { plain: true }),
      ]),
    updating &&
      row([
        line(span(`Your agent is updating ${branch}. `, { color: 'claude' }), span(updating.kind === 'worktree' ? 'It works in a worktree of its own. Nothing is pushed.' : 'It may only sync git here. Nothing is pushed.', QUIET)),
        ctx.draw.button('sync:open', 'Open', () => openWorkspace(ctx, updating.id), { plain: true }),
      ]),
    (showUpdate || Boolean(sync.upstream)) &&
      actions(
        showUpdate && ctx.draw.button('sync:update', busy ? 'Updating...' : `Update ${branch}`, update, { hotkey: 'e', ...(asking ? { plain: true } : {}) }),
        sync.upstream ? ctx.draw.button('sync:fetch', 'Fetch', () => ctx.call('git.fetch', project.id), { plain: true, dim: true, hotkey: 'f' }) : undefined,
        trouble ? ctx.draw.button('sync:why', trouble, () => setAsking(fetchAsking(sync.fetchError?.message ?? 'Couldn’t fetch.')), { plain: true, spans: [span(trouble, WARN)] }) : sync.upstream ? dim(fetched) : undefined,
      ),
    asking && col([askingCard(ctx, project, sync, asking, setAsking, upstream)], { top: 1 }),
  ], { title: [span(branch, { weight: 'bold' }), span('  main folder', QUIET)], ...(asking ? { tone: 'warn' as const } : {}) });
}

// ---------------------------------------------------------------- starting work

/** A template picked for the box: its words are waiting there, and whether it plans first. */
export interface HomeDraft {
  readonly prompt: string;
  readonly plan?: boolean;
}

export const draftKey = (projectId: string): string => `home:${projectId}:draft`;
const agentKey = (projectId: string): string => `home:${projectId}:agent`;

interface Branches {
  readonly base: string;
  readonly branches: readonly string[];
}

/** How many branches the popup holds: the default first, then the newest. */
const MAX_BRANCHES = 100;

/** Based on: the branch the new one starts from. Not the default's name? It goes along. */
function basedOn(ctx: Ctx, project: Project, base: string | undefined, setBase: (next: string | undefined) => void): Node {
  const loaded = ctx.load<Branches>(`branches:${project.id}`, async () => (await ctx.call('workspaces.branches', project.id)) as Branches, { ttlMs: 60_000 });
  const fallback = loaded.value?.base ?? project.base;
  const chosen = base ?? fallback;
  const listed = (loaded.value?.branches ?? []).slice(0, MAX_BRANCHES);
  const options = [...new Set([...(chosen ? [chosen] : []), ...listed])];
  if (loaded.error) return dim(`Couldn’t list the branches: ${loaded.error}. New worktrees start from ${chosen}.`);
  if (options.length < 2) return dim(`Based on ${chosen || 'the latest origin'}${loaded.loading ? '...' : ''}`);
  return ctx.draw.select(
    `home:${project.id}:base`,
    options.map((b) => ({ value: b, label: b === fallback ? `${b} (default)` : b })),
    (value) => setBase(value && value !== fallback ? value : undefined),
    { label: 'Based on', value: chosen },
  );
}

/** What opens from a new message: a worktree of its own, or a chat that only answers. */
function startWork(ctx: Ctx, project: Project): Node {
  const [kind, setKind] = ctx.local<'worktree' | 'chat'>(`home:${project.id}:kind`, 'worktree');
  const [base, setBase] = ctx.local<string | undefined>(`home:${project.id}:base-value`, undefined);
  const [name, setName] = ctx.local(`home:${project.id}:name`, '');
  const [naming, setNaming] = ctx.local(`home:${project.id}:naming`, false);
  const [draft, setDraft] = ctx.local<HomeDraft | undefined>(draftKey(project.id), undefined);
  const [agent, setAgent] = ctx.local<AgentRef | undefined>(agentKey(project.id), undefined);
  const worktree = kind === 'worktree' && Boolean(project.root);
  const start = async (value?: string): Promise<void> => {
    const words = value?.trim() ?? '';
    const named = name.trim();
    if (!worktree) {
      if (!words) return;
      setDraft(undefined);
      await ctx.call('workspaces.startChat', project.id, words);
      return;
    }
    if (!words && !named) return;
    const place = { ...(base ? { base } : {}), ...(agent ? { agent } : {}) };
    const id = words
      ? await ctx.call('workspaces.startWorktree', project.id, words, { ...place, ...(named ? { name: named } : {}), ...(draft?.plan ? { plan: true } : {}) })
      : await ctx.call('workspaces.newWorktree', project.id, named, place);
    setName('');
    setDraft(undefined);
    setAgent(undefined);
    if (typeof id === 'string') openOnce(ctx, id);
  };
  return card([
    ctx.draw.input(`home:${project.id}:box`, start, {
      placeholder: worktree ? 'Describe a task: it gets its own folder, branch and agent' : 'Ask about this project: nothing here changes',
      rows: 2,
      submitLabel: worktree ? 'start' : 'ask',
      autoFocus: !naming,
      ...(draft ? { value: draft.prompt } : {}),
    }),
    Boolean(project.root) && row([
      ctx.draw.button('kind:worktree', 'New Worktree', () => setKind('worktree'), { plain: true, hotkey: 'n', ...(worktree ? {} : { dim: true }) }),
      ctx.draw.button('kind:chat', 'New Chat', () => setKind('chat'), { plain: true, hotkey: 'c', ...(worktree ? { dim: true } : {}) }),
      worktree && ctx.draw.button('home:template', 'From a Template', () => ctx.go({ name: 'templates', params: { project: project.id } }), { plain: true, dim: true, hotkey: 'z' }),
    ]),
    worktree && basedOn(ctx, project, base, setBase),
    worktree &&
      (naming
        ? ctx.draw.input(
            `home:${project.id}:name-box`,
            (value) => {
              setNaming(false);
              setName(value?.trim() ?? '');
            },
            { label: 'Name', placeholder: 'from the task', value: name, submitLabel: 'use', autoFocus: true },
          )
        : ctx.draw.button('home:name', name ? `Name: ${name}` : 'Name: from the task', () => setNaming(true), { plain: true, dim: true, hotkey: 'd' })),
    worktree && agent ? row([dim(`Starts with ${agent.label}${agent.model ? ` · ${agent.model}` : ''}`), ctx.draw.button('home:agent-clear', 'Use Your Agent', () => setAgent(undefined), { plain: true, dim: true })]) : undefined,
    draft?.plan && worktree ? dim('This template plans first.') : undefined,
  ], { title: worktree ? 'Start a task' : 'Ask about it', tone: 'accent' });
}

// ---------------------------------------------------------------- pull requests

const CHECKS: Readonly<Record<Exclude<GhPull['checks'], 'none'>, { readonly words: string; readonly style: Omit<Span, 't'> }>> = {
  passing: { words: 'Checks pass', style: OK },
  failing: { words: 'Checks fail', style: { color: 'error' } },
  pending: { words: 'Checks running', style: { color: 'claude' } },
};

const REVIEW: Readonly<Record<NonNullable<GhPull['review']>, string>> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' };

/** How many open pull requests the home lists; the rest are on the Board. */
const HOME_PULLS = 4;

function pullRow(ctx: Ctx, project: Project, pull: GhPull): Node {
  const ws = project.workspaces.find((w) => w.kind === 'worktree' && !w.archived && w.branch === pull.branch);
  const facts = [`#${pull.number}`, pull.author, pull.branch, pull.draft ? 'Draft' : pull.review ? REVIEW[pull.review] : undefined].filter(Boolean).join(' · ');
  const checks = pull.checks === 'none' ? undefined : CHECKS[pull.checks];
  const about = meta(facts, checks ? span(checks.words, checks.style) : undefined);
  return col([
    ws ? ctx.draw.button(`pull:${pull.number}`, pull.title, () => openWorkspace(ctx, ws.id), { plain: true, spans: [span(pull.title, { weight: 'semibold' }), span('  in a worktree', QUIET)] }) : { k: 'link', href: pull.url, text: pull.title },
    about,
  ]);
}

/** The project's open pull requests, anyone's, the most recently active first. Nothing when it isn't on GitHub or none are open. */
function pullsSection(ctx: Ctx, project: Project): Node | undefined {
  const loaded = ctx.load<PullsList>(`home:pulls:${project.id}`, async () => (await ctx.call('issues.pulls', project.id)) as PullsList, { ttlMs: 30_000 });
  const list = loaded.value;
  if (loaded.error) return dim(`Couldn’t read its pull requests: ${loaded.error}`);
  if (!list) return loaded.loading ? dim('Looking for pull requests...') : undefined;
  if (list.kind === 'error') return dim(`Couldn’t read its pull requests: ${list.message}`);
  if (list.kind !== 'github' || !list.pulls.length) return undefined;
  const rest = list.total - Math.min(HOME_PULLS, list.pulls.length);
  return section(
    'Pull requests',
    [
      card([
        col(list.pulls.slice(0, HOME_PULLS).map((pull) => pullRow(ctx, project, pull)), { gap: 1 }),
        rest > 0 && col([ctx.draw.button('pulls:board', `The Other ${rest} on the Board`, () => ctx.show('board', { name: 'pulls', params: { project: project.id } }), { plain: true, dim: true })], { top: 1 }),
      ]),
    ],
    list.total,
  );
}

// ---------------------------------------------------------------- scripts and what was put away

const SCRIPT_SOURCE: Readonly<Record<string, string>> = { yours: 'set by you', claude: 'worked out by your agent', 'teamod.json': 'from teamod.json', 'conductor.json': 'from conductor.json', detected: 'guessed from the project' };

function scriptsSection(ctx: Ctx, project: Project): Node {
  const s = project.scripts ?? {};
  const script = (label: string, it: { readonly command: string; readonly source: string } | undefined): Node => line(span(`${label}  `, QUIET), it ? it.command : span('none', QUIET), it ? span(`  ${SCRIPT_SOURCE[it.source] ?? it.source}`, QUIET) : undefined);
  return section('Scripts', [script('Setup', s.setup), script('Run', s.run), ctx.state.prefs.autoSetup ? undefined : dim('Setup in new worktrees is off (Settings, Worktrees).')]);
}

/** Put-away worktrees and chats, the newest first: bring one back, read it, or delete it for good (after asking). */
function archivedSection(ctx: Ctx, project: Project, archived: readonly Workspace[]): Node | undefined {
  if (!archived.length) return undefined;
  const window = windowed(ctx, `archived:${project.id}`, archived, { size: 10 });
  return section('Archived', [
    ...window.shown.map((ws) =>
      row([
        text(ws.name),
        ws.archive || ws.branch || ws.kind !== 'worktree' ? ctx.draw.button(`arch:${ws.id}:restore`, 'Restore', () => ctx.call('workspaces.restore', ws.id), { plain: true }) : dim('Can’t come back'),
        ctx.draw.button(`arch:${ws.id}:read`, 'Read', () => openWorkspace(ctx, ws.id), { plain: true, dim: true }),
        ctx.draw.button(`arch:${ws.id}:delete`, 'Delete', () => askFirst(ctx, 'delete', { ids: ws.id }), { plain: true, dim: true }),
      ], { gap: 2 }),
    ),
    window.controls,
  ], archived.length);
}

export function projectHome(ctx: Ctx, id: string): Node {
  const project = ctx.state.projects.find((p) => p.id === id);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'projects'), back(ctx), empty('That project is gone.'));
  if (project.root) ctx.load(`sync:${project.id}:fetched`, () => ctx.call('git.fetchIfStale', project.id), { ttlMs: 5 * 60_000 });
  const active = activeOf(project);
  const worktrees = active.filter((w) => w.kind !== 'chat');
  const chats = active.filter((w) => w.kind === 'chat');
  const archived = project.workspaces.filter((w) => w.archived).sort((a, b) => b.createdAt - a.createdAt);
  const ready = worktrees.filter((w) => isReady(ctx.state, w)).length;
  const inProgress = windowed(ctx, `home:${project.id}:active`, [...worktrees, ...chats], { size: 30 });
  const asCards = active.length <= CARD_LIMIT;
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, 'Projects'),
    col([text(project.name, { weight: 'bold' }), project.root ? dim(homePath(ctx.state, project.root)) : undefined]),
    project.error ? text(project.error, { color: 'error' }) : undefined,
    startWork(ctx, project),
    project.root ? mainSync(ctx, project) : undefined,
    active.length === 0
      ? empty('Nothing in progress here.')
      : section(
          'In progress',
          [
            ready ? line(span(`${ready} ready to merge`, OK)) : undefined,
            asCards ? col(inProgress.shown.map((ws) => workspaceCard(ctx, ws))) : col(inProgress.shown.map((ws) => workspaceRow(ctx, ws))),
            inProgress.controls,
          ],
          active.length,
        ),
    project.root ? pullsSection(ctx, project) : undefined,
    project.root ? scriptsSection(ctx, project) : undefined,
    archivedSection(ctx, project, archived),
    project.root ? ctx.draw.button('project:more', 'More', () => ctx.go({ name: 'project-more', params: { id: project.id } }), { plain: true, dim: true, hotkey: 'x' }) : undefined,
  );
}

// ---------------------------------------------------------------- more

/** What's advanced about a project, out of the way. */
export function projectMore(ctx: Ctx, id: string): Node {
  const project = ctx.state.projects.find((p) => p.id === id);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'projects'), back(ctx), empty('That project is gone.'));
  const agents = project.workspaces.filter((w) => !w.archived && worktreeOrigin(w) === 'agent').length;
  const outside = project.workspaces.filter((w) => w.kind === 'worktree' && w.external && !w.archived).length;
  const group = ctx.state.projectGroups.find((g) => g.projects.includes(project.root));
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, project.name),
    col([text(project.name, { weight: 'bold' }), meta(group ? `In group: ${group.name}` : 'Not in a group', homePath(ctx.state, project.root))]),
    section('This project', [
      ctx.draw.button('more:finder', 'Show in Finder', () => ctx.call('local.openFolder', project.root), { plain: true }),
      ctx.draw.button('more:worktrees', 'Its Worktrees', () => ctx.go({ name: 'worktrees', params: { project: project.id } }), { plain: true }),
      ctx.draw.button('more:import', 'Import a Conversation', () => ctx.go({ name: 'import', params: { project: project.id } }), { plain: true }),
      agents + outside > 0 ? ctx.draw.button('more:clean', `Clean Up Worktrees (${agents + outside})`, () => ctx.go({ name: 'clean', params: { project: project.id } }), { plain: true }) : undefined,
      ctx.draw.button('more:agent', 'Agent for This Project', () => ctx.go({ name: 'project-agent', params: { id: project.id } }), { plain: true }),
    ]),
    section('In the list', [
      ctx.draw.button('more:group', 'Move to Group', () => ctx.go({ name: 'project-group', params: { id: project.id } }), { plain: true }),
      ctx.draw.button('more:arrange', 'Arrange Projects', () => ctx.go({ name: 'arrange' }), { plain: true }),
      ctx.draw.button('more:hide', 'Hide This Project', async () => {
        await ctx.call('workspaces.hideProject', project.id);
        backTo(ctx, 'projects');
      }, { plain: true, dim: true }),
      ctx.draw.button('more:delete', 'Delete from teamod', () => askFirst(ctx, 'remove-project', { project: project.id }), { plain: true, dim: true }),
    ]),
  );
}

/** Who works in this project: its own default over yours, and who the next worktree starts with. */
export function projectAgentPage(ctx: Ctx, id: string): Node {
  const project = ctx.state.projects.find((p) => p.id === id);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'projects'), back(ctx), empty('That project is gone.'));
  const [next, setNext] = ctx.local<AgentRef | undefined>(agentKey(project.id), undefined);
  const prefs = ctx.state.prefs;
  const choices = agentChoices(ctx.state.runtimes, ctx.state.models);
  const offered = choices.filter((c) => !c.disabled).map((c) => ({ value: c.value, label: c.label }));
  const own = prefs.projectAgents?.[project.name];
  const YOURS = '~';
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, project.name),
    col([text(`Agent for ${project.name}`, { weight: 'bold' }), dim('Who answers in this project, and who starts the next worktree.')]),
    ctx.draw.select(
      'agent:project',
      [{ value: YOURS, label: 'The same as yours (Settings)' }, ...offered],
      async (value) => {
        const { [project.name]: _gone, ...others } = prefs.projectAgents ?? {};
        await ctx.call('session.setPrefs', { projectAgents: !value || value === YOURS ? others : { ...others, [project.name]: agentForChoice(value, ctx.state.runtimes) } });
      },
      { label: 'Every new conversation here', value: own ? choiceForAgent(own) : YOURS },
    ),
    ctx.draw.select(
      'agent:next',
      [{ value: YOURS, label: 'The usual one' }, ...offered],
      (value) => setNext(!value || value === YOURS ? undefined : agentForChoice(value, ctx.state.runtimes)),
      { label: 'The next worktree only', value: next ? choiceForAgent(next) : YOURS },
    ),
    ...choices.filter((c) => c.disabled).map((c) => line(span(c.label, { weight: 'semibold' }), span('  '), span(c.why ?? 'not set up here', { dim: true }))),
  );
}
