import type { Project, Workspace } from '../../workspaces/types.js';
import { worktreeOrigin } from '../../workspaces/origin.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, col, dim, line, span, text, title } from '../tree.js';
import { type Place, back, chrome, empty, homePath, openWorkspace, page, statusOf } from './common.js';

const PLACES: readonly Place[] = [{ id: 'projects', label: 'Projects', hotkey: 'p', route: { name: 'projects' } }];

/** A project's work in progress: yours, not a sub-agent's, not archived, not the main checkout. */
export const activeOf = (project: Project): Workspace[] =>
  project.workspaces.filter((w) => !w.archived && w.kind !== 'main' && worktreeOrigin(w) !== 'agent');

function workspaceRow(ctx: Ctx, ws: Workspace): Node {
  const status = statusOf(ctx.state, ws);
  return ctx.draw.button(`ws:${ws.id}`, ws.name, () => openWorkspace(ctx, ws.id), { plain: true, spans: [span(`${ws.name}  `), status] });
}

/** Add Project: a press opens the field, Enter adds it. */
function addProject(ctx: Ctx): Node {
  const [adding, setAdding] = ctx.local('work:adding', false);
  if (!adding) return ctx.draw.button('add', 'Add Project', () => setAdding(true), { hotkey: 'a' });
  return ctx.draw.input(
    'add-path',
    async (value) => {
      setAdding(false);
      const path = value?.trim();
      if (path) await ctx.call('projects.add', path);
    },
    { label: 'Folder', placeholder: '/path/to/repository', submitLabel: 'add', autoFocus: true },
  );
}

function projects(ctx: Ctx): Node {
  const hidden = new Set(ctx.state.hiddenProjects);
  const shown = ctx.state.projects.filter((p) => p.root && !hidden.has(p.root));
  const withWork = shown.filter((p) => activeOf(p).length > 0);
  const quiet = shown.filter((p) => activeOf(p).length === 0);
  const chats = ctx.state.projects.find((p) => !p.root);
  const openChats = chats ? activeOf(chats) : [];
  return page(
    chrome(ctx, PLACES, 'projects'),
    addProject(ctx),
    shown.length === 0 && empty('No projects yet. Add a repository to start.'),
    ...withWork.map((p) =>
      col([
        ctx.draw.button(`project:${p.id}`, p.name, () => ctx.go({ name: 'project', params: { id: p.id } }), { plain: true, spans: [span(p.name, { weight: 'semibold' })] }),
        ...activeOf(p).map((ws) => workspaceRow(ctx, ws)),
      ]),
    ),
    openChats.length > 0 && col([title('Chats'), ...openChats.map((ws) => workspaceRow(ctx, ws))]),
    quiet.length > 0 &&
      col([
        dim(`Other projects (${quiet.length})`),
        ...quiet.map((p) => ctx.draw.button(`project:${p.id}`, p.name, () => ctx.go({ name: 'project', params: { id: p.id } }), { plain: true, dim: true })),
      ]),
  );
}

function projectHome(ctx: Ctx, id: string): Node {
  const project = ctx.state.projects.find((p) => p.id === id);
  if (!project) return page(back(ctx), empty('That project is gone.'));
  const active = activeOf(project);
  return page(
    chrome(ctx, PLACES),
    back(ctx, 'Projects'),
    col([title(project.name), dim(homePath(ctx.state, project.root))]),
    project.error ? text(project.error, { color: 'error' }) : undefined,
    active.length === 0 ? empty('Nothing in progress here.') : col([line(span(`In progress (${active.length})`, { dim: true })), ...active.map((ws) => workspaceRow(ctx, ws))]),
  );
}

export const workPane: Screen = (ctx) => {
  if (ctx.route.name === 'project' && ctx.route.params?.id) return projectHome(ctx, ctx.route.params.id);
  return projects(ctx);
};
