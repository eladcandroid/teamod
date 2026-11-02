import { criteria } from '../../core/board/criteria.js';
import { actorName, taskProof } from '../../core/board/model.js';
import { AUTONOMY_INFO, type Autonomy, MAX_PARALLEL, type Plan, TESTS_AT, TESTS_AT_INFO, planTitle, shownBody } from '../../core/plans/model.js';
import { type MilestoneView, type PlanView, type TaskView, liveFrom, planView, tidyOffer } from '../../core/plans/progress.js';
import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import { CONTINUE_PROMPT, decodeFailure, resetWords } from '../../shared/run-failure.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, line, row, span, text, title } from '../tree.js';
import { MAIN_KEY, MORE_KEY, agentRows, asking, choices, errorText, field, myAgent, pickProject, subPage, top, webLink, windowed, written } from './board-common.js';
import { MILESTONE_STATE, branchFlow, changeMarks, changeWords, feedOf, headline, milestoneLabel, milestoneRows, modeChange, nextWords, planStatus, prWords, shipAction, taskWords, toneStyle } from './board-plan-words.js';
import { autonomyRows } from './board-plans.js';
import { ago, back, empty, openWorkspace, page } from './common.js';

const gone = (ctx: Ctx): Node => subPage(ctx, 'plans', 'Plans', empty('This plan is gone. It was deleted; its tasks stay on the board.'));

const viewOf = (ctx: Ctx, plan: Plan): PlanView => planView(plan, ctx.state.board, liveFrom(ctx.state));

const planIn = (ctx: Ctx, id: string): Plan | undefined => ctx.state.plans.plans.find((p) => p.id === id);

const openHome = (ctx: Ctx, plan: Plan): void => {
  if (plan.home.startsWith('ws:')) openWorkspace(ctx, plan.home.slice(3));
};

interface Trouble {
  readonly what: string;
  readonly why: string;
  readonly retry: () => unknown;
}
interface Step {
  readonly busy?: string;
  readonly trouble?: Trouble;
}

interface Stepping extends Step {
  /** A big step (Open PR, Merge, Pass): the button says what's under way; what went wrong stays on the page. */
  run(what: string, doing: string, task: () => Promise<unknown>, done?: string): Promise<void>;
  dismiss(): void;
}

function planStep(ctx: Ctx, planId: string): Stepping {
  const [step, setStep] = ctx.local<Step>(`plan:${planId}:step`, {});
  const run: Stepping['run'] = async (what, doing, task, done) => {
    if (step.busy) return;
    setStep({ busy: doing });
    try {
      await task();
      setStep({});
      if (done) ctx.effect({ toast: done });
    } catch (err) {
      setStep({ trouble: { what, why: errorText(err), retry: () => run(what, doing, task, done) } });
    }
  };
  return { ...step, run, dismiss: () => setStep({}) };
}

/** Tasks that can start by your hand: yours, and on Step by Step (or paused) every ready one. */
function startableIn(view: PlanView): ReadonlySet<string> {
  const { plan } = view;
  if (!plan.body || plan.draft || !view.open.length) return new Set();
  const yours = view.ready.filter((t) => t.forYou).map((t) => t.task.id);
  if (view.active.length >= plan.maxParallel) return new Set(yours);
  const step = new Set(view.open.filter((m) => m.autonomy === 'step').map((m) => m.milestone.id));
  return new Set([...yours, ...view.ready.filter((t) => !t.forYou && (plan.paused || step.has(t.milestoneId))).map((t) => t.task.id)]);
}

/** The plan's one main action, whatever it waits for now. Its key names what it does, so a stale press never does something else. */
function mainAction(ctx: Ctx, view: PlanView, step: Stepping): Node | undefined {
  const { plan, next } = view;
  const body = shownBody(plan);
  const words = nextWords(next);
  const who = agentName(myAgent(ctx));
  const main = (action: string, label: string, run: () => unknown): Node => ctx.draw.button(`plan:${plan.id}:${action}`, label, run, { primary: true, hotkey: MAIN_KEY });
  if (step.busy) return dim(step.busy);
  const askAgain = (): Promise<void> => step.run(`ask ${who} to fix the conflict again`, `Asking ${who}...`, () => ctx.call('plans.retryConflicts', plan.id), `${who} is on the conflict again`);
  const merge = (auto: boolean): Promise<void> => step.run(auto ? `turn on Merge When Checks Pass for #${plan.pr?.number}` : `merge #${plan.pr?.number} on GitHub`, auto ? 'Turning On...' : 'Merging...', () => ctx.call('plans.mergePr', plan.id, auto ? { auto: true } : {}), auto ? `#${plan.pr?.number} merges once its checks pass` : `Merged #${plan.pr?.number}: the plan’s tasks are Done`);
  switch (next.kind) {
    case 'approve':
      if (!body?.milestones.length) return undefined;
      return main('approve', 'Approve Plan', async () => {
        await ctx.call('plans.approve', plan.id);
        ctx.effect({ toast: 'Plan approved: its tasks are on the board' });
      });
    case 'review_changes':
      return main('apply', 'Apply Changes', async () => {
        await ctx.call('plans.approve', plan.id);
        ctx.effect({ toast: 'Changes applied' });
      });
    case 'resume':
      return main('resume', 'Resume', () => ctx.call('plans.setPaused', plan.id, false));
    case 'start':
      if (next.tasks.every((t) => t.forYou)) return main('decide', words.title, () => openHome(ctx, plan));
      return main('start', words.title, () => Promise.all(next.tasks.filter((t) => !t.forYou).map((t) => ctx.call('plans.startTask', plan.id, t.task.id))));
    case 'pass':
      return main(`pass:${next.milestone.milestone.id}`, next.milestone.run.mergeFailed ? 'Pass Again' : 'Pass Milestone', () => step.run(`pass “${next.milestone.milestone.title}”`, 'Passing...', () => ctx.call('plans.pass', plan.id, next.milestone.milestone.id)));
    case 'merging':
      if (next.milestone.merging?.conflict?.stuck) return main('ask-again', `Ask ${who} Again`, askAgain);
      return dim(next.milestone.merging?.conflict ? `${who} is fixing the conflict` : 'Merging...');
    case 'failed':
      return main(`not-yet:${next.milestone.milestone.id}`, 'Not Yet', () => ctx.go({ name: 'plan-send-back', params: { id: plan.id, milestone: next.milestone.milestone.id } }));
    case 'answer': {
      const worktree = next.tasks[0]?.worktree;
      return worktree ? main('answer', `Answer in ${next.tasks[0]?.issue?.key ?? 'Its Worktree'}`, () => openWorkspace(ctx, worktree)) : undefined;
    }
    case 'stalled':
      return main('resume-tasks', words.title, () => Promise.all(next.tasks.map((t) => ctx.call('plans.resumeTask', plan.id, t.task.id))));
    case 'ship': {
      const a = shipAction(plan, next.pr);
      switch (a.kind) {
        case 'open':
          return main('open-pr', a.again ? 'Open PR Again' : 'Open PR', () => step.run('open the plan’s pull request', 'Opening PR...', () => ctx.call('plans.openPr', plan.id), 'Opened the plan’s pull request'));
        case 'catching_up':
          return dim('Bringing main in...');
        case 'fixing':
          return dim(`${who} is fixing the conflict`);
        case 'stuck':
          return main('ask-again', `Ask ${who} Again`, askAgain);
        case 'resolve':
          return main('resolve', 'Resolve Conflicts', () => step.run(`bring main into ${next.branch}`, 'Bringing Main In...', () => ctx.call('plans.bringInMain', plan.id)));
        case 'draft':
          return next.pr ? webLink(next.pr.url, 'Mark Ready on GitHub') : undefined;
        case 'wait':
          return main('merge-auto', 'Merge When Checks Pass', () => merge(true));
        case 'merge':
          return main('merge', 'Merge on GitHub', () => merge(false));
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** A merge conflict in the plan: which files, and whether the agent is on it. */
function conflictLine(ctx: Ctx, view: PlanView): Node | undefined {
  const { plan } = view;
  const merging = Object.entries(plan.merging ?? {}).find(([, m]) => m.conflict);
  const main = plan.mainMerge?.conflict;
  const c = main ?? merging?.[1].conflict;
  if (!c) return undefined;
  const m = merging ? view.milestones.find((x) => x.milestone.id === merging[0]) : undefined;
  const what = main ? `${plan.mainMerge?.main} into ${plan.branch}` : `${merging?.[1].conflict?.key ?? merging?.[1].conflict?.merging} (“${m?.milestone.title ?? 'a milestone'}”) into ${plan.branch}`;
  const shown = c.files.slice(0, 4);
  return col([
    text(c.stuck ? 'Conflict: needs you' : 'Your agent is fixing a conflict', c.stuck ? { color: 'warning' } : { color: 'claude' }),
    dim(`Merging ${what}: ${shown.join(', ')}${c.files.length > shown.length ? ` and ${c.files.length - shown.length} more` : ''}`),
    c.stuck && ctx.draw.button(`plan:${plan.id}:conflict-show`, 'Show in Finder', () => ctx.call('plans.showConflict', plan.id), { plain: true }),
  ]);
}

/** Your usage limit stopped the plan: when it goes on by itself, and Resume now. */
function limitPause(ctx: Ctx, view: PlanView): Node | undefined {
  const { plan } = view;
  const paused = view.active.filter((t) => t.pulse?.kind === 'paused');
  const card = ctx.state.log.filter((l) => l.type === 'agent' && l.channel === plan.home).at(-1);
  const failure = card?.type === 'agent' && card.status === 'error' ? decodeFailure(card.text) : undefined;
  const home = failure?.kind === 'usage_limit' ? (failure.resetsAt ?? 0) : undefined;
  if (plan.status !== 'active' || (!paused.length && home === undefined)) return undefined;
  const until = Math.max(home ?? 0, ...paused.map((t) => (t.pulse?.kind === 'paused' ? t.pulse.until : 0)));
  return row([
    text(`Paused: usage limit, ${until > Date.now() ? `resumes at ${resetWords(until)}` : 'resuming as usage comes back'}`, { color: 'warning' }),
    ctx.draw.button(`plan:${plan.id}:resume-limit`, 'Resume Now', async () => {
      if (home !== undefined) await ctx.call('session.submit', CONTINUE_PROMPT, { channel: plan.home, urgent: true });
      await Promise.all(paused.map((t) => ctx.call('plans.resumeTask', plan.id, t.task.id)));
    }, { plain: true }),
  ]);
}

function taskRow(ctx: Ctx, view: PlanView, t: TaskView, mark: string | undefined, canStart: boolean): Node {
  const { plan } = view;
  const info = taskWords(t, Date.now());
  const key = t.issue?.key;
  return row(
    [
      ctx.draw.button(`plan-task:${t.task.id}`, t.task.title, () => ctx.go({ name: 'plan-task', params: { id: plan.id, task: t.task.id } }), {
        plain: true,
        spans: [
          span(`${info.label}  `, toneStyle(info.tone)),
          ...(key ? [span(`${key}  `, { dim: true })] : []),
          span(t.task.title),
          ...(mark ? [span(`  ${mark === 'added' ? 'New' : 'Changed'}`, { color: 'warning' })] : []),
          ...(t.task.parent ? [span('  sub-task', { dim: true })] : []),
          ...(t.forYou ? [span('  for you', { dim: true })] : []),
          ...(t.task.estimate ? [span(`  ${t.task.estimate}`, { dim: true })] : []),
          ...(info.sub && (t.pulse || t.state === 'running') ? [span(`  ${info.sub}`, { dim: true })] : t.state === 'blocked' && t.why ? [span(`  ${t.why}`, { dim: true })] : []),
        ],
      }),
      canStart &&
        (t.forYou
          ? ctx.draw.button(`plan-task:${t.task.id}:decide`, 'Decide', () => openHome(ctx, plan), { plain: true })
          : ctx.draw.button(`plan-task:${t.task.id}:start`, 'Start', () => ctx.call('plans.startTask', plan.id, t.task.id), { plain: true })),
    ],
    { padX: 2 },
  );
}

function milestoneBlock(ctx: Ctx, view: PlanView, m: MilestoneView, marks: ReadonlyMap<string, string>, startable: ReadonlySet<string>): Node {
  const { plan } = view;
  const info = MILESTONE_STATE[m.state];
  const tasks = m.milestone.tasks.flatMap((task) => m.tasks.find((x) => x.task.id === task.id) ?? []);
  return col([
    ctx.draw.button(`milestone:${m.milestone.id}`, m.milestone.title, () => ctx.go({ name: 'plan-gate', params: { id: plan.id, milestone: m.milestone.id } }), {
      plain: true,
      spans: [
        span(m.state === 'passed' ? '[x] ' : `${m.index + 1}. `, { dim: true }),
        span(m.milestone.title, { weight: 'semibold' }),
        span(`  ${milestoneLabel(view, m)}`, toneStyle(info.tone)),
        ...(m.autonomy !== plan.autonomy ? [span(`  ${AUTONOMY_INFO[m.autonomy].label}`, { dim: true })] : []),
        span(`  ${m.state === 'draft' ? `${m.milestone.tasks.length} task${m.milestone.tasks.length === 1 ? '' : 's'}` : `${m.finished}/${m.total}`}`, { dim: true }),
      ],
    }),
    m.milestone.goal ? dim(m.milestone.goal) : undefined,
    ...tasks.map((t) => taskRow(ctx, view, t, marks.get(t.task.id), startable.has(t.task.id))),
    m.milestone.criteria.length > 0 && line(span('Passes when  ', { dim: true }), span(m.milestone.criteria.join(' · '), { dim: true }), m.run.check ? span(m.run.check.verdict === 'pass' ? '  Agent: passes' : '  Agent: not yet', m.run.check.verdict === 'pass' ? { color: 'success' } : { color: 'error' }) : undefined),
  ]);
}

/** The plan as an outline: milestones in order, those that run side by side together, each with its tasks. */
function outline(ctx: Ctx, view: PlanView): Node {
  const { plan } = view;
  const body = view.body ?? plan.draft;
  const marks = changeMarks(plan);
  const startable = startableIn(view);
  const rows = milestoneRows(body);
  return col(
    rows.flatMap((ids, i) => {
      const ms = ids.flatMap((id) => view.milestones.find((m) => m.milestone.id === id) ?? []);
      const after = [...new Set(ms.flatMap((m) => m.dependsOn))].flatMap((id) => view.milestones.find((m) => m.milestone.id === id) ?? []);
      return [i > 0 ? dim(after.length ? `Once ${after.map((m) => `“${m.milestone.title}”`).join(' and ')} ${after.length === 1 ? 'passes' : 'pass'}` : 'Then') : undefined, ...ms.map((m) => milestoneBlock(ctx, view, m, marks, startable))];
    }),
    { gap: 1 },
  );
}

/** While your agent writes the first plan: one line that says what's going on. */
function draftingLine(ctx: Ctx, plan: Plan): Node {
  const project = ctx.state.projects.find((x) => x.id === plan.projectId)?.name;
  const at = activityOf(ctx.state.log, plan.home);
  const fresh = Date.now() - plan.createdAt < 20_000;
  return text(at.running ? `Your agent is reading ${project ?? 'the code'} and writing the plan.` : fresh ? 'Your agent is starting on the plan...' : 'Your agent isn’t writing the plan right now. Tell it what to plan in the conversation.', at.running || fresh ? { color: 'claude' } : { dim: true });
}

/** A plan's page: what it is and the one thing it waits for at the top, the outline under it. Everything else a press away. */
export function planPage(ctx: Ctx, id: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  const step = planStep(ctx, plan.id);
  const body = shownBody(plan);
  const drafting = !plan.body && !body?.milestones.length;
  // The plan's own conversation may be only on disk after a restart: reading the page brings it back.
  if (plan.home.startsWith('ws:')) ctx.load(`plan:${plan.id}:home`, () => ctx.call('workspaces.load', plan.home.slice(3)));
  const status = planStatus(view);
  const said = headline(view);
  const pr = plan.pr;
  const failed = view.milestones.filter((m) => m.run.mergeFailed && !m.run.passedAt && m.state !== 'merging');
  const tidy = tidyOffer(view);
  const mixed = view.milestones.some((m) => m.milestone.autonomy && m.milestone.autonomy !== plan.autonomy);
  return page(
    top(ctx, 'plans'),
    back(ctx, 'Plans'),
    col([title(planTitle(plan)), line(span(status.label, toneStyle(status.tone)), span(`  ${ago(plan.updatedAt)}`, { dim: true }))]),
    !drafting && line(span(said.who === 'you' ? 'You: ' : '', { weight: 'semibold' }), span(said.text, said.who === 'agent' ? { color: 'claude' } : {})),
    mainAction(ctx, view, step),
    pr && webLink(pr.url, `#${pr.number} · ${pr.state === 'OPEN' ? prWords(pr) : pr.state === 'MERGED' ? 'Merged' : 'Closed'}`),
    step.trouble &&
      col([
        text(`Couldn’t ${step.trouble.what}`, { color: 'error' }),
        dim(step.trouble.why),
        row([ctx.draw.button(`plan:${plan.id}:retry`, 'Try Again', step.trouble.retry, { plain: true }), ctx.draw.button(`plan:${plan.id}:dismiss`, 'Dismiss', () => step.dismiss(), { plain: true, dim: true })]),
      ]),
    conflictLine(ctx, view),
    ...failed.map((m) => col([text(`“${m.milestone.title}” couldn’t merge into ${plan.branch ?? 'the plan’s branch'}`, { color: 'error' }), dim(m.run.mergeFailed?.reason ?? ''), ctx.draw.button(`plan:${plan.id}:pass-again:${m.milestone.id}`, 'Pass Again', () => step.run(`pass “${m.milestone.title}”`, 'Passing...', () => ctx.call('plans.pass', plan.id, m.milestone.id)), { plain: true })])),
    limitPause(ctx, view),
    tidy.length > 0 &&
      col([
        text(`Tidy up ${tidy.length} merged task ${tidy.length === 1 ? 'worktree' : 'worktrees'}?`),
        dim(`${tidy.map((t) => t.issue?.key).join(', ')}: their milestones passed before ${plan.branch} was the plan’s branch. Tidy Up merges each into it, then archives its worktree (the conversation stays) and deletes its branch only if merged.`),
        row([
          ctx.draw.button(`plan:${plan.id}:tidy-yes`, 'Tidy Up', async () => {
            await ctx.call('plans.tidyUp', plan.id, true);
            ctx.effect({ toast: `Tidying up ${tidy.length === 1 ? '1 worktree' : `${tidy.length} worktrees`}` });
          }, { plain: true }),
          ctx.draw.button(`plan:${plan.id}:tidy-no`, 'No', async () => {
            await ctx.call('plans.tidyUp', plan.id, false);
            ctx.effect({ toast: 'Left as they are' });
          }, { plain: true, dim: true }),
        ]),
      ]),
    plan.body &&
      plan.draft &&
      row([
        text(`Your agent proposes changes: ${changeWords(plan)}`, { color: 'warning' }),
        ctx.draw.button(`plan:${plan.id}:discard-changes`, 'Discard', () => ctx.call('plans.discard', plan.id), { plain: true, dim: true }),
      ]),
    row([
      !drafting && ctx.draw.button(`plan:${plan.id}:mode`, `Runs on ${AUTONOMY_INFO[plan.autonomy].label}${mixed ? ' (mixed)' : ''}`, () => ctx.go({ name: 'plan-mode', params: { id: plan.id } }), { plain: true, hotkey: 'u', dim: true }),
      plan.home.startsWith('ws:') && ctx.draw.button(`plan:${plan.id}:home`, 'Open the Conversation', () => openHome(ctx, plan), { plain: true, hotkey: 'c', dim: true }),
      !drafting && ctx.draw.button(`plan:${plan.id}:feed`, 'What Happened', () => ctx.go({ name: 'plan-feed', params: { id: plan.id } }), { plain: true, hotkey: 'h', dim: true }),
      ctx.draw.button(`plan:${plan.id}:more`, 'More', () => ctx.go({ name: 'plan-more', params: { id: plan.id } }), { plain: true, hotkey: MORE_KEY, dim: true }),
    ]),
    body?.goal ? written(body.goal) : undefined,
    drafting ? draftingLine(ctx, plan) : outline(ctx, view),
  );
}

/** How the plan runs, a real decision: picking another says what changes before you switch. */
export function planModePage(ctx: Ctx, id: string, milestoneId: string | undefined): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  const milestone = milestoneId ? view.milestones.find((m) => m.milestone.id === milestoneId) : undefined;
  const scope = milestone ? `“${milestone.milestone.title}”` : `“${planTitle(plan)}”`;
  const current = milestone ? milestone.autonomy : plan.autonomy;
  const [mode, setMode] = ctx.local<Autonomy>(`plan:${plan.id}:mode:${milestoneId ?? ''}`, current);
  const mixed = !milestone && plan.body?.milestones.some((m) => m.autonomy && m.autonomy !== plan.autonomy);
  const change = mode !== current || mixed ? modeChange(view, mode) : undefined;
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([title('How It Runs'), dim(`${scope} runs on ${AUTONOMY_INFO[current].label} now. Pick how it runs from here on.`)]),
    autonomyRows(ctx, `plan-mode:${plan.id}`, mode, (a) => setMode(a)),
    change ? col([text(change.from), change.now ? text(change.now, { weight: 'semibold' }) : undefined]) : dim(`${AUTONOMY_INFO[current].hint}.`),
    change &&
      ctx.draw.button(`plan-mode:${plan.id}:switch`, change.title, async () => {
        await ctx.call('plans.setAutonomy', plan.id, mode, ...(milestoneId ? [milestoneId] : []));
        ctx.effect({ toast: `Runs on ${AUTONOMY_INFO[mode].label} now` });
        ctx.nav.back(ctx.pane);
      }, { primary: true, hotkey: MAIN_KEY }),
  );
}

/** Not yet: what a milestone still needs. The plan's agent adds the work for it. */
export function planSendBackPage(ctx: Ctx, id: string, milestoneId: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const named = shownBody(plan)?.milestones.find((m) => m.id === milestoneId)?.title ?? 'this milestone';
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([title(`Not Yet: ${named}`), dim('Say what’s missing. Your agent adds the tasks that fix it to this milestone, for you to approve.')]),
    ctx.draw.input(
      `plan-send-back:${milestoneId}`,
      async (value) => {
        const note = value?.trim();
        if (!note) return;
        await ctx.call('plans.sendBack', plan.id, milestoneId, note);
        ctx.nav.back(ctx.pane);
      },
      { label: 'What’s missing', rows: 4, placeholder: 'Refunds work, but the admin doesn’t show partial refunds yet.', submitLabel: 'send to your agent', autoFocus: true },
    ),
  );
}

/** A milestone's gate: what passes it, how the agent's check went, and what you can do about it. */
export function planGatePage(ctx: Ctx, id: string, milestoneId: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  const m = view.milestones.find((x) => x.milestone.id === milestoneId);
  if (!m) return subPage(ctx, 'plans', planTitle(plan), empty('That milestone is gone.'));
  const info = MILESTONE_STATE[m.state];
  const check = m.run.check;
  const yours = plan.body && !plan.draft && (m.state === 'gate' || m.state === 'checking' || m.state === 'failed');
  const conflict = m.merging?.conflict;
  const failed = m.run.mergeFailed;
  const editOp = (patch: Record<string, unknown>): Promise<unknown> => ctx.call('plans.edit', plan.id, [{ op: 'update_milestone', id: m.milestone.id, ...patch }]);
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([dim(`Milestone ${m.index + 1}`), title(m.milestone.title), line(span(info.label, toneStyle(info.tone)), span(`  ${m.finished}/${m.total} tasks finished`, { dim: true }))]),
    yours &&
      row([
        ctx.draw.button(`gate:${m.milestone.id}:pass`, m.state === 'failed' || m.state === 'checking' ? 'Pass Anyway' : failed ? 'Pass Again' : 'Pass Milestone', () => ctx.call('plans.pass', plan.id, m.milestone.id), { primary: true, hotkey: MAIN_KEY }),
        ctx.draw.button(`gate:${m.milestone.id}:not-yet`, 'Not Yet', () => ctx.go({ name: 'plan-send-back', params: { id: plan.id, milestone: m.milestone.id } }), { plain: true }),
        (m.state === 'checking' || m.state === 'failed') && ctx.draw.button(`gate:${m.milestone.id}:recheck`, 'Check Again', () => ctx.call('plans.recheck', plan.id, m.milestone.id), { plain: true, dim: true }),
      ]),
    m.state === 'merging' &&
      col([
        text(conflict ? (conflict.stuck ? 'Merge conflict: needs you' : 'Merge conflict: your agent is fixing it') : `Merging into ${plan.branch ?? 'the plan’s branch'}`),
        conflict ? dim(`Merging ${conflict.key ?? conflict.merging} into ${plan.branch}. ${conflict.stuck ? 'Your agent couldn’t fix it: ask it again, or fix the files yourself in their folder (the merge is committed once no conflict markers are left).' : 'The milestone passes once it’s fixed.'}`) : dim('Its tasks’ work is going into the plan’s branch now; it passes once that’s in.'),
        conflict && dim(conflict.files.join(', ')),
        conflict &&
          row([
            conflict.stuck && ctx.draw.button(`gate:${m.milestone.id}:ask-again`, `Ask ${agentName(myAgent(ctx))} Again`, async () => {
              await ctx.call('plans.retryConflicts', plan.id);
              ctx.effect({ toast: 'Your agent is on the conflict again' });
            }, { plain: true }),
            ctx.draw.button(`gate:${m.milestone.id}:show`, 'Show in Finder', () => ctx.call('plans.showConflict', plan.id), { plain: true, dim: true }),
          ]),
      ]),
    failed && !m.run.passedAt && m.state !== 'merging' && col([text(`Couldn’t merge into ${plan.branch ?? 'the plan’s branch'}`, { color: 'error' }), dim(failed.reason), dim('Fix that, then pass it again: nothing was merged.')]),
    m.milestone.goal ? col([text('Goal', { weight: 'semibold' }), written(m.milestone.goal)]) : undefined,
    col([
      text('Passes when', { weight: 'semibold' }),
      m.milestone.criteria.length ? col(m.milestone.criteria.map((c) => line(span(m.state === 'passed' ? '[x] ' : '[ ] ', { dim: true }), c))) : dim('No criteria: you pass it when its tasks are done.'),
    ]),
    check && col([text(check.verdict === 'pass' ? 'The agent’s check: passes' : 'The agent’s check: not yet', { weight: 'semibold' }), written(check.notes)]),
    ctx.draw.button(`gate:${m.milestone.id}:runs`, `Runs on ${AUTONOMY_INFO[m.autonomy].label}`, () => ctx.go({ name: 'plan-mode', params: { id: plan.id, milestone: m.milestone.id } }), { plain: true, dim: true }),
    ctx.draw.input(`gate:${m.milestone.id}:rename`, (value) => (value?.trim() && value.trim() !== m.milestone.title ? editOp({ title: value.trim() }) : undefined), { label: 'Name', value: m.milestone.title, submitLabel: 'rename' }),
    ctx.draw.input(`gate:${m.milestone.id}:criteria`, (value) => editOp({ criteria: (value ?? '').split('\n').map((c) => c.trim()).filter(Boolean) }), { label: 'Passes when: one to a line', value: m.milestone.criteria.join('\n'), rows: 3, submitLabel: 'save' }),
    asking(ctx, `gate:${m.milestone.id}:remove`, {
      label: 'Remove Milestone',
      question: `Remove “${m.milestone.title}”?`,
      detail: plan.body ? 'Its tasks are taken out of the plan (unfinished ones are canceled on the board).' : 'Its tasks go with it.',
      confirm: 'Remove',
      danger: true,
      run: async () => {
        await ctx.call('plans.edit', plan.id, [{ op: 'remove_milestone', id: m.milestone.id }]);
        ctx.nav.back(ctx.pane);
      },
    }),
  );
}

/** A task of the plan: its goal, its criteria, what it waits on, where it runs, and what you can do about it. */
export function planTaskPage(ctx: Ctx, id: string, taskId: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  const all = view.milestones.flatMap((m) => m.tasks);
  const t = all.find((x) => x.task.id === taskId);
  if (!t) return subPage(ctx, 'plans', planTitle(plan), empty('That task was taken out of the plan.'));
  const info = taskWords(t, Date.now());
  const canStart = startableIn(view).has(t.task.id);
  const canResume = Boolean(t.worktree) && (t.state === 'idle' || t.state === 'stalled');
  const onBoard = criteria(t.issue?.brief.acceptance);
  const checks = onBoard.length ? onBoard : t.task.acceptance.map((words) => ({ text: words, state: 'open' as const, reason: undefined }));
  const others = (shownBody(plan)?.milestones ?? []).filter((m) => m.id !== t.milestoneId);
  const edit = (ops: readonly Record<string, unknown>[]): Promise<unknown> => ctx.call('plans.edit', plan.id, ops);
  const worktree = t.worktree;
  const waits = (shownBody(plan)?.milestones ?? []).flatMap((m) => m.tasks).filter((x) => x.id !== t.task.id);
  const proof = t.issue ? taskProof(t.issue) : [];
  const waitList = windowed(ctx, `plan-task:${t.task.id}:waits`, waits);
  const proofList = windowed(ctx, `plan-task:${t.task.id}:proof`, proof, 20);
  const main = canStart && t.forYou
    ? ctx.draw.button(`plan-task:${t.task.id}:decide`, 'Decide', () => openHome(ctx, plan), { primary: true, hotkey: MAIN_KEY })
    : canStart
      ? ctx.draw.button(`plan-task:${t.task.id}:start`, 'Start', () => ctx.call('plans.startTask', plan.id, t.task.id), { primary: true, hotkey: MAIN_KEY })
      : canResume
        ? ctx.draw.button(`plan-task:${t.task.id}:resume`, 'Resume', () => ctx.call('plans.resumeTask', plan.id, t.task.id), { primary: true, hotkey: MAIN_KEY })
        : t.state === 'asking' && worktree
          ? ctx.draw.button(`plan-task:${t.task.id}:answer`, 'Answer', () => openWorkspace(ctx, worktree), { primary: true, hotkey: MAIN_KEY })
          : undefined;
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([dim(t.issue?.key ?? 'Task'), title(t.task.title), line(span(info.label, toneStyle(info.tone)), t.forYou ? span('  For you', { dim: true }) : undefined)]),
    info.sub && t.pulse ? dim(t.pulse.kind === 'working' || t.pulse.kind === 'command' ? `Now: ${info.sub}` : info.sub) : t.step && t.state === 'running' ? dim(`Now: ${t.step}`) : undefined,
    t.why && (t.state === 'blocked' || t.state === 'later') ? dim(t.why) : undefined,
    main,
    row([
      canStart && !t.forYou && ctx.draw.button(`plan-task:${t.task.id}:start-with`, 'Start with Another Agent', () => ctx.go({ name: 'plan-task-with', params: { id: plan.id, task: t.task.id } }), { plain: true, dim: true }),
      worktree && t.state !== 'asking' && ctx.draw.button(`plan-task:${t.task.id}:open`, canResume ? 'Open Chat' : 'Open Worktree', () => openWorkspace(ctx, worktree), { plain: true }),
      t.issue && ctx.draw.button(`plan-task:${t.task.id}:board`, 'Open Task', () => ctx.go({ name: 'task', params: { id: t.issue?.id ?? '' } }), { plain: true, dim: true }),
    ]),
    t.task.goal ? col([text('Goal', { weight: 'semibold' }), written(t.task.goal)]) : undefined,
    checks.length > 0 &&
      col([
        text('Done when', { weight: 'semibold' }),
        ...checks.map((c) => line(span(c.state === 'done' ? '[x] ' : c.state === 'deferred' ? '[~] ' : c.state === 'not_done' ? '[-] ' : '[ ] ', { dim: true }), c.text, c.reason ? span(`  ${c.state === 'deferred' ? 'Deferred' : 'Not done'}: ${c.reason}`, { dim: true }) : undefined)),
      ]),
    t.task.touches?.length ? col([text('Changes', { weight: 'semibold' }), dim(t.task.touches.join(', '))]) : undefined,
    proof.length > 0 && col([text('Proof', { weight: 'semibold' }), proofList.earlier, ...proofList.rows.map((p) => (p.url ? webLink(p.url, p.title) : line(p.title))), proofList.more]),
    t.task.context ? col([text('Context', { weight: 'semibold' }), written(t.task.context)]) : undefined,
    waits.length > 0 && field('Waits on', waitList.earlier, ...waitList.rows.map((x) => ctx.draw.button(`plan-task:${t.task.id}:waits:${x.id}`, `${t.task.blockedBy.includes(x.id) ? '[x]' : '[ ]'} ${x.title}`, () => edit([{ op: 'block', id: t.task.id, by: x.id, on: !t.task.blockedBy.includes(x.id) }]), { plain: true, ...(t.task.blockedBy.includes(x.id) ? {} : { dim: true }) })), waitList.more),
    others.length > 0 && field('Move to', row(others.map((m) => ctx.draw.button(`plan-task:${t.task.id}:move:${m.id}`, m.title, () => edit([{ op: 'move_task', id: t.task.id, milestone: m.id }]), { plain: true, dim: true })))),
    ctx.draw.input(`plan-task:${t.task.id}:rename`, (value) => (value?.trim() && value.trim() !== t.task.title ? edit([{ op: 'update_task', id: t.task.id, patch: { title: value.trim() } }]) : undefined), { label: 'Name', value: t.task.title, submitLabel: 'rename' }),
    ctx.draw.button(`plan-task:${t.task.id}:who`, t.task.assignee === 'me' ? 'Give It to the Agent' : 'I’ll Do It Myself', () => edit([{ op: 'update_task', id: t.task.id, patch: { assignee: t.task.assignee === 'me' ? 'claude' : 'me' } }]), { plain: true }),
    asking(ctx, `plan-task:${t.task.id}:remove`, {
      label: 'Take Out of the Plan',
      question: `Take “${t.task.title}” out of the plan?`,
      confirm: 'Take Out',
      danger: true,
      run: async () => {
        await edit([{ op: 'remove_task', id: t.task.id }]);
        ctx.nav.back(ctx.pane);
      },
    }),
  );
}

/** Start with another agent, this start only. */
export function planTaskWithPage(ctx: Ctx, id: string, taskId: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const t = viewOf(ctx, plan).milestones.flatMap((m) => m.tasks).find((x) => x.task.id === taskId);
  if (!t) return subPage(ctx, 'plans', planTitle(plan), empty('That task was taken out of the plan.'));
  const own = t.issue?.agent ?? plan.agent;
  return subPage(
    ctx,
    'plans',
    t.task.title,
    col([title('Start with Another Agent'), dim('For this start only.')]),
    ...agentRows(ctx, `plan-task-with:${t.task.id}`, own, async (agent) => {
      await ctx.call('plans.startTask', plan.id, t.task.id, agent ?? myAgent(ctx));
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** Who works the plan's milestones and tasks from here on; those at work keep theirs. */
export function planAgentPage(ctx: Ctx, id: string, approving: boolean): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([title(approving ? 'Approve, Worked By' : 'Agent for Its Work'), dim('Who works the milestones and tasks that start from now on. Those at work keep theirs.')]),
    ...agentRows(ctx, `plan-agent:${plan.id}`, plan.agent, async (agent: AgentRef | undefined) => {
      const said = await ctx.call('plans.setWorkAgent', plan.id, agent ?? null);
      if (approving) {
        await ctx.call('plans.approve', plan.id);
        ctx.effect({ toast: 'Plan approved: its tasks are on the board' });
      } else if (typeof said === 'string') ctx.effect({ toast: said });
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** The plan as Markdown, to paste somewhere. */
function markdownOf(view: PlanView): string {
  const body = shownBody(view.plan);
  if (!body) return '';
  const lines = [`# ${body.title}`, '', body.goal, ''];
  for (const m of view.milestones) {
    lines.push(`## ${m.index + 1}. ${m.milestone.title}`, '');
    if (m.milestone.goal) lines.push(m.milestone.goal, '');
    for (const t of m.tasks) lines.push(`- [${t.state === 'done' ? 'x' : ' '}] ${t.issue ? `${t.issue.key} ` : ''}${t.task.title}${t.task.blockedBy.length ? ` (after ${t.task.blockedBy.join(', ')})` : ''}`);
    if (m.milestone.criteria.length) lines.push('', '**Passes when:**', ...m.milestone.criteria.map((c) => `- ${c}`));
    lines.push('');
  }
  return lines.join('\n');
}

const RUN_AT_ONCE = [1, 2, 3, 4, 6, MAX_PARALLEL] as const;

/** Everything else about a plan, out of the way. */
export function planMorePage(ctx: Ctx, id: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  const { next } = view;
  const step = planStep(ctx, plan.id);
  const who = agentName(myAgent(ctx));
  const pr = plan.pr;
  const conflictWaits = Boolean(plan.mainMerge?.conflict?.stuck || Object.values(plan.merging ?? {}).some((m) => m.conflict?.stuck));
  const conflictHere = Boolean(plan.mainMerge?.conflict || Object.values(plan.merging ?? {}).some((m) => m.conflict) || Object.values(plan.combining ?? {}).some((c) => c.conflict));
  const ship = next.kind === 'ship' ? shipAction(plan, next.pr) : undefined;
  const merge = (): Promise<void> => step.run(`merge #${pr?.number} on GitHub`, 'Merging...', () => ctx.call('plans.mergePr', plan.id, {}), `Merged #${pr?.number}: the plan’s tasks are Done`);
  const body = shownBody(plan);
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    title(planTitle(plan)),
    ctx.draw.input(`more:${plan.id}:rename`, (value) => (value?.trim() && value.trim() !== planTitle(plan) ? ctx.call('plans.edit', plan.id, [{ op: 'retitle', title: value.trim() }]) : undefined), { label: 'Name', value: planTitle(plan), submitLabel: 'rename' }),
    plan.body && plan.status === 'active' && ctx.draw.button(`more:${plan.id}:pause`, plan.paused ? 'Resume' : 'Pause', () => ctx.call('plans.setPaused', plan.id, !plan.paused), { plain: true }),
    next.kind === 'approve' && body?.milestones.length ? ctx.draw.button(`more:${plan.id}:approve-with`, 'Approve, Worked by Another Agent', () => ctx.go({ name: 'plan-agent', params: { id: plan.id, then: 'approve' } }), { plain: true }) : undefined,
    field('Run at once', choices(ctx, `more:${plan.id}:parallel`, RUN_AT_ONCE.map((n) => ({ value: String(n), label: `${n}` })), String(plan.maxParallel), (n) => ctx.call('plans.setParallel', plan.id, Number(n)))),
    plan.status !== 'done' && ctx.draw.button(`more:${plan.id}:agent`, `Agent for Its Work: ${plan.agent ? agentName(plan.agent, { model: true }) : `your agent (${who})`}`, () => ctx.go({ name: 'plan-agent', params: { id: plan.id } }), { plain: true }),
    field(
      'When to run tests',
      choices(ctx, `more:${plan.id}:tests`, TESTS_AT.map((t) => ({ value: t, label: TESTS_AT_INFO[t].label })), plan.testsAt, async (t) => {
        await ctx.call('plans.setTestsAt', plan.id, t);
        ctx.effect({ toast: t === 'end' ? 'From now on, milestone checks skip the test suites; they all run once, in the final step' : 'From now on, each milestone’s check runs the full suites once, on its combined work' });
      }),
      dim(`${TESTS_AT_INFO[plan.testsAt].hint}.`),
    ),
    next.kind === 'stalled' ? col(next.tasks.flatMap((t) => (t.worktree ? [ctx.draw.button(`more:${t.task.id}:chat`, `Open ${t.issue?.key ?? 'Its'} Chat`, () => openWorkspace(ctx, t.worktree ?? ''), { plain: true })] : []))) : undefined,
    next.kind === 'pass' ? ctx.draw.button(`more:${plan.id}:not-yet`, 'Not Yet', () => ctx.go({ name: 'plan-send-back', params: { id: plan.id, milestone: next.milestone.milestone.id } }), { plain: true }) : undefined,
    next.kind === 'failed' || next.kind === 'checking' ? ctx.draw.button(`more:${plan.id}:recheck`, 'Check Again', () => ctx.call('plans.recheck', plan.id, next.milestone.milestone.id), { plain: true }) : undefined,
    next.kind === 'failed' || next.kind === 'checking' ? ctx.draw.button(`more:${plan.id}:pass-anyway`, 'Pass Anyway', () => ctx.call('plans.pass', plan.id, next.milestone.milestone.id), { plain: true }) : undefined,
    ship?.kind === 'wait' && ctx.draw.button(`more:${plan.id}:merge-now`, 'Merge Now', merge, { plain: true }),
    next.kind === 'ship' && next.pr?.state === 'OPEN' && !next.pr.conflicts && !plan.mainMerge ? ctx.draw.button(`more:${plan.id}:bring-main`, 'Bring Main In', () => step.run(`bring main into ${next.branch}`, 'Bringing Main In...', () => ctx.call('plans.bringInMain', plan.id), `Main is in ${next.branch}`), { plain: true }) : undefined,
    next.kind === 'ship'
      ? asking(ctx, `more:${plan.id}:merge-local`, {
          label: 'Merge into Main Locally',
          question: `Merge ${next.branch} into main here?`,
          detail: 'The main folder must be on main with no uncommitted changes. The plan’s tasks go to Done.',
          confirm: 'Merge',
          run: () => step.run(`merge ${next.branch} into main here`, 'Merging...', () => ctx.call('plans.mergeLocal', plan.id), 'Merged into main: the plan’s tasks are Done'),
        })
      : undefined,
    conflictWaits && ctx.draw.button(`more:${plan.id}:ask-again`, `Ask ${who} Again`, () => step.run(`ask ${who} to fix the conflict again`, `Asking ${who}...`, () => ctx.call('plans.retryConflicts', plan.id), `${who} is on the conflict again`), { plain: true }),
    conflictHere && ctx.draw.button(`more:${plan.id}:show-conflict`, 'Show Conflict in Finder', () => ctx.call('plans.showConflict', plan.id), { plain: true }),
    plan.body && !plan.draft && ctx.draw.button(`more:${plan.id}:branch`, plan.branch ?? 'Where the Work Goes', () => ctx.go({ name: 'plan-branch', params: { id: plan.id } }), { plain: true, ...(plan.branch ? { spans: [span('Where the Work Goes  ', {}), span(plan.branch, { dim: true })] } : {}) }),
    ctx.draw.button(`more:${plan.id}:copy`, 'Copy as Markdown', () => ctx.effect({ copy: markdownOf(view), toast: 'Copied' }), { plain: true }),
    ctx.draw.button(`more:${plan.id}:style`, 'Planning Style', () => ctx.go({ name: 'plan-style' }), { plain: true }),
    plan.draft &&
      asking(ctx, `more:${plan.id}:discard`, {
        label: plan.body ? 'Discard Changes' : 'Discard Draft',
        question: plan.body ? 'Discard the proposed changes?' : 'Discard this draft?',
        detail: plan.body ? 'The plan stays as you approved it.' : 'Nothing was put on the board, so nothing else changes.',
        confirm: 'Discard',
        danger: true,
        run: async () => {
          await ctx.call('plans.discard', plan.id);
          if (!plan.body) {
            pickProject(ctx, plan.projectId);
            ctx.go({ name: 'plans' });
          }
        },
      }),
    plan.body &&
      asking(ctx, `more:${plan.id}:remove`, {
        label: 'Delete Plan',
        question: `Delete “${planTitle(plan)}”?`,
        detail: 'Its tasks stay on the board; only the plan goes.',
        confirm: 'Delete',
        danger: true,
        run: async () => {
          await ctx.call('plans.remove', plan.id);
          pickProject(ctx, plan.projectId);
          ctx.go({ name: 'plans' });
        },
      }),
  );
}

/** What the plan did, newest first. */
export function planFeedPage(ctx: Ctx, id: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const items = feedOf(plan.activity);
  const list = windowed(ctx, `plan:${plan.id}:feed`, items, 40);
  const self = ctx.state.selfId;
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    title('What Happened'),
    items.length === 0 && empty('Nothing has happened yet. What the plan does shows here.'),
    list.earlier,
    ...list.rows.map((e) => line(span(actorName(e.by, self), { weight: 'semibold' }), ` ${e.text}`, e.count > 1 && e.texts.every((x) => x === e.texts[0]) ? span(` ×${e.count}`, { dim: true }) : undefined, span(`  ${ago(e.at)}`, { dim: true }))),
    list.more,
  );
}

const FLOW_STATE = { done: 'Done', active: 'Now', waiting: 'Not yet', problem: 'Needs you', later: 'Later' } as const;

/** Where the plan's work goes: each milestone into its branch, the branch into main as one pull request. */
export function planBranchPage(ctx: Ctx, id: string): Node {
  const plan = planIn(ctx, id);
  if (!plan) return gone(ctx);
  const view = viewOf(ctx, plan);
  return subPage(
    ctx,
    'plans',
    planTitle(plan),
    col([title('Where the Work Goes'), dim(plan.branch ? `Each milestone merges into ${plan.branch} when it passes; at the end, one pull request takes it into main.` : 'Without a branch of its own, each task’s work goes to main on its own.')]),
    ...branchFlow(view).map((s) =>
      col([
        line(span(s.label, { weight: 'semibold' }), span(`  ${FLOW_STATE[s.state]}`, s.state === 'done' ? { color: 'success' } : s.state === 'problem' ? { color: 'error' } : s.state === 'active' ? { color: 'claude' } : { dim: true })),
        dim(s.detail),
      ]),
    ),
  );
}
