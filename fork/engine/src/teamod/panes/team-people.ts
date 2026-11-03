import { CAP_INFO, CAP_LEVEL_INFO, CAP_ORDER, capFor } from '../../core/gateway/access.js';
import { rulesFor } from '../../core/gateway/model.js';
import { GRANT_INFO, TRUST_INFO } from '../../core/trust.js';
import type { FriendOfferView, FriendView, InvitationView, Presence, PresenceState } from '../../net/mesh/views.js';
import { shortVersion } from '../../net/mesh/features.js';
import { agentName } from '../../shared/agent-label.js';
import { TRUST_LEVELS, type TrustLevel } from '../../shared/settings-schema.js';
import { windowsOf } from '../../ui/usage-cards.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text } from '../tree.js';
import { actions, back, card, empty, field, meta, page, pill, section } from './common.js';
import { ruleRow } from './team-requests.js';
import { STATE_WORDS, byName, choice, confirmPress, errorWords, failed, levelOf, listOf, nameButton, openConversation, peerMd, picture, presencePill, top } from './team-common.js';

/**
 * Your teammates: turning the network on (only ever the one press here), your status, adding someone
 * by a code or a link, and each one's card: how much you trust them, what they may do here, your
 * rules for them, and removing them.
 */

const CHOICE_WORDS: Readonly<Record<PresenceState, string>> = { ...STATE_WORDS, offline: 'Appear Offline' };

type Duration = 'hour' | 'tomorrow' | 'forever';

const DURATIONS: ReadonlyArray<{ readonly id: Duration; readonly label: string }> = [
  { id: 'hour', label: 'For 1 Hour' },
  { id: 'tomorrow', label: 'Until Tomorrow' },
  { id: 'forever', label: 'Until I Change It' },
];

function untilOf(duration: Duration, now = Date.now()): number | undefined {
  if (duration === 'hour') return now + 60 * 60_000;
  if (duration !== 'tomorrow') return undefined;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

const presenceFor = (state: PresenceState, note: string, duration: Duration): Presence => {
  const words = note.trim().slice(0, 140);
  const until = state === 'online' ? undefined : untilOf(duration);
  return { state, ...(words ? { note: words } : {}), ...(until ? { until } : {}) };
};

const selfWords = (p: Presence): string => [CHOICE_WORDS[p.state], p.note?.trim()].filter(Boolean).join(' · ');

const SELF_TONE = { online: 'ok', away: 'warn', dnd: 'error', offline: 'quiet' } as const;

/** Your own status, as the pill beside your name. */
const selfPill = (p: Presence) => pill(selfWords(p), SELF_TONE[p.state]);

/** Someone asks to be your teammate: a card that waits for your answer. */
function offerRow(ctx: Ctx, o: FriendOfferView, on: boolean): Node {
  return card(
    [
      dim('Wants to add you as a teammate'),
      o.via ? meta(`From the ${o.via} team`) : undefined,
      actions(
        on ? ctx.draw.button(`offer:${o.peerId}:yes`, 'Accept', () => ctx.call('network.friends.answerOffer', o.peerId, true), {}) : dim('Turn on the network to accept.'),
        ctx.draw.button(`offer:${o.peerId}:no`, 'Not Now', () => ctx.call('network.friends.answerOffer', o.peerId, false), { plain: true, dim: true }),
      ),
    ],
    { title: o.name, tone: 'warn' },
  );
}

const incomingOffers = (ctx: Ctx): FriendOfferView[] => (ctx.state.network.offers ?? []).filter((o) => o.dir === 'in').sort((a, b) => a.at - b.at);

/** The network is off, as it is until you say: what it is, and the one press that turns it on. */
function offPage(ctx: Ctx): Node {
  const [turning, setTurning] = ctx.local('network:turning', false);
  const offers = incomingOffers(ctx);
  return page(
    top(ctx, 'people'),
    card(
      [
        dim('Messages, channels and files go straight from computer to computer, end-to-end encrypted. No server, no account. It stays off until you turn it on.'),
        actions(
          turning
      ? dim('Turning on...')
      : ctx.draw.button(
          'network:on',
          'Turn On',
          async () => {
            setTurning(true);
            try {
              await ctx.call('network.setEnabled', true);
            } finally {
              setTurning(false);
            }
          },
          { primary: true, hotkey: 'a' },
        ),
        ),
      ],
      { title: 'Talk with teammates directly' },
    ),
    offers.length > 0 && col(offers.slice(0, 40).map((o) => offerRow(ctx, o, false)), { gap: 1 }),
  );
}

/** What's new from a teammate, in their own words: the start of their latest message. */
const latestFrom = (f: FriendView): string | undefined => (f.last && !f.last.mine && f.last.text.trim() ? f.last.text.replace(/\s+/g, ' ').slice(0, 60) : undefined);

/** A teammate's card: their name (it opens them), how they are, what's new, and a message to them. */
function friendRow(ctx: Ctx, f: FriendView): Node {
  const latest = f.unread ? latestFrom(f) : undefined;
  return card([
    row([nameButton(ctx, `friend:${f.peerId}`, f.name, () => ctx.go({ name: 'friend', params: { id: f.peerId } })), ctx.draw.button(`dm:${f.peerId}`, 'Message', () => openConversation(ctx, `dm:${f.peerId}`), { plain: true, ...(f.unread ? {} : { dim: true }) })], { justify: 'space-between', wrap: false }),
    meta(presencePill(f), f.via === 'relay' && f.online && 'through another computer', f.unread ? pill(`${f.unread} new`, 'accent', '✦') : undefined),
    latest ? md(peerMd(latest)) : undefined,
  ]);
}

/** Your teammates, or the card that turns the network on. Then whoever's in your room who isn't one yet. */
export function friendsPage(ctx: Ctx): Node {
  const net = ctx.state.network;
  if (!net.enabled) return offPage(ctx);
  const friends = [...net.friends].sort(byName);
  const offers = incomingOffers(ctx);
  const me = net.self;
  const selfIds = new Set([ctx.state.selfId, ctx.state.self?.peerId]);
  const strangers = ctx.state.peers.filter((p) => !selfIds.has(p.peerId) && !p.guest && !ctx.state.guests[p.peerId] && !net.friends.some((f) => f.peerId === p.peerId)).sort(byName);
  const asked = (peerId: string): boolean => (net.offers ?? []).some((o) => o.dir === 'out' && o.peerId === peerId);
  return page(
    top(ctx, 'people'),
    me && card([nameButton(ctx, 'status', me.name, () => ctx.go({ name: 'status' }), [span('  You', { dim: true })], { hotkey: 'u' }), line(selfPill(me.presence))]),
    ctx.draw.button('add', 'Add a Teammate', () => ctx.go({ name: 'add' }), { primary: true, hotkey: 'a' }),
    offers.length > 0 && section('Asking to be your teammate', [listOf(ctx, 'offers', offers, (o) => offerRow(ctx, o, true))], offers.length),
    friends.length > 0 ? section('Teammates', [listOf(ctx, 'friends', friends, (f) => friendRow(ctx, f))], friends.length) : empty('No teammates yet. Send someone a code or a link: they’re a teammate once they use it.'),
    net.pendingJoins.length > 0 && listOf(ctx, 'pending', net.pendingJoins, (p) => dim(`Asked to join ${p.name}: waiting for an admin to let you in.`)),
    strangers.length > 0 &&
      section('In your room, not teammates yet', [
        listOf(ctx, 'strangers', strangers, (p) =>
          row([
            ctx.draw.button(`stranger:${p.peerId}`, p.name, () => ctx.go({ name: 'room-person', params: { id: p.peerId } }), { plain: true }),
            asked(p.peerId) ? dim('Asked') : ctx.draw.button(`stranger:${p.peerId}:add`, 'Add', () => ctx.call('network.friends.addFromRoom', p.peerId), { plain: true, dim: true }),
          ]),
        ),
      ], strangers.length),
    ctx.draw.button('network', 'More', () => ctx.go({ name: 'network' }), { plain: true, dim: true, hotkey: 'm' }),
  );
}

/** The newest invitation still worth showing. One made for someone in your room isn't yours to hand out. */
const openInvitation = (invitations: readonly InvitationView[], now = Date.now()): InvitationView | undefined =>
  [...invitations].filter((i) => i.kind === 'friend' && !i.for && i.expiresAt > now && i.uses === 0).sort((a, b) => b.expiresAt - a.expiresAt)[0];

const leftWords = (until: number, now = Date.now()): string => {
  const minutes = Math.ceil((until - now) / 60_000);
  if (minutes <= 0) return 'no longer';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
};

type Accepted = { readonly kind: 'friend'; readonly peerId: string; readonly name: string } | { readonly kind: 'group'; readonly groupId: string; readonly name: string; readonly status: 'joined' | 'waiting' };

const acceptWords = (err: unknown): string => {
  const words = errorWords(err);
  if (/Nobody is waiting/i.test(words)) return 'That invitation expired or was already used. Ask for a new one.';
  if (/own invitation/i.test(words)) return 'That’s your own invitation. Send it to a teammate instead.';
  return words;
};

/** Add a teammate: a code and a link to send them, beside using one they sent you. */
export function addPage(ctx: Ctx): Node {
  if (!ctx.state.network.enabled) return friendsPage(ctx);
  const invite = openInvitation(ctx.state.network.invitations);
  const [accepted, setAccepted] = ctx.local<Accepted | undefined>('add:accepted', undefined);
  const [error, setError] = ctx.local<string | undefined>('add:error', undefined);
  const now = Date.now();
  const copy = (words: string, what: string) => (): void => ctx.effect({ copy: words, toast: `Copied ${what}` });
  return page(
    top(ctx, 'people'),
    back(ctx, 'People'),
    card(
      [
        dim('Send them the code or the link. It works once, then you can talk, share and ask each other’s agents.'),
        invite
          ? col([
              col([field('Code', span(invite.code, { weight: 'bold' })), field('Link', invite.link)], { top: 1 }),
              dim(invite.codeExpiresAt <= now ? `The code expired; the link works for ${leftWords(invite.expiresAt, now)}.` : `The code works for ${leftWords(invite.codeExpiresAt, now)}, the link for ${leftWords(invite.expiresAt, now)}.`),
              actions(
                ctx.draw.button('invite:copy-link', 'Copy Link', copy(invite.link, 'the link'), { primary: true, hotkey: 'a' }),
                ctx.draw.button('invite:copy-code', 'Copy Code', copy(invite.code, 'the code'), { plain: true, hotkey: 'q' }),
                ctx.draw.button('invite:cancel', 'Cancel Invitation', () => ctx.call('network.friends.cancelInvite', invite.id), { plain: true, dim: true }),
              ),
            ])
          : actions(ctx.draw.button('invite:create', 'Create Invitation', () => ctx.call('network.friends.invite'), { primary: true, hotkey: 'a' })),
      ],
      { title: 'Add a Teammate' },
    ),
    card(
      [
        dim('Paste what they sent you.'),
        ctx.draw.input(
          'invite:accept',
          async (value) => {
            const words = value?.trim();
            if (!words) return;
            setError(undefined);
            try {
              setAccepted((await ctx.call(/^teamod:\/\/join/.test(words) ? 'network.groups.join' : 'network.friends.accept', words)) as Accepted | undefined);
            } catch (err) {
              setError(acceptWords(err));
            }
          },
          { placeholder: 'K7QM-4XPA-R2TD or teamod://add#…', submitLabel: 'add' },
        ),
        failed(error),
        accepted?.kind === 'friend' &&
          row([text(`You and ${accepted.name} are teammates now.`, { color: 'success' }), ctx.draw.button('accepted:open', `Message ${accepted.name}`, () => openConversation(ctx, `dm:${accepted.peerId}`), { plain: true })]),
        accepted?.kind === 'group' &&
          (accepted.status === 'joined'
            ? row([text(`You’re in ${accepted.name}.`, { color: 'success' }), ctx.draw.button('accepted:open', `Open ${accepted.name}`, () => openConversation(ctx, `group:${accepted.groupId}`), { plain: true })])
            : text(`You asked to join ${accepted.name}. An admin lets you in.`)),
      ],
      { title: 'Have a code or link?' },
    ),
  );
}

/** Which of the durations a status's end matches, roughly. */
const durationOf = (p: Presence, now = Date.now()): Duration => (!p.until ? 'forever' : p.until - now <= 61 * 60_000 ? 'hour' : 'tomorrow');

/** Your status: picked ones apply at once, the note when you press Enter. */
export function statusPage(ctx: Ctx): Node {
  const me = ctx.state.network.self;
  if (!me) return page(top(ctx, 'people'), back(ctx, 'People'), empty('Your status comes with the network, and it’s off.'));
  const presence = me.presence;
  const duration = durationOf(presence);
  const set = (state: PresenceState, note: string, d: Duration): Promise<unknown> => ctx.call('network.presence.set', presenceFor(state, note, d));
  return page(
    top(ctx, 'people'),
    back(ctx, 'People'),
    card(
      [
        line(selfPill(presence)),
        section('Show me as', [row((['online', 'away', 'dnd', 'offline'] as const).map((state) => choice(ctx, `status:${state}`, CHOICE_WORDS[state], presence.state === state, () => set(state, presence.note ?? '', duration))), { gap: 2 })]),
        presence.state === 'offline' ? dim('You still get messages.') : presence.state === 'dnd' ? dim('It silences notifications.') : undefined,
        presence.state !== 'online' &&
          section('For how long', [row(
            DURATIONS.map((d) =>
              choice(ctx, `status:for:${d.id}`, d.label, duration === d.id, () => set(presence.state, presence.note ?? '', d.id)),
            ),
            { gap: 2 },
          )]),
        col([ctx.draw.input('status:note', (value) => set(presence.state, value ?? '', duration), { label: 'Note', value: presence.note ?? '', placeholder: 'What’s your status?', submitLabel: 'save' })], { top: 1 }),
      ],
      { title: 'Your status' },
    ),
  );
}

/** How much you trust someone: one press each. Full trust says what it means first. */
export function trustChoices(ctx: Ctx, key: string, peerId: string, level: TrustLevel | undefined): Node {
  const [askingFull, setAskingFull] = ctx.local(`${key}:asking-full`, false);
  return col([
    row(
      TRUST_LEVELS.map((l) =>
        choice(ctx, `${key}:${l}`, TRUST_INFO[l].label, l === level, () => {
          if (l === 'full' && level !== 'full') return setAskingFull(true);
          setAskingFull(false);
          return ctx.call('people.setTrust', peerId, l);
        }),
      ),
    ),
    askingFull &&
      col([
        text(TRUST_INFO.full.detail),
        row([
          ctx.draw.button(
            `${key}:full-yes`,
            'Give Full Trust',
            async () => {
              setAskingFull(false);
              await ctx.call('people.setTrust', peerId, 'full');
            },
            {},
          ),
          ctx.draw.button(`${key}:full-no`, 'Cancel', () => setAskingFull(false), { plain: true, dim: true }),
        ]),
      ]),
  ]);
}

/** A teammate's card: who they are, how much you trust them, what they may do here, your rules. */
export function friendPage(ctx: Ctx, id: string): Node {
  const f = ctx.state.network.friends.find((x) => x.peerId === id);
  if (!f) return page(top(ctx, 'people'), back(ctx, 'People'), empty('Not a teammate any more.'));
  const level = levelOf(ctx.state, id);
  const theirs = ctx.state.gateway.cards[id];
  const grant = ctx.state.granted[id];
  const caps = ctx.state.gateway.capabilities;
  const rules = rulesFor(ctx.state, id);
  const version = f.teamod && f.teamod.version !== 'unknown' ? shortVersion(f.teamod.version) : undefined;
  const usages = (theirs?.usages ?? []).slice(0, 4).flatMap((u) => {
    const left = windowsOf(u).map((w) => `${w.label} ${Math.max(0, 100 - w.pct)}% left`);
    return left.length > 0 ? [dim(`Their ${agentName(u.agent)} plan: ${left.join(', ')}`)] : [];
  });
  return page(
    top(ctx, 'people'),
    back(ctx, 'People'),
    card(
      [
        meta(presencePill(f), !f.online ? 'Not connected' : f.via === 'relay' ? 'Connected through another member’s computer, still end-to-end encrypted' : 'Connected directly'),
        version ? meta(`Their version: ${version}`) : undefined,
        actions(
          ctx.draw.button('friend:message', `Message ${f.name}`, () => openConversation(ctx, `dm:${id}`), { primary: true, hotkey: 'a' }),
          ctx.state.gateway.enabled ? ctx.draw.button('friend:ask', 'Ask Their Agent', () => ctx.go({ name: 'ask', params: { to: id } }), { plain: true, hotkey: 'q' }) : undefined,
        ),
      ],
      { title: f.name },
    ),
    f.avatar ? picture(ctx, `friend:${id}:avatar`, `${f.name}’s picture`, async () => (await ctx.call('network.avatar.get', f.avatar)) as { mime: string; b64: string }) : undefined,
    Boolean(theirs?.note?.trim() || grant || usages.length > 0 || (theirs && theirs.offers.length > 0) || (theirs && theirs.projects.length > 0)) &&
      section('What they offer', [
        theirs?.note?.trim() ? col([dim(`Ask ${f.name} for`), md(peerMd(theirs.note.trim()))]) : undefined,
        grant && dim(`They let you: ${GRANT_INFO[grant.level].short}. ${GRANT_INFO[grant.level].detail}.`),
        ...usages,
        theirs && theirs.offers.length > 0 ? dim(`Their computer offers you: ${theirs.offers.map((n) => CAP_INFO[n].label).join(', ')}`) : undefined,
        theirs && theirs.projects.length > 0 ? dim(`Projects you can ask about: ${theirs.projects.slice(0, 20).join(', ')}`) : undefined,
      ]),
    section('Trust', [trustChoices(ctx, `friend:${id}:trust`, id, level), dim(TRUST_INFO[level].detail)]),
    ctx.state.gateway.enabled &&
      section('What their agent can do here, at their trust', [
        ...CAP_ORDER.map((need) => line(`${CAP_INFO[need].label}: `, span(CAP_LEVEL_INFO[capFor(caps, need, level)], { dim: true }))),
        ctx.draw.button('friend:access', 'Change for All Teammates', () => ctx.go({ name: 'access' }), { plain: true, dim: true }),
      ]),
    ctx.state.gateway.enabled &&
      section(`Your rules for ${f.name}`, [rules.length === 0 && empty('No rules yet. Choosing Always on one of their requests makes one.'), listOf(ctx, `friend:${id}:rules`, rules, (r) => ruleRow(ctx, `rule:${r.id}`, r, false))], rules.length),
    ctx.draw.button('friend:more', 'More', () => ctx.go({ name: 'friend-more', params: { id } }), { plain: true, dim: true, hotkey: 'm' }),
  );
}

/** What's advanced about a teammate: how far they reach, channels, forgetting, and removing them. */
export function friendMorePage(ctx: Ctx, id: string): Node {
  const net = ctx.state.network;
  const f = net.friends.find((x) => x.peerId === id);
  if (!f) return page(top(ctx, 'people'), back(ctx, 'People'), empty('Not a teammate any more.'));
  const full = levelOf(ctx.state, id) === 'full';
  const reach = full ? 'full' : (ctx.state.access[id] ?? 'folder');
  const freely = (ctx.state.gateway.askFreely ?? []).includes(id);
  const channels = net.groups.filter((g) => g.active && g.admin && !g.members.some((m) => m.peerId === id));
  const remembered = Boolean(ctx.state.levels[id] ?? ctx.state.remembered[id]);
  return page(
    top(ctx, 'people'),
    back(ctx, f.name),
    card(
      [
        section('How far their requests reach', [
          row([choice(ctx, 'friend:reach:folder', 'Only your shared folders', reach === 'folder', () => ctx.call('session.setAccess', id, 'folder')), choice(ctx, 'friend:reach:full', 'This whole computer', reach === 'full', () => ctx.call('session.setAccess', id, 'full'))], { gap: 2 }),
          full ? dim('Full trust already reaches the whole computer.') : undefined,
        ]),
        ctx.state.gateway.enabled &&
          section('Your agent asks them', [row([choice(ctx, 'friend:freely:no', 'Checking with you first', !freely, () => ctx.call('gateway.setAskFreely', id, false)), choice(ctx, 'friend:freely:yes', 'Without checking', freely, () => ctx.call('gateway.setAskFreely', id, true))], { gap: 2 })]),
      ],
      { title: f.name },
    ),
    section('Channels', [
      ctx.draw.button('friend:new-channel', `New Channel with ${f.name}`, () => ctx.go({ name: 'new-channel', params: { with: id } }), { plain: true }),
      channels.length > 0 && col([dim('Add to a channel'), listOf(ctx, `friend:${id}:channels`, channels, (g) => ctx.draw.button(`friend:add-to:${g.id}`, g.name, () => ctx.call('network.groups.addMember', g.id, id), { plain: true }))], { top: 1 }),
    ]),
    ctx.state.peers.some((p) => p.peerId === id && !p.guest) && ctx.draw.button('friend:room', 'In Your Room', () => ctx.go({ name: 'room-person', params: { id } }), { plain: true }),
    actions(
      remembered && ctx.draw.button('friend:forget', 'Forget the Trust You Picked', () => ctx.call('people.forget', id), { plain: true, dim: true }),
      confirmPress(ctx, 'friend:remove', `Remove ${f.name}`, `You won’t be connected any more, and your conversation with ${f.name} is removed from this computer. Channels you share stay.`, async () => {
        await ctx.call('network.friends.remove', id);
        ctx.go({ name: 'friends' });
      }),
    ),
  );
}

/** Your side of the network: what it knows you as, who may use your agent, and turning it off. */
export function networkPage(ctx: Ctx): Node {
  const net = ctx.state.network;
  if (!net.enabled) return offPage(ctx);
  const status = ctx.load('team:network-status', async () => (await ctx.call('network.status')) as { readonly peerId?: string; readonly address?: string }, { ttlMs: 60_000 });
  const friends = new Set(net.friends.map((f) => f.peerId));
  const remembered = Object.entries(ctx.state.remembered).filter(([id]) => !friends.has(id) && !ctx.state.peers.some((p) => p.peerId === id));
  const me = net.self;
  const avatar = me?.avatar;
  return page(
    top(ctx, 'people'),
    back(ctx, 'People'),
    card(
      [
        line(pill('On', 'ok')),
        dim('Your computer connects straight to your teammates’, end-to-end encrypted.'),
        status.error ? failed(status.error) : undefined,
        status.value?.peerId ? field('Your id', span(status.value.peerId, { dim: true })) : undefined,
        status.value?.address ? field('Your address', span(status.value.address, { dim: true })) : undefined,
      ],
      { title: 'The network' },
    ),
    section('People you haven’t picked a trust level for', [
      row(
        [
          choice(ctx, 'network:policy:ask', 'Ask me each time', ctx.state.policy === 'ask', () => ctx.call('session.setClaudeSharing', 'ask')),
          choice(ctx, 'network:policy:auto', 'Without asking', ctx.state.policy === 'auto', () => ctx.call('session.setClaudeSharing', 'auto')),
          choice(ctx, 'network:policy:deny', 'Never', ctx.state.policy === 'deny', () => ctx.call('session.setClaudeSharing', 'deny')),
        ],
        { gap: 2 },
      ),
    ]),
    section('Teammates may ask to start work here; you approve each one', [
      row([choice(ctx, 'network:worktrees:ask', 'Yes', ctx.state.prefs.friendWorktrees === 'ask', () => ctx.call('session.setFriendWorktrees', 'ask')), choice(ctx, 'network:worktrees:off', 'No', ctx.state.prefs.friendWorktrees === 'off', () => ctx.call('session.setFriendWorktrees', 'off'))], { gap: 2 }),
    ]),
    avatar ? section('Your picture', [picture(ctx, 'network:avatar', 'Your picture', async () => (await ctx.call('network.avatar.get', avatar)) as { mime: string; b64: string }), ctx.draw.button('network:avatar:remove', 'Take It Away', () => ctx.call('network.avatar.set', null), { plain: true, dim: true })]) : undefined,
    remembered.length > 0 &&
      section('Remembered from before', [
        listOf(ctx, 'network:remembered', remembered, ([id, r]) => row([line(r.name, span(`  ${TRUST_INFO[r.trust].label}`, { dim: true })), ctx.draw.button(`network:forget:${id}`, 'Forget', () => ctx.call('people.forget', id), { plain: true, dim: true })])),
      ], remembered.length),
    confirmPress(ctx, 'network:off', 'Turn Off', 'You stop being connected to your teammates until you turn it on again. What you have stays on this computer.', () => ctx.call('network.setEnabled', false)),
  );
}
