import { planTitle } from '../../core/plans/model.js';
import { OFFER_DETAIL, type PlanReview, type SharedPlan, knockWords, myKnockOn, myKnockWords, offerWords } from '../../core/team/model.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, md, row, span, text } from '../tree.js';
import { actions, ago, back, card, empty, meta, page, pill, section } from './common.js';
import { byName, confirmPress, listOf, nameButton, nameOf, peerMd, top, uniqueBy } from './team-common.js';

/**
 * Team boards: teammates on the same GitHub repository who said yes keep one board. Here: the offers
 * to team up, each team, tasks a teammate gave you, knocks on worktrees, and plans shared for review.
 * Nothing is shared until both say yes.
 */

/** What a review is, as a pill beside its author. */
const reviewPill = (r: PlanReview) => (r.kind === 'approve' ? pill('Approved', 'ok', '✓') : r.kind === 'suggest' ? pill(r.ops?.length === 1 ? 'Suggests a change' : `Suggests ${r.ops?.length ?? 0} changes`, 'accent') : pill('Comment'));

/** What a suggested change says, in words. */
function opWords(op: unknown): string {
  const o = op as { op?: string; id?: string; patch?: { title?: string; goal?: string }; title?: string };
  switch (o.op) {
    case 'update_task':
      return `Change ${o.id ?? 'a task'}${o.patch?.title ? ` to “${o.patch.title}”` : ''}${o.patch?.goal ? `: ${o.patch.goal}` : ''}`;
    case 'add_task':
      return 'Add a task';
    case 'remove_task':
      return `Take out ${o.id ?? 'a task'}`;
    case 'retitle':
      return `Rename the plan${o.title ? ` “${o.title}”` : ''}`;
    default:
      return o.op ? o.op.replace(/_/g, ' ') : 'A change';
  }
}

export function boardsPage(ctx: Ctx): Node {
  const st = ctx.state;
  const team = st.team;
  if (!team.enabled) return page(top(ctx, 'boards'), empty('Team boards run while the network is on. It turns on from People, and nothing is shared until both of you say yes.'));
  const teams = Object.values(team.teams).sort((a, b) => a.repo.localeCompare(b.repo));
  const working = uniqueBy(
    Object.entries(team.working).flatMap(([issueId, people]) => people.filter((p) => p.peerId !== st.selfId).map((p) => ({ issueId, p, issue: st.board.issues.find((i) => i.id === issueId) }))),
    (w) => `${w.issueId}:${w.p.peerId}`,
  );
  const knocks = uniqueBy(team.knocks ?? [], (k) => k.id);
  const assigned = uniqueBy(team.assigned, (a) => a.issueId);
  const myKnocks = (team.myKnocks ?? []).filter((k) => !working.some((w) => w.issueId === k.issueId));
  const shareable = st.plans.plans.filter((p) => (team.teams[p.projectId]?.mates.length ?? 0) > 0 || team.planShares[p.id]);
  const nothing = !team.offers.length && !teams.length && !assigned.length && !knocks.length && !team.plans.length && !shareable.length;
  const planWords = (status: string): string => (status === 'draft' ? 'draft' : status === 'active' ? 'running' : 'done');
  return page(
    top(ctx, 'boards'),
    nothing && empty('No teams yet. When a teammate has the same GitHub repository as one of your projects, an offer to team up shows here.'),
    team.offers.length > 0 &&
      section('Team up?', [
        listOf(ctx, 'boards:offers', team.offers, (o) =>
          card(
            [
              text(offerWords(o), { weight: 'bold' }),
              dim(o.state === 'asked' ? 'The team forms when they say yes too.' : OFFER_DETAIL),
              actions(
                o.state === 'asked' ? undefined : ctx.draw.button(`offer:${o.peerId}:${o.projectId}:yes`, 'Team Up', () => ctx.call('team.answer', o.peerId, o.projectId, true), {}),
                ctx.draw.button(`offer:${o.peerId}:${o.projectId}:no`, o.state === 'asked' ? 'Take Back' : 'Not Now', () => ctx.call('team.answer', o.peerId, o.projectId, false), { plain: true, dim: true }),
              ),
            ],
            o.state === 'asked' ? {} : { tone: 'warn' },
          ),
        ),
      ], team.offers.length),
    knocks.length > 0 &&
      section('Knocking on your worktrees', [
        listOf(ctx, 'boards:knocks', knocks, (k) =>
          card(
            [
              text(knockWords(k), { weight: 'bold' }),
              dim(`${k.note ? `“${k.note}” · ` : ''}${k.key}: ${k.title}. An editor can talk to your agent there; a viewer follows along.`),
              actions(
                ctx.draw.button(`knock:${k.id}:contribute`, 'Let In as Editor', () => ctx.call('team.answerKnock', k.id, 'contribute'), {}),
                ctx.draw.button(`knock:${k.id}:view`, 'Let In as Viewer', () => ctx.call('team.answerKnock', k.id, 'view'), { plain: true }),
                ctx.draw.button(`knock:${k.id}:decline`, 'Not Now', () => ctx.call('team.answerKnock', k.id, 'decline'), { plain: true, dim: true }),
              ),
            ],
            { tone: 'warn' },
          ),
        ),
      ], knocks.length),
    assigned.length > 0 &&
      section('Given to you', [
        listOf(ctx, 'boards:assigned', assigned, (a) =>
          card([
            text(`${a.key}: ${a.title}`, { weight: 'bold' }),
            meta(`${a.by} gave ${a.claude ? 'your agent' : 'you'} this`, ago(a.at)),
            actions(ctx.draw.button(`assigned:${a.issueId}`, 'Got It', () => ctx.call('team.ackAssignment', a.issueId), {})),
          ]),
        ),
      ], assigned.length),
    teams.length > 0 &&
      section('Your teams', [
        listOf(ctx, 'boards:teams', teams, (t) =>
          card([
            nameButton(ctx, `team:${t.projectId}`, t.repo, () => ctx.go({ name: 'team-project', params: { id: t.projectId } }), [span('  ›', { dim: true })]),
            meta(`with ${t.mates.slice(0, 4).map((m) => m.name).join(', ')}${t.mates.length > 4 ? ` and ${t.mates.length - 4} others` : ''}`),
          ]),
        ),
      ], teams.length),
    working.length > 0 &&
      section('Teammates at work', [
        listOf(ctx, 'boards:working', working, ({ issueId, p, issue }) => {
          const mine = myKnockOn(team, issueId, p.peerId);
          const word = issue ? `${issue.key}: ${issue.title}` : 'A task';
          return row([
            col([line(span(`${p.name}${p.running ? '’s agent' : ''}`, { weight: 'bold' }), span('  '), p.running ? pill('working', 'accent') : undefined), meta(word, mine && myKnockWords(mine))]),
            mine?.state === 'waiting'
              ? ctx.draw.button(`knock:mine:${mine.id}:back`, 'Take Back', () => ctx.call('team.cancelKnock', mine.id), { plain: true, dim: true })
              : mine?.state === 'in' && mine.workspaceId && st.shared.some((w) => w.id === mine.workspaceId && w.owner === mine.peerId)
                ? ctx.draw.button(`knock:mine:${mine.id}:open`, 'Open', () => ctx.go({ name: 'shared-worktree', params: { owner: mine.peerId, id: mine.workspaceId ?? '' } }), { plain: true })
                : ctx.draw.button(`knock:${issueId}:${p.peerId}`, mine ? 'Knock Again' : 'Knock to Join', () => ctx.call('team.knock', issueId, p.peerId), { plain: true }),
          ], { justify: 'space-between' });
        }),
      ], working.length),
    myKnocks.length > 0 &&
      section('Your knocks', [
        listOf(ctx, 'boards:my-knocks', myKnocks, (k) =>
          row([
            text(myKnockWords(k)),
            row([
              k.state === 'in' && k.workspaceId && st.shared.some((w) => w.id === k.workspaceId && w.owner === k.peerId) ? ctx.draw.button(`knock:mine:${k.id}:open`, 'Open', () => ctx.go({ name: 'shared-worktree', params: { owner: k.peerId, id: k.workspaceId ?? '' } }), { plain: true }) : undefined,
              ctx.draw.button(`knock:mine:${k.id}:clear`, k.state === 'waiting' ? 'Take Back' : 'Clear', () => ctx.call('team.cancelKnock', k.id), { plain: true, dim: true }),
            ], { gap: 2 }),
          ], { justify: 'space-between' }),
        ),
      ], myKnocks.length),
    team.plans.length > 0 &&
      section('Plans shared by your team', [
        listOf(ctx, 'boards:plans', team.plans, (p) =>
          card([
            nameButton(ctx, `team-plan:${p.owner}:${p.id}`, p.title, () => ctx.go({ name: 'team-plan', params: { owner: p.owner, id: p.id } })),
            meta(pill(planWords(p.status), p.status === 'active' ? 'accent' : p.status === 'draft' ? 'quiet' : 'ok'), `${p.ownerName}’s`, ago(p.updatedAt)),
          ]),
        ),
      ], team.plans.length),
    shareable.length > 0 &&
      section('Your plans', [
        listOf(ctx, 'boards:my-plans', shareable, (p) => {
          const share = team.planShares[p.id];
          const open = share?.reviews.filter((r) => r.kind === 'suggest' && !r.settled).length ?? 0;
          return card(
            [
              line(span(planTitle(p), { weight: 'bold' }), span('  '), share ? pill('Shared with your team', 'accent') : pill('Only you')),
              row([
                share ? ctx.draw.button(`plan:${p.id}:reviews`, open ? `Reviews (${open} to answer)` : `Reviews (${share.reviews.length})`, () => ctx.go({ name: 'plan-reviews', params: { id: p.id } }), { plain: true }) : undefined,
                ctx.draw.button(`plan:${p.id}:share`, share ? 'Stop Sharing' : 'Share with Team', () => ctx.call('team.sharePlan', p.id, !share), { plain: true, dim: true }),
              ], { gap: 3, top: 1 }),
            ],
            open ? { tone: 'warn' } : {},
          );
        }),
      ], shareable.length),
  );
}

/** One project's team: everyone on it, who could join, and leaving. */
export function teamProjectPage(ctx: Ctx, id: string): Node {
  const st = ctx.state;
  const t = st.team.teams[id];
  if (!t) return page(top(ctx, 'boards'), back(ctx, 'Boards'), empty('That project isn’t worked on as a team any more.'));
  const friends = new Set(st.network.friends.map((f) => f.peerId));
  const offers = st.network.offers ?? [];
  const mates = [...t.mates].sort(byName);
  return page(
    top(ctx, 'boards'),
    back(ctx, 'Boards'),
    card([dim('Tasks, who is on which issue and the plans you choose to share stay in step. Chats and worktrees stay on your own computer.')], { title: `Team on ${t.repo}` }),
    section('On the team', [listOf(ctx, `team:${id}:mates`, mates, (m) => {
      const friend = friends.has(m.peerId);
      const theyAsked = offers.some((o) => o.dir === 'in' && o.peerId === m.peerId);
      const asked = offers.some((o) => o.dir === 'out' && o.peerId === m.peerId);
      return row([
        line(span(m.name, { weight: 'bold' }), span('  '), friend ? pill('teammate', 'ok') : span('on the team, not your teammate yet', { dim: true })),
        friend
          ? undefined
          : theyAsked
            ? ctx.draw.button(`team:accept:${m.peerId}`, 'Accept', () => ctx.call('network.friends.answerOffer', m.peerId, true), { plain: true })
            : asked
              ? dim('Asked')
              : ctx.draw.button(`team:befriend:${m.peerId}`, 'Add as Teammate', () => ctx.call('team.befriend', id, m.peerId), { plain: true }),
        mates.length > 1 && !m.indirect ? confirmPress(ctx, `team:leave:${m.peerId}`, `Leave Team with ${m.name}`, `You and ${m.name} stop staying in step on ${t.repo}. Your tasks stay on your board.`, () => ctx.call('team.leave', id, m.peerId)) : undefined,
      ], { gap: 2 });
    })], mates.length),
    (t.invitable?.length ?? 0) > 0 &&
      section('Invite to the team: they have this repository', [
        listOf(ctx, `team:${id}:invitable`, t.invitable ?? [], (f) => (f.state === 'asked' ? line(span(f.name), span('  '), pill('invited', 'accent')) : ctx.draw.button(`team:invite:${f.peerId}`, f.name, () => ctx.call('team.answer', f.peerId, id, true), { plain: true, spans: [span('+ ', { dim: true }), span(f.name)] }))),
      ], t.invitable?.length),
    confirmPress(ctx, `team:${id}:leave`, mates.length === 1 ? `Leave Team with ${mates[0]?.name ?? 'them'}` : 'Leave Team', 'They stop staying in step. Your tasks stay on your board.', async () => {
      await ctx.call('team.leave', id);
      ctx.go({ name: 'boards' });
    }),
  );
}

function reviewRow(r: PlanReview): Node {
  return col([
    line(span(r.name, { weight: 'bold' }), span('  '), reviewPill(r), span(`  ${ago(r.at)}`, { dim: true }), r.settled ? span(`  ${r.settled === 'applied' ? 'applied' : 'set aside'}`, { dim: true }) : undefined),
    r.text ? md(peerMd(r.text)) : undefined,
    ...(r.ops ?? []).slice(0, 5).map((op) => dim(opWords(op))),
    (r.ops?.length ?? 0) > 5 && dim(`and ${(r.ops?.length ?? 0) - 5} more`),
  ]);
}

/** What your team said about a plan you shared: Apply on a suggestion, or set it aside. */
export function planReviewsPage(ctx: Ctx, id: string): Node {
  const share = ctx.state.team.planShares[id];
  const plan = ctx.state.plans.plans.find((p) => p.id === id);
  if (!share) return page(top(ctx, 'boards'), back(ctx, 'Boards'), empty('That plan isn’t shared any more.'));
  return page(
    top(ctx, 'boards'),
    back(ctx, 'Boards'),
    card([meta(share.peers.length ? `Shared with ${share.peers.slice(0, 8).map((p) => nameOf(ctx.state, p)).join(', ')}` : 'Shared with your team: nobody can open it yet.')], { title: plan ? planTitle(plan) : 'Your plan' }),
    section('Reviews', [
      share.reviews.length === 0 && empty('No reviews yet.'),
      listOf(ctx, `plan:${id}:reviews-list`, uniqueBy(share.reviews, (r) => r.id), (r) => {
        const open = r.kind === 'suggest' && !r.settled;
        return card(
          [
            reviewRow(r),
            open ? actions(ctx.draw.button(`suggestion:${r.id}:apply`, 'Apply', () => ctx.call('team.applySuggestion', id, r.id), {}), ctx.draw.button(`suggestion:${r.id}:dismiss`, 'Set Aside', () => ctx.call('team.dismissSuggestion', id, r.id), { plain: true, dim: true })) : undefined,
          ],
          open ? { tone: 'warn' } : {},
        );
      }),
    ], share.reviews.length),
  );
}

/** Suggest a change to one task: its title and goal as you'd have them. */
function suggestion(ctx: Ctx, plan: SharedPlan, taskId: string, was: { readonly title: string; readonly goal?: string }): Node {
  const key = `suggest:${plan.owner}:${plan.id}:${taskId}`;
  const [newTitle, setTitle] = ctx.local<string | undefined>(`${key}:title`, undefined);
  const close = (): void => {
    setTitle(undefined);
    ctx.nav.back(ctx.pane);
  };
  return col([
    ctx.draw.input(`${key}:title`, (value) => setTitle(value?.trim() || undefined), { label: 'Title', value: newTitle ?? was.title, submitLabel: 'keep' }),
    ctx.draw.input(
      `${key}:goal`,
      async (value) => {
        const goal = value?.trim() ?? '';
        const title = newTitle ?? was.title;
        const patch = { ...(title !== was.title ? { title } : {}), ...(goal !== (was.goal ?? '') ? { goal } : {}) };
        if (!Object.keys(patch).length) return close();
        await ctx.call('team.reviewPlan', plan.owner, plan.id, { kind: 'suggest', ops: [{ op: 'update_task', id: taskId, patch }] });
        ctx.effect({ toast: `Suggested to ${plan.ownerName}` });
        return close();
      },
      { label: 'What it’s for', value: was.goal ?? '', rows: 3, submitLabel: 'suggest' },
    ),
  ]);
}

/** A teammate's plan, read-only: approve it, comment, or suggest a change to a task. */
export function teamPlanPage(ctx: Ctx, owner: string, id: string): Node {
  const plan = ctx.state.team.plans.find((p) => p.owner === owner && p.id === id);
  if (!plan) return page(top(ctx, 'boards'), back(ctx, 'Boards'), empty('This plan isn’t shared with you any more.'));
  const me = ctx.state.selfId;
  const approved = plan.reviews.some((r) => r.by === me && r.kind === 'approve' && r.rev === plan.rev);
  const task = ctx.route.params?.task;
  const editing = task ? plan.body.milestones.flatMap((m) => m.tasks).find((t) => t.id === task) : undefined;
  // A task once each, however its plan lists them: its owner wrote it.
  const seen = new Set<string>();
  const outline = plan.body.milestones.flatMap((m) => [
    { milestone: m },
    ...m.tasks.flatMap((t) => {
      if (seen.has(t.id)) return [];
      seen.add(t.id);
      return [{ task: t }];
    }),
  ]);
  if (editing) return page(top(ctx, 'boards'), back(ctx, 'Plan'), card([suggestion(ctx, plan, editing.id, editing)], { title: `Suggest a change to ${editing.title}` }));
  return page(
    top(ctx, 'boards'),
    back(ctx, 'Boards'),
    card(
      [
        meta(pill(plan.status === 'draft' ? 'a draft' : plan.status === 'active' ? 'approved and running' : 'done', plan.status === 'active' ? 'accent' : plan.status === 'draft' ? 'quiet' : 'ok'), `${plan.ownerName}’s plan`, 'read-only'),
        plan.body.goal ? md(peerMd(plan.body.goal)) : undefined,
        actions(approved ? line(pill('You approved this version.', 'ok', '✓')) : ctx.draw.button('team-plan:approve', 'Approve', () => ctx.call('team.reviewPlan', owner, id, { kind: 'approve' }), { primary: true, hotkey: 'a' })),
      ],
      { title: plan.title },
    ),
    section('Outline', [
      dim('Press a task to suggest a change to it.'),
      listOf(ctx, `team-plan:${owner}:${id}:outline`, outline, (at) =>
        'milestone' in at
          ? col([text(`◆ ${at.milestone.title}`, { weight: 'bold' }), at.milestone.goal ? dim(at.milestone.goal) : undefined, at.milestone.criteria.length > 0 && dim(`Passes when: ${at.milestone.criteria.slice(0, 6).join('; ')}`)], { top: 1 })
          : ctx.draw.button(`team-plan:task:${at.task.id}`, at.task.title, () => ctx.go({ name: 'team-plan', params: { owner, id, task: at.task.id } }), { plain: true, spans: [span('  ▸ ', { dim: true }), span(at.task.title), ...(at.task.goal ? [span(`  ${at.task.goal.replace(/\s+/g, ' ').slice(0, 80)}`, { dim: true })] : [])] }),
      ),
    ]),
    section('What the team said', [plan.reviews.length === 0 && empty('Nothing yet.'), listOf(ctx, `team-plan:${owner}:${id}:reviews`, plan.reviews, reviewRow)], plan.reviews.length),
    ctx.draw.input(
      'team-plan:comment',
      async (value) => {
        const words = value?.trim();
        if (words) await ctx.call('team.reviewPlan', owner, id, { kind: 'comment', text: words.slice(0, 8000) });
      },
      { placeholder: `Comment for ${plan.ownerName}`, rows: 2, submitLabel: 'comment' },
    ),
  );
}
