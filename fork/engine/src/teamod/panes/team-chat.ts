import { taskIn } from '../../core/chat-people.js';
import { liveDialogueIn } from '../../core/dialogues/model.js';
import { dialogueHeader } from '../../core/dialogues/view.js';
import { isFinal } from '../../core/gateway/model.js';
import { KEEP_MESSAGES } from '../../core/network-store.js';
import type { ChatFile, FriendView, GroupView, InvitationView, MemberView, MessageView } from '../../net/mesh/views.js';
import { agentName } from '../../shared/agent-label.js';
import { formatBytes } from '../../shared/format.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text } from '../tree.js';
import { actions, ago, back, card, empty, homePath, meta, page, pill, rule, section } from './common.js';
import { MAX_ROWS, byName, choice, confirmPress, listOf, nameOf, needsYou, networkOff, openConversation, peerMd, picture, presencePill, shownState, tick, top, uniqueBy, wholePath } from './team-common.js';
import { taskRow } from './team-requests.js';

/**
 * Conversations with teammates: direct messages and channels, their members, admins and invitations,
 * and the files in them. What a teammate wrote is only ever drawn, and the messages come from the
 * state or the history, never the phone's views (those strip code).
 */

/** How much of a conversation one draw holds at first: the pane scrolls, and Earlier shows more. */
const PAGE_MESSAGES = 30;
const HISTORY_PAGE = 100;

type Target = { readonly kind: 'dm'; readonly peerId: string } | { readonly kind: 'group'; readonly groupId: string };

const targetOf = (id: string): Target | undefined => (/^dm:[\w-]{32}$/.test(id) ? { kind: 'dm', peerId: id.slice(3) } : /^group:[0-9a-f]{32}$/.test(id) ? { kind: 'group', groupId: id.slice(6) } : undefined);

const groupName = (ctx: Ctx, g: Pick<GroupView, 'id' | 'name'>): string => (ctx.state.network.main === g.id ? 'All Teammates' : g.name);

const snippet = (m: MessageView | undefined): string => (!m ? '' : m.text.trim() ? m.text.replace(/\s+/g, ' ').slice(0, 60) : m.files?.length ? `${m.files.length} file${m.files.length === 1 ? '' : 's'}` : '');

/** Unread messages as a count beside the name, in Claude's color. */
const unreadSpans = (n: number) => (n ? [pill(String(n), 'accent', '●'), span('  ')] : []);

function dmRow(ctx: Ctx, f: FriendView): Node {
  const last = snippet(f.last);
  return ctx.draw.button(`chat:dm:${f.peerId}`, f.name, () => openConversation(ctx, `dm:${f.peerId}`), {
    plain: true,
    spans: [span(f.name, f.unread ? { weight: 'bold' } : {}), span('  '), ...unreadSpans(f.unread), ...(last ? [span(last, { dim: true })] : [])],
  });
}

function channelRow(ctx: Ctx, g: GroupView): Node {
  const unread = g.active ? g.unread : 0;
  const asking = g.admin ? g.requests.length : 0;
  return ctx.draw.button(`chat:group:${g.id}`, g.name, () => openConversation(ctx, `group:${g.id}`), {
    plain: true,
    ...(g.active ? {} : { dim: true }),
    spans: [
      span(`# ${groupName(ctx, g)}`, unread ? { weight: 'bold' } : {}),
      span('  '),
      ...unreadSpans(unread),
      ...(asking ? [pill(`${asking} asking to join`, 'warn'), span('  ')] : []),
      ...(g.active ? (g.last ? [span(snippet(g.last), { dim: true })] : []) : [span('You’re no longer in this channel', { dim: true })]),
    ],
  });
}

/** Every conversation: your main channel, direct messages, channels, and how to start or join one. */
export function chatsPage(ctx: Ctx): Node {
  const net = ctx.state.network;
  if (!net.enabled) return page(top(ctx, 'chats'), networkOff(ctx, 'Chats'));
  const [joining, setJoining] = ctx.local('chats:joining', false);
  const friends = [...net.friends].sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || byName(a, b));
  const main = net.main ? net.groups.find((g) => g.id === net.main) : undefined;
  const channels = net.groups.filter((g) => g.id !== net.main).sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b));
  return page(
    top(ctx, 'chats'),
    ctx.draw.button('chats:new', 'New Channel', () => ctx.go({ name: 'new-channel' }), { primary: true, hotkey: 'a' }),
    main
      ? channelRow(ctx, main)
      : ctx.draw.button(
          'chats:main',
          'All Teammates',
          async () => {
            const made = (await ctx.call('network.channels.main')) as string | undefined;
            if (made) openConversation(ctx, `group:${made}`);
          },
          { plain: true, spans: [span('# All Teammates', { weight: 'bold' }), span('  '), span('Your main channel: everyone you’ve added, in one conversation', { dim: true })] },
        ),
    friends.length > 0 ? section('Direct messages', [listOf(ctx, 'chats:dms', friends, (f) => dmRow(ctx, f))], friends.length) : empty('No teammates yet. Add one in People.'),
    channels.length > 0 && section('Channels', [listOf(ctx, 'chats:channels', channels, (g) => channelRow(ctx, g))], channels.length),
    net.pendingJoins.length > 0 && listOf(ctx, 'chats:pending', net.pendingJoins, (p) => dim(`Asked to join ${p.name}: waiting for an admin to let you in.`)),
    joining
      ? ctx.draw.input(
          'chats:join-link',
          async (value) => {
            setJoining(false);
            const words = value?.trim();
            if (words) await ctx.call('network.groups.join', words);
          },
          { label: 'Join a channel', placeholder: 'teamod://join#…', submitLabel: 'join', autoFocus: true },
        )
      : ctx.draw.button('chats:join', 'Join a Channel', () => setJoining(true), { plain: true, dim: true, hotkey: 'j' }),
  );
}

// ---- a conversation

/** The messages of a conversation, oldest first, once each: earlier pages you asked for and the latest the state keeps. */
function messagesIn(ctx: Ctx, id: string): readonly MessageView[] {
  const latest = ctx.state.network.messages[id] ?? [];
  const [older] = ctx.local<readonly MessageView[]>(`chat:${id}:older`, []);
  const seen = new Set(latest.map((m) => m.id));
  const earlier = older.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return [...earlier, ...latest];
}

const authorWords = (m: MessageView): string => (m.claude ? (m.mine ? `Your ${agentName(m.claude.agent)}` : `${m.name}’s ${agentName(m.claude.agent)}`) : m.mine ? 'You' : m.name);

function askedWords(ctx: Ctx, m: MessageView): string | undefined {
  const to = m.ask?.to;
  if (!to) return undefined;
  if (to === 'all') return 'Asked everyone’s agent';
  const me = ctx.state.network.self?.peerId;
  const who = to.slice(0, 4).map((p) => (p === me ? 'your' : `${nameOf(ctx.state, p)}’s`));
  return `Asked ${who.join(' and ')} agent`;
}


function fileWords(ctx: Ctx, f: ChatFile, mine: boolean): string {
  const state = ctx.state.network.files?.[f.sha];
  if (state?.state === 'coming') return `Coming: ${formatBytes(state.received ?? 0)} of ${formatBytes(f.size)}`;
  if (state?.state === 'failed') return state.error ?? 'Didn’t come';
  return state?.state === 'here' ? formatBytes(f.size) : `${formatBytes(f.size)} · ${mine ? 'sent' : 'not downloaded'}`;
}

function messageNode(ctx: Ctx, id: string, m: MessageView): Node {
  const task = m.task ? ctx.state.gateway.tasks.find((t) => t.id === m.task?.id) : undefined;
  if (task) return taskRow(ctx, `msg-task:${m.id}`, task, false, true);
  const asked = askedWords(ctx, m);
  const request = m.claude?.request && !m.mine ? m.claude.request : undefined;
  const offered = request && ctx.state.gateway.tasks.some((t) => t.answer === m.id);
  return col([
    row([
      line(span(authorWords(m), { weight: 'bold', ...(m.claude ? { color: 'claude' } : {}) }), span(`  ${ago(m.ts)}`, { dim: true }), m.edited ? span('  edited', { dim: true }) : undefined),
      ctx.draw.button(`msg:${m.id}`, '•••', () => ctx.go({ name: 'message', params: { id, msg: m.id } }), { plain: true, dim: true }),
    ], { justify: 'space-between', wrap: false }),
    m.status === 'locked' ? dim('Can’t be read on this computer.') : m.text.trim() ? md(peerMd(m.text)) : undefined,
    ...uniqueBy(m.files ?? [], (f) => f.sha).slice(0, 20).map((f) =>
      ctx.draw.button(`file:${m.id}:${f.sha}`, f.name, () => ctx.go({ name: 'file', params: { id, msg: m.id, sha: f.sha } }), { plain: true, spans: [span(`${f.name}  `), span(fileWords(ctx, f, m.mine), { dim: true })] }),
    ),
    asked ? dim(asked) : undefined,
    m.mine && m.status === 'waiting' && dim('Waiting to be delivered'),
    m.mine && m.status === 'expired' && text('Not delivered. Send it again from More.', { color: 'warning' }),
    request &&
      !offered &&
      card(
        [
          dim('That takes a request to their computer:'),
          md(peerMd(request.ask)),
          actions(ctx.draw.button(`msg:${m.id}:request`, `Ask on ${m.name}’s Computer`, () => ctx.call('gateway.ask', m.from, request.ask, { ...(request.needs?.length ? { needs: [...request.needs] } : {}), answer: { conversation: id, id: m.id } }), {})),
        ],
        { tone: 'warn' },
      ),
  ]);
}

/** Whose agent the next message asks. */
type Asking = { readonly kind: 'none' } | { readonly kind: 'me' } | { readonly kind: 'all' } | { readonly kind: 'person'; readonly peerId: string; readonly name: string };

const askingWords = (a: Asking): string => (a.kind === 'none' ? 'Ask an Agent' : a.kind === 'me' ? 'Asking your agent' : a.kind === 'all' ? 'Asking everyone’s agent' : `Asking ${a.name}’s agent`);

function composer(ctx: Ctx, id: string, target: Target, placeholder: string): Node {
  const [files, setFiles] = ctx.local<readonly ChatFile[]>(`chat:${id}:files`, []);
  const [asking, setAsking] = ctx.local<Asking>(`chat:${id}:asking`, { kind: 'none' });
  const [attaching, setAttaching] = ctx.local(`chat:${id}:attaching`, false);
  const me = ctx.state.network.self?.peerId;
  const send = async (value?: string): Promise<void> => {
    const words = value?.trim() ?? '';
    if (!words && !files.length) return;
    const ask = asking.kind === 'all' ? ('all' as const) : asking.kind === 'me' && me ? [me] : asking.kind === 'person' ? [asking.peerId] : undefined;
    if (files.length || ask) {
      await ctx.call('network.post', id, { text: words, ...(files.length ? { files: [...files] } : {}), ...(ask ? { ask } : {}) });
      setFiles([]);
      setAsking({ kind: 'none' });
    } else if (target.kind === 'dm') {
      await ctx.call('network.dm.send', target.peerId, words);
    } else {
      await ctx.call('network.groups.send', target.groupId, words);
    }
  };
  return col([
    ctx.draw.input(`chat:${id}:box`, send, { placeholder, rows: 2, submitLabel: 'send' }),
    files.length > 0 && col(files.map((f) => row([dim(`Attached: ${f.name} · ${formatBytes(f.size)}`), ctx.draw.button(`chat:${id}:unattach:${f.sha}`, 'Remove', () => setFiles(files.filter((x) => x.sha !== f.sha)), { plain: true, dim: true })]))),
    attaching &&
      ctx.draw.input(
        `chat:${id}:path`,
        async (value) => {
          setAttaching(false);
          const file = value?.trim() ? wholePath(ctx.state, value) : '';
          if (file) setFiles(uniqueBy([...files, ...(((await ctx.call('network.files.add', [file])) as readonly ChatFile[] | undefined) ?? [])], (f) => f.sha));
        },
        { label: 'File', placeholder: '/path/to/file', submitLabel: 'attach', autoFocus: true },
      ),
    row([
      ctx.draw.button(`chat:${id}:ask`, askingWords(asking), () => ctx.go({ name: 'chat-ask', params: { id } }), { plain: true, hotkey: 'v', ...(asking.kind === 'none' ? { dim: true } : {}) }),
      ctx.draw.button(`chat:${id}:attach`, 'Attach', () => setAttaching(true), { plain: true, dim: true, hotkey: 'f' }),
      ctx.draw.button(`chat:${id}:more`, 'More', () => ctx.go({ name: 'chat-more', params: { id } }), { plain: true, dim: true, hotkey: 'm' }),
    ], { gap: 3 }),
  ]);
}

/** A conversation with a teammate (`dm:<peerId>`) or in a channel (`group:<id>`). */
export function conversationPage(ctx: Ctx, id: string): Node {
  const net = ctx.state.network;
  if (!net.enabled) return page(top(ctx, 'chats'), back(ctx), networkOff(ctx, 'Chats'));
  const target = targetOf(id);
  const friend = target?.kind === 'dm' ? net.friends.find((f) => f.peerId === target.peerId) : undefined;
  const group = target?.kind === 'group' ? net.groups.find((g) => g.id === target.groupId) : undefined;
  if (!target || (!friend && !group)) return page(top(ctx, 'chats'), back(ctx, 'Chats'), empty(target?.kind === 'group' ? 'This channel isn’t here any more.' : 'Not a teammate any more. Your messages stay on this computer, but you can’t write here.'));
  const latest = net.messages[id] ?? [];
  const [older, setOlder] = ctx.local<readonly MessageView[]>(`chat:${id}:older`, []);
  const [moreOlder, setMoreOlder] = ctx.local(`chat:${id}:more-older`, true);
  const [limit, setLimit] = ctx.local(`chat:${id}:shown`, PAGE_MESSAGES);
  // A message deleted or the chat cleared: earlier pages kept here may hold it, so they go.
  const [count, setCount] = ctx.local(`chat:${id}:count`, latest.length);
  if (latest.length !== count) {
    setCount(latest.length);
    if (latest.length < count && older.length) setOlder([]);
  }
  const messages = messagesIn(ctx, id);
  const wanted = Math.min(limit, messages.length);
  const from = messages.length - wanted;
  const to = Math.min(messages.length, from + MAX_ROWS);
  const canAskHistory = latest.length >= KEEP_MESSAGES && moreOlder;
  const name = group ? groupName(ctx, group) : (friend?.name ?? '');
  const writable = Boolean(friend || group?.active);
  // What's shown is read as it comes: once per message, not once per draw.
  const unread = friend ? friend.unread : group?.active ? group.unread : 0;
  const newest = latest.at(-1)?.id ?? '';
  if (unread > 0) ctx.load(`team:read:${id}:${newest}`, () => ctx.call('network.read', id));
  const waiting = ctx.state.gateway.tasks.filter((t) => taskIn(t, id) && needsYou(t));
  const asking = ctx.state.gateway.tasks.filter((t) => t.direction === 'sent' && t.conversation === id && t.chat !== id && !isFinal(t.state) && !needsYou(t));
  const live = (net.live?.[id] ?? []).filter((l) => Date.now() - l.since < 3 * 60_000);
  const dialogue = liveDialogueIn(ctx.state, id);
  const header = dialogue ? dialogueHeader(dialogue) : undefined;
  const me = net.self?.peerId;
  return page(
    top(ctx, 'chats'),
    back(ctx, 'Chats'),
    col([
      row(
        [
          line(span(group ? `# ${name}` : name, { weight: 'bold' }), span('  '), friend ? presencePill(friend) : group?.active ? span(`${group.members.length} member${group.members.length === 1 ? '' : 's'}`, { dim: true }) : undefined),
          ctx.draw.button('chat:info', 'Info', () => ctx.go(friend ? { name: 'friend', params: { id: friend.peerId } } : { name: 'channel', params: { id: group?.id ?? '' } }), { plain: true, dim: true, hotkey: 'i' }),
        ],
        { justify: 'space-between', wrap: false },
      ),
      group && !group.active ? dim(`You’re no longer in ${group.name}. Its messages stay here, read-only.`) : undefined,
      rule(ctx),
    ]),
    waiting.length > 0 && section('Waiting for you', [listOf(ctx, `chat:${id}:waiting`, waiting, (t) => taskRow(ctx, `chat-waiting:${t.id}`, t, false, true), 10)], waiting.length),
    dialogue && card([ctx.draw.button(`chat:${id}:dialogue`, 'Dialogue', () => ctx.go({ name: 'dialogue', params: { id: dialogue.id } }), { plain: true, spans: [span('Dialogue', { dim: true }), span('  '), span(dialogue.topic.slice(0, 80), { weight: 'bold' })] }), header?.status ? meta(header.status) : undefined]),
    from > 0 || canAskHistory
      ? ctx.draw.button(
          'earlier',
          from > 0 ? `Earlier (${from})` : 'Earlier',
          async () => {
            if (from > 0) return setLimit(wanted + PAGE_MESSAGES);
            const first = messages[0];
            if (!first) return undefined;
            const before = { before: first.ts, limit: HISTORY_PAGE };
            const earlier = ((target.kind === 'dm' ? await ctx.call('network.dm.history', target.peerId, before) : await ctx.call('network.groups.history', target.groupId, before)) as readonly MessageView[] | undefined) ?? [];
            setOlder([...earlier, ...older]);
            setMoreOlder(earlier.length >= HISTORY_PAGE);
            return setLimit(wanted + PAGE_MESSAGES);
          },
          { plain: true, dim: true },
        )
      : undefined,
    messages.length === 0 && empty(friend ? `This is the start of your conversation with ${friend.name}. End-to-end encrypted, straight to their computer.` : 'Nothing here yet. End-to-end encrypted, kept on each member’s computer.'),
    col(messages.slice(from, to).map((m) => messageNode(ctx, id, m)), { gap: 1 }),
    to < messages.length && ctx.draw.button('later', `Later (${messages.length - to})`, () => setLimit(Math.max(PAGE_MESSAGES, wanted - PAGE_MESSAGES)), { plain: true, dim: true }),
    asking.length > 0 && listOf(ctx, `chat:${id}:asking-list`, asking, (t) => taskRow(ctx, `chat-asking:${t.id}`, t, false, true), 10),
    live.length > 0 && text(`${[...new Set(live.map((l) => (l.peerId === me ? 'Your agent' : `${l.name}’s agent`)))].join(' and ')} ${new Set(live.map((l) => l.peerId)).size === 1 ? 'is' : 'are'} answering...`, { color: 'claude' }),
    friend && shownState(friend) === 'offline' ? dim(`${friend.name} is offline: this waits for them.`) : undefined,
    writable ? composer(ctx, id, target, `Message ${name}`) : group ? confirmPress(ctx, `group:${group.id}:delete`, 'Delete from This Computer', `Its messages are removed from this computer. The people still in ${group.name} keep their copies.`, () => ctx.call('network.groups.delete', group.id)) : undefined,
  );
}

/** Who the next message asks. Nobody's agent reads a message unless you say. */
export function chatAskPage(ctx: Ctx, id: string): Node {
  const net = ctx.state.network;
  const target = targetOf(id);
  const friend = target?.kind === 'dm' ? net.friends.find((f) => f.peerId === target.peerId) : undefined;
  const group = target?.kind === 'group' ? net.groups.find((g) => g.id === target.groupId) : undefined;
  const people = friend ? [{ peerId: friend.peerId, name: friend.name }] : uniqueBy(group?.members.filter((m) => !m.self) ?? [], (m) => m.peerId);
  const [asking, setAsking] = ctx.local<Asking>(`chat:${id}:asking`, { kind: 'none' });
  const pick = (next: Asking) => (): void => {
    setAsking(next);
    ctx.nav.back(ctx.pane);
  };
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        dim('It answers here, from its owner’s computer. Nobody’s agent reads a message unless you say.'),
        col(
          [
            choice(ctx, 'ask:none', 'Nobody’s Agent', asking.kind === 'none', pick({ kind: 'none' })),
            choice(ctx, 'ask:me', 'Your Agent', asking.kind === 'me', pick({ kind: 'me' })),
            people.length > 0 && choice(ctx, 'ask:all', people.length === 1 ? 'Both Agents' : 'Everyone’s Agent', asking.kind === 'all', pick({ kind: 'all' })),
            listOf(ctx, 'ask:people', people, (p) => choice(ctx, `ask:person:${p.peerId}`, `${p.name}’s Agent`, asking.kind === 'person' && asking.peerId === p.peerId, pick({ kind: 'person', peerId: p.peerId, name: p.name }))),
          ],
          { top: 1 },
        ),
      ],
      { title: 'Ask an agent with your next message' },
    ),
  );
}

/** What's advanced about a conversation. */
export function chatMorePage(ctx: Ctx, id: string): Node {
  const net = ctx.state.network;
  const target = targetOf(id);
  const friend = target?.kind === 'dm' ? net.friends.find((f) => f.peerId === target.peerId) : undefined;
  const group = target?.kind === 'group' ? net.groups.find((g) => g.id === target.groupId) : undefined;
  if (!friend && !group) return page(top(ctx, 'chats'), back(ctx), empty('That conversation is gone.'));
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        friend && ctx.draw.button('more:card', `${friend.name}’s Card`, () => ctx.go({ name: 'friend', params: { id: friend.peerId } }), { plain: true }),
    friend && ctx.draw.button('more:new-channel', `New Channel with ${friend.name}`, () => ctx.go({ name: 'new-channel', params: { with: friend.peerId } }), { plain: true }),
    friend && (net.messages[id]?.length ?? 0) > 0 ? confirmPress(ctx, 'more:clear', 'Clear Chat', `Every message is removed from this computer. ${friend.name} keeps their copy.`, () => ctx.call('network.clear', id)) : undefined,
    group && ctx.draw.button('more:info', 'Channel Info', () => ctx.go({ name: 'channel', params: { id: group.id } }), { plain: true }),
    group && group.unread > 0 ? ctx.draw.button('more:read', 'Mark as Read', () => ctx.call('network.read', id), { plain: true }) : undefined,
      ],
      { title: group ? groupName(ctx, group) : (friend?.name ?? '') },
    ),
  );
}

const inConversation = (ctx: Ctx, id: string, msg: string): MessageView | undefined => messagesIn(ctx, id).find((m) => m.id === msg);

/** One message: its words, and what you can do with it. */
export function messagePage(ctx: Ctx, id: string, msg: string): Node {
  const m = inConversation(ctx, id, msg);
  if (!m) return page(top(ctx, 'chats'), back(ctx), empty('That message is gone.'));
  const target = targetOf(id);
  const dm = target?.kind === 'dm';
  const locked = m.status === 'locked';
  const editable = dm && m.mine && !m.claude && !m.task && !locked && Boolean(m.text.trim());
  const [editing, setEditing] = ctx.local(`message:${msg}:editing`, false);
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        meta(new Date(m.ts).toLocaleString()),
        locked ? dim('Can’t be read on this computer.') : m.text.trim() ? md(peerMd(m.text)) : undefined,
        m.mine && m.status === 'expired' ? text('Not delivered.', { color: 'warning' }) : undefined,
      ],
      { title: authorWords(m), ...(m.mine && m.status === 'expired' ? { tone: 'warn' as const } : {}) },
    ),
    m.mine && m.status === 'expired'
      ? ctx.draw.button(
          `message:${msg}:again`,
          'Send Again',
          () => (target?.kind === 'dm' && !m.files?.length ? ctx.call('network.dm.send', target.peerId, m.text) : ctx.call('network.post', id, { text: m.text, ...(m.files?.length ? { files: [...m.files] } : {}) })),
          { primary: true, hotkey: 'a' },
        )
      : undefined,
    row([
    m.text.trim() && !locked ? ctx.draw.button(`message:${msg}:copy`, 'Copy', () => ctx.effect({ copy: m.text, toast: 'Copied the message' }), { plain: true }) : undefined,
    editable && !editing ? ctx.draw.button(`message:${msg}:edit`, 'Edit', () => setEditing(true), { plain: true }) : undefined,
    ], { gap: 3 }),
    editable &&
      editing &&
      ctx.draw.input(
        `message:${msg}:words`,
        async (value) => {
          const words = value?.trim();
          setEditing(false);
          if (words && words !== m.text.trim()) await ctx.call('network.messages.edit', id, msg, words);
        },
        { value: m.text, rows: 3, submitLabel: 'save', autoFocus: true },
      ),
    dm && section('Delete', [
      confirmPress(ctx, `message:${msg}:delete`, 'Delete Here', `It’s removed from this computer.${m.mine ? ' They still have it.' : ''}`, async () => {
        await ctx.call('network.messages.delete', id, msg);
        ctx.nav.back(ctx.pane);
      }),
      m.mine &&
      confirmPress(ctx, `message:${msg}:delete-all`, 'Delete for Them Too', 'It’s removed from this computer and theirs. If they’re offline, it goes when they’re back.', async () => {
        await ctx.call('network.messages.delete', id, msg, { everyone: true });
        ctx.nav.back(ctx.pane);
      }),
    ]),
  );
}

/** One file of a message: get it, and once it's here, open it, show it, or put a copy somewhere. */
export function filePage(ctx: Ctx, id: string, msg: string, sha: string): Node {
  const m = inConversation(ctx, id, msg);
  const f = m?.files?.find((x) => x.sha === sha);
  if (!m || !f) return page(top(ctx, 'chats'), back(ctx), empty('That file is gone.'));
  const state = ctx.state.network.files?.[sha];
  const [saving, setSaving] = ctx.local(`file:${sha}:saving`, false);
  const here = state?.state === 'here';
  const coming = state?.state === 'coming';
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        meta(m.mine ? 'You sent it' : `Sent by ${m.name}`, formatBytes(f.size), f.mime),
        line(here ? pill('Here', 'ok') : coming ? pill(`Coming: ${formatBytes(state.received ?? 0)} of ${formatBytes(f.size)}`, 'accent') : state?.state === 'failed' ? pill(state.error ?? 'It didn’t come.', 'error') : pill('Not downloaded')),
        coming && state.error ? dim(state.error) : undefined,
        here && state.path ? dim(homePath(ctx.state, state.path)) : undefined,
        !here && !coming && actions(ctx.draw.button(`file:${sha}:download`, state?.state === 'failed' ? 'Try Again' : 'Download', () => ctx.call('network.files.download', sha, id), { primary: true, hotkey: 'a' })),
        coming && actions(ctx.draw.button(`file:${sha}:cancel`, 'Stop Downloading', () => ctx.call('network.files.cancel', sha), { plain: true, hotkey: 'x' })),
      ],
      { title: f.name, ...(state?.state === 'failed' ? { tone: 'error' as const } : {}) },
    ),
    here && f.image ? picture(ctx, `file:${sha}:picture`, f.name, async () => (await ctx.call('network.files.preview', sha)) as { mime: string; b64: string }) : undefined,
    here && !m.mine ? dim('Someone else made this file: opening it runs it with the app your computer picks.') : undefined,
    here &&
      actions(
        ctx.draw.button(`file:${sha}:open`, 'Open', () => ctx.call('network.files.open', sha), { primary: true, hotkey: 'a' }),
        ctx.draw.button(`file:${sha}:reveal`, 'Show in Folder', () => ctx.call('network.files.reveal', sha), { plain: true, hotkey: 'f' }),
        ctx.draw.button(`file:${sha}:save`, 'Save To', () => setSaving(true), { plain: true, dim: true, hotkey: 'v' }),
      ),
    here &&
      saving &&
      ctx.draw.input(
        `file:${sha}:target`,
        async (value) => {
          setSaving(false);
          const target = value?.trim() ? wholePath(ctx.state, value) : '';
          if (!target) return;
          const to = (await ctx.call('network.files.saveTo', sha, target)) as string | undefined;
          ctx.effect({ toast: `Saved to ${to ?? target}` });
        },
        { label: 'Save to', placeholder: `/path/to/${f.name}`, submitLabel: 'save', autoFocus: true },
      ),
  );
}

// ---- channels

const sortMembers = (members: readonly MemberView[]): MemberView[] => uniqueBy(members, (m) => m.peerId).sort((a, b) => Number(b.self) - Number(a.self) || Number(b.admin) - Number(a.admin) || byName(a, b));

const openGroupLink = (invitations: readonly InvitationView[], id: string, now = Date.now()): InvitationView | undefined => [...invitations].filter((i) => i.kind === 'group' && i.groupId === id && i.expiresAt > now).sort((a, b) => b.expiresAt - a.expiresAt)[0];

/** An invite link for a channel: one person's approval each, or anyone with it. The link doesn't say which, so this screen remembers. */
function inviteLink(ctx: Ctx, g: GroupView): Node {
  const open = openGroupLink(ctx.state.network.invitations, g.id);
  const [autoLinks, setAutoLinks] = ctx.local<readonly string[]>('channel:auto-links', []);
  const make = async (auto: boolean): Promise<void> => {
    if (open) await ctx.call('network.friends.cancelInvite', open.id);
    const made = (await ctx.call('network.groups.invite', g.id, { auto })) as InvitationView | undefined;
    if (auto && made) setAutoLinks([...autoLinks, made.id]);
  };
  if (!open) return section('Invite with a link', [ctx.draw.button('channel:invite', 'Create Invite Link', () => make(false), { plain: true })]);
  const auto = autoLinks.includes(open.id);
  return section('Invite with a link', [
    line(span(open.link, { dim: true })),
    row([
      ctx.draw.button('channel:copy-link', 'Copy Link', () => ctx.effect({ copy: open.link, toast: `Copied the invite link to ${g.name}` }), { plain: true, hotkey: 'q' }),
      choice(ctx, 'channel:invite:ask', 'Approve Each Request', !auto, () => (auto ? make(false) : undefined)),
      choice(ctx, 'channel:invite:auto', 'Anyone with the Link', auto, () => (auto ? undefined : make(true))),
    ], { gap: 2 }),
    dim(auto ? 'Anyone with the link joins right away.' : 'You, or another admin, approve each person.'),
  ]);
}

/** A channel's info: its name, who's in it, who asks to join, its link, and leaving. */
export function channelPage(ctx: Ctx, id: string): Node {
  const g = ctx.state.network.groups.find((x) => x.id === id);
  if (!g) return page(top(ctx, 'chats'), back(ctx), empty('This channel isn’t here any more.'));
  const lastAdmin = g.admin && g.members.filter((m) => m.admin).length === 1 && g.members.length > 1;
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        meta(g.active ? (g.admin ? pill('Admin', 'accent') : pill('Member')) : pill('Left'), `${g.members.length} member${g.members.length === 1 ? '' : 's'}`),
        dim(g.active ? (g.admin ? 'You’re an admin. Kept on each member’s computer.' : 'Kept on each member’s computer.') : 'You’re no longer in this channel.'),
        g.active && ctx.state.network.main !== g.id
      ? col([ctx.draw.input(
          `channel:${id}:name`,
          async (value) => {
            const next = value?.trim();
            if (next && next !== g.name) await ctx.call('network.groups.rename', g.id, next);
          },
          { label: 'Name', value: g.name, submitLabel: 'rename' },
        )], { top: 1 })
      : undefined,
      ],
      { title: `# ${groupName(ctx, g)}` },
    ),
    g.admin && g.requests.length > 0 &&
      section('Asking to join', [
        listOf(ctx, `channel:${id}:requests`, g.requests, (r) =>
          card([
            text(r.name, { weight: 'bold' }),
            actions(
              ctx.draw.button(`channel:approve:${r.peerId}`, 'Approve', () => ctx.call('network.groups.approve', g.id, r.peerId), {}),
              ctx.draw.button(`channel:decline:${r.peerId}`, 'Decline', () => ctx.call('network.groups.decline', g.id, r.peerId), { plain: true, dim: true }),
            ),
          ], { tone: 'warn' }),
        ),
      ], g.requests.length),
    g.admin && g.active ? ctx.draw.button('channel:add', 'Add People', () => ctx.go({ name: 'add-people', params: { id } }), { primary: true, hotkey: 'a' }) : undefined,
    section('Members', [
      listOf(ctx, `channel:${id}:members`, sortMembers(g.members), (m) =>
        m.self
          ? line(span(m.name), span('  you', { dim: true }), m.admin ? span('  · admin', { dim: true }) : undefined)
          : ctx.draw.button(`channel:member:${m.peerId}`, m.name, () => ctx.go({ name: 'member', params: { id, peer: m.peerId } }), { plain: true, spans: [span(m.name), span('  '), presencePill(m), ...(m.admin ? [span('  · admin', { dim: true })] : [])] }),
      ),
    ], g.members.length),
    g.admin && g.active && inviteLink(ctx, g),
    g.active
      ? confirmPress(ctx, `channel:${id}:leave`, 'Leave Channel', `You stop getting its messages. What was said stays on this computer, read-only.${lastAdmin ? ' You’re its only admin, so the person who’s been in it longest becomes admin.' : ''}`, () => ctx.call('network.groups.leave', g.id))
      : confirmPress(ctx, `channel:${id}:delete`, 'Delete Channel', `Its messages are removed from this computer. The people still in ${g.name} keep their copies, and if someone adds you again it comes back.`, async () => {
          await ctx.call('network.groups.delete', g.id);
          ctx.go({ name: 'chats' });
        }),
  );
}

/** Someone in a channel, for an admin. */
export function memberPage(ctx: Ctx, id: string, peer: string): Node {
  const g = ctx.state.network.groups.find((x) => x.id === id);
  const m = g?.members.find((x) => x.peerId === peer);
  if (!g || !m) return page(top(ctx, 'chats'), back(ctx), empty('They aren’t in this channel any more.'));
  const friend = ctx.state.network.friends.some((f) => f.peerId === peer);
  return page(
    top(ctx, 'chats'),
    back(ctx, g.name),
    card(
      [
        meta(presencePill(m), m.admin && 'Admin'),
        friend && actions(ctx.draw.button('member:message', 'Message', () => openConversation(ctx, `dm:${peer}`), {}), ctx.draw.button('member:card', `${m.name}’s Card`, () => ctx.go({ name: 'friend', params: { id: peer } }), { plain: true })),
      ],
      { title: m.name },
    ),
    g.admin && g.active && ctx.draw.button('member:admin', m.admin ? 'Remove as Admin' : 'Make Admin', () => ctx.call('network.groups.setAdmin', g.id, peer, !m.admin), { plain: true }),
    g.admin &&
      g.active &&
      confirmPress(ctx, 'member:remove', `Remove ${m.name}`, `${m.name} stops getting new messages. What was said before stays on their computer.`, async () => {
        await ctx.call('network.groups.removeMember', g.id, peer);
        ctx.nav.back(ctx.pane);
      }),
  );
}

/** Teammates who aren't in a channel yet: a press adds each. */
export function addPeoplePage(ctx: Ctx, id: string): Node {
  const g = ctx.state.network.groups.find((x) => x.id === id);
  if (!g) return page(top(ctx, 'chats'), back(ctx), empty('This channel isn’t here any more.'));
  const friends = ctx.state.network.friends.filter((f) => !g.members.some((m) => m.peerId === f.peerId)).sort(byName);
  return page(
    top(ctx, 'chats'),
    back(ctx, g.name),
    card(
      [
        dim('They can read what’s said from now on.'),
        friends.length === 0 && empty('Every teammate is here already. Invite others with the channel’s link.'),
        col([listOf(ctx, `add-people:${id}`, friends, (f) => ctx.draw.button(`add-people:${f.peerId}`, f.name, () => ctx.call('network.groups.addMember', g.id, f.peerId), { plain: true, spans: [span('+ ', { dim: true }), span(f.name), span('  '), presencePill(f)] }))], { top: 1 }),
      ],
      { title: `Add People to ${g.name}` },
    ),
  );
}

/** A new channel: teammates to start with, a name. */
export function newChannelPage(ctx: Ctx, preset?: string): Node {
  const net = ctx.state.network;
  if (!net.enabled) return page(top(ctx, 'chats'), back(ctx), networkOff(ctx, 'Channels'));
  const friends = [...net.friends].sort(byName);
  const [chosen, setChosen] = ctx.local<readonly string[]>(`new-channel:${preset ?? ''}:chosen`, preset ? [preset] : []);
  return page(
    top(ctx, 'chats'),
    back(ctx),
    card(
      [
        dim('A conversation with several teammates, kept on everyone’s computer. You can add people later too.'),
        ctx.draw.input(
      'new-channel:name',
      async (value) => {
        const name = value?.trim();
        if (!name) return;
        const made = (await ctx.call('network.groups.create', name.slice(0, 64), [...chosen])) as GroupView | undefined;
        setChosen([]);
        if (made?.id) openConversation(ctx, `group:${made.id}`);
      },
      { label: 'Name', placeholder: 'Launch team', submitLabel: 'create', autoFocus: true },
    ),
      ],
      { title: 'New Channel' },
    ),
    friends.length > 0 &&
      section('Start with', [
        listOf(ctx, 'new-channel:friends', friends, (f) =>
          tick(ctx, `new-channel:${f.peerId}`, f.name, chosen.includes(f.peerId), () => setChosen(chosen.includes(f.peerId) ? chosen.filter((p) => p !== f.peerId) : [...chosen, f.peerId])),
        ),
      ], chosen.length || undefined),
  );
}
