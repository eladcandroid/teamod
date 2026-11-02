import type { Ctx, Screen } from '../screens.js';
import type { Node } from '../tree.js';
import { boardsPage, planReviewsPage, teamPlanPage, teamProjectPage } from './team-boards.js';
import { addPeoplePage, channelPage, chatAskPage, chatMorePage, chatsPage, conversationPage, filePage, memberPage, messagePage, newChannelPage } from './team-chat.js';
import { inert } from './team-common.js';
import { dialogueNewPage, dialoguePage, dialoguesPage } from './team-dialogues.js';
import { addPage, friendMorePage, friendPage, friendsPage, networkPage, statusPage } from './team-people.js';
import { accessPage, askPage, capabilityPage, requestMorePage, requestPage, requestsPage, rulePage } from './team-requests.js';
import {
  folderPage,
  guestPage,
  handoffPage,
  invitePersonPage,
  remoteWorktreePage,
  roomChatPage,
  roomInvitePage,
  roomMorePage,
  roomPage,
  roomPersonPage,
  shareFolderPage,
  sharePickPage,
  shareProjectPage,
  shareWorktreePage,
  sharedFilePage,
  sharedMorePage,
  sharedProjectPage,
  sharedScratchPage,
  sharedWorktreePage,
  sharingPage,
} from './team-sharing.js';

/** Which page a route is. Its parameters name what it shows; one that's gone says so. */
function pageFor(ctx: Ctx): Node {
  const params = ctx.route.params ?? {};
  const id = params.id ?? '';
  const owner = params.owner ?? '';
  switch (ctx.route.name) {
    case 'add':
      return addPage(ctx);
    case 'status':
      return statusPage(ctx);
    case 'friend':
      return friendPage(ctx, id);
    case 'friend-more':
      return friendMorePage(ctx, id);
    case 'network':
      return networkPage(ctx);
    case 'chats':
      return chatsPage(ctx);
    case 'conversation':
      return conversationPage(ctx, id);
    case 'chat-ask':
      return chatAskPage(ctx, id);
    case 'chat-more':
      return chatMorePage(ctx, id);
    case 'message':
      return messagePage(ctx, id, params.msg ?? '');
    case 'file':
      return filePage(ctx, id, params.msg ?? '', params.sha ?? '');
    case 'channel':
      return channelPage(ctx, id);
    case 'member':
      return memberPage(ctx, id, params.peer ?? '');
    case 'add-people':
      return addPeoplePage(ctx, id);
    case 'new-channel':
      return newChannelPage(ctx, params.with);
    case 'requests':
      return requestsPage(ctx);
    case 'request':
      return requestPage(ctx, id);
    case 'request-more':
      return requestMorePage(ctx, id);
    case 'ask':
      return askPage(ctx, params.to);
    case 'access':
      return accessPage(ctx);
    case 'capability':
      return capabilityPage(ctx, params.need ?? '');
    case 'rule':
      return rulePage(ctx, id);
    case 'sharing':
      return sharingPage(ctx);
    case 'share-pick':
      return sharePickPage(ctx);
    case 'share-project':
      return shareProjectPage(ctx, id);
    case 'share-worktree':
      return shareWorktreePage(ctx, id);
    case 'handoff':
      return handoffPage(ctx, id);
    case 'share-folder':
      return shareFolderPage(ctx);
    case 'shared-project':
      return sharedProjectPage(ctx, owner, id);
    case 'shared-worktree':
      return sharedWorktreePage(ctx, owner, id);
    case 'shared-more':
      return sharedMorePage(ctx, owner, id);
    case 'shared-scratch':
      return sharedScratchPage(ctx, owner, id);
    case 'shared-file':
      return sharedFilePage(ctx, { owner, share: params.share ?? '', path: params.path ?? '' });
    case 'folder':
      return folderPage(ctx);
    case 'room':
      return roomPage(ctx);
    case 'room-more':
      return roomMorePage(ctx);
    case 'room-chat':
      return roomChatPage(ctx);
    case 'room-invite':
      return roomInvitePage(ctx);
    case 'guest':
      return guestPage(ctx, id);
    case 'room-person':
      return roomPersonPage(ctx, id);
    case 'invite-person':
      return invitePersonPage(ctx, id);
    case 'remote-worktree':
      return remoteWorktreePage(ctx, id);
    case 'boards':
      return boardsPage(ctx);
    case 'team-project':
      return teamProjectPage(ctx, id);
    case 'team-plan':
      return teamPlanPage(ctx, owner, id);
    case 'plan-reviews':
      return planReviewsPage(ctx, id);
    case 'dialogues':
      return dialoguesPage(ctx);
    case 'dialogue':
      return dialoguePage(ctx, id);
    case 'dialogue-new':
      return dialogueNewPage(ctx);
    default:
      return friendsPage(ctx);
  }
}

/** People: the network and your teammates, conversations, requests between agents, what you share, team boards and dialogues. */
export const teamPane: Screen = (ctx) => inert(pageFor(ctx));
