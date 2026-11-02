import type { Dashboard, Tile } from '../../core/sentinel/dashboard-model.js';
import type { Sentinel, Step } from '../../core/sentinel/model.js';
import type { Ctx, Screen } from '../screens.js';
import type { Node } from '../tree.js';
import { back, empty, page } from './common.js';
import { askPage } from './sentinel-asks.js';
import { addNewPage, addPage, addPickPage, boardMorePage, boardPage, dashboardsPage, tileMorePage, tilePage } from './sentinel-board.js';
import { chatMorePage, chatPage, chatsPage, sessionPage } from './sentinel-chat.js';
import { top } from './sentinel-common.js';
import { dataPage, documentPage, filesPage, metricPage, rowPage, rowsPage } from './sentinel-data.js';
import { addStepPage, specPage, stepMorePage, stepPage, whenPage } from './sentinel-form.js';
import { listMorePage, listPage, newPage } from './sentinel-list.js';
import { morePage, runsPage, sentinelPage, webhookPage } from './sentinel-page.js';
import { runMorePage, runPage } from './sentinel-runs.js';

/**
 * Sentinel: watchers that run on a schedule or a trigger, do steps and leave a report, and dashboards
 * of the numbers they keep (docs/sentinel.md). This file only finds the page a route names, and says
 * so when its subject has gone: the words and edits are in sentinel-model.ts, each kind of page in a
 * file of its own, and everything that asks first in sentinel-asks.ts.
 */

const goneSentinel = (ctx: Ctx): Node => page(top(ctx, 'sentinels'), back(ctx), empty('That sentinel is gone. It may have been deleted.'));
const goneBoard = (ctx: Ctx): Node => page(top(ctx, 'dashboards'), back(ctx), empty('That board is gone.'));
const goneTile = (ctx: Ctx): Node => page(top(ctx, 'dashboards'), back(ctx), empty('That tile is gone.'));
const goneStep = (ctx: Ctx): Node => page(top(ctx, 'sentinels'), back(ctx), empty('That step is gone.'));

function sentinelRoute(ctx: Ctx, item: Sentinel, p: Readonly<Record<string, string>>): Node | undefined {
  const step: Step | undefined = item.steps.find((x) => x.id === p.step);
  switch (ctx.route.name) {
    case 'page':
      return sentinelPage(ctx, item);
    case 'more':
      return morePage(ctx, item);
    case 'when':
      return whenPage(ctx, item);
    case 'webhook':
      return webhookPage(ctx, item);
    case 'runs':
      return runsPage(ctx, item);
    case 'add-step':
      return addStepPage(ctx, item);
    case 'step':
      return step ? stepPage(ctx, item, step) : goneStep(ctx);
    case 'step-more':
      return step ? stepMorePage(ctx, item, step) : goneStep(ctx);
    case 'spec':
      return step?.kind === 'measure' ? specPage(ctx, item, step, Number(p.at)) : goneStep(ctx);
    case 'data':
      return dataPage(ctx, item);
    case 'files':
      return filesPage(ctx, item, p.run ?? '');
    case 'metric':
      return metricPage(ctx, item, p.name ?? '');
    case 'rows':
      return rowsPage(ctx, item, p.name ?? '', p.run);
    case 'row':
      return rowPage(ctx, item, p.name ?? '', Number(p.at), p.run);
    default:
      return undefined;
  }
}

function boardRoute(ctx: Ctx, board: Dashboard, p: Readonly<Record<string, string>>): Node | undefined {
  const tile: Tile | undefined = board.tiles.find((t) => t.id === p.tile);
  switch (ctx.route.name) {
    case 'board':
      return boardPage(ctx, board);
    case 'board-more':
      return boardMorePage(ctx, board);
    case 'tile':
      return tile ? tilePage(ctx, board, tile) : goneTile(ctx);
    case 'tile-more':
      return tile ? tileMorePage(ctx, board, tile) : goneTile(ctx);
    case 'add':
      return addPage(ctx, board);
    case 'add-new':
      return addNewPage(ctx, board, p.source ?? '');
    case 'add-pick':
      return addPickPage(ctx, board, p);
    default:
      return undefined;
  }
}

const SENTINEL_ROUTES: ReadonlySet<string> = new Set(['page', 'more', 'when', 'webhook', 'runs', 'add-step', 'step', 'step-more', 'spec', 'data', 'files', 'metric', 'rows', 'row']);
const BOARD_ROUTES: ReadonlySet<string> = new Set(['board', 'board-more', 'tile', 'tile-more', 'add', 'add-new', 'add-pick']);

export const sentinelPane: Screen = (ctx) => {
  const s = ctx.state.sentinel;
  if (!s.enabled) return page(top(ctx), empty('Sentinel isn’t on in this engine.'));
  const name = ctx.route.name;
  const p = ctx.route.params ?? {};
  if (SENTINEL_ROUTES.has(name)) {
    const item = s.items.find((x) => x.id === p.id);
    return (item && sentinelRoute(ctx, item, p)) ?? goneSentinel(ctx);
  }
  if (BOARD_ROUTES.has(name)) {
    const board = s.dashboards?.find((d) => d.id === p.board);
    return (board && boardRoute(ctx, board, p)) ?? goneBoard(ctx);
  }
  switch (name) {
    case 'ask':
      return askPage(ctx);
    case 'new':
      return newPage(ctx);
    case 'list-more':
      return listMorePage(ctx);
    case 'run':
      return p.run ? runPage(ctx, p.run) : goneSentinel(ctx);
    case 'run-more':
      return p.run ? runMorePage(ctx, p.run) : goneSentinel(ctx);
    case 'document':
      return documentPage(ctx, p);
    case 'dashboards':
      return dashboardsPage(ctx);
    case 'chat':
      return chatPage(ctx, p.chat);
    case 'chats':
      return chatsPage(ctx);
    case 'chat-more':
      return p.chat ? chatMorePage(ctx, p.chat) : chatPage(ctx, undefined);
    case 'session':
      return p.channel ? sessionPage(ctx, p.channel) : goneSentinel(ctx);
    default:
      return listPage(ctx);
  }
};
