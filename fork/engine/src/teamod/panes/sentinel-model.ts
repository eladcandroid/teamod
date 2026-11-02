import { type MetricColumn, deltaCellOf, personOf, progressOf, ratingOf, sparkOf, storageName, storageSources } from '../../core/sentinel/columns.js';
import { type Dashboard, type Tile, type TileColumn, type TileState, OUTPUT_STEP_KINDS, TILE_STATE_WORDS, metricOf, tileColumns, tileCompare, tileMetrics, tileOutput, tileStateIn, tileTitle } from '../../core/sentinel/dashboard-model.js';
import { COMPARE_WORDS, type Compare, type Tone, changeText, deltaOf, formatMetric, unitLabel } from '../../core/sentinel/metrics.js';
import {
  type Access,
  type AfterTrigger,
  type TeamodTrigger,
  type ClaudeStep,
  type GitHubTrigger,
  type HttpStep,
  type MergeStep,
  type MetricKind,
  type MetricSeries,
  type Recipe,
  type RunState,
  type RunSummary,
  type ScheduleEvery,
  type ScheduleHours,
  type ScheduleTrigger,
  type ScriptLanguage,
  type Sentinel,
  type SentinelAsk,
  type SentinelState,
  type Step,
  type StepDraft,
  type StepKind,
  type StepState,
  type StripeTrigger,
  type SentryTrigger,
  type Trigger,
  type TriggerKind,
  type UptimeTrigger,
  ACCESS_INFO,
  CLAUDE_CHANGED,
  RUN_STATE_INFO,
  SERVICE_PRESETS,
  STEP_INFO,
  TRIGGER_INFO,
  firstLine,
  hostOf,
  lastRunOf,
  pausedWords,
  scheduleSentence,
  stepRefusal,
} from '../../core/sentinel/model.js';
import { ASSISTANT_TITLE } from '../../shared/assistant.js';
import type { Source } from '../../shared/view-spec.js';
import { agentForChoice } from '../../ui/agent-choice.js';
import type { Span } from '../tree.js';
import { ago } from './common.js';

/**
 * Sentinel's words and edits, with no drawing in them: times, what a row says, what needs you, the
 * schedule's and the steps' changes, what a tile's numbers say. The same sentences teamod's own
 * window has (docs/sentinel.md §3, §10), so a person reads the same thing on either screen.
 */

export interface Choice {
  readonly value: string;
  readonly label: string;
}

/** The list's project switch: Your Mac's, or one project's. None: every one. */
export const MAC_SCOPE = 'mac';
export type Show = 'watching' | 'paused' | 'all';

// ---------------------------------------------------------------- times

const pad = (n: number): string => String(n).padStart(2, '0');

export const clockOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
};

const DAY = 86_400_000;
const startOf = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** When a run was: "Today 7:00", "Yesterday 7:00", "Fri 2:00", "Oct 3 2:00". */
export function whenText(ts: number, now: number): string {
  const days = Math.round((startOf(now) - startOf(ts)) / DAY);
  const at = clockOf(ts);
  if (days === 0) return `Today ${at}`;
  if (days === 1) return `Yesterday ${at}`;
  if (days > 1 && days < 7) return `${new Date(ts).toLocaleDateString('en-US', { weekday: 'short' })} ${at}`;
  return `${new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${at}`;
}

/** When it runs next, short: "7:00" today, "Tue 7:00" this week, "Nov 3" later. */
export function nextText(ts: number, now: number): string {
  const days = Math.round((startOf(ts) - startOf(now)) / DAY);
  if (days <= 0) return clockOf(ts);
  if (days === 1) return `tomorrow ${clockOf(ts)}`;
  if (days < 7) return `${new Date(ts).toLocaleDateString('en-US', { weekday: 'short' })} ${clockOf(ts)}`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** How long something took: "48 s", "2.1 s", "4 min 12 s", "1 h 3 min". */
export function durationText(ms: number): string {
  if (ms < 0) return '';
  if (ms < 10_000) return `${Math.round(ms / 100) / 10} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// ---------------------------------------------------------------- the list

export const nameIn =
  (state: Pick<SentinelState, 'items'>) =>
  (id: string): string | undefined =>
    state.items.find((i) => i.id === id)?.name;

export const countsOf = (items: readonly Sentinel[]): { readonly watching: number; readonly paused: number } => {
  const paused = items.filter((s) => s.paused).length;
  return { watching: items.length - paused, paused };
};

export const inScope = (s: Pick<Sentinel, 'projectId'>, scope: string | undefined): boolean => (!scope ? true : scope === MAC_SCOPE ? !s.projectId : s.projectId === scope);

/** The list's sentinels: in the scope, watching or paused, matching the filter (name, trigger, steps). */
export function filterSentinels(items: readonly Sentinel[], opts: { readonly scope?: string | undefined; readonly show: Show; readonly query?: string | undefined }): Sentinel[] {
  const q = opts.query?.trim().toLowerCase();
  return items.filter((s) => {
    if (!inScope(s, opts.scope)) return false;
    if (opts.show === 'watching' && s.paused) return false;
    if (opts.show === 'paused' && !s.paused) return false;
    if (!q) return true;
    return [s.name, scheduleSentence(s.trigger), ...s.steps.map((st) => `${st.name} ${STEP_INFO[st.kind].label}`)].join(' ').toLowerCase().includes(q);
  });
}

export interface Group {
  readonly projectId?: string;
  readonly name: string;
  readonly items: readonly Sentinel[];
}

/** Rows grouped by project, in the sidebar's order of projects, Your Mac last; names A to Z inside. */
export function groupSentinels(items: readonly Sentinel[], projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): Group[] {
  const byName = (a: Sentinel, b: Sentinel): number => a.name.localeCompare(b.name);
  const out: Group[] = [];
  for (const p of projects) {
    const mine = items.filter((s) => s.projectId === p.id);
    if (mine.length) out.push({ projectId: p.id, name: p.name, items: [...mine].sort(byName) });
  }
  const known = new Set(projects.map((p) => p.id));
  const mac = items.filter((s) => !s.projectId || !known.has(s.projectId));
  if (mac.length) out.push({ name: ASSISTANT_TITLE, items: [...mac].sort(byName) });
  return out;
}

/** The project switch: All, then only the projects that have sentinels, then Your Mac, each with its count. */
export function scopesOf(items: readonly Sentinel[], projects: ReadonlyArray<{ readonly id: string; readonly name: string }>): Choice[] {
  const known = new Set(projects.map((p) => p.id));
  const mac = items.filter((s) => !s.projectId || !known.has(s.projectId)).length;
  return [
    { value: '', label: `All projects (${items.length})` },
    ...projects.flatMap((p) => {
      const count = items.filter((s) => s.projectId === p.id).length;
      return count ? [{ value: p.id, label: `${p.name} (${count})` }] : [];
    }),
    ...(mac ? [{ value: MAC_SCOPE, label: `${ASSISTANT_TITLE} (${mac})` }] : []),
  ];
}

/** Why a sentinel's trigger can't watch now, in words with what to do. A paused one has none. */
export function troubleOf(state: Pick<SentinelState, 'troubles' | 'webhook'>, s: Pick<Sentinel, 'id' | 'paused' | 'trigger'>): string | undefined {
  if (s.paused) return undefined;
  const own = state.troubles?.[s.id];
  if (own) return own;
  if (s.trigger.kind === 'webhook' && state.webhook && !state.webhook.ready && state.webhook.why) return state.webhook.why;
  return undefined;
}

/** A run's one line: its headline, else what it's doing. */
export function headlineOf(run: Pick<RunSummary, 'headline' | 'state' | 'why'>): string {
  if (run.headline) return run.headline;
  if (run.state === 'running') return 'Running...';
  if (run.state === 'queued') return 'Waiting for the run before it';
  return run.why ?? RUN_STATE_INFO[run.state].label;
}

/** The list's foot: "3 watching · 1 paused · last run 2m". */
export function footLine(items: readonly Sentinel[], runs: readonly RunSummary[], now: number): string {
  const c = countsOf(items);
  const ids = new Set(items.map((s) => s.id));
  const last = runs.filter((r) => ids.has(r.sentinelId)).reduce<number | undefined>((at, r) => (at === undefined || r.startedAt > at ? r.startedAt : at), undefined);
  return [`${c.watching} watching`, ...(c.paused ? [`${c.paused} paused`] : []), ...(last !== undefined ? [`last run ${ago(last, now)}`] : [])].join(' · ');
}

/** What a sentinel does, in a few words: its steps' names in order. */
export const doesLine = (s: Pick<Sentinel, 'steps'>): string => (s.steps.length ? s.steps.map((st) => st.name).join(' → ') : 'No steps yet');

/** Something that waits for you on Sentinel's list, with what you'd do about it. */
export type Need =
  | { readonly kind: 'merge'; readonly key: string; readonly sentinel: Sentinel; readonly run: RunSummary; readonly title: string; readonly detail: string }
  | { readonly kind: 'draft' | 'changed' | 'failing' | 'trouble'; readonly key: string; readonly sentinel: Sentinel; readonly title: string; readonly detail: string };

/** What needs you: runs waiting for your Merge, sentinels your agent changed, ones paused after failures, ones that can't watch, and drafts. */
export function needsOf(state: SentinelState, scope?: string): Need[] {
  const items = state.items.filter((s) => inScope(s, scope));
  const out: Need[] = [];
  const nameOf = nameIn(state);
  for (const run of state.runs) {
    if (run.state !== 'needs-you') continue;
    const s = items.find((i) => i.id === run.sentinelId);
    if (s) out.push({ kind: 'merge', key: `run:${run.id}`, sentinel: s, run, title: run.pr ? `${s.name} wants to merge #${run.pr.number}` : `${s.name} waits for you`, detail: headlineOf(run) });
  }
  for (const s of items) {
    const trouble = troubleOf(state, s);
    if (s.paused && s.pausedWhy === CLAUDE_CHANGED) out.push({ kind: 'changed', key: `s:${s.id}`, sentinel: s, title: `Your agent changed what “${s.name}” can do`, detail: 'Look it over, then turn it on again' });
    else if (s.paused && s.pausedWhy) out.push({ kind: 'failing', key: `s:${s.id}`, sentinel: s, title: `${s.name}: ${pausedWords(s) ?? 'paused'}`, detail: headlineOf(lastRunOf(state, s.id) ?? { headline: '', state: 'failed' }) });
    else if (trouble) out.push({ kind: 'trouble', key: `s:${s.id}`, sentinel: s, title: `${s.name} can’t watch`, detail: trouble });
    else if (s.paused && !lastRunOf(state, s.id)) out.push({ kind: 'draft', key: `s:${s.id}`, sentinel: s, title: `“${s.name}” is ready: look it over`, detail: [scheduleSentence(s.trigger, nameOf), doesLine(s)].join(' · ') });
  }
  return out;
}

// ---------------------------------------------------------------- runs

/** A run's state as a theme colour. */
export const runStyle = (state: RunState): Omit<Span, 't'> => (state === 'done' ? { color: 'success' } : state === 'failed' ? { color: 'error' } : state === 'running' || state === 'queued' ? { color: 'claude' } : state === 'needs-you' ? { color: 'warning' } : { dim: true });

export const STEP_STATE_WORDS: Readonly<Record<StepState, string>> = { waiting: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped' };
export const stepStyle = (state: StepState): Omit<Span, 't'> => (state === 'done' ? { color: 'success' } : state === 'failed' ? { color: 'error' } : state === 'running' ? { color: 'claude' } : { dim: true });

/** Who or what started a run, in words: "schedule", "you", "your phone", "after Nightly tests". */
export function byWords(run: Pick<RunSummary, 'by' | 'trigger'>, state: Pick<SentinelState, 'items' | 'runs'>): string {
  switch (run.by) {
    case 'schedule':
      return 'schedule';
    case 'you':
      return 'you';
    case 'phone':
      return 'your phone';
    case 'claude':
      return 'your agent';
    case 'event':
      return run.trigger.summary || 'an event';
    default: {
      const before = state.runs.find((r) => r.id === run.by.slice('after:'.length));
      const name = before ? state.items.find((s) => s.id === before.sentinelId)?.name : undefined;
      return name ? `after ${name}` : 'after another sentinel';
    }
  }
}

/** Under a run's title: "Nightly tests · ran by schedule · Fri 2:00 · 4 min 12 s". */
export function runLine(run: Pick<RunSummary, 'by' | 'trigger' | 'startedAt' | 'endedAt'>, name: string | undefined, state: Pick<SentinelState, 'items' | 'runs'>, now: number): string {
  const took = run.endedAt !== undefined ? durationText(run.endedAt - run.startedAt) : `${durationText(now - run.startedAt)} so far`;
  return [name ?? 'A sentinel', `ran by ${byWords(run, state)}`, whenText(run.startedAt, now), took].join(' · ');
}

export const isRunning = (state: RunState): boolean => state === 'running' || state === 'queued';

/** A run's own chats (a project or Your Mac chat), not its worktree's: what Delete Chat deletes. */
export const hasOwnChat = (run: Pick<RunSummary, 'channel' | 'chatDeleted' | 'putAway' | 'worktreeId'> & { readonly steps: ReadonlyArray<{ readonly channel?: string }> }): boolean =>
  !run.chatDeleted && !run.putAway && [run.channel, ...run.steps.map((x) => x.channel)].some((c) => c && c !== (run.worktreeId ? `ws:${run.worktreeId}` : undefined));

// ---------------------------------------------------------------- when

export const EVERY_CHOICES: ReadonlyArray<{ readonly value: ScheduleEvery; readonly label: string }> = [
  { value: 'day', label: 'Every day' },
  { value: 'other-day', label: 'Every other day' },
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
  { value: 'hours', label: 'Every few hours' },
];

export const DEFAULT_SCHEDULE: ScheduleTrigger = { kind: 'schedule', every: 'day', at: '07:00', missed: 'catch-up' };

/** Another "every": the fields that kind needs, the rest kept where they make sense. */
export function withEvery(t: ScheduleTrigger, every: ScheduleEvery): ScheduleTrigger {
  const base = { kind: 'schedule' as const, every, at: t.at, missed: t.missed };
  if (every === 'week') return { ...base, days: t.days?.length ? t.days : [1] };
  if (every === 'month') return { ...base, day: t.day ?? 1 };
  if (every === 'hours') return { ...base, hours: t.hours ?? 3 };
  return base;
}

/** A weekday pressed: on or off (one stays on). Monday first. */
export function toggleDay(days: readonly number[] | undefined, day: number): number[] {
  const now = new Set(days?.length ? days : [1]);
  if (now.has(day)) {
    if (now.size > 1) now.delete(day);
  } else now.add(day);
  return [...now].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
export const HOURS_CHOICES: readonly ScheduleHours[] = [1, 2, 3, 6, 12];

export const TRIGGER_CHOICES: readonly Choice[] = (Object.keys(TRIGGER_INFO) as TriggerKind[]).map((k) => ({ value: k, label: TRIGGER_INFO[k].label }));

/** A trigger of another kind, with what it needs filled in. */
export function triggerOfKind(kind: TriggerKind, was: Trigger): Trigger {
  if (kind === was.kind) return was;
  switch (kind) {
    case 'schedule':
      return DEFAULT_SCHEDULE;
    case 'manual':
      return { kind: 'manual' };
    case 'after':
      return { kind: 'after', sentinelId: '', on: 'failure' };
    case 'teamod':
      return { kind: 'teamod', what: 'task-done' };
    case 'github':
      return { kind: 'github', what: 'workflow-failed', minutes: 2 };
    case 'stripe':
      return { kind: 'stripe', what: 'payment-failed' };
    case 'uptime':
      return { kind: 'uptime', url: 'https://example.com', minutes: 5 };
    case 'sentry':
      return { kind: 'sentry', org: '', project: '', what: 'new-issue' };
    case 'webhook':
      return { kind: 'webhook' };
  }
}

export const TEAMOD_WHAT: ReadonlyArray<{ readonly value: TeamodTrigger['what']; readonly label: string }> = [
  { value: 'task-done', label: 'A task is done' },
  { value: 'pr-opened', label: 'A pull request opens' },
  { value: 'pr-merged', label: 'A pull request merges' },
  { value: 'milestone-passed', label: 'A milestone passes' },
  { value: 'claude-finished', label: 'A worktree’s agent finishes' },
  { value: 'friend-asks', label: 'A friend asks' },
];

export const GITHUB_WHAT: ReadonlyArray<{ readonly value: GitHubTrigger['what']; readonly label: string }> = [
  { value: 'workflow-failed', label: 'A workflow fails' },
  { value: 'issue-opened', label: 'An issue opens' },
  { value: 'issue-labelled', label: 'An issue gets a label' },
  { value: 'pr-opened', label: 'A pull request opens' },
  { value: 'deployment-failed', label: 'A deployment fails' },
];

export const STRIPE_WHAT: ReadonlyArray<{ readonly value: StripeTrigger['what']; readonly label: string }> = [
  { value: 'payment-failed', label: 'A payment fails' },
  { value: 'subscription-started', label: 'A subscription starts' },
  { value: 'subscription-ended', label: 'A subscription ends' },
  { value: 'dispute-opened', label: 'A dispute opens' },
  { value: 'refund', label: 'A refund happens' },
];

export const SENTRY_WHAT: ReadonlyArray<{ readonly value: SentryTrigger['what']; readonly label: string }> = [
  { value: 'new-issue', label: 'A new issue' },
  { value: 'regression', label: 'A regression' },
  { value: 'spike', label: 'A spike' },
];

export const GITHUB_MINUTES: readonly number[] = [1, 2, 5, 15, 30, 60];
export const UPTIME_MINUTES: ReadonlyArray<UptimeTrigger['minutes']> = [1, 5, 15];
export const EXPECT_STATUSES: readonly number[] = [200, 204, 301, 302, 401, 403];

const every = (minutes: number): string => (minutes === 1 ? 'every minute' : `every ${minutes} minutes`);
export const everyLabel = (minutes: number): string => (minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`);

/** One sentence of what will happen, under an event's fields. */
export function eventSentence(t: Trigger, where: { readonly project?: string | undefined } = {}): string | undefined {
  switch (t.kind) {
    case 'teamod': {
      const p = t.projectId && where.project ? `in ${where.project}` : 'in any project';
      const what = TEAMOD_WHAT.find((c) => c.value === t.what)?.label.toLowerCase() ?? t.what;
      return `When ${what} ${p}, a run starts with what happened as {{trigger}}. Its own runs’ worktrees, pull requests and chats never start it again.`;
    }
    case 'github': {
      const what =
        t.what === 'workflow-failed'
          ? 'a workflow run failed, the run starts with its failed jobs, the first failing step and the end of its log'
          : t.what === 'issue-labelled'
            ? `an issue got ${t.label ? `the label “${t.label}”` : 'a label'}, the run starts with the issue`
            : t.what === 'deployment-failed'
              ? 'a deployment failed, the run starts with its environment, commit and status'
              : t.what === 'issue-opened'
                ? 'an issue opened, the run starts with the issue'
                : 'a pull request opened, the run starts with it';
      return `It asks GitHub about the project’s repository ${every(t.minutes ?? 2)} with gh. When ${what}. What was there before it was on never fires.`;
    }
    case 'stripe':
      return 'It reads the project’s Stripe events every 2 minutes with the project’s key. Each new one starts a run with its amount, currency, the customer’s email and the description; never card details.';
    case 'uptime':
      return `It opens ${hostOf(t.url) || 'the address'} ${every(t.minutes)} and expects ${t.expect ?? 200} within 10 seconds. Two misses in a row start a run (“stopped answering”), and the first good answer after that starts another (“back”).`;
    case 'sentry':
      return t.org && t.project
        ? `It reads ${t.org}/${t.project}’s unresolved issues every 2 minutes with $SENTRY_TOKEN. ${t.what === 'spike' ? 'An issue Sentry calls escalating, or with 5 times the events of the hour before (10 at least), starts a run once.' : t.what === 'regression' ? 'An issue that came back after it was resolved starts a run once.' : 'An issue first seen after it was turned on starts a run.'}`
        : 'Say which Sentry organization and project, as in the address of its issues page (sentry.io/organizations/<org>/projects/<project>).';
    case 'webhook':
      return t.signature === 'github'
        ? 'Point GitHub’s webhook at its URL with Copy Secret’s secret as its Secret; it’s live while this sentinel is on. Each post starts a run with what was posted.'
        : t.signature === 'stripe'
          ? 'Point a Stripe webhook endpoint at its URL and keep its signing secret (whsec_...) in Settings › Environment as STRIPE_WEBHOOK_SECRET; it’s live while this sentinel is on.'
          : 'Point GitHub’s webhook (or anything that posts) at its URL; it’s live while this sentinel is on. Each post starts a run with what was posted.';
    default:
      return undefined;
  }
}

/** A whole http(s) address (a host, a port, a path). */
export function looksLikeUrl(v: string): boolean {
  const text = v.trim();
  if (!text || /\s/.test(text)) return false;
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** The address the tunnel changes: quick tunnels get a new name when the engine restarts. */
export const WEBHOOK_MOVES = 'The address changes when the engine restarts: copy it again then.';

export const AFTER_ON: ReadonlyArray<{ readonly value: AfterTrigger['on']; readonly label: string }> = [
  { value: 'failure', label: 'When it fails' },
  { value: 'success', label: 'When it succeeds' },
  { value: 'always', label: 'Whenever it runs' },
];

/** The sentinels an "after" (or Run another sentinel) may name: every other one, A to Z. */
export const otherSentinels = (items: readonly Sentinel[], self: string): Choice[] =>
  items
    .filter((i) => i.id !== self)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ value: i.id, label: i.paused ? `${i.name} (paused)` : i.name }));

// ---------------------------------------------------------------- steps

/** Ask your agent presets (docs/sentinel.md §1): a good prompt to start from, editable. */
export const AGENT_PRESETS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly prompt: string }> = [
  {
    id: 'brief',
    label: 'Write a brief of what changed',
    prompt: [
      'Write a brief for {{project}} ({{date}}) of what changed since the last run: commits on the default branch (`git log --since="24 hours ago"`), pull requests opened, merged or waiting for review (`gh pr list`), new issues (`gh issue list`), the latest CI runs (`gh run list --limit 10`), and these open tasks:',
      '{{tasks}}',
      '',
      'Start with what needs me first, then what moved, then what is next. Short bullets. If nothing changed, say so in one line and stop.',
    ].join('\n'),
  },
  {
    id: 'tasks',
    label: 'Turn this into tasks',
    prompt: [
      'Here is what came in:',
      '{{previous}}',
      '',
      'Make a task with task_create for each real thing worth doing on {{project}}: a short title in your own words, what done means, a priority. One task per thing; skip noise and anything already open:',
      '{{tasks}}',
      '',
      'If there is nothing worth a task, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'fix',
    label: 'Investigate and fix it',
    prompt: [
      'Something needs looking at:',
      '{{trigger}}',
      '{{previous}}',
      '',
      'Find out why it happens and reproduce it. Fix it with the smallest change that is clearly right, add or update a test that shows it, and run the tests. Commit the fix with a message that says what broke. If you can’t reproduce it, say what you tried and stop.',
    ].join('\n'),
  },
  {
    id: 'review',
    label: 'Review the changes',
    prompt: [
      'Review what changed in {{project}} since the last run (`git log --since="24 hours ago" -p`, and open pull requests with `gh pr diff`).',
      '',
      'Look for bugs, missing tests and anything risky; say what to fix, file by file, most important first. Praise nothing; skip style nits. If there is nothing new, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'deps',
    label: 'Update dependencies and run the tests',
    prompt: [
      'Update this project’s dependencies within the ranges its manifest allows, with its own package manager and lockfile.',
      'Run the tests and the type check. If something breaks, fix it when the fix is small and clear; otherwise put that dependency back and say why.',
      'Commit what works with a message listing what moved. If everything is current, say so and stop.',
    ].join('\n'),
  },
  {
    id: 'notes',
    label: 'Write release notes',
    prompt: [
      'Write release notes for {{project}} up to {{date}} from the pull requests merged and the tasks done since the last release.',
      'Group them as New, Better and Fixed, one line each in plain words a user understands, in the voice of the project’s README and earlier notes. Leave out internal chores. If nothing shipped, say so in one line.',
    ].join('\n'),
  },
];

/** The one line under a text field: what it can say. */
export const TEMPLATE_HELP = '{{trigger}}, {{previous}}, {{steps.<name>}}, {{project}}, {{date}}; $VAR from Settings › Environment';

export const SECRETS_NOTE = '$VAR from Settings › Environment; headers never show in reports.';

/** Add a step: the ten kinds, each with why it can't be added when it can't. */
export const stepChoices = (access: Access): ReadonlyArray<{ readonly kind: StepKind; readonly label: string; readonly hint: string; readonly refused?: string }> =>
  (Object.keys(STEP_INFO) as StepKind[]).map((kind) => {
    const refused = stepRefusal(access, kind);
    return { kind, label: STEP_INFO[kind].label, hint: STEP_INFO[kind].hint, ...(refused ? { refused } : {}) };
  });

/** A new step of a kind, with what it needs filled in. */
export function newStep(kind: StepKind): StepDraft {
  switch (kind) {
    case 'claude':
      return { kind: 'claude', name: 'Ask your agent', prompt: '', where: 'project' };
    case 'script':
      return { kind: 'script', name: 'Run a script', command: '', cwd: 'project', timeoutSec: 120 };
    case 'notify':
      return { kind: 'notify', name: 'Tell me', phone: false };
    case 'http':
      return { kind: 'http', name: 'Call a service', method: 'GET', url: 'https://', headers: {}, timeoutSec: 30, preset: 'url' };
    case 'pr':
      return { kind: 'pr', name: 'Open a pull request' };
    case 'merge':
      return { kind: 'merge', name: 'Merge if acceptable', require: { checks: true, approval: true }, method: 'squash' };
    case 'message':
      return { kind: 'message', name: 'Message a chat', to: '', text: '{{sentinel}}: {{previous}}' };
    case 'friend':
      return { kind: 'friend', name: 'Ask a friend’s agent', peerId: '', prompt: '' };
    case 'trigger':
      return { kind: 'trigger', name: 'Run another sentinel', sentinelId: '' };
    case 'measure':
      return { kind: 'measure', name: 'Keep the numbers', from: 'previous', metrics: [] };
  }
}

export const SERVICE_CHOICES: readonly Choice[] = (Object.keys(SERVICE_PRESETS) as Array<keyof typeof SERVICE_PRESETS>).map((k) => ({ value: k, label: SERVICE_PRESETS[k].label }));
export const HTTP_METHODS: ReadonlyArray<HttpStep['method']> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Where a Message step can write: your friends and the groups you're in. */
export function chatChoices(network: { readonly friends: ReadonlyArray<{ readonly peerId: string; readonly name: string }>; readonly groups: ReadonlyArray<{ readonly id: string; readonly name: string; readonly active: boolean }> }): Choice[] {
  return [
    ...[...network.friends].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: `dm:${f.peerId}`, label: f.name })),
    ...network.groups.filter((g) => g.active).sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: `group:${g.id}`, label: `${g.name} (a group)` })),
  ];
}

export const mergeWords = (step: Pick<MergeStep, 'require'>): string =>
  step.require.approval ? 'It merges once the checks pass, the agent’s review says ship, and you press Merge.' : 'It merges by itself once the checks pass and the agent’s review says ship. A hold still asks you.';

/** The access sentence (Ship says when a merge goes by itself). */
export function accessSentence(access: Access, steps: readonly Step[]): string {
  if (access === 'ship' && steps.some((st) => st.kind === 'merge' && !st.require.approval)) return 'Your agent can change code in a worktree, open pull requests, and merge by itself when the checks pass';
  return ACCESS_INFO[access].sentence;
}

export const recipeWhen = (r: Recipe): string => (r.sentinel.trigger ? scheduleSentence(r.sentinel.trigger) : TRIGGER_INFO.manual.label);

/** Describe it: a name to start with, from the words (your agent names it properly). */
export function describedName(text: string): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(every|each)\s+(other\s+)?(weekday|week|day|morning|evening|night|hour)s?(\s+(morning|evening|night))?,?\s*/i, '')
    .replace(/^(at|by|on)\s+[\w:]+(\s*(am|pm))?\s*,?\s*/i, '')
    .replace(/^(please|can you|i want( you)? to|make (it|a sentinel) (that|to))\s+/i, '')
    .split(/[,.;:!?]/)[0]!
    .split(' ')
    .slice(0, 5)
    .join(' ')
    .replace(/(\s+(and|or|the|a|an|to|of|with|for))+$/i, '');
  return words ? (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80) : 'New sentinel';
}

export interface AskLine {
  readonly who: 'agent' | 'done' | 'failed';
  readonly text: string;
}

/** What your agent is doing now (its conversation's last line), its answer, or what went wrong. */
export function askLine(ask: SentinelAsk | undefined, live: { readonly running: boolean; readonly last?: string } | undefined): AskLine | undefined {
  if (!ask) return undefined;
  if (ask.state === 'writing') {
    const last = live?.running && live.last && live.last !== ask.text ? live.last : undefined;
    return { who: 'agent', text: last ? `Your agent is writing... ${last.replace(/^mcp__\w+__/, '').slice(0, 120)}` : 'Your agent is writing...' };
  }
  if (ask.state === 'failed') return { who: 'failed', text: ask.answer ? `Your agent stopped: ${ask.answer}` : 'Your agent stopped' };
  return { who: 'done', text: ask.answer || 'Done' };
}

/** Your agent's words with each `sentinel:<id>` it names said by name. */
export function namedLine(text: string, nameOf: (id: string) => string | undefined): string {
  return text.replace(/`sentinel:([\w-]+)`/g, (m, id: string) => {
    const name = nameOf(id);
    return name ? `“${name}”` : m;
  });
}

/** Steps moved: `at` goes `by` places (kept in the list). */
export function moveStep<T>(steps: readonly T[], at: number, by: number): T[] {
  const to = at + by;
  if (at < 0 || at >= steps.length || to < 0 || to >= steps.length) return [...steps];
  const out = [...steps];
  const [s] = out.splice(at, 1);
  out.splice(to, 0, s!);
  return out;
}

/** A step copied right after itself (a new id from the engine, "copy" on its name). */
export function duplicateStep(steps: readonly Step[], at: number): ReadonlyArray<Step | StepDraft> {
  const s = steps[at];
  if (!s) return [...steps];
  const { id: _id, ...rest } = s;
  const copy = { ...rest, name: `${s.name} copy`.slice(0, 80) } as StepDraft;
  return [...steps.slice(0, at + 1), copy, ...steps.slice(at + 1)];
}

/** One step changed (its fields merged; a field set to nothing goes). */
export const patchStep = <S extends Step>(steps: readonly Step[], id: string, patch: Partial<S>): Step[] => steps.map((s) => (s.id === id ? (Object.fromEntries(Object.entries({ ...s, ...patch }).filter(([, v]) => v !== undefined)) as unknown as Step) : s));

/** What a new script starts as, by language: it prints what the next step reads. */
export const SCRIPT_STARTER: Readonly<Record<ScriptLanguage, string>> = {
  python: 'import json, os\n\n# What you print is what the next step reads (a number, JSON or CSV).\nprint(json.dumps({"value": 42}))\n',
  node: '// What you print is what the next step reads (a number, JSON or CSV).\nconsole.log(JSON.stringify({ value: 42 }));\n',
  bash: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  sh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  zsh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  ruby: '# What you print is what the next step reads (a number, JSON or CSV).\nrequire "json"\nputs({ value: 42 }.to_json)\n',
  perl: '# What you print is what the next step reads (a number, JSON or CSV).\nprint "42\\n";\n',
};

export const SCRIPT_TIMEOUTS: readonly number[] = [30, 60, 120, 300, 600, 900, 1800, 3600];
export const HTTP_TIMEOUTS: readonly number[] = [10, 30, 60, 120, 300, 600];
export const timeoutLabel = (sec: number): string => (sec < 60 ? `${sec} seconds` : sec < 3600 ? `${Math.round(sec / 60)} minute${sec === 60 ? '' : 's'}` : '1 hour');

export const WHERE_INFO: ReadonlyArray<{ readonly value: ClaudeStep['where']; readonly label: string; readonly line: string }> = [
  { value: 'project', label: 'In the project', line: 'A new chat in the project’s main folder; the agent reads and reports, never changes files' },
  { value: 'worktree', label: 'In a new worktree', line: 'Its own branch: the agent edits, commits and runs the tests; later steps share it' },
  { value: 'mac', label: `On ${ASSISTANT_TITLE}`, line: 'A chat of its own, for things about this computer itself' },
];

// ---------------------------------------------------------------- keep the numbers

export const MEASURE_FROM_INFO: ReadonlyArray<{ readonly value: 'previous' | 'source' | 'claude'; readonly label: string; readonly line: string }> = [
  { value: 'previous', label: 'The step before', line: 'A number, JSON, CSV or “name: value” lines' },
  { value: 'source', label: 'A source', line: 'A database query, a command or a request, run here as you' },
  { value: 'claude', label: 'What the agent keeps', line: 'The agent step before calls sentinel_measure for each one' },
];

export const UNIT_CHOICES: readonly Choice[] = [
  { value: 'count', label: 'A count' },
  { value: 'currency:USD', label: 'Dollars' },
  { value: 'currency:EUR', label: 'Euros' },
  { value: 'currency:GBP', label: 'Pounds' },
  { value: 'percent', label: 'A percent' },
  { value: 'ms', label: 'Milliseconds' },
  { value: 'bytes', label: 'Bytes' },
  { value: 'plain', label: 'A plain number' },
  { value: 'rows', label: 'Rows (a table)' },
  { value: 'series', label: 'A series (a whole array)' },
  { value: 'output', label: 'The output itself' },
];

export const BETTER_CHOICES: readonly Choice[] = [
  { value: 'up', label: 'Up is good' },
  { value: 'down', label: 'Down is good' },
  { value: 'none', label: 'Neither' },
];

export const SOURCE_CHOICES: readonly Choice[] = [
  { value: 'postgres', label: 'Postgres query' },
  { value: 'sqlite', label: 'SQLite query' },
  { value: 'command', label: 'A command' },
  { value: 'http', label: 'A web request' },
  { value: 'file', label: 'A file' },
];

export function newSource(kind: string): Source {
  switch (kind) {
    case 'postgres':
      return { kind, env: 'DATABASE_URL', query: 'select count(*) as count from customers' };
    case 'sqlite':
      return { kind, path: 'data.db', query: 'select count(*) as count from customers' };
    case 'command':
      return { kind, command: 'echo 42', format: 'auto' };
    case 'http':
      return { kind, url: 'https://api.example.com/stats', method: 'GET', format: 'auto' };
    default:
      return { kind: 'file', path: 'stats.json', format: 'auto' };
  }
}

// ---------------------------------------------------------------- properties

/** The usual numbers, with what's set now among them when nobody offers it. */
export const withValue = (usual: readonly number[], value: number): number[] => (usual.includes(value) ? [...usual] : [...usual, value].sort((a, b) => a - b));

export const timeChoices = (minutes: number): Choice[] => withValue([10, 30, 60, 120], minutes).map((n) => ({ value: String(n), label: n < 60 ? `${n} minutes` : n === 60 ? '1 hour' : `${n / 60} hours` }));

const perDayLabel = (n: number): string => (!n ? 'No limit' : n === 1 ? 'Once a day' : `${n} a day`);
export const perDayChoices = (perDay: number): Choice[] => withValue([0, 1, 2, 3, 4, 6, 12, 24], perDay).map((n) => ({ value: String(n), label: perDayLabel(n) }));

const pauseAfterLabel = (n: number): string => (n === 0 ? 'Never' : n === 1 ? '1 failure' : `${n} failures in a row`);
export const pauseAfterChoices = (pauseAfter: number): Choice[] => withValue([0, 1, 2, 3, 5, 10], pauseAfter).map((n) => ({ value: String(n), label: pauseAfterLabel(n) }));

export const NOTIFY_LABEL: Readonly<Record<Sentinel['notify'], string>> = { mac: 'On this computer', phone: 'On your phone', both: 'This computer and your phone', off: 'Off' };

/** An agent step's agent as a choice: '' for your default agent, else `runtime:model`. */
export const stepAgentChoice = (step: Pick<ClaudeStep, 'runtime' | 'model'>): string => (!step.runtime && !step.model ? '' : `${step.runtime ?? 'claude'}:${step.model ?? ''}`);

/** The runtime and model a choice stands for, as a step's fields ('': neither, your default agent). */
export function agentFields(value: string): Pick<ClaudeStep, 'runtime' | 'model'> {
  if (!value) return { runtime: undefined, model: undefined };
  const ref = agentForChoice(value);
  return { runtime: ref.runtime, model: ref.model };
}

/** The agent every agent step shares ('': your default; undefined when they differ). */
export function sharedAgent(steps: readonly Step[]): string | undefined {
  const picks = new Set(steps.flatMap((s) => (s.kind === 'claude' ? [stepAgentChoice(s)] : [])));
  return picks.size === 1 ? [...picks][0] : picks.size === 0 ? '' : undefined;
}

/** Every agent step on one agent and model ('': your default). */
export const withAgent = (steps: readonly Step[], value: string): Step[] =>
  steps.map((s) => {
    if (s.kind !== 'claude') return s;
    const { runtime: _r, model: _m, ...rest } = s;
    const { runtime, model } = agentFields(value);
    return { ...rest, ...(runtime ? { runtime } : {}), ...(model ? { model } : {}) };
  });

// ---------------------------------------------------------------- numbers and tiles

const BLOCKS = '▁▂▃▄▅▆▇█';

/** A small line of a number's last points, a block for each; nothing to say with fewer than two. */
export function sparkline(values: readonly number[], width = 24): string {
  const points = values.filter((v) => Number.isFinite(v)).slice(-Math.max(2, width));
  if (points.length < 2) return '';
  const low = Math.min(...points);
  const high = Math.max(...points);
  const range = high - low;
  return points.map((v) => BLOCKS[range === 0 ? 3 : Math.round(((v - low) / range) * (BLOCKS.length - 1))]).join('');
}

export const toneStyle = (tone: Tone): Omit<Span, 't'> => (tone === 'good' ? { color: 'success' } : tone === 'bad' ? { color: 'error' } : { dim: true });

export interface NumberWords {
  readonly value: string;
  readonly unit?: string;
  readonly change?: string;
  readonly tone: Tone;
  readonly vs: string;
  readonly trend: readonly number[];
}

/** A number as a tile says it: its value, its change, its tone, what it's compared with, its points. */
export function numberWords(m: MetricSeries, compare: Compare): NumberWords {
  const last = m.points.at(-1);
  const d = deltaOf(m.points, compare, m.better);
  const change = changeText(d, m.unit);
  const unit = unitLabel(m.unit);
  return {
    value: last ? formatMetric(last.value, m.unit) : '—',
    ...(unit && m.unit !== 'percent' && !m.unit.startsWith('currency:') && m.unit !== 'ms' && m.unit !== 'bytes' ? { unit } : {}),
    ...(change ? { change } : {}),
    tone: d?.tone ?? 'none',
    vs: d?.change !== undefined ? COMPARE_WORDS[compare] : m.points.length > 1 ? `nothing ${COMPARE_WORDS[compare].replace(/^vs /, 'from ')}` : 'its first number',
    trend: m.points.slice(-30).map((p) => p.value),
  };
}

/** A sentinel's numbers, in the order they were made. */
export function metricsOf(s: Pick<SentinelState, 'metrics'>, sentinelId: string): { readonly numbers: MetricSeries[]; readonly tables: MetricSeries[]; readonly series: MetricSeries[]; readonly outputs: MetricSeries[] } {
  const all = Object.values(s.metrics?.[sentinelId] ?? {});
  return { numbers: all.filter((m) => m.kind === 'number'), tables: all.filter((m) => m.kind === 'rows'), series: all.filter((m) => m.kind === 'series'), outputs: all.filter((m) => m.kind === 'output') };
}

export const METRIC_KIND_WORDS: Readonly<Record<MetricKind, string>> = { number: 'a number', rows: 'a table', series: 'a list of points', output: 'an output' };

/** A kept table's cell in words, as its column says it reads. */
export function cellWords(cell: unknown, t?: MetricColumn): string {
  if (cell === null || cell === undefined) return '';
  switch (t?.type) {
    case 'progress': {
      const share = progressOf(cell, t.max);
      if (share !== undefined) return `${Math.round(share * 100)}%`;
      break;
    }
    case 'sparkline': {
      const values = sparkOf(cell);
      if (values) return sparkline(values, 16);
      break;
    }
    case 'delta':
      return deltaCellOf(cell, t.better)?.text ?? String(cell);
    case 'person':
      return personOf(cell)?.name ?? String(cell);
    case 'rating': {
      const r = ratingOf(cell, t.max);
      if (r) return `${r.value} of ${r.max}`;
      break;
    }
    case 'storage':
      return t.button?.trim() || storageName(cell);
    case 'html':
    case 'file':
      return t.button?.trim() || String(cell);
    case 'action':
      return t.button?.trim() || t.label?.trim() || 'Run';
    default:
      break;
  }
  return typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
}

/** A rows metric's columns as they're shown: the tile's own say first, what only feeds a storage chip out of sight. */
export function shownColumns(m: Pick<MetricSeries, 'rows' | 'columns' | 'columnTypes'>, own?: readonly TileColumn[]): ReadonlyArray<{ readonly key: string; readonly label: string; readonly type?: MetricColumn }> {
  const present = [...new Set(m.columns?.length ? m.columns : Object.keys(m.rows?.[0] ?? {}))];
  const typed = new Map((m.columnTypes ?? []).map((c) => [c.key, c]));
  const quiet = new Set(storageSources(m.columnTypes, present));
  return tileColumns(present, own)
    .filter((c) => !c.hidden && !(quiet.has(c.key) && !own?.some((o) => o.key === c.key)))
    .map((c) => {
      const t = typed.get(c.key);
      return { key: c.key, label: c.label ?? t?.label ?? c.key, ...(t ? { type: t } : {}) };
    });
}

const tableCell = (text: string, max = 40): string => {
  const one = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** Rows as a Markdown table: at most `most` columns and `limit` rows. */
export function rowsTable(m: Pick<MetricSeries, 'rows' | 'columns' | 'columnTypes'>, opts: { readonly limit: number; readonly most: number; readonly own?: readonly TileColumn[] | undefined }): string {
  const columns = shownColumns(m, opts.own).slice(0, Math.max(1, opts.most));
  if (!columns.length) return '';
  const rows = (m.rows ?? []).slice(0, opts.limit);
  return [`| ${columns.map((c) => tableCell(c.label)).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${columns.map((c) => tableCell(cellWords((r as Record<string, unknown>)[c.key], c.type))).join(' | ')} |`)].join('\n');
}

/** A list of objects as rows a table draws: each cell as text or a number. */
export function outputTable(rows: ReadonlyArray<Record<string, unknown>>): { readonly rows: Array<Record<string, string | number | boolean | null>>; readonly columns: string[] } {
  const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].slice(0, 12);
  const cell = (v: unknown): string | number | boolean | null => (v === null || v === undefined ? null : typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'string' ? v : JSON.stringify(v));
  return { columns, rows: rows.slice(0, 200).map((r) => Object.fromEntries(columns.map((c) => [c, cell(r[c])]))) };
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** "Fetching... 2 of 3" (the one going is the next: 0 done means the first is running). */
export const refreshLine = (r: { readonly done: number; readonly total: number }): string => `Fetching... ${Math.min(r.total, r.done + 1)} of ${r.total}`;

/** What a tile can't draw from, in its quiet words (none: it draws). */
export const tileNote = (state: TileState): string | undefined => (state === 'ok' ? undefined : TILE_STATE_WORDS[state]);

/** What a tile is: its title, the sentinel it draws from, whether it can draw. */
export function tileCaption(s: Pick<SentinelState, 'metrics' | 'items'>, t: Tile): { readonly title: string; readonly from?: string; readonly state: TileState } {
  const ref = t.metric ?? t.metrics?.[0];
  const sid = ref?.sentinelId ?? t.sentinelId ?? t.step?.sentinelId;
  const from = sid ? s.items.find((i) => i.id === sid)?.name : undefined;
  return { title: tileTitle(s, t), ...(from ? { from } : {}), state: tileStateIn(s, t) };
}

/** The sentinels your agent made for a board's ask that are still drafts (never turned on). */
export function draftsOf(s: Pick<SentinelState, 'items' | 'dashboardAsks' | 'runs'>, dashboardId: string): Array<{ readonly id: string; readonly name: string }> {
  const made = new Set(s.dashboardAsks?.[dashboardId]?.made ?? []);
  return [...made].flatMap((id) => {
    const sn = s.items.find((i) => i.id === id);
    return sn && sn.paused && !s.runs.some((r) => r.sentinelId === id) ? [{ id: sn.id, name: sn.name }] : [];
  });
}

/** What can go on a board that a sentinel keeps: every metric, by project then sentinel, with its value now. */
export function metricChoices(s: Pick<SentinelState, 'metrics' | 'items'>, projectName: (id: string | undefined) => string, d?: Dashboard): ReadonlyArray<{ readonly sentinelId: string; readonly name: string; readonly label: string; readonly sentinel: string; readonly project: string; readonly kind: MetricKind; readonly value?: string; readonly onIt: boolean }> {
  const on = new Set((d?.tiles ?? []).flatMap((t) => [...(t.metric ? [t.metric] : []), ...(t.metrics ?? [])]).map((r) => `${r.sentinelId}/${r.metric}`));
  return s.items
    .flatMap((i) =>
      Object.values(s.metrics?.[i.id] ?? {}).map((m) => {
        const last = m.points.at(-1);
        const value = m.kind === 'rows' ? `${m.rows?.length ?? 0} rows` : m.kind === 'series' ? `${m.series?.length ?? 0} points` : m.kind === 'output' ? (m.output?.format === 'json' ? 'JSON' : m.output?.format === 'markdown' ? 'Markdown' : 'text') : last ? formatMetric(last.value, m.unit) : undefined;
        return { sentinelId: i.id, name: m.name, label: m.label, sentinel: i.name, project: projectName(i.projectId), kind: m.kind, ...(value ? { value } : {}), onIt: on.has(`${i.id}/${m.name}`) };
      }),
    )
    .sort((a, b) => a.project.localeCompare(b.project) || a.sentinel.localeCompare(b.sentinel));
}

/** Every step an output tile can show, by project then sentinel. */
export function outputStepChoices(s: Pick<SentinelState, 'items'>, projectName: (id: string | undefined) => string): ReadonlyArray<{ readonly sentinelId: string; readonly stepId: string; readonly label: string; readonly sentinel: string; readonly project: string; readonly hint: string }> {
  return s.items
    .flatMap((i) => i.steps.filter((st) => OUTPUT_STEP_KINDS.has(st.kind)).map((st) => ({ sentinelId: i.id, stepId: st.id, label: st.name, sentinel: i.name, project: projectName(i.projectId), hint: st.kind === 'claude' ? 'what the agent wrote' : st.kind === 'http' ? 'the service’s answer' : 'what it printed' })))
    .sort((a, b) => a.project.localeCompare(b.project) || a.sentinel.localeCompare(b.sentinel));
}

/** A tile's words for Copy as Markdown. */
export function tileWords(s: Pick<SentinelState, 'metrics' | 'items' | 'runs' | 'outputs'>, d: Dashboard, t: Tile): { readonly title: string; readonly value?: string; readonly change?: string; readonly text?: string } {
  const title = tileTitle(s, t);
  if (t.kind === 'number') {
    const m = metricOf(s, t.metric);
    if (!m) return { title };
    const w = numberWords(m, tileCompare(d, t));
    return { title, value: w.value, ...(w.change ? { change: `${w.change} ${w.vs}` } : {}) };
  }
  if (t.kind === 'text') {
    const last = [...s.runs].reverse().find((r) => r.sentinelId === t.sentinelId);
    return { title, ...(last?.headline ? { text: last.headline } : {}) };
  }
  if (t.kind === 'table') {
    const m = metricOf(s, t.metric);
    return { title, ...(m?.rows ? { value: `${m.rows.length} rows` } : {}) };
  }
  if (t.kind === 'series') {
    const ms = tileMetrics(s, t);
    const kept = ms[0]?.kind === 'series' ? ms[0] : undefined;
    if (kept) return { title, value: (kept.series ?? []).slice(0, 14).map((p) => `${p.x} ${formatMetric(p.y, kept.unit)}`).join(', ') };
    return { title, ...(ms.length ? { value: ms.map((m) => `${m.label} ${m.points.at(-1) ? formatMetric(m.points.at(-1)!.value, m.unit) : '—'}`).join(', ') } : {}) };
  }
  if (t.kind === 'output') {
    const o = tileOutput(s, t);
    return { title, ...(o ? { text: o.format === 'json' ? `\`\`\`json\n${prettyJson(o.text)}\n\`\`\`` : o.format === 'markdown' ? o.text : firstLine(o.text, 400) } : {}) };
  }
  return { title };
}

/** How a picked thing can show on the board. */
export type TileLook = 'number' | 'line' | 'bars' | 'table' | 'text';
export const LOOK_WORDS: Readonly<Record<TileLook, string>> = { number: 'A number', line: 'Over time', bars: 'Bars', table: 'A table', text: 'Its text' };

export function looksFor(kind: MetricKind | 'step' | 'report'): readonly TileLook[] {
  if (kind === 'number') return ['number', 'line', 'bars'];
  if (kind === 'series') return ['line', 'bars'];
  if (kind === 'rows') return ['table'];
  return ['text'];
}

/** The sizes: how many of the six columns, and whether tall. */
export const TILE_SIZES = [
  { id: 'small', label: 'Small', w: 1, h: 1 },
  { id: 'wide', label: 'Wide', w: 2, h: 1 },
  { id: 'half', label: 'Half', w: 3, h: 1 },
  { id: 'big', label: 'Big', w: 3, h: 2 },
  { id: 'full', label: 'Full width', w: 6, h: 1 },
] as const;
export type TileSizeId = (typeof TILE_SIZES)[number]['id'];

/** The size a look starts at: a number small, a chart or a table half, text big. */
export const sizeFor = (look: TileLook): TileSizeId => (look === 'number' ? 'small' : look === 'text' ? 'big' : 'half');

/** Somewhere a tile can come from that no sentinel fetches yet: your agent sets one up (a draft). */
export const NEW_SOURCES = [
  { id: 'stripe', label: 'Stripe', hint: 'revenue, payments', ideas: ['Revenue per day', 'New subscriptions this week', 'Failed payments'] },
  { id: 'github', label: 'GitHub', hint: 'pull requests, issues, CI', ideas: ['Open pull requests', 'Open issues', 'Failed CI runs this week'] },
  { id: 'database', label: 'A database', hint: 'Supabase, Postgres, SQLite', ideas: ['Sign-ups per day', 'Rows added yesterday', 'The latest 10 orders'] },
  { id: 'url', label: 'A URL or an API', hint: 'any JSON', ideas: ['A number from a JSON API', 'Whether my site answers'] },
  { id: 'script', label: 'A script', hint: 'prints a number', ideas: ['Free disk space', 'Lines of code'] },
] as const;
export type NewSourceId = (typeof NEW_SOURCES)[number]['id'];

export const newSourceAsk = (source: NewSourceId, words: string): string => `Add a tile from ${NEW_SOURCES.find((x) => x.id === source)!.label}: ${words.trim()}. If no sentinel fetches it yet, set one up (a draft) that does.`;

/** A run state's word, for rows. */
export const runWord = (state: RunState): string => RUN_STATE_INFO[state].label;
