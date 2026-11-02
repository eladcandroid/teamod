import type { Screen } from '../screens.js';
import { assistantPage } from './work-assistant.js';
import { confirmPage } from './work-confirm.js';
import { projectAgentPage, projectHome, projectMore } from './work-home.js';
import { inboxPage, templatesPage } from './work-inbox.js';
import { activityPage, overviewPage, searchPage } from './work-places.js';
import { addPage, arrangePage, browsePage, hiddenPage, newProjectPage, projectGroupPage, projectsPage } from './work-projects.js';
import { usagePage } from './work-usage.js';
import { cleanPage, importPage, worktreePage, worktreesPage } from './work-worktrees.js';

export { activeOf } from './work-common.js';

/** The Work screen, by route. `project`, `overview`, `search`, `usage`, `activity` and `assistant` are where the engine navigates too (`routeOfView`). */
export const workPane: Screen = (ctx) => {
  const params = ctx.route.params ?? {};
  switch (ctx.route.name) {
    case 'project':
      if (params.id) return projectHome(ctx, params.id);
      break;
    case 'project-more':
      if (params.id) return projectMore(ctx, params.id);
      break;
    case 'project-agent':
      if (params.id) return projectAgentPage(ctx, params.id);
      break;
    case 'project-group':
      if (params.id) return projectGroupPage(ctx, params.id);
      break;
    case 'add':
      return addPage(ctx);
    case 'browse':
      return browsePage(ctx, params.dir || ctx.state.home || '~');
    case 'new':
      return newProjectPage(ctx);
    case 'hidden':
      return hiddenPage(ctx);
    case 'arrange':
      return arrangePage(ctx);
    case 'worktrees':
      return worktreesPage(ctx, params.project);
    case 'worktree':
      if (params.id) return worktreePage(ctx, params.id);
      break;
    case 'clean':
      return cleanPage(ctx, params.project);
    case 'import':
      if (params.project) return importPage(ctx, params.project, params.dir);
      break;
    case 'confirm':
      return confirmPage(ctx);
    case 'overview':
      return overviewPage(ctx);
    case 'search':
      return searchPage(ctx);
    case 'usage':
      return usagePage(ctx);
    case 'activity':
      return activityPage(ctx);
    case 'inbox':
      return inboxPage(ctx);
    case 'templates':
      return templatesPage(ctx);
    case 'assistant':
      return assistantPage(ctx);
    default:
      break;
  }
  return projectsPage(ctx);
};
