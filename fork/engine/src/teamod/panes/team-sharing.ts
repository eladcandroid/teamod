import { waitingNote } from '../../core/friend-share-people.js';
import type { BrowserRow, LogItem, Location, MyShare } from '../../core/store.js';
import { TRUST_INFO, canRunOn } from '../../core/trust.js';
import { cannotTake } from '../../net/mesh/features.js';
import { type GuestCan, type WsRole, defaultAgentOf } from '../../protocol.js';
import { agentLabel, agentName } from '../../shared/agent-label.js';
import { formatBytes } from '../../shared/format.js';
import { CAN_INFO, DAY_MS, expiresIn } from '../../shared/invites.js';
import { shareNameOf } from '../../shared/share-names.js';
import { CAN_ORDER, type InviteChoice, inviteChoice } from '../../ui/invite-menus.js';
import { type ShareAccess, type WorktreeShareRow, handoffPeople, shareRowDetail, worktreeShareRows } from '../../ui/worktree-share.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, row, span, text, title } from '../tree.js';
import { ago, back, empty, findWorkspace, homePath, openWorkspace, page } from './common.js';
import { MAX_ROWS, byName, choice, confirmPress, levelOf, listOf, nameOf, peerMd, top, uniqueBy, wholePath } from './team-common.js';
import { trustChoices } from './team-people.js';

/**
 * Sharing: projects, worktrees and folders with teammates over the network, and your room with its
 * links, guests and people at the door. Everything here is a person's press: nothing is shared, and
 * nobody's let in, until you say.
 */

const ACCESS: ReadonlyArray<readonly [ShareAccess, string]> = [
  ['contribute', 'Can work here'],
  ['view', 'Can follow'],
  ['none', 'No access'],
];

const accessChoices = (ctx: Ctx, key: string, now: ShareAccess, set: (access: ShareAccess) => unknown): Node => row(ACCESS.map(([value, label]) => choice(ctx, `${key}:${value}`, label, now === value, () => set(value))));

const shareWords = (ctx: Ctx, x: MyShare): string => (x.private ? `only ${(x.allowed ?? []).map((id) => nameOf(ctx.state, id)).join(', ') || 'nobody'}` : 'everyone');

/** Who's in your room, in a few words. */
function roomWords(ctx: Ctx): string {
  const { status, peers, isHost, connection } = ctx.state;
  if (connection) return connection.state === 'offline' ? 'Offline' : 'Reconnecting...';
  const others = peers.filter((p) => p.peerId !== ctx.state.selfId).length;
  return `${status === 'connected' ? (isHost ? 'You host it' : 'Connected') : status === 'connecting' ? 'Connecting...' : 'Offline'}${others ? ` · ${others} other${others === 1 ? '' : 's'}` : ''}`;
}

export function sharingPage(ctx: Ctx): Node {
  const st = ctx.state;
  const roomWorktrees = st.shared.filter((w) => w.via !== 'mesh');
  const yours = st.projects.filter((p) => p.root && Object.keys(st.projectShares[p.id] ?? {}).length > 0);
  const folders = uniqueBy([...st.offers.map((o) => ({ owner: o.owner, ownerName: nameOf(st, o.owner), name: o.name, label: o.name, writable: o.writable })), ...st.friendFolders], (f) => `${f.owner}:${f.name}`);
  const nothing = !st.sharedProjects.length && !roomWorktrees.length && !folders.length && !yours.length && !st.myShares.length;
  return page(
    top(ctx, 'sharing'),
    ctx.draw.button('share:pick', 'Share a Project', () => ctx.go({ name: 'share-pick' }), { primary: true, hotkey: 'a' }),
    ctx.draw.button('share:room', 'Your Room', () => ctx.go({ name: 'room' }), { plain: true, hotkey: 'i', spans: [span('Your Room  '), span(roomWords(ctx), { dim: true })] }),
    nothing && empty('Nothing shared yet, either way. Nobody sees anything until you share it.'),
    st.sharedProjects.length > 0 &&
      col([
        dim(`Shared with you (${st.sharedProjects.length})`),
        listOf(ctx, 'shared:projects', st.sharedProjects, (p) =>
          ctx.draw.button(`shared:${p.owner}:${p.id}`, p.name, () => ctx.go({ name: 'shared-project', params: { owner: p.owner, id: p.id } }), {
            plain: true,
            spans: [span(`${p.name}  `), span(`${p.ownerName}’s · ${p.role === 'contribute' ? 'you can work here' : 'you can follow along'} · ${p.worktrees.length} worktree${p.worktrees.length === 1 ? '' : 's'}`, { dim: true })],
          }),
        ),
      ]),
    roomWorktrees.length > 0 &&
      col([
        dim(`Shared with you in your room (${roomWorktrees.length})`),
        listOf(ctx, 'shared:room', roomWorktrees, (w) =>
          ctx.draw.button(`shared-room:${w.owner}:${w.id}`, w.name, () => ctx.go({ name: 'shared-worktree', params: { owner: w.owner, id: w.id } }), { plain: true, spans: [span(`${w.name}  `), span(`${nameOf(st, w.owner)}’s ${w.project}`, { dim: true })] }),
        ),
      ]),
    folders.length > 0 &&
      col([
        dim(`Folders shared with you (${folders.length})`),
        listOf(ctx, 'shared:folders', folders, (f) =>
          ctx.draw.button(
            `shared-folder:${f.owner}:${f.name}`,
            f.label,
            async () => {
              await ctx.call('files.browseTo', { owner: f.owner, share: f.name, path: '' });
              ctx.go({ name: 'folder' });
            },
            { plain: true, spans: [span(`${f.label}  `), span(`${f.ownerName}’s${f.writable ? ' · their agent may edit it' : ''}`, { dim: true })] },
          ),
        ),
      ]),
    yours.length > 0 &&
      col([
        dim(`Projects you share (${yours.length})`),
        listOf(ctx, 'share:yours', yours, (p) => {
          const people = Object.keys(st.projectShares[p.id] ?? {});
          return ctx.draw.button(`share:project:${p.id}`, p.name, () => ctx.go({ name: 'share-project', params: { id: p.id } }), { plain: true, spans: [span(`${p.name}  `), span(`with ${people.map((id) => nameOf(st, id)).slice(0, 4).join(', ')}${people.length > 4 ? ` and ${people.length - 4} others` : ''}`, { dim: true })] });
        }),
      ]),
    ctx.draw.button('share:folder', st.myShares.length ? `Folders You Share (${st.myShares.length})` : 'Share a Folder', () => ctx.go({ name: 'share-folder' }), { plain: true, dim: true, hotkey: 'f' }),
  );
}

/** Which project to share. */
export function sharePickPage(ctx: Ctx): Node {
  const projects = ctx.state.projects.filter((p) => p.root);
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Sharing'),
    title('Share a Project'),
    dim('Teammates you add see it with its worktrees, new ones too. Nobody needs to host, and it stays while either of you is offline.'),
    projects.length === 0 && empty('No projects yet. Add one in Work.'),
    listOf(ctx, 'share:pick-list', projects, (p) => ctx.draw.button(`share:pick:${p.id}`, p.name, () => ctx.go({ name: 'share-project', params: { id: p.id } }), { plain: true })),
  );
}

/** A project of yours: each teammate's access, changed in place, and its worktrees one by one. */
export function shareProjectPage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const project = st.projects.find((p) => p.id === id);
  if (!project) return page(top(ctx, 'sharing'), back(ctx), empty('That project is gone.'));
  const grants = st.projectShares[id];
  const friends = [...st.network.friends].sort(byName);
  const worktrees = project.workspaces.filter((w) => !w.archived && !w.external && w.kind !== 'main');
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Sharing'),
    title(`Share ${project.name}`),
    friends.length === 0 && empty(st.network.enabled ? 'No teammates yet. Add one in People, then share with them here.' : 'Sharing with teammates needs the network: it turns on from People.'),
    listOf(ctx, `share:${id}:friends`, friends, (f) => {
      const grant = grants?.[f.peerId];
      const access: ShareAccess = grant?.role ?? 'none';
      const why = access === 'none' ? cannotTake(f.name, f.teamod, 'share.project', f.online) : undefined;
      return col([
        line(f.name, span(`  ${why ?? (access === 'contribute' ? 'Talks to your agent in its worktrees' : access === 'view' ? 'Follows along, read-only' : 'Not shared with them')}`, { dim: true }), grant?.only ? span(`  ${grant.only.length === 1 ? 'one worktree' : `${grant.only.length} worktrees`}`, { dim: true }) : undefined),
        accessChoices(ctx, `share:${id}:${f.peerId}`, access, (next) => (next === 'none' ? ctx.call('sharing.unshareFriend', { peerId: f.peerId, projectId: id }) : ctx.call('sharing.shareWithFriend', { peerId: f.peerId, projectId: id, role: next as WsRole }))),
      ]);
    }),
    worktrees.length > 0 &&
      col([
        dim('One worktree only'),
        listOf(ctx, `share:${id}:worktrees`, worktrees, (w) => ctx.draw.button(`share:worktree:${w.id}`, w.name, () => ctx.go({ name: 'share-worktree', params: { id: w.id } }), { plain: true, ...(w.branch ? { spans: [span(`${w.name}  `), span(w.branch, { dim: true })] } : {}) })),
      ]),
    dim('Your agent does the work, on this computer. Risky steps still ask you, unless you fully trust the person asking.'),
  );
}

/** A worktree of yours: everyone's access to just this one. */
export function shareWorktreePage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const ws = findWorkspace(st, id);
  if (!ws) return page(top(ctx, 'sharing'), back(ctx), empty('That worktree is gone.'));
  const project = st.projects.find((p) => p.workspaces.some((w) => w.id === id));
  const rows = worktreeShareRows(st, id);
  const set = (r: WorktreeShareRow, access: ShareAccess): Promise<unknown> => {
    const where = { peerId: r.peerId, workspaceId: id, ...(project ? { projectId: project.id } : {}) };
    if (r.via === 'room') return access === 'none' ? ctx.call('sharing.remove', id, r.peerId) : ctx.call('sharing.invite', id, r.peerId, access);
    return access === 'none' ? ctx.call('sharing.unshareFriend', where) : ctx.call('sharing.shareWithFriend', { ...where, role: access });
  };
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(`Share ${ws.name}`),
    dim('Only this worktree: people you add see its conversation, files and Scratch, and can ask your agent here.'),
    rows.length === 0 && empty(st.network.enabled ? 'No teammates yet. Add one in People, then share this worktree with them here.' : 'Turn on the network in People to share with teammates, or invite someone to your room.'),
    listOf(ctx, `share-ws:${id}:rows`, rows, (r) => {
      const friend = st.network.friends.find((f) => f.peerId === r.peerId);
      const why = r.via === 'network' && r.access === 'none' && friend ? cannotTake(friend.name, friend.teamod, 'share.project', friend.online) : undefined;
      return col([line(r.name, span(`  ${why ?? shareRowDetail(r, st.peers.some((p) => p.peerId === r.peerId))}`, { dim: true })), accessChoices(ctx, `share-ws:${id}:${r.peerId}`, r.access, (next) => set(r, next))]);
    }),
    ws.kind === 'worktree' && ctx.draw.button('share-ws:handoff', 'Hand Off', () => ctx.go({ name: 'handoff', params: { id } }), { plain: true, dim: true }),
  );
}

/** Hand a worktree to someone: they take over on their computer, with their own agent. */
export function handoffPage(ctx: Ctx, id: string): Node {
  const ws = findWorkspace(ctx.state, id);
  if (!ws) return page(top(ctx, 'sharing'), back(ctx), empty('That worktree is gone.'));
  const people = handoffPeople(ctx.state);
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(`Hand Off ${ws.name}`),
    dim('A teammate takes over this work on their computer, with their own agent. They need the same repository. To work on it together instead, share it.'),
    people.length === 0 && empty('Nobody to hand it to yet. Add a teammate in People.'),
    listOf(ctx, `handoff:${id}`, people, (p) =>
      p.why
        ? line(p.name, span(`  ${p.why}`, { dim: true }))
        : confirmPress(ctx, `handoff:${id}:${p.peerId}`, `Hand Off to ${p.name}`, `${p.name}’s agent continues on ${p.name}’s computer${p.online ? '' : '. They’re offline: it waits for them'}.`, () => ctx.call('remote.handoff', id, p.peerId)),
    ),
  );
}

/** A project a teammate shared with you. */
export function sharedProjectPage(ctx: Ctx, owner: string, id: string): Node {
  const p = ctx.state.sharedProjects.find((x) => x.owner === owner && x.id === id);
  if (!p) return page(top(ctx, 'sharing'), back(ctx), empty('That project isn’t shared with you any more.'));
  const copy = p.copy;
  const worktrees = uniqueBy(p.worktrees, (w) => w.id);
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Sharing'),
    col([title(p.name), dim(`${p.ownerName}’s · ${p.role === 'contribute' ? 'you can work here' : 'you can follow along'}`), p.members.length > 0 ? dim(`Also with ${p.members.slice(0, 8).map((m) => m.name).join(', ')}`) : undefined]),
    copy?.state === 'copying' && dim('Copying it to this computer...'),
    copy?.state === 'ready' && copy.path ? dim(`Your copy: ${homePath(ctx.state, copy.path)}`) : undefined,
    copy?.state === 'failed' && col([text(copy.error ?? 'Couldn’t copy it here.', { color: 'error' }), ctx.draw.button('shared:copy', 'Copy to This Computer Again', () => ctx.call('sharing.copyProject', owner, id), { plain: true })]),
    worktrees.length === 0 && empty('No worktrees in it yet.'),
    listOf(ctx, `shared:${owner}:${id}:worktrees`, worktrees, (w) => ctx.draw.button(`shared:worktree:${w.id}`, w.name, () => ctx.go({ name: 'shared-worktree', params: { owner, id: w.id } }), { plain: true, ...(w.branch ? { spans: [span(`${w.name}  `), span(w.branch, { dim: true })] } : {}) })),
    confirmPress(ctx, 'shared:leave', 'Leave Project', `It goes from this list. ${p.ownerName} can share it with you again.`, async () => {
      await ctx.call('sharing.leaveProject', owner, id);
      ctx.nav.back(ctx.pane);
    }),
  );
}

const SHELL_WORDS: Readonly<Record<Extract<LogItem, { type: 'shell' }>['status'], string>> = { waiting: 'waiting for them to approve', running: 'running', done: 'done', failed: 'failed', declined: 'declined' };

function logRow(ctx: Ctx, item: LogItem): Node | undefined {
  switch (item.type) {
    case 'chat':
      return col([line(span(item.name, { weight: 'semibold', ...(item.byAgent ? { color: 'claude' } : {}) }), span(`  ${ago(item.ts)}`, { dim: true })), md(peerMd(item.text)), item.request && ctx.state.delivery[item.request] === 'waiting' ? dim('Waiting for their computer') : undefined]);
    case 'system':
      return item.said ? col([line(span(item.said.name, { weight: 'semibold', ...(item.said.byAgent ? { color: 'claude' } : {}) }), span(`  ${ago(item.said.ts)}`, { dim: true })), md(peerMd(item.said.text))]) : dim(item.text);
    case 'agent':
      return col([
        line(span(agentLabel(item.agent, item.ownerName, item.owner === ctx.state.selfId, { capital: item.owner === ctx.state.selfId }), { weight: 'semibold', color: 'claude' }), span(`  ${ago(item.ts)}`, { dim: true }), item.steps.length ? span(`  ${item.steps.length} step${item.steps.length === 1 ? '' : 's'}`, { dim: true }) : undefined),
        item.text ? md(peerMd(item.text)) : undefined,
        item.status === 'error' && text('This run failed.', { color: 'error' }),
      ]);
    case 'shell':
      return col([line(span(`${item.ownerName}: `, { dim: true }), `$ ${item.command}`, span(`  ${SHELL_WORDS[item.status]}`, { dim: true })), item.output ? code(item.output.slice(-8000)) : undefined, item.error ? text(item.error, { color: 'error' }) : undefined]);
    default:
      return undefined;
  }
}

/** A conversation from the log, a window of it: the latest first shown, Earlier for the rest. */
function logRows(ctx: Ctx, channel: string): Node {
  const items = ctx.state.log.filter((item) => item.channel === channel);
  const [limit, setLimit] = ctx.local(`log:${channel}:shown`, 30);
  const wanted = Math.min(limit, items.length);
  const from = items.length - wanted;
  const to = Math.min(items.length, from + MAX_ROWS);
  return col(
    [
      from > 0 && ctx.draw.button(`log:${channel}:earlier`, `Earlier (${from})`, () => setLimit(wanted + 30), { plain: true, dim: true }),
      items.length === 0 && empty('Nothing here yet.'),
      ...items.slice(from, to).map((item) => logRow(ctx, item)),
      to < items.length && ctx.draw.button(`log:${channel}:later`, `Later (${items.length - to})`, () => setLimit(Math.max(30, wanted - 30)), { plain: true, dim: true }),
    ],
    { gap: 1 },
  );
}

/** A worktree a teammate shared with you: its conversation, and what you may say in it. */
export function sharedWorktreePage(ctx: Ctx, owner: string, id: string): Node {
  const st = ctx.state;
  const ws = st.shared.find((w) => w.owner === owner && w.id === id);
  if (!ws) return page(top(ctx, 'sharing'), back(ctx), empty('That worktree isn’t shared with you any more.'));
  const channel = `ws:${id}`;
  const project = st.sharedProjects.find((p) => p.owner === owner && p.worktrees.some((w) => w.id === id));
  const ownerName = project?.ownerName ?? nameOf(st, owner);
  const blocked = waitingNote(st, id);
  const roster = (st.roster[id] ?? []).filter((r) => r.peerId !== owner);
  const [mine, setMine] = ctx.local(`shared:${id}:mine`, false);
  const copyReady = project?.copy?.state === 'ready';
  const agent = agentName(ws.agent);
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    col([title(ws.name), dim(`${ownerName}’s ${ws.project}${ws.branch ? ` · ${ws.branch}` : ''}`), dim(ws.role === 'contribute' ? `You can work here: talk to ${ownerName}’s ${agent}. It runs on their computer.` : 'Read-only: you follow along.'), roster.length > 0 ? dim(`In it: ${roster.slice(0, 8).map((r) => `${nameOf(st, r.peerId)} (${r.role === 'contribute' ? 'works here' : 'follows'})`).join(', ')}`) : undefined]),
    ws.earlier && ctx.draw.button('shared:earlier', 'Earlier from Their Computer', () => ctx.call('sharing.earlier', owner, id), { plain: true, dim: true }),
    logRows(ctx, channel),
    ws.role === 'contribute' && (blocked ? dim(blocked) : undefined),
    ws.role === 'contribute' &&
      !blocked &&
      ctx.draw.input(
        `shared:${id}:box`,
        async (value) => {
          const words = value?.trim();
          if (!words) return;
          if (mine) await ctx.call('sharing.runHere', owner, id, words);
          else await ctx.call('session.submit', words, { channel });
        },
        { placeholder: mine ? 'To your own agent, in your copy of this project' : `Message ${ownerName}’s ${agent}`, rows: 2, submitLabel: 'send' },
      ),
    row([
      copyReady ? choice(ctx, 'shared:runs-on', mine ? 'Runs on This Computer' : `Runs on ${ownerName}’s Computer`, true, () => setMine(!mine)) : undefined,
      ctx.draw.button('shared:scratch', 'Scratch', () => ctx.go({ name: 'shared-scratch', params: { owner, id } }), { plain: true, dim: true, hotkey: 'f' }),
      ctx.draw.button('shared:more', 'More', () => ctx.go({ name: 'shared-more', params: { owner, id } }), { plain: true, dim: true, hotkey: 'm' }),
    ]),
  );
}

/** What's advanced about a teammate's worktree: your own copy of it, and leaving. */
export function sharedMorePage(ctx: Ctx, owner: string, id: string): Node {
  const st = ctx.state;
  const ws = st.shared.find((w) => w.owner === owner && w.id === id);
  if (!ws) return page(top(ctx, 'sharing'), back(ctx), empty('That worktree isn’t shared with you any more.'));
  const fork = st.forks[id];
  const mineNow = fork?.wsId ? findWorkspace(st, fork.wsId) : undefined;
  const canFork = ws.via === 'mesh' && ws.role === 'contribute';
  const ownerName = nameOf(st, owner);
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(ws.name),
    fork?.state === 'ready' && mineNow && !mineNow.archived ? ctx.draw.button('shared:fork-open', 'Open My Fork', () => openWorkspace(ctx, mineNow.id), { primary: true, hotkey: 'a' }) : undefined,
    fork?.state === 'asking' && dim(`Waiting for ${ownerName}’s computer to pack it...`),
    fork?.state === 'copying' && dim(fork.total ? `Copying: ${formatBytes(fork.received ?? 0)} of ${formatBytes(fork.total)}` : 'Copying...'),
    fork?.state === 'failed' && text(`Last time: ${fork.error ?? 'it didn’t work'}. Try again.`, { color: 'error' }),
    canFork &&
      fork?.state !== 'asking' &&
      fork?.state !== 'copying' &&
      fork?.state !== 'ready' &&
      col([
        dim(`Fork to this computer: a worktree of your own that starts where ${ownerName}’s is now, with your agent. Its commits, uncommitted changes, Scratch and conversation come with it. What git ignores stays behind, and never a .env file or a key.`),
        ctx.draw.input('shared:fork-name', (value) => (value?.trim() ? ctx.call('sharing.fork', owner, id, value.trim().slice(0, 120)) : undefined), { label: 'Name', value: ws.name, submitLabel: 'fork' }),
      ]),
    confirmPress(ctx, 'shared:leave-worktree', 'Leave', `It goes from your list. ${ownerName} can invite you again.`, async () => {
      await ctx.call('sharing.leave', owner, id);
      ctx.go({ name: 'sharing' });
    }),
  );
}

interface Scratch {
  readonly files: ReadonlyArray<{ readonly path: string; readonly size: number; readonly mtime: number }>;
}

/** What a teammate's agent saved while it worked, read one file at a time. */
export function sharedScratchPage(ctx: Ctx, owner: string, id: string): Node {
  const loaded = ctx.load(`team:scratch:${owner}:${id}`, async () => (await ctx.call('sharing.scratch', owner, id)) as Scratch, { ttlMs: 5000 });
  const files = uniqueBy(loaded.value?.files ?? [], (f) => f.path);
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title('Scratch'),
    loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
    files.length === 0 && !loaded.error && dim(loaded.loading ? 'Loading...' : 'Nothing saved yet.'),
    listOf(ctx, `scratch:${id}`, files, (f) =>
      ctx.draw.button(`scratch:${f.path}`, f.path, () => ctx.go({ name: 'shared-file', params: { owner, share: shareNameOf(id), path: f.path } }), { plain: true, spans: [span(`${f.path}  `), span(`${formatBytes(f.size)} · ${ago(f.mtime)}`, { dim: true })] }),
    ),
  );
}

/** A file on a teammate's computer, as words, through their share: secrets never go. */
export function sharedFilePage(ctx: Ctx, at: Location): Node {
  const loaded = ctx.load(`team:shared-file:${at.owner}:${at.share}:${at.path}`, async () => (await ctx.call('files.read', at)) as { readonly content: string; readonly truncated: boolean });
  const content = loaded.value?.content ?? '';
  const binary = content.includes('\u0000');
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(at.path),
    loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
    !loaded.value && !loaded.error && dim('Loading...'),
    binary ? dim('It isn’t text. Download it to open it.') : content ? code(content.slice(0, 50_000)) : undefined,
    loaded.value?.truncated && dim('Cut to fit.'),
    ctx.draw.button('shared-file:download', 'Download', () => ctx.call('files.download', at), { plain: true, dim: true, hotkey: 'f' }),
  );
}

const rowKey = (r: BrowserRow): string => (r.target === 'up' ? 'up' : `${r.target.owner}:${r.target.share}:${r.target.path}`);

/** A folder shared with you, one level at a time. */
export function folderPage(ctx: Ctx): Node {
  const b = ctx.state.browser;
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(b.at ? `${nameOf(ctx.state, b.at.owner)}’s ${b.at.share}${b.at.path ? `/${b.at.path}` : ''}` : 'Files'),
    b.error ? text(b.error, { color: 'error' }) : undefined,
    b.rows.length === 0 && !b.error && dim(b.loading ? 'Loading...' : 'Nothing here.'),
    listOf(ctx, `folder:${b.at?.owner ?? ''}:${b.at?.share ?? ''}:${b.at?.path ?? ''}`, uniqueBy(b.rows, rowKey), (r) =>
      ctx.draw.button(
        `folder:row:${rowKey(r)}`,
        r.label,
        () => {
          if (r.target === 'up') return ctx.call('files.up');
          if (r.dir) return ctx.call('files.browseTo', r.target);
          return ctx.go({ name: 'shared-file', params: { owner: r.target.owner, share: r.target.share, path: r.target.path } });
        },
        { plain: true, spans: [span(`${r.label}${r.dir ? '/' : ''}`), ...(r.size !== undefined && !r.dir ? [span(`  ${formatBytes(r.size)}`, { dim: true })] : [])] },
      ),
    ),
  );
}

/** Share a folder: which, who sees it, and whether your agent may edit there. */
export function shareFolderPage(ctx: Ctx): Node {
  const st = ctx.state;
  const selfIds = new Set([st.selfId, st.self?.peerId]);
  const inRoom = st.peers.filter((p) => !selfIds.has(p.peerId));
  const people = [...inRoom.map((p) => ({ id: p.peerId, name: p.name })), ...st.network.friends.filter((f) => !inRoom.some((p) => p.peerId === f.peerId)).map((f) => ({ id: f.peerId, name: f.name }))];
  const [who, setWho] = ctx.local<'all' | 'some'>('share-folder:who', 'some');
  const [only, setOnly] = ctx.local<readonly string[]>('share-folder:only', []);
  const [writable, setWritable] = ctx.local('share-folder:writable', false);
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Sharing'),
    title('Share a Folder'),
    dim('They can browse, open and download its files. Secrets like .env files and keys are never shared.'),
    row([choice(ctx, 'share-folder:some', 'Only…', who === 'some', () => setWho('some')), choice(ctx, 'share-folder:all', 'Everyone in the room', who === 'all', () => setWho('all'))]),
    who === 'some' &&
      (people.length === 0
        ? dim('No teammates or room yet. Add a teammate in People first.')
        : listOf(ctx, 'share-folder:people', people, (p) => ctx.draw.button(`share-folder:person:${p.id}`, `${only.includes(p.id) ? '[x]' : '[ ]'} ${p.name}`, () => setOnly(only.includes(p.id) ? only.filter((x) => x !== p.id) : [...only, p.id]), { plain: true, ...(only.includes(p.id) ? {} : { dim: true }) }))),
    row([choice(ctx, 'share-folder:read', 'Read-only', !writable, () => setWritable(false)), choice(ctx, 'share-folder:write', 'Your agent may edit here', writable, () => setWritable(true))]),
    ctx.draw.input(
      'share-folder:path',
      async (value) => {
        const dir = value?.trim() ? wholePath(st, value) : '';
        if (!dir) return;
        if (who === 'some' && !only.length) throw new Error('Pick who sees it first.');
        await ctx.call('session.shareFolder', dir, writable, who === 'some' ? [...only] : undefined);
      },
      { label: 'Folder', placeholder: '~/path/to/folder', submitLabel: 'share' },
    ),
    st.myShares.length > 0 &&
      col([
        dim(`Shared now (${st.myShares.length})`),
        listOf(ctx, 'share-folder:now', st.myShares, (x) =>
          row([
            line(x.name, span(`  ${homePath(st, x.root)} · ${shareWords(ctx, x)}${x.writable ? ' · your agent may edit' : ''}`, { dim: true })),
            ctx.draw.button(`share-folder:stop:${x.name}`, 'Stop Sharing', () => ctx.call('session.unshareFolder', x.name), { plain: true, dim: true }),
          ]),
        ),
      ]),
  );
}

// ---- your room

/** Your room: who's here, who's at the door, and your links. */
export function roomPage(ctx: Ctx): Node {
  const st = ctx.state;
  const host = st.isHost || st.self?.host === true;
  const selfIds = new Set([st.selfId, st.self?.peerId]);
  const others = uniqueBy(st.peers.filter((p) => !selfIds.has(p.peerId)), (p) => p.peerId);
  const guests = Object.values(st.guests);
  const nameAtDoor = (peerId: string): string => st.peers.find((p) => p.peerId === peerId)?.name ?? 'Someone';
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Sharing'),
    col([title(st.room), dim(roomWords(ctx)), st.connection ? text(st.connection.reason, { color: 'warning' }) : undefined]),
    st.connection && ctx.draw.button('room:retry', 'Retry Now', () => ctx.call('session.retryConnection'), { plain: true, hotkey: 'x' }),
    host ? ctx.draw.button('room:invite', 'Invite People', () => ctx.go({ name: 'room-invite' }), { primary: true, hotkey: 'a' }) : st.invite ? ctx.draw.button('room:copy-invite', 'Copy Room Invite', () => ctx.call('session.copyInvite'), { primary: true, hotkey: 'a' }) : undefined,
    st.knocks.length > 0 &&
      col([
        dim('Waiting to come in'),
        listOf(ctx, 'room:knocks', st.knocks, (k) => {
          const link = st.links.find((l) => l.id === k.linkId);
          return row([
            line(nameAtDoor(k.peerId), span(`  ${link ? `wants to join ${link.label} · ${CAN_INFO[link.can].short}` : 'is at the door'}`, { dim: true })),
            ctx.draw.button(`room:let-in:${k.peerId}`, 'Let In', () => ctx.call('invites.letIn', k.peerId), { plain: true }),
            ctx.draw.button(`room:turn-away:${k.peerId}`, 'Decline', () => ctx.call('invites.decline', k.peerId), { plain: true, dim: true }),
          ]);
        }),
      ]),
    st.trustPrompts.length > 0 &&
      col([
        dim('New here: how much do you trust them?'),
        listOf(ctx, 'room:prompts', st.trustPrompts, (peerId) =>
          col([
            text(nameOf(st, peerId)),
            trustChoices(ctx, `room:trust:${peerId}`, peerId, undefined),
            ctx.draw.button(`room:trust-later:${peerId}`, 'Later', () => ctx.call('people.dismissPrompt', peerId), { plain: true, dim: true }),
          ]),
        ),
      ]),
    others.length > 0 ? col([dim(`Here (${others.length})`), listOf(ctx, 'room:people', others, (p) => ctx.draw.button(`room:person:${p.peerId}`, p.name, () => ctx.go(st.guests[p.peerId] ? { name: 'guest', params: { id: p.peerId } } : { name: 'room-person', params: { id: p.peerId } }), { plain: true, spans: [span(`${p.name}  `), span([p.host ? 'host' : '', p.guest ? 'guest' : '', st.follow === p.peerId ? 'you follow them' : ''].filter(Boolean).join(' · '), { dim: true })] }))]) : empty('Nobody else is here yet.'),
    guests.length > 0 && col([dim(`Guests (${guests.length})`), listOf(ctx, 'room:guests', guests, (g) => ctx.draw.button(`room:guest:${g.peerId}`, g.name, () => ctx.go({ name: 'guest', params: { id: g.peerId } }), { plain: true, spans: [span(`${g.name}  `), span(CAN_INFO[g.can].short, { dim: true })] }))]),
    st.follow ? ctx.draw.button('room:unfollow', `Stop Following ${nameOf(st, st.follow)}`, () => ctx.call('session.follow'), { plain: true, dim: true }) : undefined,
    row([ctx.draw.button('room:chat', 'Room Chat', () => ctx.go({ name: 'room-chat' }), { plain: true, hotkey: 'i' }), ctx.draw.button('room:more', 'More', () => ctx.go({ name: 'room-more' }), { plain: true, dim: true, hotkey: 'm' })]),
  );
}

/** What's advanced about your room. */
export function roomMorePage(ctx: Ctx): Node {
  const st = ctx.state;
  const host = st.isHost || st.self?.host === true;
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Room'),
    title(st.room),
    host &&
      col([
        dim(st.roomOpen ? 'Anyone with a link can come in, or knock.' : 'Closed: even with a link, nobody new gets in.'),
        row([choice(ctx, 'room:open', 'New People Can Join', st.roomOpen, () => ctx.call('session.setRoomOpen', true)), choice(ctx, 'room:closed', 'Closed', !st.roomOpen, () => ctx.call('session.setRoomOpen', false))]),
      ]),
    st.invite ? ctx.draw.button('room:copy-link', 'Copy Room Link', () => ctx.call('session.copyInvite'), { plain: true }) : undefined,
    host && confirmPress(ctx, 'room:new-link', 'New Invite Link', 'The current link stops working. People already in the room stay.', () => ctx.call('session.newInviteLink')),
    confirmPress(ctx, 'room:clear', 'Clear the Chat Here', 'It’s cleared on this computer.', () => ctx.call('session.clearChat', 'room')),
    host && confirmPress(ctx, 'room:clear-all', 'Clear the Chat for Everyone', 'It’s cleared for everyone here, and for people who join later.', () => ctx.call('session.clearChat', 'room', { everyone: true })),
  );
}

/** The room's chat. */
export function roomChatPage(ctx: Ctx): Node {
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Room'),
    title('Room Chat'),
    logRows(ctx, 'room'),
    ctx.draw.input(
      'room-chat:box',
      async (value) => {
        const words = value?.trim();
        if (words) await ctx.call('session.submit', words, { channel: 'room' });
      },
      { placeholder: 'Message the room', rows: 2, submitLabel: 'send' },
    ),
  );
}

/** What remote access is doing, when there's no link to copy yet. */
const hostingWords = (phase: string | undefined, detail: string | undefined): string =>
  phase === 'failed' ? (detail ?? 'Couldn’t open remote access. Try again.') : phase === 'local' ? 'Only people on this network can join right now.' : phase ? 'Opening a secure link: it’s copied as soon as it’s ready.' : 'A secure link opens the first time you copy one.';

/** The links you made, and a new one: where to, what they can do, how the link behaves. */
export function roomInvitePage(ctx: Ctx): Node {
  const st = ctx.state;
  const [c, setC] = ctx.local<InviteChoice>('room-invite:choice', inviteChoice());
  const set = (patch: Partial<InviteChoice>): void => setC({ ...c, ...patch });
  const projects = st.projects.filter((p) => p.root);
  const links = [...st.links].sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Room'),
    title('Invite People'),
    dim('Send a link. They see only what you invite them to. Secrets like .env files and keys never leave this computer.'),
    !st.invite && dim(hostingWords(st.hosting?.phase, st.hosting?.detail)),
    col([
      dim('Invite to'),
      choice(ctx, 'invite:scope:room', 'Everything (the whole room)', c.scope === 'room', () => set({ scope: 'room' })),
      listOf(ctx, 'invite:scopes', projects, (p) => choice(ctx, `invite:scope:${p.id}`, p.name, c.scope === p.id, () => set({ scope: p.id }))),
    ]),
    col([dim('They can'), row(CAN_ORDER.map((can) => choice(ctx, `invite:can:${can}`, CAN_INFO[can].label, c.can === can, () => set({ can })))), dim(CAN_INFO[c.can].detail)]),
    row([
      choice(ctx, 'invite:knock', `${c.knock ? '[x]' : '[ ]'} Knock first`, c.knock, () => set({ knock: !c.knock })),
      choice(ctx, 'invite:single', `${c.singleUse ? '[x]' : '[ ]'} One person only`, c.singleUse, () => set({ singleUse: !c.singleUse })),
      choice(ctx, 'invite:expires', `${c.expires ? '[x]' : '[ ]'} Expires in 24 hours`, c.expires, () => set({ expires: !c.expires })),
    ]),
    ctx.draw.button('invite:copy', 'Copy Invite Link', () => ctx.call('invites.create', { scope: c.scope, can: c.can, knock: c.knock, singleUse: c.singleUse, expiresInMs: c.expires ? DAY_MS : 0 }), { primary: true, hotkey: 'a' }),
    links.length > 0 &&
      col([
        dim(`Active links (${links.length})`),
        listOf(ctx, 'invite:links', links, (l) =>
          row([
            line(l.label === 'everything' ? 'Everything' : l.label, span(`  ${CAN_INFO[l.can].short} · ${expiresIn(l.expiresAt, now)} · ${l.used ? `used by ${l.used}` : 'not used yet'} · ${l.singleUse ? 'one person' : 'anyone'} · ${l.knock ? 'knocks first' : 'no knock'}`, { dim: true })),
            ctx.draw.button(`invite:copy:${l.id}`, 'Copy', () => ctx.call('invites.copyLink', l.id), { plain: true }),
            ctx.draw.button(`invite:revoke:${l.id}`, 'Revoke', () => ctx.call('invites.revoke', l.id), { plain: true, dim: true }),
          ]),
        ),
      ]),
  );
}

/** Someone who came in with a link: what they can do, where, and giving them more or less. */
export function guestPage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const g = st.guests[id];
  if (!g) return page(top(ctx, 'sharing'), back(ctx, 'Room'), empty('They aren’t a guest any more.'));
  const projects = st.projects.filter((p) => p.root);
  const more = projects.filter((p) => !g.projects.includes(p.id));
  const can = (next: GuestCan): Promise<unknown> => ctx.call('invites.change', id, { can: next });
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Room'),
    col([title(g.name), dim(g.room ? 'Invited to everything: the room chat and what you share.' : `Came in with a link: sees only ${g.projects.map((p) => projects.find((x) => x.id === p)?.name ?? 'a project').join(', ') || 'what you invited them to'}.`)]),
    col([dim(`${g.name} can`), row(CAN_ORDER.map((c) => choice(ctx, `guest:can:${c}`, CAN_INFO[c].label, g.can === c, () => can(c)))), dim(CAN_INFO[g.can].detail)]),
    !g.room && more.length > 0 && col([dim('Add to a project'), listOf(ctx, `guest:${id}:projects`, more, (p) => ctx.draw.button(`guest:add:${p.id}`, p.name, () => ctx.call('invites.change', id, { addProject: p.id }), { plain: true }))]),
    !g.room && ctx.draw.button('guest:everything', 'Invite to Everything', () => ctx.call('invites.change', id, { room: true }), { plain: true, dim: true }),
    confirmPress(ctx, 'guest:remove', `Remove ${g.name}`, 'They’re disconnected and lose access to everything you invited them to.', async () => {
      await ctx.call('invites.remove', id);
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** Someone in your room: what you do together there. Their trust is set on their card, once they're a teammate. */
export function roomPersonPage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const peer = st.peers.find((p) => p.peerId === id);
  if (!peer) return page(top(ctx, 'sharing'), back(ctx, 'Room'), empty('They aren’t in your room any more.'));
  const friend = st.network.friends.some((f) => f.peerId === id);
  const asked = (st.network.offers ?? []).some((o) => o.dir === 'out' && o.peerId === id);
  const grant = st.granted[id];
  const following = st.follow === id;
  const host = st.isHost || st.self?.host === true;
  const level = levelOf(st, id);
  const [running, setRunning] = ctx.local(`room-person:${id}:running`, false);
  return page(
    top(ctx, 'sharing'),
    back(ctx, 'Room'),
    col([title(peer.name), dim([peer.host ? 'Host' : '', peer.agent ? `${agentName(defaultAgentOf(peer))} on` : 'No agent', peer.shares.length ? `Shares ${peer.shares.map((x) => x.name).join(', ')}` : ''].filter(Boolean).join(' · ')), dim(`Trust: ${TRUST_INFO[level].label}.`)]),
    choice(ctx, 'person:follow', following ? 'Stop Following' : 'Follow', following, () => (following ? ctx.call('session.follow') : ctx.call('session.follow', peer.name))),
    friend
      ? ctx.draw.button('person:card', `${peer.name}’s Card`, () => ctx.go({ name: 'friend', params: { id } }), { plain: true })
      : asked
        ? dim('Teammate request sent. You set their trust on their card once they accept.')
        : st.network.enabled
          ? ctx.draw.button('person:befriend', `Add ${peer.name} as a Teammate`, () => ctx.call('network.friends.addFromRoom', id), { plain: true })
          : undefined,
    ctx.draw.button('person:invite', 'Invite to a Worktree', () => ctx.go({ name: 'invite-person', params: { id } }), { plain: true }),
    canRunOn(grant?.level) && !running ? ctx.draw.button('person:run', 'Run a Command', () => setRunning(true), { plain: true }) : undefined,
    running &&
      ctx.draw.input(
        'person:command',
        async (value) => {
          setRunning(false);
          const command = value?.trim();
          if (!command) return;
          await ctx.call('session.runOnPeerByHand', peer.name, command, 'room');
          ctx.go({ name: 'room-chat' });
        },
        { label: 'Command', placeholder: 'npm test', submitLabel: 'run', autoFocus: true },
      ),
    running && dim(grant?.level === 'full' ? 'It runs right away. The output shows in the chat.' : `${peer.name} approves it first. The output shows in the chat.`),
    (peer.projects?.length ?? 0) > 0 && ctx.draw.button('person:remote', `Start a Worktree on ${peer.name}’s Computer`, () => ctx.go({ name: 'remote-worktree', params: { id } }), { plain: true }),
    host && confirmPress(ctx, 'person:remove', 'Remove from Room', `${peer.name} is disconnected and the room’s invite link changes, so the old one stops working.`, async () => {
      await ctx.call('session.removePerson', id);
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** Put someone in your room into one of your worktrees. */
export function invitePersonPage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const peer = st.peers.find((p) => p.peerId === id);
  if (!peer) return page(top(ctx, 'sharing'), back(ctx), empty('They aren’t in your room any more.'));
  const [role, setRole] = ctx.local<WsRole>('invite-person:role', 'contribute');
  const list = st.projects.flatMap((p) => p.workspaces.filter((w) => !w.archived && !w.external).map((w) => ({ w, label: p.root ? `${p.name} › ${w.name}` : w.name })));
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(`Invite ${peer.name} to a Worktree`),
    dim(`${peer.name} sees its conversation and files${role === 'contribute' ? ', and can ask your agent there' : ''}.`),
    row([choice(ctx, 'invite-person:work', 'Work Here', role === 'contribute', () => setRole('contribute')), choice(ctx, 'invite-person:follow', 'Follow', role === 'view', () => setRole('view'))]),
    list.length === 0 && empty('No worktrees yet.'),
    listOf(ctx, `invite-person:${id}`, list, ({ w, label }) => {
      const now = st.members[w.id]?.[id];
      return now === role ? line(label, span(`  ${now === 'contribute' ? 'works here' : 'follows'}`, { dim: true })) : ctx.draw.button(`invite-person:ws:${w.id}`, label, () => ctx.call('sharing.invite', w.id, id, role), { plain: true });
    }),
  );
}

/** Ask a teammate to start a worktree on their computer. */
export function remoteWorktreePage(ctx: Ctx, id: string): Node {
  const peer = ctx.state.peers.find((p) => p.peerId === id);
  if (!peer) return page(top(ctx, 'sharing'), back(ctx), empty('They aren’t in your room any more.'));
  const projects = peer.projects ?? [];
  const [picked, setPicked] = ctx.local(`remote:${id}:project`, projects[0] ?? '');
  const [plan, setPlan] = ctx.local(`remote:${id}:plan`, false);
  const project = projects.includes(picked) ? picked : (projects[0] ?? '');
  const agent = agentName(defaultAgentOf(peer));
  return page(
    top(ctx, 'sharing'),
    back(ctx),
    title(`New Worktree on ${peer.name}’s Computer`),
    dim(`${peer.name} approves it, then ${peer.name}’s ${agent} does the work there.`),
    projects.length > 1 && ctx.draw.select('remote:project', projects.map((p) => ({ value: p, label: p })), (value) => setPicked(value ?? ''), { label: 'Project', value: project }),
    projects.length === 1 && dim(`In ${project}`),
    choice(ctx, 'remote:plan', `${plan ? '[x]' : '[ ]'} Plan first`, plan, () => setPlan(!plan)),
    ctx.draw.input(
      'remote:task',
      async (value) => {
        const task = value?.trim();
        if (!task || !project) return;
        await ctx.call('remote.requestWorktree', id, project, task, plan);
        ctx.nav.back(ctx.pane);
      },
      { label: 'Task', placeholder: 'Add a health check endpoint and a test for it', rows: 3, submitLabel: `ask ${peer.name}`, autoFocus: true },
    ),
  );
}
