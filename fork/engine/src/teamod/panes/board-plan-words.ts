import type { Actor } from '../../core/board/model.js';
import { AUTONOMY_INFO, type Autonomy, type Plan, type PlanBody, type PlanEvent, type PlanPr, type PlansState, diffBodies, milestoneDeps } from '../../core/plans/model.js';
import type { MilestoneState, MilestoneView, NextStep, PlanView, TaskState, TaskView } from '../../core/plans/progress.js';
import { pulseWords } from '../../core/plans/watchdog.js';
import type { Span } from '../tree.js';

/**
 * The Plans screens' words: what a plan, a milestone and a task are at, what a plan waits for, and
 * how its last step goes. Pure. The Mac app has these for itself in its own package.
 */

export type Tone = 'muted' | 'neutral' | 'claude' | 'info' | 'ok' | 'warn' | 'error' | 'accent';

/** A tone as the surface's theme says it. */
export function toneStyle(tone: Tone): Omit<Span, 't'> {
  switch (tone) {
    case 'muted':
      return { dim: true };
    case 'claude':
      return { color: 'claude' };
    case 'ok':
      return { color: 'success' };
    case 'warn':
    case 'accent':
      return { color: 'warning' };
    case 'error':
      return { color: 'error' };
    default:
      return {};
  }
}

export const TASK_STATE: Readonly<Record<TaskState, { readonly label: string; readonly tone: Tone }>> = {
  draft: { label: 'Draft', tone: 'muted' },
  later: { label: 'Later', tone: 'muted' },
  blocked: { label: 'Waiting', tone: 'muted' },
  ready: { label: 'Ready', tone: 'accent' },
  running: { label: 'Working', tone: 'claude' },
  asking: { label: 'Waiting for you', tone: 'warn' },
  idle: { label: 'Stopped without finishing', tone: 'warn' },
  stalled: { label: 'Needs you', tone: 'warn' },
  review: { label: 'In review', tone: 'info' },
  planned: { label: 'Merged into plan', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
  canceled: { label: 'Canceled', tone: 'muted' },
  missing: { label: 'Deleted', tone: 'muted' },
};

export const MILESTONE_STATE: Readonly<Record<MilestoneState, { readonly label: string; readonly tone: Tone }>> = {
  draft: { label: 'Draft', tone: 'muted' },
  later: { label: 'Up next', tone: 'muted' },
  running: { label: 'In progress', tone: 'claude' },
  checking: { label: 'Agent is checking', tone: 'claude' },
  gate: { label: 'Ready to pass', tone: 'accent' },
  failed: { label: 'Check failed', tone: 'error' },
  merging: { label: 'Merging into the plan', tone: 'claude' },
  passed: { label: 'Passed', tone: 'ok' },
};

/** A milestone's status text: its state, plus when it runs. */
export function milestoneLabel(view: Pick<PlanView, 'milestones' | 'open'>, m: MilestoneView): string {
  const base = MILESTONE_STATE[m.state].label;
  const named = (id: string): string => `“${view.milestones.find((x) => x.milestone.id === id)?.milestone.title ?? id}”`;
  if (m.state === 'later') {
    const waits = m.dependsOn.filter((d) => view.milestones.find((x) => x.milestone.id === d)?.state !== 'passed');
    return waits.length ? `After ${waits.map(named).join(' and ')}` : base;
  }
  const beside = view.open.filter((x) => x.milestone.id !== m.milestone.id);
  if (!view.open.some((x) => x.milestone.id === m.milestone.id) || !beside.length) return base;
  return `${base} · alongside ${beside.length > 2 ? `${beside.length} others` : beside.map((x) => named(x.milestone.id)).join(' and ')}`;
}

/** How a plan is, in one word. */
export function planStatus(view: Pick<PlanView, 'plan' | 'next'>): { readonly label: string; readonly tone: Tone } {
  const { plan, next } = view;
  if (!plan.body) return { label: 'Draft', tone: 'muted' };
  if (plan.status === 'done' && !plan.draft) return next.kind === 'ship' ? { label: plan.pr?.state === 'CLOSED' ? 'PR closed' : plan.pr ? 'PR open' : 'Ready to ship', tone: plan.pr?.state === 'CLOSED' ? 'warn' : 'accent' } : { label: 'Done', tone: 'ok' };
  if (plan.draft) return { label: 'Changes proposed', tone: 'accent' };
  if (plan.paused) return { label: 'Paused', tone: 'muted' };
  switch (next.kind) {
    case 'pass':
    case 'start':
    case 'answer':
    case 'stalled':
      return { label: 'Waiting for you', tone: 'accent' };
    case 'failed':
      return { label: 'Needs a fix', tone: 'error' };
    case 'checking':
      return { label: 'Checking', tone: 'claude' };
    case 'merging':
      return next.milestone.merging?.conflict?.stuck ? { label: 'Waiting for you', tone: 'accent' } : { label: 'Merging', tone: 'claude' };
    case 'working':
      return { label: 'Running', tone: 'claude' };
    default:
      return { label: 'Waiting', tone: 'muted' };
  }
}

/** A task's state in words: a started one says how it's doing right now, never "working" when no turn runs. */
export function taskWords(t: TaskView, now: number): { readonly label: string; readonly tone: Tone; readonly sub?: string } {
  const base = TASK_STATE[t.state];
  if (!t.pulse || t.combining) return { ...base, ...(t.state === 'running' && t.step ? { sub: t.step } : t.state === 'blocked' || t.state === 'later' ? (t.why ? { sub: t.why } : {}) : {}) };
  const w = pulseWords(t.pulse, now);
  const sub = t.watch && !t.watch.needsYou && t.pulse.kind !== 'stopped' && t.pulse.kind !== 'waiting' ? `${w.sub ?? ''}${w.sub ? ' · ' : ''}${t.watch.line}` : w.sub;
  return { label: w.label, tone: w.tone, ...(sub ? { sub } : {}) };
}

/** The one thing to do next, in words. */
export function nextWords(next: NextStep): { readonly title: string; readonly detail?: string } {
  switch (next.kind) {
    case 'approve':
      return { title: 'Approve Plan', detail: 'Its tasks go on the board and the plan starts' };
    case 'review_changes':
      return { title: 'Apply Changes', detail: 'Your agent proposed changes to the plan' };
    case 'resume':
      return { title: 'Resume', detail: 'Paused: nothing starts until you resume it' };
    case 'start': {
      const yours = next.tasks.filter((t) => t.forYou);
      if (yours.length === next.tasks.length) return { title: yours.length === 1 ? `Answer “${yours[0]!.task.title}”` : `Answer ${yours.length} Decisions`, detail: 'Yours: answer in the plan’s conversation, and it carries on' };
      const agents = next.tasks.length - yours.length;
      return { title: agents === 1 ? `Start “${next.tasks.find((t) => !t.forYou)!.task.title}”` : `Start ${agents} Tasks`, detail: agents === 1 ? 'Ready to go' : 'Ready to go, side by side' };
    }
    case 'pass':
      return { title: `Pass “${next.milestone.milestone.title}”`, detail: next.milestone.run.check ? (next.milestone.run.check.verdict === 'pass' ? 'The agent checked it: every criterion holds' : 'The agent’s check found problems') : 'Every task is finished' };
    case 'checking':
      return { title: 'Agent is checking', detail: `The pass criteria of “${next.milestone.milestone.title}”` };
    case 'failed':
      return { title: 'Needs a fix', detail: `“${next.milestone.milestone.title}” didn’t pass the agent’s check` };
    case 'answer':
      return { title: 'Your agent asked something', detail: next.tasks.map((t) => t.issue?.key ?? t.task.title).join(', ') };
    case 'stalled':
      return { title: next.tasks.length === 1 ? `Resume ${next.tasks[0]!.issue?.key ?? `“${next.tasks[0]!.task.title}”`}` : `Resume ${next.tasks.length} Tasks`, detail: next.tasks.map((t) => t.watch?.line ?? `${t.issue?.key ?? t.task.title} stopped again`).join(' · ') };
    case 'working':
      return { title: next.tasks.length ? `${next.tasks.length} ${next.tasks.length === 1 ? 'task' : 'tasks'} in progress` : 'Starting...', ...(next.note ? { detail: next.note } : {}) };
    case 'waiting':
      return { title: 'Waiting', detail: next.why };
    case 'merging':
      return { title: next.text, detail: `“${next.milestone.milestone.title}” passes once its work is merged into the plan’s branch` };
    case 'ship':
      if (next.pr?.state === 'OPEN') return { title: `Pull request #${next.pr.number} is open`, detail: `${next.branch} → main: ${prWords(next.pr)}` };
      if (next.pr?.state === 'CLOSED') return { title: `Pull request #${next.pr.number} was closed`, detail: 'Closed without merging: the plan’s tasks stay merged into the plan' };
      return { title: 'Open PR', detail: `Every milestone passed: ${next.branch} has all the plan’s work` };
    case 'done':
      return { title: 'Done', detail: 'Every milestone passed' };
  }
}

/** A project's plans: running first, then drafts, then finished; newest first in each. */
export function plansOf(state: PlansState, projectId: string | undefined): Plan[] {
  const rank = (p: Plan): number => (p.status === 'active' ? 0 : p.status === 'draft' ? 1 : 2);
  return state.plans.filter((p) => p.projectId === projectId).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

/** Milestones in rows by what they wait on: milestones in one row run side by side (ids, in the plan's order). */
export function milestoneRows(body: PlanBody | undefined): ReadonlyArray<readonly string[]> {
  const ms = body?.milestones ?? [];
  const depth = new Map<string, number>();
  const of = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const m = ms.find((x) => x.id === id);
    if (!m || seen.has(id)) return 0;
    const d = Math.max(-1, ...milestoneDeps(body, m).map((x) => of(x, new Set([...seen, id])))) + 1;
    depth.set(id, d);
    return d;
  };
  const rows: string[][] = [];
  for (const m of ms) (rows[of(m.id, new Set())] ??= []).push(m.id);
  return rows.filter(Boolean);
}

// ---- the plan's one sentence

export type Who = 'you' | 'agent' | 'plan';

export interface Headline {
  readonly who: Who;
  readonly text: string;
}

const quoted = (m: MilestoneView): string => `“${m.milestone.title}”`;
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What's merging into the plan's branch now (a conflict first). */
function mergingLine(view: PlanView): Headline | undefined {
  const entries = Object.entries(view.plan.merging ?? {}).filter(([, m]) => !m.catchUp);
  const conflict = entries.find(([, m]) => m.conflict)?.[1].conflict;
  if (conflict) {
    const what = conflict.key ?? conflict.merging ?? 'the plan’s branch';
    return conflict.stuck ? { who: 'you', text: `Fix the merge conflict in ${what}${conflict.files.length ? ` (${conflict.files.slice(0, 2).join(', ')})` : ''}` } : { who: 'agent', text: `Fixing a merge conflict in ${what}` };
  }
  const first = entries[0];
  if (!first) return undefined;
  const m = view.milestones.find((x) => x.milestone.id === first[0]);
  return { who: 'plan', text: `Merging ${m ? quoted(m) : 'a milestone'} into ${view.plan.branch ?? 'the plan’s branch'}` };
}

/** The plan in one sentence, with who it's about: what waits for you, else what's being done. */
export function headline(view: PlanView): Headline {
  const { plan, next } = view;
  const running = view.active.filter((t) => t.state === 'running' || t.state === 'idle');
  const inMilestones = new Set(running.map((t) => t.milestoneId)).size;
  const alsoRunning = running.length ? ` · ${count(running.length, 'task')} running` : '';
  if (!plan.body) return view.milestones.length ? { who: 'you', text: `Approve the plan: ${count(view.milestones.length, 'milestone')} · ${count(view.total, 'task')} · a draft, not on the board yet` } : { who: 'agent', text: 'Your agent is writing the plan' };
  if (plan.draft) return { who: 'you', text: `Review your agent’s changes: ${changeWords(plan)}` };
  if (next.kind !== 'done' && next.kind !== 'answer' && next.kind !== 'failed') {
    const merging = mergingLine(view);
    if (merging) return merging;
  }
  switch (next.kind) {
    case 'approve':
    case 'review_changes':
      return { who: 'you', text: `Review your agent’s changes: ${changeWords(plan)}` };
    case 'resume':
      return { who: 'you', text: 'Resume the plan: it’s paused, nothing starts' };
    case 'answer':
      return { who: 'you', text: `Answer your agent in ${next.tasks.map((t) => t.issue?.key ?? `“${t.task.title}”`).join(', ')}` };
    case 'failed':
      return { who: 'you', text: `${quoted(next.milestone)} didn’t pass the agent’s check: send it back or pass it anyway` };
    case 'pass': {
      const m = next.milestone;
      const failed = m.run.mergeFailed;
      if (failed) return { who: 'you', text: `${quoted(m)} couldn’t merge into ${plan.branch ?? 'the plan’s branch'}: ${failed.reason}. Fix that, then pass it again` };
      const n = m.milestone.criteria.length;
      const why = m.run.check?.verdict === 'pass' ? `The agent checked ${n === 1 ? 'its criterion' : n === 2 ? 'both criteria' : `all ${n} criteria`}` : 'every task is finished';
      return { who: 'you', text: `Pass ${quoted(m)}: ${why}` };
    }
    case 'start':
      return { who: 'you', text: next.tasks.length === 1 ? `Start “${next.tasks[0]!.task.title}”` : `Start ${count(next.tasks.length, 'task')}` };
    case 'checking':
      return { who: 'agent', text: `The agent is checking ${quoted(next.milestone)}${alsoRunning}` };
    case 'working':
      return running.length ? { who: 'agent', text: `${count(running.length, 'task')} running${inMilestones > 1 ? ` in ${inMilestones} milestones` : ''}` } : { who: 'plan', text: 'Starting the next tasks' };
    case 'waiting':
      return { who: 'plan', text: next.why };
    case 'merging':
      return { who: next.milestone.merging?.conflict?.stuck ? 'you' : 'plan', text: next.text };
    case 'stalled':
      return { who: 'you', text: `Resume ${next.tasks.map((t) => t.issue?.key ?? `“${t.task.title}”`).join(', ')}: its agent stopped again without finishing` };
    case 'ship':
      return shipHeadline(plan, next.branch, next.pr);
    case 'done':
      return { who: 'plan', text: 'Done: every milestone passed' };
  }
}

// ---- changing how a plan runs

/** What switching a plan to `to` changes from now on, in plain words (and what happens at once). */
export function modeChange(view: PlanView, to: Autonomy): { readonly title: string; readonly from: string; readonly now?: string } {
  const branch = view.plan.branch;
  const label = AUTONOMY_INFO[to].label;
  const from = {
    step: 'From now on nothing starts by itself: you start each task. Tasks already running go on.',
    gated: 'From now on tasks start by themselves, and each milestone waits for you to pass it once the agent has checked it.',
    autopilot: `From now on the agent passes milestones itself${branch ? ` and merges them into ${branch}` : ''}. It stops only if a check fails.`,
  }[to];
  const bits: string[] = [];
  if (to === 'autopilot') {
    const passing = view.open.filter((m) => m.state === 'gate' && (m.run.check?.verdict === 'pass' || !m.milestone.criteria.length));
    if (passing.length) bits.push(`${passing.map(quoted).join(' and ')} ${passing.length === 1 ? 'passes' : 'pass'} now`);
  }
  if (to !== 'step') {
    const ready = view.ready.filter((t) => !t.forYou).length;
    const starts = Math.min(ready, Math.max(0, view.plan.maxParallel - view.active.length));
    if (starts) bits.push(`${count(starts, 'ready task')} ${starts === 1 ? 'starts' : 'start'} now`);
  }
  if (view.plan.body?.milestones.some((m) => m.autonomy && m.autonomy !== to)) bits.push('milestones you set their own way follow this too');
  const now = bits.length ? `${bits.join('; ')}.` : undefined;
  return { title: `Switch to ${label}`, from, ...(now ? { now: now[0]!.toUpperCase() + now.slice(1) } : {}) };
}

// ---- what happened

export interface FeedItem {
  readonly id: string;
  readonly at: number;
  readonly by: Actor;
  readonly kind: string;
  /** What happened (the newest of a run of repeats), after the actor's name. */
  readonly text: string;
  /** Repeats folded into it (1: none). */
  readonly count: number;
  readonly texts: readonly string[];
}

function feedKind(e: PlanEvent): string | undefined {
  switch (e.kind) {
    case 'started':
    case 'finished':
    case 'checked':
    case 'failed':
    case 'merged':
    case 'approved':
    case 'changed':
    case 'paused':
    case 'resumed':
    case 'done':
    case 'problem':
      return e.kind;
    case 'passed':
      return /^merged\b/.test(e.text) ? 'merged' : 'passed';
    case 'gate':
      return /^checked\b/.test(e.text) ? 'checked' : 'checking';
    case 'autonomy':
      return 'mode';
    case 'note':
      return /^(made the plan’s branch|collects the plan’s work on)\b/.test(e.text) ? 'branch' : /^opened pull request #\d+/.test(e.text) ? 'pr' : undefined;
    default:
      return undefined;
  }
}

const FOLD_MS = 30 * 60 * 1000;
const sameBy = (a: Actor, b: Actor): boolean => a.kind === b.kind && (a.kind === 'person' ? a.id === (b as typeof a).id : a.kind === 'claude' ? a.owner === (b as typeof a).owner : true);

/** What the plan did, newest first; a run of the same thing by the same one is one line. */
export function feedOf(activity: readonly PlanEvent[]): readonly FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of [...activity].reverse()) {
    const kind = feedKind(e);
    if (!kind) continue;
    const last = out.at(-1);
    const fold = last && last.kind === kind && sameBy(last.by, e.by) && last.at - e.at < FOLD_MS && (last.texts[0] === e.text || kind === 'started' || kind === 'finished');
    if (!fold) {
      out.push({ id: e.id, at: e.at, by: e.by, kind, text: e.text, count: 1, texts: [e.text] });
      continue;
    }
    const texts = [...last.texts, e.text];
    const same = texts.every((x) => x === texts[0]);
    out[out.length - 1] = { ...last, count: texts.length, texts, text: same ? last.texts[0]! : `${kind} ${count(texts.length, 'task')}: ${texts.map((x) => /\b[A-Z][A-Z0-9]*-\d+\b/.exec(x)?.[0] ?? x.replace(/^\w+\s+/, '')).reverse().join(', ')}` };
  }
  return out;
}

/** What a draft changes in an approved plan, per task id. */
export function changeMarks(plan: Plan): ReadonlyMap<string, 'added' | 'changed'> {
  if (!plan.body || !plan.draft) return new Map();
  const d = diffBodies(plan.body, plan.draft);
  return new Map([...d.added.map((id) => [id, 'added'] as const), ...d.changed.map((id) => [id, 'changed'] as const)]);
}

export function changeWords(plan: Plan): string {
  const d = diffBodies(plan.body, plan.draft);
  const parts = [d.added.length ? `${d.added.length} new` : '', d.changed.length ? `${d.changed.length} changed` : '', d.removed.length ? `${d.removed.length} taken out` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Milestones changed';
}

// ---- the plan's branch and pull request

/** What stands in the way of the plan's pull request, in a few words. */
export function prWords(pr: PlanPr): string {
  if (pr.state === 'MERGED') return 'merged into main';
  if (pr.state === 'CLOSED') return 'closed without merging';
  const bits: string[] = [];
  if (pr.draft) bits.push('a draft');
  if (pr.conflicts) bits.push('conflicts with main');
  else if (pr.mergeState === 'behind') bits.push('behind main');
  if (pr.checks === 'failing') bits.push('checks failing');
  else if (pr.checks === 'pending') bits.push('checks running');
  else if (pr.checks === 'passing') bits.push('checks pass');
  if (pr.review === 'CHANGES_REQUESTED') bits.push('changes requested');
  else if (pr.review === 'REVIEW_REQUIRED') bits.push('needs a review');
  else if (pr.review === 'APPROVED') bits.push('approved');
  if (pr.autoMerge) bits.push('merges when checks pass');
  return bits.length ? bits.join(' · ') : 'ready to merge';
}

/** The plan's last step, once every milestone passed. */
export type ShipAction =
  | { readonly kind: 'open'; readonly again: boolean }
  | { readonly kind: 'catching_up'; readonly main: string }
  | { readonly kind: 'fixing'; readonly files: readonly string[] }
  | { readonly kind: 'stuck'; readonly files: readonly string[] }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'merged' };

export function shipAction(plan: Plan, pr: PlanPr | undefined): ShipAction {
  const main = plan.mainMerge;
  if (main?.conflict) return { kind: main.conflict.stuck ? 'stuck' : 'fixing', files: main.conflict.files };
  if (main) return { kind: 'catching_up', main: main.main };
  if (!pr || pr.state === 'CLOSED') return { kind: 'open', again: pr?.state === 'CLOSED' };
  if (pr.state === 'MERGED') return { kind: 'merged' };
  if (pr.conflicts) return { kind: 'resolve' };
  if (pr.draft) return { kind: 'draft' };
  if (pr.autoMerge) return { kind: 'queued' };
  if (pr.checks === 'pending' || pr.checks === 'failing' || pr.review === 'REVIEW_REQUIRED' || pr.review === 'CHANGES_REQUESTED' || pr.mergeState === 'blocked') return { kind: 'wait' };
  return { kind: 'merge' };
}

const fileList = (files: readonly string[]): string => files.slice(0, 2).join(', ') + (files.length > 2 ? ` and ${files.length - 2} more` : '');

function shipHeadline(plan: Plan, branch: string, pr: PlanPr | undefined): Headline {
  const a = shipAction(plan, pr);
  const n = pr ? `#${pr.number}` : 'the pull request';
  switch (a.kind) {
    case 'open':
      return a.again ? { who: 'you', text: `${n} was closed without merging: open it again, or merge locally` } : { who: 'you', text: `Open the plan’s pull request: ${branch} → main` };
    case 'catching_up':
      return { who: 'plan', text: `Merging ${a.main} into ${branch}, so ${n} merges cleanly` };
    case 'fixing':
      return { who: 'agent', text: `Your agent is fixing the conflict with main in ${fileList(a.files)}` };
    case 'stuck':
      return { who: 'you', text: `The conflict with main in ${fileList(a.files)} is still there: ask your agent again, or fix it in its folder` };
    case 'resolve':
      return { who: 'you', text: `${n} conflicts with main: Resolve Conflicts brings main into ${branch}` };
    case 'draft':
      return { who: 'you', text: `${n} is a draft: mark it ready on GitHub` };
    case 'queued':
      return { who: 'plan', text: `${n} merges by itself once its checks pass` };
    case 'wait':
      return { who: 'you', text: `${n}: ${prWords(pr!)}. Merge it once they pass` };
    case 'merge':
      return { who: 'you', text: `Merge ${n} on GitHub: every milestone passed, ${prWords(pr!)}` };
    case 'merged':
      return { who: 'plan', text: `${n} merged into main` };
  }
}

/** One step on the way from the plan's milestones to main. */
export interface FlowStep {
  readonly id: string;
  readonly kind: 'main' | 'pr' | 'branch' | 'milestone';
  readonly label: string;
  readonly detail: string;
  readonly state: 'done' | 'active' | 'waiting' | 'problem' | 'later';
}

/** Where the plan's work goes, from main back: main, the pull request, the branch, each milestone merged into it. */
export function branchFlow(view: PlanView): readonly FlowStep[] {
  const { plan } = view;
  const branch = plan.branch;
  const pr = plan.pr;
  const steps: FlowStep[] = [];
  const shipped = plan.shipped;
  steps.push({ id: 'main', kind: 'main', label: 'main', detail: shipped ? (shipped.how === 'pr' ? `the plan’s work is in, via #${shipped.number}` : 'the plan’s work is in, merged here') : 'the plan’s work goes here at the end', state: shipped ? 'done' : 'waiting' });
  if (branch) {
    const ship = shipAction(plan, pr);
    const prState: FlowStep['state'] = shipped || pr?.state === 'MERGED' ? 'done' : ship.kind === 'stuck' || ship.kind === 'resolve' || pr?.state === 'CLOSED' || pr?.checks === 'failing' ? 'problem' : pr ? 'active' : 'waiting';
    const prDetail = plan.mainMerge?.conflict ? `conflicts with main in ${fileList(plan.mainMerge.conflict.files)}${plan.mainMerge.conflict.stuck ? ': needs you' : ': your agent is fixing it'}` : pr ? prWords(pr) : shipped?.how === 'local' ? 'merged here instead' : 'opened once every milestone passed';
    steps.push({ id: 'pr', kind: 'pr', label: pr ? `Pull request #${pr.number}` : 'Pull request', detail: `${branch} → main · ${prDetail}`, state: shipped?.how === 'local' ? 'done' : prState });
    steps.push({ id: 'branch', kind: 'branch', label: branch, detail: 'made from main: every task starts from it, each milestone merges into it', state: shipped ? 'done' : 'active' });
  } else if (plan.body && plan.status !== 'done') {
    const failed = [...plan.activity].reverse().find((e) => e.kind === 'problem' && /^couldn’t make the plan’s branch/.test(e.text));
    steps.push({ id: 'branch', kind: 'branch', label: 'No plan branch', detail: failed ? failed.text.replace(/^couldn’t make the plan’s branch /, 'couldn’t make ') : 'not made yet: tasks start from main', state: failed ? 'problem' : 'waiting' });
  }
  for (const m of view.milestones) {
    const c = m.merging?.conflict;
    const failed = m.run.mergeFailed;
    const state: FlowStep['state'] = m.state === 'merging' ? (c?.stuck ? 'problem' : 'active') : failed ? 'problem' : m.state === 'passed' ? 'done' : m.state === 'later' || m.state === 'draft' ? 'later' : 'waiting';
    const detail =
      m.state === 'merging'
        ? c
          ? `merging into ${branch ?? 'the branch'}: ${c.key ?? c.merging} conflicts in ${fileList(c.files)}${c.stuck ? ': needs you' : ': your agent is fixing it'}`
          : `merging into ${branch ?? 'the branch'} now`
        : failed
          ? `couldn’t merge: ${failed.reason}`
          : m.state === 'passed'
            ? branch
              ? `merged into ${branch}`
              : 'passed'
            : `merges into ${branch ?? 'the plan’s branch'} when it passes · ${m.finished}/${m.total} tasks finished`;
    steps.push({ id: m.milestone.id, kind: 'milestone', label: m.milestone.title, detail, state });
  }
  return steps;
}
