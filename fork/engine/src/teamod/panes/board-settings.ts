import { DEFAULT_LABELS, LABEL_COLORS, LABEL_COLOR_INFO, LABEL_ICONS, LABEL_NAME, type LabelColor, type LabelIcon, cleanLabelName, labelTitle, labelsFor } from '../../core/board/labels.js';
import { type Issue, MAX_PROJECT_CONTEXT, boardName, issueById, isOwnBoard, reposOf } from '../../core/board/model.js';
import { LINEAR_KEY_URL, linearKeyProblem } from '../../shared/tracker-keys.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { MAIN_KEY, asking, choices, field, realProjects, subPage, toggle, webLink, windowed } from './board-common.js';
import { boardDelete } from './board-tasks.js';
import { ago, card, empty } from './common.js';

const repoName = (ctx: Ctx, id: string): string | undefined => ctx.state.projects.find((p) => p.id === id)?.name;

/** What a board's keys may start with: two to six letters or digits. */
const prefixProblem = (prefix: string): string | undefined => (/^[A-Za-z0-9]{2,6}$/.test(prefix) ? undefined : 'Keys start with two to six letters or digits');

/** New Board: one board for work across a few repos, each task on it running in one of them. */
export function boardNewPage(ctx: Ctx): Node {
  const projects = realProjects(ctx);
  const [name, setName] = ctx.local('board-new:name', '');
  const [repos, setRepos] = ctx.local<readonly string[]>('board-new:repos', []);
  const [prefix, setPrefix] = ctx.local('board-new:prefix', '');
  const [, setPicked] = ctx.local('board:board', '');
  const ready = Boolean(name.trim()) && repos.length > 0;
  const list = windowed(ctx, 'board-new:repos', projects);
  return subPage(
    ctx,
    'tasks',
    'Boards',
    col([title('New Board'), dim('One board for work across a few repos: each task on it runs in one of them, and Start makes its worktree there.')]),
    ctx.draw.input('board-new:name', (value) => setName(value?.trim() ?? ''), { label: 'Name', value: name, placeholder: 'Launch', submitLabel: 'set', autoFocus: !name }),
    card([field('Repos: the ones its tasks run in', list.earlier, ...list.rows.map((p) => toggle(ctx, `board-new:repo:${p.id}`, p.name, repos.includes(p.id), () => setRepos(repos.includes(p.id) ? repos.filter((r) => r !== p.id) : [...repos, p.id]))), list.more)]),
    ctx.draw.input(
      'board-new:prefix',
      (value) => {
        const next = value?.trim().toUpperCase() ?? '';
        if (next && prefixProblem(next)) throw new Error(prefixProblem(next));
        setPrefix(next);
      },
      { label: 'Task Keys', value: prefix, placeholder: 'What its task keys start with. Empty: made from the name.', submitLabel: 'set' },
    ),
    ready
      ? ctx.draw.button(
          'board-new:create',
          'Create Board',
          async () => {
            const id = await ctx.call('board.createBoard', { name: name.trim(), repos: [...repos], ...(prefix ? { prefix } : {}) });
            setName('');
            setRepos([]);
            setPrefix('');
            if (typeof id === 'string') setPicked(id);
            ctx.effect({ toast: `${name.trim()} is ready: new tasks there run in the repo you pick` });
            ctx.go({ name: 'tasks' });
          },
          { primary: true, hotkey: MAIN_KEY },
        )
      : dim('Give it a name and tick a repo.'),
  );
}

/** A board's settings: its name, the repos it covers, what its keys start with, and what hangs off it. */
export function boardSettingsPage(ctx: Ctx, boardId: string): Node {
  const board = ctx.state.board;
  const own = isOwnBoard(boardId);
  const projects = realProjects(ctx);
  const saved = board.projects[boardId];
  const name = boardName(board, boardId, (id) => repoName(ctx, id));
  if (own && !saved) return subPage(ctx, 'tasks', 'Tasks', empty('That board is gone.'));
  const repos = reposOf(board, boardId).filter((r) => r !== boardId);
  const flip = (id: string): Promise<unknown> => ctx.call('board.editBoard', boardId, { repos: repos.includes(id) ? repos.filter((r) => r !== id) : [...repos, id] });
  const here = { id: boardId, name, repos: reposOf(board, boardId), own };
  const list = windowed(ctx, `board-settings:${boardId}:repos`, projects);
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    col([text(`${name} Board`, { weight: 'bold' }), dim(`Tasks here run in any of the repos it covers, each in the one it’s for.${saved?.prefix ? ` Keys start with ${saved.prefix}-.` : ''}`)]),
    ctx.draw.input('board-settings:name', (value) => ctx.call('board.editBoard', boardId, { name: value?.trim() ?? '' }), { label: 'Name', value: saved?.name ?? '', placeholder: own ? 'Launch' : `Empty: ${repoName(ctx, boardId) ?? 'the project'}’s name`, submitLabel: 'save' }),
    card([
      field(
        own ? 'Repos: the ones its tasks run in' : 'Repos: others whose tasks go on this board too',
        list.earlier,
        ...list.rows.map((p) => (p.id === boardId && !own ? line(span(`[x] ${p.name}`), span('  Its own', { dim: true })) : toggle(ctx, `board-settings:repo:${p.id}`, p.name, repos.includes(p.id), () => flip(p.id)))),
        list.more,
      ),
    ]),
    ctx.draw.input(
      'board-settings:prefix',
      async (value) => {
        const next = value?.trim().toUpperCase() ?? '';
        const problem = prefixProblem(next);
        if (problem) throw new Error(problem);
        await ctx.call('board.setPrefix', boardId, next);
        ctx.effect({ toast: `Keys start with ${next}- from now on` });
      },
      { label: 'Task Keys', value: saved?.prefix ?? '', placeholder: 'BOB', submitLabel: 'save' },
    ),
    card([
      ctx.draw.button('board-settings:about', own ? 'About This Board' : 'About This Project', () => ctx.go({ name: 'about', params: { project: boardId } }), { plain: true }),
      ctx.draw.button('board-settings:labels', 'Labels', () => ctx.go({ name: 'labels', params: { project: boardId } }), { plain: true }),
      !own && ctx.draw.button('board-settings:sync', board.sync?.[boardId] ? 'Linear Sync' : 'Sync with Linear', () => ctx.go({ name: 'sync', params: { project: boardId } }), { plain: true }),
    ]),
    own && boardDelete(ctx, board, here),
  );
}

/** About This Project: a few paragraphs your agent reads whenever it writes a task here. */
export function aboutPage(ctx: Ctx, projectId: string): Node {
  const saved = ctx.state.board.projects[projectId]?.context;
  const mates = ctx.state.team.teams[projectId]?.mates.map((m) => m.name) ?? [];
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    col([title('About This Project'), dim('Your agent reads this whenever it writes a task here, so tasks use the project’s own words and point at the right part of the app.')]),
    ctx.draw.input(
      'about:context',
      async (value) => {
        const words = value ?? '';
        if (words.length > MAX_PROJECT_CONTEXT) throw new Error(`That’s too long: ${MAX_PROJECT_CONTEXT} characters at most`);
        await ctx.call('board.setContext', projectId, words);
        ctx.effect({ toast: words.trim() ? 'Your agent knows about this project now' : 'The project’s context is cleared' });
        ctx.nav.back(ctx.pane);
      },
      { value: saved?.text ?? '', rows: 10, placeholder: 'What the app is and who it’s for. How the code is laid out. Words the team uses, and anything a new person gets wrong.', submitLabel: 'save', autoFocus: true },
    ),
    dim(`${mates.length ? `Shared with ${mates.join(', ')}: an edit here reaches them too.` : 'Teammates on this project get it too.'}${saved?.text ? ` Last edited by ${saved.by}, ${ago(saved.at)}.` : ''}`),
  );
}

/**
 * Labels are a small set everyone shares: the built-in ones, and a few of a project's own. From a
 * task's Labels (`issue`), a new one goes on that task at once.
 */
export function labelsPage(ctx: Ctx, projectId: string, issueId: string | undefined): Node {
  const board = ctx.state.board;
  const own = board.projects[projectId]?.labels ?? [];
  const issue: Issue | undefined = issueId ? issueById(board, issueId) : undefined;
  const [name, setName] = ctx.local('labels:name', '');
  const [icon, setIcon] = ctx.local<LabelIcon>('labels:icon', 'tag');
  const [color, setColor] = ctx.local<LabelColor>('labels:color', 'blue');
  const [hint, setHint] = ctx.local('labels:hint', '');
  const clean = cleanLabelName(name);
  const taken = labelsFor(board, projectId).some((l) => l.name === clean);
  const problem = !clean ? undefined : taken ? 'There’s a label called that already' : !LABEL_NAME.test(clean) ? 'One or two short words (letters, digits and dashes)' : undefined;
  return subPage(
    ctx,
    'tasks',
    issue ? issue.key : 'Tasks',
    col([title('Labels'), dim('A small set everyone shares: the built-in ones, and a few of your own that mean something.')]),
    card([
      field('Built in', dim(DEFAULT_LABELS.map((l) => labelTitle(l.name)).join(' · '))),
      own.length > 0 &&
        field(
          'This project’s labels',
          ...own.map((l) =>
            row([
              line(span(labelTitle(l.name)), l.hint ? span(`  ${l.hint}`, { dim: true }) : undefined),
              ctx.draw.button(
                `labels:remove:${l.name}`,
                'Remove',
                async () => {
                  await ctx.call('board.removeLabel', projectId, l.name);
                  ctx.effect({ toast: `Removed ${labelTitle(l.name)}: tasks that have it keep it, plainly` });
                },
                { plain: true, dim: true },
              ),
            ]),
          ),
        ),
    ]),
    text('New Label', { weight: 'bold' }),
    ctx.draw.input('labels:name', (value) => setName(value?.trim() ?? ''), { label: 'Name', value: name, placeholder: 'Performance', submitLabel: 'set' }),
    field('Icon', choices(ctx, 'labels:icon', LABEL_ICONS.map((i) => ({ value: i, label: i })), icon, (i) => setIcon(i))),
    field('Color', choices(ctx, 'labels:color', LABEL_COLORS.map((c) => ({ value: c, label: LABEL_COLOR_INFO[c].label })), color, (c) => setColor(c))),
    ctx.draw.input('labels:hint', (value) => setHint(value?.trim() ?? ''), { label: 'What it’s for', value: hint, placeholder: 'Optional. Your agent reads it when it picks labels.', submitLabel: 'set' }),
    problem ? text(problem, { color: 'error' }) : undefined,
    clean && !problem
      ? ctx.draw.button(
          'labels:create',
          issue ? 'Create and Add' : 'Create Label',
          async () => {
            const made = (await ctx.call('board.createLabel', projectId, { name: clean, icon, color, ...(hint ? { hint } : {}) })) as { readonly name: string } | undefined;
            setName('');
            setHint('');
            if (issue) {
              await ctx.call('board.update', issue.id, { labels: [...issue.labels, made?.name ?? clean] });
              ctx.nav.back(ctx.pane);
            } else ctx.effect({ toast: `Added ${labelTitle(clean)}` });
          },
          { primary: true, hotkey: MAIN_KEY },
        )
      : undefined,
  );
}

interface FoundTeams {
  readonly workspace?: string;
  readonly teams: ReadonlyArray<{ readonly id: string; readonly key: string; readonly name: string }>;
}

/** Linear: paste a personal API key, pick the team, and connect. The key is never drawn, and stays on this computer. */
function syncConnectForm(ctx: Ctx, projectId: string, name: string, changing: boolean, stopChanging: () => void): Node {
  const [key, setKey] = ctx.local(`sync:${projectId}:key`, '');
  const [found, setFound] = ctx.local<FoundTeams | null>(`sync:${projectId}:found`, null);
  const [team, setTeam] = ctx.local(`sync:${projectId}:team`, '');
  const [auto, setAuto] = ctx.local(`sync:${projectId}:auto`, true);
  const [pushExisting, setPush] = ctx.local(`sync:${projectId}:push`, false);
  const [trouble, setTrouble] = ctx.local(`sync:${projectId}:trouble`, '');
  const forget = (): void => {
    setKey('');
    setFound(null);
    setTeam('');
    setTrouble('');
  };
  return col(
    [
      col([title(changing ? `Change how ${name} syncs` : `Sync ${name} with Linear`), dim('Issues in a Linear team show up here as tasks, and tasks made here show up in Linear. A change on either side follows to the other. The key stays on this computer.')]),
      found
        ? line(span('Key checked', { color: 'success' }), found.workspace ? span(`  ${found.workspace}`, { dim: true }) : undefined)
        : ctx.draw.input(
            'sync:key',
            async (value) => {
              const typed = value?.trim() ?? '';
              const problem = linearKeyProblem(typed);
              if (problem) {
                setTrouble(problem);
                return;
              }
              const answer = (await ctx.call('board.syncTeams', 'linear', typed)) as ({ readonly ok: true } & FoundTeams) | { readonly ok: false; readonly error: string } | undefined;
              if (!answer?.ok) {
                setTrouble(answer?.error ?? 'That key didn’t work');
                return;
              }
              if (!answer.teams.length) {
                setTrouble('This key sees no teams in Linear');
                return;
              }
              setKey(typed);
              setFound({ ...(answer.workspace ? { workspace: answer.workspace } : {}), teams: answer.teams });
              setTeam(answer.teams[0]!.id);
              setTrouble('');
            },
            { label: 'API key', placeholder: 'lin_api_...', submitLabel: 'check key', autoFocus: true },
          ),
      !found && dim('Starts with lin_api_. Linear › Settings › Security & access › Personal API keys.'),
      !found && webLink(LINEAR_KEY_URL, 'Create one in Linear'),
      trouble ? text(trouble, { color: 'error' }) : undefined,
      found && field('Team: its issues and this project’s tasks are kept in step', choices(ctx, 'sync:team', found.teams.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` })), team, (t) => setTeam(t))),
      found && toggle(ctx, 'sync:auto', 'Autosync: every minute, and moments after a change here', auto, () => setAuto(!auto)),
      found && toggle(ctx, 'sync:push', 'Also send this project’s open tasks. Otherwise only tasks made from now on go to Linear', pushExisting, () => setPush(!pushExisting)),
      found &&
        ctx.draw.button(
          'sync:connect',
          'Connect',
          async () => {
            const answer = (await ctx.call('board.syncConnect', projectId, { provider: 'linear', key, teamId: team, auto, pushExisting })) as { readonly ok: boolean; readonly error?: string } | undefined;
            if (answer && !answer.ok) {
              setTrouble(answer.error ?? 'That didn’t connect');
              return;
            }
            forget();
            stopChanging();
          },
          { primary: true, hotkey: MAIN_KEY },
        ),
      changing && ctx.draw.button('sync:back', 'Keep It As It Is', () => {
        forget();
        stopChanging();
      }, { plain: true, dim: true }),
    ],
    { gap: 1 },
  );
}

/** Sync a project's tasks with Linear, both ways: connect it, or how it stands once it is. */
export function syncPage(ctx: Ctx, projectId: string): Node {
  const project = ctx.state.projects.find((p) => p.id === projectId);
  const sync = ctx.state.board.sync?.[projectId];
  const [changing, setChanging] = ctx.local(`sync:${projectId}:changing`, false);
  if (!project) return subPage(ctx, 'tasks', 'Tasks', empty('That project is gone.'));
  if (!sync || changing) return subPage(ctx, 'tasks', 'Tasks', syncConnectForm(ctx, projectId, project.name, Boolean(sync), () => setChanging(false)));
  return subPage(
    ctx,
    'tasks',
    'Tasks',
    card(
      [
        text(`${project.name} syncs with Linear`, { weight: 'bold' }),
        dim(`${sync.workspace ? `${sync.workspace} · ` : ''}${sync.team} ${sync.teamKey}`),
        line(span(`● ${sync.linked} ${sync.linked === 1 ? 'task' : 'tasks'} linked`, sync.error ? { color: 'warning' } : { color: 'success' }), span(`  ${sync.syncing ? 'Syncing...' : sync.syncedAt ? `Synced ${ago(sync.syncedAt)}` : 'Not synced yet'}`, { dim: true })),
        sync.error && text(sync.error.message, { color: 'warning' }),
      ],
      sync.error ? { tone: 'warn' } : {},
    ),
    !sync.syncing && ctx.draw.button('sync:now', 'Sync Now', () => ctx.call('board.syncNow', projectId), { primary: true, hotkey: MAIN_KEY }),
    toggle(ctx, 'sync:autosync', 'Autosync: every minute, and moments after a change here. Off: only when you press Sync Now', sync.auto, () => ctx.call('board.syncAuto', projectId, !sync.auto)),
    dim('Kept in step: title, status, priority, labels, estimate, due date, parent, and the brief as the description. When both sides change the same thing, the newer change wins.'),
    ctx.draw.button('sync:change', sync.error?.code === 'auth' ? 'Connect a New Key' : 'Change Team or Key', () => setChanging(true), { plain: true }),
    asking(ctx, 'sync:disconnect', {
      label: 'Disconnect',
      question: `Stop syncing ${project.name} with Linear?`,
      detail: 'The key is forgotten, and tasks here stay as they are, unlinked. Nothing in Linear changes.',
      confirm: 'Disconnect',
      danger: true,
      run: () => ctx.call('board.syncDisconnect', projectId),
    }),
  );
}
