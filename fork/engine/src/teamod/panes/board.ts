import { BRIEF_SECTIONS, type BriefSection } from '../../core/board/model.js';
import type { Screen } from '../screens.js';
import { actionsPage, logPage, runMorePage, runPage, workflowsPage } from './board-actions.js';
import { pickProjectPage } from './board-common.js';
import { issueMorePage, issuePage, issuesPage, pullsPage } from './board-issues.js';
import { planAgentPage, planBranchPage, planFeedPage, planGatePage, planModePage, planMorePage, planPage, planSendBackPage, planTaskPage, planTaskWithPage } from './board-plan.js';
import { newPlanAgentPage, newPlanPage, planHerePage, planStylePage, plansPage } from './board-plans.js';
import { aboutPage, boardNewPage, boardSettingsPage, labelsPage, syncPage } from './board-settings.js';
import { taskAgentPage, taskBriefPage, taskEditPage, taskHistoryPage, taskMorePage, taskPage, taskProofPage, taskRelatePage, taskStartWithPage } from './board-task.js';
import { boardsPage, newTaskAgentPage, newTaskPage, tasksMorePage, tasksPage } from './board-tasks.js';

const isSection = (name: string | undefined): name is BriefSection => (BRIEF_SECTIONS as readonly (string | undefined)[]).includes(name);

/**
 * Board: the work, from a task to a plan to GitHub. Tasks and Plans read the state; Issues and
 * Actions ask GitHub through the engine. Each place's pages are in its own file.
 */
export const boardPane: Screen = (ctx) => {
  const { id, project, number, run, task, milestone, field, section, rel, board, issue, as, then, job } = ctx.route.params ?? {};
  const asNumber = Number(number);
  const asRun = Number(run);
  switch (ctx.route.name) {
    case 'task':
      if (id) return taskPage(ctx, id);
      break;
    case 'task-more':
      if (id) return taskMorePage(ctx, id);
      break;
    case 'task-edit':
      if (id) return taskEditPage(ctx, id, field ?? '');
      break;
    case 'task-brief':
      if (id && isSection(section)) return taskBriefPage(ctx, id, section);
      break;
    case 'task-history':
      if (id && isSection(section)) return taskHistoryPage(ctx, id, section);
      break;
    case 'task-relate':
      if (id) return taskRelatePage(ctx, id, rel ?? '');
      break;
    case 'task-proof':
      if (id) return taskProofPage(ctx, id, as === 'file' ? 'file' : 'proof');
      break;
    case 'task-agent':
      if (id) return taskAgentPage(ctx, id);
      break;
    case 'task-start-with':
      if (id) return taskStartWithPage(ctx, id);
      break;
    case 'new-task':
      return newTaskPage(ctx);
    case 'new-task-agent':
      return newTaskAgentPage(ctx);
    case 'tasks-more':
      return tasksMorePage(ctx);
    case 'boards':
      return boardsPage(ctx);
    case 'board-new':
      return boardNewPage(ctx);
    case 'board-settings':
      if (board) return boardSettingsPage(ctx, board);
      break;
    case 'about':
      if (project) return aboutPage(ctx, project);
      break;
    case 'labels':
      if (project) return labelsPage(ctx, project, issue);
      break;
    case 'sync':
      if (project) return syncPage(ctx, project);
      break;
    case 'pick-project':
      return pickProjectPage(ctx);
    case 'plans':
      return plansPage(ctx);
    case 'plan':
      if (id) return planPage(ctx, id);
      return plansPage(ctx);
    case 'plan-new':
      return newPlanPage(ctx);
    case 'plan-new-agent':
      return newPlanAgentPage(ctx);
    case 'plan-here':
      return planHerePage(ctx);
    case 'plan-style':
      return planStylePage(ctx);
    case 'plan-mode':
      if (id) return planModePage(ctx, id, milestone);
      return plansPage(ctx);
    case 'plan-more':
      if (id) return planMorePage(ctx, id);
      return plansPage(ctx);
    case 'plan-feed':
      if (id) return planFeedPage(ctx, id);
      return plansPage(ctx);
    case 'plan-branch':
      if (id) return planBranchPage(ctx, id);
      return plansPage(ctx);
    case 'plan-agent':
      if (id) return planAgentPage(ctx, id, then === 'approve');
      return plansPage(ctx);
    case 'plan-gate':
      if (id && milestone) return planGatePage(ctx, id, milestone);
      return plansPage(ctx);
    case 'plan-send-back':
      if (id && milestone) return planSendBackPage(ctx, id, milestone);
      return plansPage(ctx);
    case 'plan-task':
      if (id && task) return planTaskPage(ctx, id, task);
      return plansPage(ctx);
    case 'plan-task-with':
      if (id && task) return planTaskWithPage(ctx, id, task);
      return plansPage(ctx);
    case 'issues':
      return issuesPage(ctx);
    case 'issue':
      if (project && asNumber > 0) return issuePage(ctx, project, asNumber);
      return issuesPage(ctx);
    case 'issue-more':
      if (project && asNumber > 0) return issueMorePage(ctx, project, asNumber);
      return issuesPage(ctx);
    case 'pulls':
      if (project) return pullsPage(ctx, project);
      return issuesPage(ctx);
    case 'actions':
      return actionsPage(ctx);
    case 'workflows':
      if (project) return workflowsPage(ctx, project);
      return actionsPage(ctx);
    case 'run':
      if (project && asRun > 0) return runPage(ctx, project, asRun);
      return actionsPage(ctx);
    case 'run-more':
      if (project && asRun > 0) return runMorePage(ctx, project, asRun);
      return actionsPage(ctx);
    case 'log':
      if (project && Number(job) > 0) return logPage(ctx, project, Number(job));
      return actionsPage(ctx);
    default:
      break;
  }
  return tasksPage(ctx);
};
