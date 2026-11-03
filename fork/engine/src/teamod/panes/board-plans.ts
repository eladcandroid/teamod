import { AUTONOMIES, AUTONOMY_INFO, type Autonomy, DEFAULT_AUTONOMY, type Plan, TESTS_AT, TESTS_AT_INFO, type TestsAt, planTitle } from '../../core/plans/model.js';
import { type Live, liveFrom, planView } from '../../core/plans/progress.js';
import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, line, row, span, title } from '../tree.js';
import { agentRows, choices, field, leadOn, myAgent, projectHere, projectSwitch, prop, subPage, top, windowed } from './board-common.js';
import { type Tone as PlanTone, nextWords, planStatus, plansOf, toneStyle } from './board-plan-words.js';
import { type Tone, ago, card, empty, meta, page, section } from './common.js';

/** A plan's, a milestone's or a task's state as a pill: a dot and its words, in its tone. */
export const planPill = (label: string, tone: PlanTone): Span => span(`● ${label}`, toneStyle(tone));

/** A card's border: only what waits for you or went wrong stands out. */
export const planCardTone = (tone: PlanTone): Tone | undefined => (tone === 'accent' || tone === 'warn' ? 'warn' : tone === 'error' ? 'error' : undefined);

/** A plan as a card: its name (a press opens it), how it is, and what it waits for. */
const planCard = (ctx: Ctx, plan: Plan, live: Live): Node => {
  const view = planView(plan, ctx.state.board, live);
  const status = planStatus(view);
  const next = nextWords(view.next);
  const sub = plan.body ? (next.detail ? `${next.title} · ${next.detail}` : next.title) : `${view.milestones.length} milestone${view.milestones.length === 1 ? '' : 's'} · ${view.total} task${view.total === 1 ? '' : 's'} · draft`;
  const tone = planCardTone(status.tone);
  return card(
    [
      ctx.draw.button(`plan:${plan.id}`, planTitle(plan), () => ctx.go({ name: 'plan', params: { id: plan.id } }), { plain: true, spans: [span(planTitle(plan), { weight: 'bold' })] }),
      meta(planPill(status.label, status.tone), ago(plan.updatedAt)),
      dim(sub),
    ],
    tone ? { tone } : {},
  );
};

/** Plans: one project's at a time. Each is a card with how far it got and what it waits for. */
export function plansPage(ctx: Ctx): Node {
  const state = ctx.state.plans;
  if (!state.enabled) return page(top(ctx, 'plans'), empty('Plans are off: the engine isn’t running them.'));
  const { projects, here } = projectHere(ctx);
  if (!here) return page(top(ctx, 'plans'), empty('No projects yet. Plans belong to a project: add one in Work.'));
  const plans = plansOf(state, here.id);
  const list = windowed(ctx, `plans:${here.id}`, plans);
  const live = liveFrom(ctx.state);
  return page(
    top(ctx, 'plans'),
    row([projectSwitch(ctx, projects, here), ctx.draw.button('plans:new', 'New Plan', () => ctx.go({ name: 'plan-new', params: { project: here.id } }), { primary: true, hotkey: 'n' })], { justify: 'space-between' }),
    plans.length === 0 && empty(`No plans in ${here.name} yet. Say what you want built: your agent reads the code and cuts it into milestones and tasks that run side by side, each with what proves it’s done. You talk it through; nothing reaches the board until you approve.`),
    plans.length > 0 && section('Plans', [col([list.earlier, ...list.rows.map((plan) => planCard(ctx, plan, live)), list.more], { gap: 1 })], plans.length),
    ctx.draw.button('plans:style', 'Planning Style', () => ctx.go({ name: 'plan-style' }), { plain: true, dim: true, hotkey: 'y' }),
  );
}

export const autonomyRows = (ctx: Ctx, key: string, current: Autonomy | undefined, pick: (a: Autonomy) => unknown): Node =>
  col(AUTONOMIES.map((a) => ctx.draw.button(`${key}:${a}`, AUTONOMY_INFO[a].label, () => pick(a), { plain: true, spans: [span(a === current ? '● ' : '○ ', a === current ? { color: 'claude' } : { dim: true }), span(AUTONOMY_INFO[a].label, a === current ? { weight: 'bold' } : {}), span(`  ${AUTONOMY_INFO[a].summary}`, { dim: true })] })));

/** A new plan: what it's for and how far it runs on its own. Your agent plans from it, reading the code. */
export function newPlanPage(ctx: Ctx): Node {
  const { here } = projectHere(ctx);
  if (!here) return subPage(ctx, 'plans', 'Plans', empty('Plans belong to a project. Add a project in Work first.'));
  const [autonomy, setAutonomy] = ctx.local<Autonomy>('plan-new:autonomy', DEFAULT_AUTONOMY);
  const [testsAt, setTestsAt] = ctx.local<TestsAt>('plan-new:tests', 'milestone');
  const [agent, setAgent] = ctx.local<AgentRef | null>('plan-new:agent', null);
  const [draft, setDraft] = ctx.local('plan-new:goal', '');
  return subPage(
    ctx,
    'plans',
    'Plans',
    col([title(`Plan in ${here.name}`), dim('Say what you want built. Your agent reads the code and cuts it into milestones and tasks; you talk it through, and nothing reaches the board until you approve.')]),
    ctx.draw.input(
      'plan-new:goal',
      async (value) => {
        const goal = value?.trim();
        if (!goal) return;
        setDraft(goal);
        const plan = (await ctx.call('plans.create', { projectId: here.id, goal, autonomy, testsAt, ...(agent ? { agent } : {}) })) as Plan | undefined;
        setDraft('');
        setAgent(null);
        if (plan) leadOn(ctx, 'plan-new', { name: 'plan', params: { id: plan.id } });
        else ctx.nav.back(ctx.pane);
      },
      { label: 'Goal', value: draft, rows: 6, placeholder: 'Let customers pay by card: a checkout page, webhooks that never double-charge, and refunds from the admin. Done when a test card goes through end to end.', submitLabel: 'plan with your agent', autoFocus: true },
    ),
    card(
      [
        col(
          [
            field('How it runs', autonomyRows(ctx, 'plan-new:autonomy', autonomy, (a) => setAutonomy(a))),
            field('When to run tests', choices(ctx, 'plan-new:tests', TESTS_AT.map((t) => ({ value: t, label: TESTS_AT_INFO[t].label })), testsAt, (t) => setTestsAt(t)), dim(`${TESTS_AT_INFO[testsAt].hint}.`)),
            prop(ctx, 'plan-new:agent', 'Agent', agent ? agentName(agent, { model: true }) : `Your agent (${agentName(myAgent(ctx))})`, () => ctx.go({ name: 'plan-new-agent', params: { project: here.id } })),
          ],
          { gap: 1 },
        ),
      ],
      { title: 'Details' },
    ),
    ctx.draw.button('plan-new:here', 'Plan in a Conversation You Have Open', () => ctx.go({ name: 'plan-here', params: { project: here.id } }), { plain: true, dim: true }),
  );
}

/** Who works a new plan's milestones and tasks: each worktree runs this agent and model. */
export function newPlanAgentPage(ctx: Ctx): Node {
  const [agent, setAgent] = ctx.local<AgentRef | null>('plan-new:agent', null);
  return subPage(
    ctx,
    'plans',
    'New Plan',
    col([title('Agent'), dim('Who works its milestones and tasks: each worktree runs this agent and model.')]),
    ...agentRows(ctx, 'plan-new-agent', agent ?? undefined, (picked) => {
      setAgent(picked ?? null);
      ctx.nav.back(ctx.pane);
    }),
  );
}

/** Plan with Tasks: your agent plans in a conversation you already have, from what you say next there. */
export function planHerePage(ctx: Ctx): Node {
  const { here } = projectHere(ctx);
  if (!here) return subPage(ctx, 'plans', 'New Plan', empty('Plans belong to a project. Add a project in Work first.'));
  const [autonomy] = ctx.local<Autonomy>('plan-new:autonomy', DEFAULT_AUTONOMY);
  const open = here.workspaces.filter((w) => !w.archived && !w.pending);
  const list = windowed(ctx, `plan-here:${here.id}`, open);
  return subPage(
    ctx,
    'plans',
    'New Plan',
    col([title('Plan in a Conversation'), dim('Your agent plans there: an empty draft, written from what you say next in that conversation.')]),
    open.length === 0 && empty(`Nothing open in ${here.name}.`),
    open.length > 0 &&
      card([
        list.earlier,
        ...list.rows.map((ws) =>
          ctx.draw.button(
            `plan-here:${ws.id}`,
            ws.name,
            async () => {
              const plan = (await ctx.call('plans.here', `ws:${ws.id}`, autonomy)) as Plan | undefined;
              if (plan) leadOn(ctx, 'plan-here', { name: 'plan', params: { id: plan.id } });
            },
            { plain: true },
          ),
        ),
        list.more,
      ]),
  );
}

/** How you like plans cut: added to your agent's planning instructions every time. */
export function planStylePage(ctx: Ctx): Node {
  return subPage(
    ctx,
    'plans',
    'Plans',
    col([title('Planning Style'), dim('How you like plans cut: task size, when to add a review, what every milestone must prove. Your agent follows it whenever it plans.')]),
    ctx.draw.input(
      'plan-style:style',
      async (value) => {
        await ctx.call('plans.setStyle', value ?? '');
        ctx.effect({ toast: 'Planning style saved' });
        ctx.nav.back(ctx.pane);
      },
      { value: ctx.state.plans.style, rows: 9, placeholder: 'Tasks are at most a day of work. Every milestone ends with screenshots of what changed. Tests before code.', submitLabel: 'save', autoFocus: true },
    ),
    line(span('Markdown.', { dim: true })),
  );
}
