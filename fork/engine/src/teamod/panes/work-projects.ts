import { groupOfKey, isGroupKey, topLevel } from '../../workspaces/arrange.js';
import type { Project, ProjectGroup, Workspace } from '../../workspaces/types.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { back, chrome, empty, homePath, page } from './common.js';
import { activeOf, backTo, errorText, findField, loadingWords, placesOf, plural, projectRoute, steady, twoPress, windowed, workspaceRow } from './work-common.js';

/** The Projects place: what's in progress first, then the rest as you arranged them; adding, grouping and hiding. */

const shownProjects = (ctx: Ctx): Project[] => {
  const hidden = new Set(ctx.state.hiddenProjects);
  return ctx.state.projects.filter((p) => p.root && !hidden.has(p.root));
};

const nameFromPath = (root: string): string => root.split('/').filter(Boolean).pop() ?? root;

/** Add Project: a press opens the field, Enter adds it. The other ways in are a press away. */
function addProject(ctx: Ctx): Node {
  const [adding, setAdding] = ctx.local('work:adding', false);
  if (!adding) return ctx.draw.button('add', 'Add Project', () => setAdding(true), { hotkey: 'a', primary: true });
  const leaving = (route: string) => (): void => {
    setAdding(false);
    ctx.go({ name: route });
  };
  return col([
    ctx.draw.input(
      'add-path',
      async (value) => {
        setAdding(false);
        const path = value?.trim();
        if (path) await ctx.call('projects.add', path);
      },
      { label: 'Folder', placeholder: '/path/to/repository', submitLabel: 'add', autoFocus: true },
    ),
    row([
      ctx.draw.button('add:more', 'On This Computer', leaving('add'), { plain: true, hotkey: 'n' }),
      ctx.draw.button('add:new', 'Start New', leaving('new'), { plain: true, hotkey: 'e' }),
      ctx.draw.button('add:cancel', 'Cancel', () => setAdding(false), { plain: true, dim: true }),
    ]),
  ]);
}

/** Your own new chat, in no project: words start it, none just makes it. */
function newChat(ctx: Ctx, chatsId: string): Node {
  const [chatting, setChatting] = ctx.local('work:chatting', false);
  if (!chatting) return ctx.draw.button('chat:start', 'New Chat', () => setChatting(true), { plain: true, dim: true, hotkey: 'c' });
  return col([
    ctx.draw.input(
      'chat:box',
      async (value) => {
        setChatting(false);
        const words = value?.trim();
        if (words) await ctx.call('workspaces.startChat', chatsId, words);
        else await ctx.call('workspaces.newChat', chatsId, 'New chat');
      },
      { placeholder: 'Ask anything. Leave it empty for an empty chat.', rows: 2, submitLabel: 'start', autoFocus: true },
    ),
    ctx.draw.button('chat:cancel', 'Cancel', () => setChatting(false), { plain: true, dim: true }),
  ]);
}

type ListRow =
  | { readonly kind: 'project'; readonly project: Project; readonly quiet: boolean }
  | { readonly kind: 'ws'; readonly ws: Workspace }
  | { readonly kind: 'group'; readonly name: string; readonly count: number; readonly folded: boolean }
  | { readonly kind: 'label'; readonly words: string };

/** Everything the list can show, flat and in order: a row is a row wherever it's from, so one window counts them all. */
function listOf(ctx: Ctx, query: string, folded: readonly string[]): ListRow[] {
  const shown = shownProjects(ctx);
  const q = query.toLowerCase();
  const said = (words: string): boolean => words.toLowerCase().includes(q);
  const found = q ? shown.filter((p) => said(p.name) || said(p.root) || activeOf(p).some((w) => said(w.name))) : shown;
  const quiet = new Set(found.filter((p) => activeOf(p).length === 0));
  const out: ListRow[] = [];
  for (const p of found) {
    const active = activeOf(p);
    if (!active.length) continue;
    out.push({ kind: 'project', project: p, quiet: false }, ...active.map((ws): ListRow => ({ kind: 'ws', ws })));
  }
  const chats = ctx.state.projects.find((p) => !p.root);
  const openChats = chats ? activeOf(chats).filter((w) => !q || said(w.name)) : [];
  if (openChats.length) out.push({ kind: 'label', words: 'Chats' }, ...openChats.map((ws): ListRow => ({ kind: 'ws', ws })));
  if (quiet.size) out.push({ kind: 'label', words: `Other projects (${quiet.size})` });
  const byRoot = new Map(shown.map((p) => [p.root, p]));
  for (const key of topLevel({ order: ctx.state.projectOrder, groups: ctx.state.projectGroups }, shown.map((p) => p.root))) {
    if (!isGroupKey(key)) {
      const p = byRoot.get(key);
      if (p && quiet.has(p)) out.push({ kind: 'project', project: p, quiet: true });
      continue;
    }
    const name = groupOfKey(key);
    const members = (ctx.state.projectGroups.find((g) => g.name === name)?.projects ?? []).flatMap((root) => {
      const p = byRoot.get(root);
      return p && quiet.has(p) ? [p] : [];
    });
    if (!members.length) continue;
    const shut = folded.includes(name);
    out.push({ kind: 'group', name, count: members.length, folded: shut });
    if (!shut) out.push(...members.map((p): ListRow => ({ kind: 'project', project: p, quiet: true })));
  }
  return out;
}

function listRow(ctx: Ctx, item: ListRow, folded: readonly string[], setFolded: (next: readonly string[]) => void): Node {
  switch (item.kind) {
    case 'project': {
      const p = item.project;
      const open = (): void => ctx.go(projectRoute(p.id));
      return item.quiet ? ctx.draw.button(`project:${p.id}`, p.name, open, { plain: true, dim: true }) : ctx.draw.button(`project:${p.id}`, p.name, open, { plain: true, spans: [span(p.name, { weight: 'semibold' })] });
    }
    case 'ws':
      return workspaceRow(ctx, item.ws);
    case 'label':
      return dim(item.words);
    case 'group':
      return ctx.draw.button(`group:${item.name}`, item.name, () => setFolded(item.folded ? folded.filter((n) => n !== item.name) : [...folded, item.name]), {
        plain: true,
        spans: [span(item.name, { weight: 'semibold' }), span(`  ${item.count}${item.folded ? ', folded' : ''}`, { dim: true })],
      });
  }
}

export function projectsPage(ctx: Ctx): Node {
  const shown = shownProjects(ctx);
  const [folded, setFolded] = ctx.local<readonly string[]>('work:folded', []);
  const find = findField(ctx, 'projects', 'Find a project or a worktree');
  const rows = listOf(ctx, find.query, folded);
  const window = windowed(ctx, 'projects', rows, { keys: true });
  const hiddenCount = ctx.state.hiddenProjects.length;
  const chats = ctx.state.projects.find((p) => !p.root);
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    addProject(ctx),
    shown.length === 0 && empty('No projects yet. Add a repository to start.'),
    shown.length > 0 && find.node,
    find.query && rows.length === 0 ? empty(`Nothing called “${find.query}”.`) : undefined,
    col(window.shown.map((item) => listRow(ctx, item, folded, setFolded))),
    window.controls,
    newChat(ctx, chats?.id ?? 'chats'),
    row([
      shown.length > 0 && ctx.draw.button('arrange', 'Arrange', () => ctx.go({ name: 'arrange' }), { plain: true, dim: true, hotkey: 'x' }),
      hiddenCount > 0 && ctx.draw.button('hidden', `Hidden Projects (${hiddenCount})`, () => ctx.go({ name: 'hidden' }), { plain: true, dim: true, hotkey: 'h' }),
      ctx.draw.button('templates', 'Templates', () => ctx.go({ name: 'templates' }), { plain: true, dim: true, hotkey: 'z' }),
    ]),
  );
}

// ---------------------------------------------------------------- adding

interface Found {
  readonly path: string;
  readonly name: string;
  readonly changed: number;
}

interface PathInfo {
  readonly path: string;
  readonly kind: 'file' | 'folder' | 'missing';
}

/** A typed path, checked before it's added: a file or nothing says so here, not in a toast. */
async function addTyped(ctx: Ctx, typed: string, as: 'project' | 'folder', setProblem: (words: string | undefined) => void): Promise<void> {
  setProblem(undefined);
  const [info] = ((await ctx.call('local.statFiles', [typed])) ?? []) as readonly PathInfo[];
  if (info?.kind !== 'folder') {
    setProblem(info?.kind === 'file' ? `${typed} is a file, not a folder.` : `There’s no folder at ${typed}.`);
    return;
  }
  await ctx.call(as === 'folder' ? 'projects.addFolder' : 'projects.add', typed);
  ctx.refresh('work:suggest');
}

/** Add projects: a path, the git projects found on this computer, the ones you hid, or look through the folders. */
export function addPage(ctx: Ctx): Node {
  const loaded = steady<readonly Found[]>(ctx, 'work:suggest', async () => ((await ctx.call('projects.suggest')) ?? []) as readonly Found[], { ttlMs: 30_000 });
  const [as, setAs] = ctx.local<'project' | 'folder'>('add:as', 'project');
  const [problem, setProblem] = ctx.local<string | undefined>('add:problem', undefined);
  const known = new Set(ctx.state.projects.map((p) => p.root));
  const hidden = ctx.state.hiddenProjects;
  const found = (loaded.value ?? []).filter((f) => !known.has(f.path) && !hidden.includes(f.path));
  const window = windowed(ctx, 'add', [...hidden.map((root) => ({ root, hidden: true as const })), ...found.map((f) => ({ root: f.path, hidden: false as const }))], { size: 30, keys: true });
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, 'Projects'),
    title('Add Projects'),
    row([
      ctx.draw.button('as:project', 'A Project', () => setAs('project'), { plain: true, hotkey: 'n', ...(as === 'project' ? {} : { dim: true }) }),
      ctx.draw.button('as:folder', 'A Folder of Projects', () => setAs('folder'), { plain: true, hotkey: 'e', ...(as === 'folder' ? {} : { dim: true }) }),
    ]),
    ctx.draw.input(
      'add:path',
      async (value) => {
        const typed = value?.trim();
        if (typed) await addTyped(ctx, typed, as, setProblem);
      },
      { label: 'Folder', placeholder: as === 'folder' ? 'A folder of them: new ones in it show up too' : 'Type a path, like ~/code/app', submitLabel: 'add', autoFocus: true },
    ),
    problem ? text(problem, { color: 'error' }) : undefined,
    row([
      ctx.draw.button('browse', 'Look Through Folders', () => ctx.go({ name: 'browse', params: { dir: ctx.state.home || '~' } }), { plain: true, hotkey: 'x' }),
      ctx.draw.button('add:new', 'Start a New Project', () => ctx.go({ name: 'new' }), { plain: true, hotkey: 'a' }),
    ]),
    loadingWords(loaded, 'Looking in your code folders...', 'Couldn’t look for projects'),
    !loaded.loading && !window.shown.length && !loaded.error ? empty('No other git projects in your code folders.') : undefined,
    window.shown.length > 0 && dim('On this computer'),
    ...window.shown.map(({ root, hidden: wasHidden }) =>
      row([
        line(nameFromPath(root), span(`  ${homePath(ctx.state, root)}${wasHidden ? '  hidden' : ''}`, { dim: true })),
        wasHidden
          ? ctx.draw.button(`show:${root}`, 'Show', () => ctx.call('workspaces.showProject', root), { plain: true })
          : ctx.draw.button(`found:${root}`, 'Add', async () => {
              await ctx.call('workspaces.addProject', root);
              ctx.refresh('work:suggest');
            }, { plain: true }),
      ]),
    ),
    window.controls,
  );
}

interface FsDir {
  readonly name: string;
  /** 1: a git project. */
  readonly size: number;
}

/** The folders on this computer, one level at a time. */
export function browsePage(ctx: Ctx, dir: string): Node {
  const loaded = ctx.load<readonly FsDir[]>(`browse:${dir}`, async () => ((await ctx.call('local.listDirs', dir)) ?? []) as readonly FsDir[], { ttlMs: 15_000 });
  const rows = loaded.value ?? [];
  const window = windowed(ctx, `browse:${dir}`, rows, { size: 40, keys: true });
  const parent = dir.split('/').slice(0, -1).join('/') || '/';
  const inside = (name: string): string => `${dir.replace(/\/$/, '')}/${name}`;
  const done = (): void => backTo(ctx, 'projects');
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx),
    title(homePath(ctx.state, dir)),
    row([
      ctx.draw.button('browse:add', 'Add This Folder', async () => {
        await ctx.call('projects.add', dir);
        done();
      }, { primary: true, hotkey: 'a' }),
      ctx.draw.button('browse:watch', 'Watch as a Folder of Projects', async () => {
        await ctx.call('workspaces.addFolder', dir);
        done();
      }, { plain: true, dim: true, hotkey: 'e' }),
      dir !== '/' && ctx.draw.button('browse:up', 'Up', () => ctx.go({ name: 'browse', params: { dir: parent } }), { plain: true, dim: true, hotkey: 'n' }),
    ]),
    loadingWords(loaded, 'Looking...', 'Couldn’t read that folder'),
    !loaded.loading && !rows.length && !loaded.error ? empty('No folders in here.') : undefined,
    ...window.shown.map((entry) =>
      ctx.draw.button(`dir:${entry.name}`, entry.name, () => ctx.go({ name: 'browse', params: { dir: inside(entry.name) } }), { plain: true, spans: [span(entry.name), ...(entry.size === 1 ? [span('  a git project', { color: 'success' })] : [])] }),
    ),
    window.controls,
  );
}

/** Start new: a name and where it goes; the engine makes the folder, git and a first commit. */
export function newProjectPage(ctx: Ctx): Node {
  const home = ctx.load<string>('work:newhome', async () => (await ctx.call('projects.newHome')) as string);
  const [parent, setParent] = ctx.local<string | undefined>('new:parent', undefined);
  const [changing, setChanging] = ctx.local('new:changing', false);
  const [problem, setProblem] = ctx.local<string | undefined>('new:problem', undefined);
  const where = parent ?? home.value;
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, 'Projects'),
    title('New Project'),
    ctx.draw.input(
      'new:name',
      async (value) => {
        const name = value?.trim();
        if (!name) return;
        setProblem(undefined);
        try {
          const made = (await ctx.call('projects.create', name, ...(parent ? [parent] : []))) as { readonly id: string } | undefined;
          setParent(undefined);
          backTo(ctx, 'projects');
          if (made) ctx.go(projectRoute(made.id));
        } catch (err) {
          setProblem(errorText(err));
        }
      },
      { label: 'Name', placeholder: 'my-app', submitLabel: 'create', autoFocus: !changing },
    ),
    dim(where ? `Goes in ${homePath(ctx.state, where)}, with git and a first commit, ready for worktrees.` : 'Goes in your code folder, with git and a first commit, ready for worktrees.'),
    changing
      ? ctx.draw.input(
          'new:where',
          (value) => {
            setChanging(false);
            if (value?.trim()) setParent(value.trim());
          },
          { label: 'In', value: where ?? '', submitLabel: 'use', autoFocus: true },
        )
      : ctx.draw.button('new:change', 'Change Where', () => setChanging(true), { plain: true, dim: true, hotkey: 'e' }),
    problem ? text(problem, { color: 'error' }) : undefined,
  );
}

// ---------------------------------------------------------------- hidden

/** Projects you hid, each with Show: it comes back where it was. */
export function hiddenPage(ctx: Ctx): Node {
  const hidden = ctx.state.hiddenProjects;
  const window = windowed(ctx, 'hidden', hidden, { keys: true });
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, 'Projects'),
    title('Hidden Projects'),
    hidden.length === 0 && empty('None. Hide a project from its More; it waits here until you show it again.'),
    ...window.shown.map((root) => row([line(nameFromPath(root), span(`  ${homePath(ctx.state, root)}`, { dim: true })), ctx.draw.button(`show:${root}`, 'Show', () => ctx.call('workspaces.showProject', root), { plain: true })])),
    window.controls,
  );
}

// ---------------------------------------------------------------- arranging

type Item = { readonly project: string } | { readonly group: string };

type ArrangeRow =
  | { readonly kind: 'group'; readonly group: ProjectGroup; readonly key: string; readonly at: number; readonly list: readonly string[] }
  | { readonly kind: 'project'; readonly project: Project; readonly into: string | null; readonly key: string; readonly at: number; readonly list: readonly string[] };

/**
 * Projects and groups in the order they show, each with Move buttons: the same arranging the Mac
 * does by dragging. A list is the top level or a group's projects, and an item moves within it.
 */
export function arrangePage(ctx: Ctx): Node {
  const shown = shownProjects(ctx);
  const byRoot = new Map(shown.map((p) => [p.root, p]));
  const groups = ctx.state.projectGroups;
  const top = topLevel({ order: ctx.state.projectOrder, groups }, shown.map((p) => p.root)).filter((k) => isGroupKey(k) || byRoot.has(k));
  const rows: ArrangeRow[] = top.flatMap((key, at): ArrangeRow[] => {
    if (!isGroupKey(key)) return [{ kind: 'project', project: byRoot.get(key)!, into: null, key, at, list: top }];
    const group = groups.find((g) => g.name === groupOfKey(key));
    if (!group) return [];
    const list = group.projects.filter((root) => byRoot.has(root));
    return [{ kind: 'group', group, key, at, list: top }, ...list.map((root, i): ArrangeRow => ({ kind: 'project', project: byRoot.get(root)!, into: group.name, key: root, at: i, list }))];
  });
  const window = windowed(ctx, 'arrange', rows, { size: 40, keys: true });
  const [naming, setNaming] = ctx.local('arrange:naming', false);
  const [renaming, setRenaming] = ctx.local<string | undefined>('arrange:renaming', undefined);
  const itemOf = (key: string): Item => (isGroupKey(key) ? { group: groupOfKey(key) } : { project: byRoot.get(key)?.id ?? key });
  const moves = (id: string, row_: ArrangeRow): Node[] => {
    const into = row_.kind === 'project' ? row_.into : null;
    const before = (at: number): Item | null => {
      const next = row_.list[at];
      return next ? itemOf(next) : null;
    };
    return [
      ...(row_.at > 0 ? [ctx.draw.button(`arrange:${id}:up`, 'Move Up', () => ctx.call('workspaces.arrange', itemOf(row_.key), { into, before: before(row_.at - 1) }), { plain: true, dim: true })] : []),
      ...(row_.at < row_.list.length - 1 ? [ctx.draw.button(`arrange:${id}:down`, 'Move Down', () => ctx.call('workspaces.arrange', itemOf(row_.key), { into, before: before(row_.at + 2) }), { plain: true, dim: true })] : []),
    ];
  };
  const drawn = (item: ArrangeRow): Node => {
    if (item.kind === 'project') {
      const p = item.project;
      return row([line(span(`${item.into ? '  ' : ''}${p.name}`)), ...moves(`p:${p.id}`, item), ctx.draw.button(`arrange:p:${p.id}:group`, 'Move to Group', () => ctx.go({ name: 'project-group', params: { id: p.id } }), { plain: true, dim: true })]);
    }
    const name = item.group.name;
    if (renaming === name) {
      return ctx.draw.input(
        `arrange:g:${name}:name`,
        async (value) => {
          setRenaming(undefined);
          const to = value?.trim();
          if (to && to !== name) await ctx.call('workspaces.renameGroup', name, to);
        },
        { label: 'Group', value: name, submitLabel: 'rename', autoFocus: true },
      );
    }
    return row([
      line(span(name, { weight: 'semibold' }), span(`  ${plural(item.group.projects.length, 'project')}`, { dim: true })),
      ...moves(`g:${name}`, item),
      ctx.draw.button(`arrange:g:${name}:rename`, 'Rename', () => setRenaming(name), { plain: true, dim: true }),
      twoPress(ctx, `arrange:g:${name}:ungroup`, 'Ungroup', () => ctx.call('workspaces.ungroup', name)),
    ]);
  };
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx, 'Projects'),
    title('Arrange'),
    dim('Moving a group moves its projects with it. Ungrouping keeps the projects.'),
    naming
      ? ctx.draw.input(
          'arrange:new',
          async (value) => {
            setNaming(false);
            if (value?.trim()) await ctx.call('workspaces.newGroup', value.trim());
          },
          { label: 'Name', placeholder: 'A name for the group', submitLabel: 'make', autoFocus: true },
        )
      : ctx.draw.button('arrange:add', 'New Group', () => setNaming(true), { hotkey: 'a', primary: true }),
    rows.length === 0 && empty('No projects to arrange yet.'),
    col(window.shown.map(drawn)),
    window.controls,
  );
}

/** Which group a project is in: another, a new one, or none. */
export function projectGroupPage(ctx: Ctx, id: string): Node {
  const project = ctx.state.projects.find((p) => p.id === id);
  if (!project) return page(chrome(ctx, placesOf(ctx), 'projects'), back(ctx), empty('That project is gone.'));
  const current = ctx.state.projectGroups.find((g) => g.projects.includes(project.root));
  const others = ctx.state.projectGroups.filter((g) => g.name !== current?.name);
  const window = windowed(ctx, `group:${id}`, others, { keys: true });
  const [naming, setNaming] = ctx.local(`project-group:${id}:naming`, false);
  const done = (): void => ctx.nav.back(ctx.pane);
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx),
    title(project.name),
    dim(current ? `In group: ${current.name}` : 'Not in a group'),
    ...window.shown.map((g) =>
      ctx.draw.button(`to:${g.name}`, `Move to “${g.name}”`, async () => {
        await ctx.call('workspaces.setGroup', project.id, g.name);
        done();
      }, { plain: true }),
    ),
    window.controls,
    naming
      ? ctx.draw.input(
          'group:new',
          async (value) => {
            setNaming(false);
            if (!value?.trim()) return;
            await ctx.call('workspaces.newGroup', value.trim(), { project: project.id });
            done();
          },
          { label: 'Name', placeholder: 'A name for the group', submitLabel: 'make', autoFocus: true },
        )
      : ctx.draw.button('group:add', 'Move to a New Group', () => setNaming(true), { primary: true, hotkey: 'a' }),
    current
      ? ctx.draw.button('group:out', `Take Out of “${current.name}”`, async () => {
          await ctx.call('workspaces.setGroup', project.id);
          done();
        }, { plain: true, dim: true })
      : undefined,
  );
}
