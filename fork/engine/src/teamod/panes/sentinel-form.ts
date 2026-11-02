import { metricName } from '../../core/sentinel/metrics.js';
import {
  DAY_NAMES,
  ROWS_KEPT,
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_INFO,
  SERVICE_PRESETS,
  STEP_INFO,
  type Better,
  type ClaudeStep,
  type FriendStep,
  type HttpStep,
  type MeasureFrom,
  type MeasureStep,
  type MergeStep,
  type MessageStep,
  type MetricSpec,
  type MetricUnit,
  type NotifyStep,
  type PrStep,
  type ScheduleTrigger,
  type ScriptLanguage,
  type ScriptStep,
  type Sentinel,
  type Step,
  type StepKind,
  type Trigger,
  type TriggerKind,
  type TriggerStep,
  accessAllows,
  ordinal,
  presetFields,
  scheduleSentence,
  stepRefusal,
  stepSentence,
} from '../../core/sentinel/model.js';
import type { Source } from '../../shared/view-spec.js';
import { agentChoices } from '../../ui/agent-choice.js';
import type { Ctx } from '../screens.js';
import { type Node, col, dim, row, span, text, title } from '../tree.js';
import { back, empty, page } from './common.js';
import { askRoute } from './sentinel-asks.js';
import { field, leave, pick, saver, top } from './sentinel-common.js';
import {
  AFTER_ON,
  AGENT_PRESETS,
  TEAMOD_WHAT,
  BETTER_CHOICES,
  EVERY_CHOICES,
  EXPECT_STATUSES,
  GITHUB_MINUTES,
  GITHUB_WHAT,
  HOURS_CHOICES,
  HTTP_METHODS,
  HTTP_TIMEOUTS,
  MEASURE_FROM_INFO,
  SCRIPT_STARTER,
  SCRIPT_TIMEOUTS,
  SECRETS_NOTE,
  SENTRY_WHAT,
  SERVICE_CHOICES,
  SOURCE_CHOICES,
  STRIPE_WHAT,
  TEMPLATE_HELP,
  TRIGGER_CHOICES,
  UNIT_CHOICES,
  UPTIME_MINUTES,
  WHERE_INFO,
  WEEK,
  chatChoices,
  duplicateStep,
  eventSentence,
  everyLabel,
  looksLikeUrl,
  mergeWords,
  moveStep,
  nameIn,
  newSource,
  newStep,
  otherSentinels,
  patchStep,
  stepAgentChoice,
  agentFields,
  stepChoices,
  timeoutLabel,
  toggleDay,
  triggerOfKind,
  troubleOf,
  withEvery,
  withValue,
} from './sentinel-model.js';

/** A sentinel's form: what starts it and each step's fields, one to a row. Everything saves as it changes, as on the Mac: there is no Save. */

// ---------------------------------------------------------------- when

function scheduleFields(ctx: Ctx, t: ScheduleTrigger, set: (next: Trigger) => unknown): Array<Node | false> {
  const days = t.days?.length ? t.days : [1];
  return [
    pick(ctx, 'when:every', 'How often', EVERY_CHOICES, t.every, (every) => set(withEvery(t, every as ScheduleTrigger['every']))),
    t.every === 'hours'
      ? pick(ctx, 'when:hours', 'Every', HOURS_CHOICES.map((h) => ({ value: String(h), label: h === 1 ? 'hour' : `${h} hours` })), String(t.hours ?? 1), (h) => set({ ...t, hours: Number(h) as NonNullable<ScheduleTrigger['hours']> }))
      : field(ctx, 'when:at', 'At', t.at, (value) => {
          const at = value.trim();
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('A time like 07:00');
          return set({ ...t, at });
        }, { placeholder: '07:00' }),
    t.every === 'week' &&
      row(
        WEEK.map((d) =>
          ctx.draw.button(`when:day:${d}`, DAY_NAMES[d]!, () => set({ ...t, days: toggleDay(t.days, d) }), { plain: true, ...(days.includes(d) ? {} : { dim: true }) }),
        ),
      ),
    t.every === 'month' && pick(ctx, 'when:day', 'On the', Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) })), String(t.day ?? 1), (d) => set({ ...t, day: Number(d) })),
    pick(ctx, 'when:missed', 'If this computer was asleep', [{ value: 'catch-up', label: 'Run as soon as it wakes' }, { value: 'skip', label: 'Skip that run' }], t.missed, (missed) => set({ ...t, missed: missed as ScheduleTrigger['missed'] })),
  ];
}

function eventFields(ctx: Ctx, s: Sentinel, t: Trigger, set: (next: Trigger) => unknown): Array<Node | false> {
  const projects = ctx.state.projects.filter((p) => p.root && !p.error);
  const project = ctx.state.projects.find((p) => p.id === (t.kind === 'teamod' ? t.projectId : s.projectId));
  switch (t.kind) {
    case 'teamod':
      return [
        pick(ctx, 'when:what', 'Event', TEAMOD_WHAT, t.what, (what) => set({ ...t, what: what as typeof t.what })),
        pick(ctx, 'when:project', 'In', [{ value: '', label: 'Any project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))], t.projectId ?? '', (value) => {
          const { projectId: _p, ...rest } = t;
          return set(value ? { ...rest, projectId: value } : rest);
        }),
      ];
    case 'github':
      return [
        pick(ctx, 'when:what', 'Event', GITHUB_WHAT, t.what, (what) => set({ ...t, what: what as typeof t.what })),
        dim(s.projectId ? `It watches ${project?.name ?? 'the project'}’s repository on GitHub.` : 'Pick a project in More: it watches that project’s repository.'),
        t.what === 'issue-labelled' &&
          field(ctx, 'when:label', 'Label', t.label ?? '', (value) => {
            const { label: _l, ...rest } = t;
            return set(value.trim() ? { ...rest, label: value.trim() } : rest);
          }, { placeholder: 'Any label' }),
        pick(ctx, 'when:minutes', 'Look', withValue(GITHUB_MINUTES, t.minutes ?? 2).map((m) => ({ value: String(m), label: everyLabel(m) })), String(t.minutes ?? 2), (m) => set({ ...t, minutes: Number(m) })),
      ];
    case 'stripe':
      return [pick(ctx, 'when:what', 'Event', STRIPE_WHAT, t.what, (what) => set({ ...t, what: what as typeof t.what })), dim(project ? `Account: ${project.name}’s Stripe.` : 'Pick a project in More: it reads that project’s Stripe.')];
    case 'uptime':
      return [
        field(ctx, 'when:url', 'Address', t.url, (value) => {
          const url = value.trim();
          if (!looksLikeUrl(url)) throw new Error('A whole address, like https://example.com/health');
          return set({ ...t, url });
        }, { placeholder: 'https://example.com' }),
        pick(ctx, 'when:minutes', 'Check', UPTIME_MINUTES.map((m) => ({ value: String(m), label: everyLabel(m) })), String(t.minutes), (m) => set({ ...t, minutes: Number(m) as typeof t.minutes })),
        pick(ctx, 'when:expect', 'Expect', withValue(EXPECT_STATUSES, t.expect ?? 200).map((n) => ({ value: String(n), label: String(n) })), String(t.expect ?? 200), (value) => {
          const { expect: _e, ...rest } = t;
          return set(Number(value) === 200 ? rest : { ...rest, expect: Number(value) });
        }),
      ];
    case 'sentry':
      return [
        pick(ctx, 'when:what', 'Event', SENTRY_WHAT, t.what, (what) => set({ ...t, what: what as typeof t.what })),
        field(ctx, 'when:org', 'Organization', t.org, (value) => set({ ...t, org: value.trim() }), { placeholder: 'organization' }),
        field(ctx, 'when:sentry-project', 'Project', t.project, (value) => set({ ...t, project: value.trim() }), { placeholder: 'project' }),
      ];
    case 'webhook':
      return [
        // Its address holds its secret: only the press below fetches it, on a page of its own.
        ctx.draw.button('when:show-url', 'Show URL', () => ctx.go({ name: 'webhook', params: { id: s.id } }), { plain: true, hotkey: 'u' }),
        pick(ctx, 'when:signature', 'Signature', [{ value: 'none', label: 'None: the secret in the URL is the check' }, { value: 'github', label: 'GitHub' }, { value: 'stripe', label: 'Stripe' }], t.signature ?? 'none', (value) => {
          const { signature: _s, ...rest } = t;
          return set(value === 'none' ? rest : { ...rest, signature: value as 'github' | 'stripe' });
        }),
        ctx.draw.button('when:rotate', 'Rotate Secret...', () => ctx.go(askRoute('rotate', { id: s.id })), { plain: true, dim: true, hotkey: 'i' }),
      ];
    default:
      return [];
  }
}

/** What starts it, and that kind's fields. */
export function whenPage(ctx: Ctx, s: Sentinel): Node {
  const t = s.trigger;
  const save = saver(ctx, s);
  const set = (next: Trigger): unknown => save({ trigger: next });
  const state = ctx.state.sentinel;
  const others = otherSentinels(state.items, s.id);
  const project = ctx.state.projects.find((p) => p.id === (t.kind === 'teamod' ? t.projectId : s.projectId));
  const sentence = eventSentence(t, { project: project?.name });
  const trouble = troubleOf(state, s);
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    col([title('When'), text(scheduleSentence(t, nameIn(state)))]),
    pick(ctx, 'when:kind', 'What starts it', TRIGGER_CHOICES, t.kind, (kind) => set(triggerOfKind(kind as TriggerKind, t))),
    ...(t.kind === 'schedule' ? scheduleFields(ctx, t, set) : []),
    t.kind === 'manual' && dim('It runs only when you press Run Now.'),
    ...(t.kind === 'after'
      ? [
          others.length ? pick(ctx, 'when:after', 'After', [{ value: '', label: 'Pick a sentinel' }, ...others], t.sentinelId, (sentinelId) => (sentinelId ? set({ ...t, sentinelId }) : undefined)) : dim('There’s no other sentinel yet to follow.'),
          pick(ctx, 'when:on', 'Runs', AFTER_ON, t.on, (on) => set({ ...t, on: on as typeof t.on })),
          dim('It starts when that one’s run ends, with its last output as what fired it ({{trigger}}, {{trigger.json}}). It doesn’t run while paused.'),
        ]
      : []),
    ...eventFields(ctx, s, t, set),
    sentence ? dim(sentence) : undefined,
    trouble ? text(trouble, { color: 'error' }) : undefined,
  );
}

// ---------------------------------------------------------------- adding a step

export function addStepPage(ctx: Ctx, s: Sentinel): Node {
  const add = async (kind: StepKind): Promise<void> => {
    const next = (await ctx.call('sentinel.update', s.id, { steps: [...s.steps, newStep(kind)] })) as Sentinel | undefined;
    ctx.nav.back(ctx.pane);
    const made = next?.steps.at(-1);
    if (made) ctx.go({ name: 'step', params: { id: s.id, step: made.id } });
  };
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    title('Add a Step'),
    ...stepChoices(s.access).map((c) =>
      c.refused
        ? col([dim(c.label), dim(c.refused)])
        : col([ctx.draw.button(`add:${c.kind}`, c.label, () => add(c.kind), { plain: true }), dim(c.hint)]),
    ),
  );
}

// ---------------------------------------------------------------- a step

type Change<S extends Step> = (patch: Partial<S>) => unknown;

function agentFieldsOf(ctx: Ctx, s: Sentinel, step: ClaudeStep, change: Change<ClaudeStep>): Node[] {
  const where = WHERE_INFO.find((w) => w.value === step.where);
  const allowed = WHERE_INFO.filter((w) => accessAllows(s.access, 'claude', w.value));
  const refused = WHERE_INFO.filter((w) => !allowed.includes(w)).map((w) => `${w.label}: ${stepRefusal(s.access, 'claude', w.value) ?? ''}`);
  const agents = agentChoices(ctx.state.runtimes, ctx.state.models).filter((c) => !c.disabled);
  const nodes: Array<Node | false> = [
    pick(ctx, 'step:preset', 'Start from', [{ value: '', label: 'What it says now' }, ...AGENT_PRESETS.map((p) => ({ value: p.id, label: p.label }))], '', (id) => {
      const preset = AGENT_PRESETS.find((p) => p.id === id);
      return preset ? change({ prompt: preset.prompt }) : undefined;
    }),
    field(ctx, 'step:prompt', 'What the agent does', step.prompt, (prompt) => change({ prompt }), { rows: 6, placeholder: 'What should your agent do each run? Say when to stop: “If nothing changed, say so and stop.”' }),
    dim(TEMPLATE_HELP),
    pick(ctx, 'step:where', 'Where', allowed.map((w) => ({ value: w.value, label: w.label })), step.where, (value) => change({ where: value as ClaudeStep['where'] })),
    where ? dim(`${where.line}.`) : false,
    refused.length > 0 && dim(refused.join(' · ')),
    pick(ctx, 'step:agent', 'Agent', [{ value: '', label: 'Your default agent' }, ...agents.map((c) => ({ value: c.value, label: c.label }))], stepAgentChoice(step), (value) => change(agentFields(value))),
    step.where === 'mac' && stepAgentChoice(step) !== '' ? dim('On this computer’s own chat your default agent does it: pick In the project or In a new worktree for this one.') : false,
  ];
  return nodes.filter((n): n is Node => Boolean(n));
}

function scriptFields(ctx: Ctx, step: ScriptStep, change: Change<ScriptStep>): Node[] {
  const own = step.code !== undefined;
  const language: ScriptLanguage = step.language ?? 'sh';
  const nodes: Array<Node | false> = [
    pick(ctx, 'step:mode', 'It runs', [{ value: 'command', label: 'A command' }, { value: 'script', label: 'Its own script' }], own ? 'script' : 'command', (mode) =>
      // Going back to a line keeps nothing of the script.
      mode === 'script' ? change({ code: step.code ?? SCRIPT_STARTER.python, language: step.language ?? 'python', command: '' }) : change({ code: undefined, language: undefined } as Partial<ScriptStep>),
    ),
    own && pick(ctx, 'step:language', 'Language', SCRIPT_LANGUAGES.map((l) => ({ value: l, label: SCRIPT_LANGUAGE_INFO[l].label })), language, (l) => change({ language: l as ScriptLanguage })),
    own && field(ctx, 'step:code', 'Script', step.code ?? '', (code) => change({ code }), { rows: 8 }),
    own && dim(`Runs with ${SCRIPT_LANGUAGE_INFO[language].run} in the folder below. What it prints is what the next step reads (a number, JSON or CSV); a non-zero exit stops the run. It gets $VAR from Settings › Environment, $SENTINEL_PREVIOUS (the step before’s output), $SENTINEL_PREVIOUS_FILE and $SENTINEL_RUN_DIR.`),
    field(ctx, 'step:command', own ? 'Arguments' : 'Command', step.command, (command) => change({ command }), { placeholder: own ? '--since yesterday' : 'npm test' }),
    !own && dim('One shell line or a script’s path; a non-zero exit stops the run. $VAR from Settings › Environment; $SENTINEL_PREVIOUS has the step before’s output, and $SENTINEL_PREVIOUS_FILE the file it’s in.'),
    pick(ctx, 'step:cwd', 'Runs in', [{ value: 'project', label: 'The project’s main folder' }, { value: 'home', label: 'Your home folder' }], step.cwd, (cwd) => change({ cwd: cwd as ScriptStep['cwd'] })),
    pick(ctx, 'step:timeout', 'Stop it after', withValue(SCRIPT_TIMEOUTS, step.timeoutSec).map((n) => ({ value: String(n), label: timeoutLabel(n) })), String(step.timeoutSec), (n) => change({ timeoutSec: Number(n) })),
  ];
  return nodes.filter((n): n is Node => Boolean(n));
}

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const yesNo = (on: boolean | undefined): string => (on ? 'yes' : 'no');

function notifyFields(ctx: Ctx, step: NotifyStep, change: Change<NotifyStep>): Node[] {
  return [
    field(ctx, 'step:title', 'Title', step.title ?? '', (value) => change({ title: value }), { placeholder: '{{sentinel}} (the sentinel’s name)' }),
    field(ctx, 'step:body', 'Says', step.body ?? '', (value) => change({ body: value }), { rows: 2, placeholder: 'The report’s first line' }),
    dim(TEMPLATE_HELP),
    pick(ctx, 'step:phone', 'On my phone too', YES_NO, yesNo(step.phone), (value) => change({ phone: value === 'yes' })),
  ];
}

function httpFields(ctx: Ctx, step: HttpStep, change: Change<HttpStep>): Node[] {
  const preset = step.preset ?? 'url';
  const note = SERVICE_PRESETS[preset].note;
  const nodes: Array<Node | false> = [
    pick(ctx, 'step:service', 'Service', SERVICE_CHOICES, preset, (p) => change(p === 'url' ? { preset: 'url' } : presetFields(p as NonNullable<HttpStep['preset']>))),
    note ? dim(note) : false,
    pick(ctx, 'step:method', 'Method', HTTP_METHODS.map((m) => ({ value: m, label: m })), step.method, (method) => change({ method: method as HttpStep['method'] })),
    field(ctx, 'step:url', 'Address', step.url, (url) => change({ url: url.trim() }), { placeholder: 'https://api.example.com/search' }),
    ...Object.entries(step.headers).flatMap(([name, value]) => [
      field(ctx, `step:header:${name}`, name, value, (next) => change({ headers: { ...step.headers, [name]: next } }), { placeholder: 'Bearer $API_KEY' }),
      ctx.draw.button(`step:header-remove:${name}`, `Remove ${name}`, () => {
        const { [name]: _gone, ...rest } = step.headers;
        return change({ headers: rest });
      }, { plain: true, dim: true }),
    ]),
    field(ctx, 'step:header-new', 'New header', '', (line) => {
      const at = line.indexOf(':');
      const name = at > 0 ? line.slice(0, at).trim() : '';
      if (!name) throw new Error('A header like Authorization: Bearer $API_KEY');
      return change({ headers: { ...step.headers, [name]: line.slice(at + 1).trim() } });
    }, { placeholder: 'Authorization: Bearer $API_KEY', submitLabel: 'add' }),
    step.method !== 'GET' && field(ctx, 'step:http-body', 'Body', step.body ?? '', (body) => change({ body }), { rows: 4, placeholder: '{"query": "{{previous}}"}' }),
    step.method !== 'GET' && dim(`${TEMPLATE_HELP} (filled in as JSON text in a JSON body)`),
    pick(ctx, 'step:timeout', 'Give up after', withValue(HTTP_TIMEOUTS, step.timeoutSec).map((n) => ({ value: String(n), label: timeoutLabel(n) })), String(step.timeoutSec), (n) => change({ timeoutSec: Number(n) })),
    dim(SECRETS_NOTE),
  ];
  return nodes.filter((n): n is Node => Boolean(n));
}

function prFields(ctx: Ctx, step: PrStep, change: Change<PrStep>): Node[] {
  return [
    pick(ctx, 'step:draft', 'Open it as a draft', YES_NO, yesNo(step.draft), (value) => change({ draft: value === 'yes' })),
    dim('From the worktree an earlier Ask your agent step made (in a new worktree), with your pull request instructions. Without one, the run stops here. A draft can’t be merged by a later step.'),
  ];
}

function mergeFields(ctx: Ctx, s: Sentinel, step: MergeStep, change: Change<MergeStep>): Node[] {
  return [
    // Turning asking off asks first; turning it on doesn't.
    pick(ctx, 'step:approval', 'Ask me before merging', YES_NO, yesNo(step.require.approval), (value) => (value === 'yes' ? change({ require: { checks: true, approval: true } }) : ctx.go(askRoute('merge-alone', { id: s.id, step: step.id })))),
    pick(ctx, 'step:merge-as', 'Merge as', [{ value: 'squash', label: 'One squashed commit' }, { value: 'merge', label: 'A merge commit' }], step.method, (method) => change({ method: method as MergeStep['method'] })),
    dim(`${mergeWords(step)} The pull request must not be a draft or conflict; after merging, its worktree is archived.`),
  ];
}

function messageFields(ctx: Ctx, step: MessageStep, change: Change<MessageStep>): Node[] {
  const chats = chatChoices(ctx.state.network);
  return [
    chats.length ? pick(ctx, 'step:to', 'Writes in', [{ value: '', label: 'Pick a chat' }, ...chats], step.to, (to) => change({ to })) : dim(ctx.state.network.enabled ? 'No friends or groups yet: add a friend in Team.' : 'Turn on the network in Settings to message friends and groups.'),
    field(ctx, 'step:text', 'Message', step.text, (value) => change({ text: value }), { rows: 3, placeholder: '{{sentinel}}: {{previous}}' }),
    dim(`${TEMPLATE_HELP}; @name tags someone and tells them`),
  ];
}

function friendFields(ctx: Ctx, step: FriendStep, change: Change<FriendStep>): Node[] {
  const friends = [...ctx.state.network.friends].sort((a, b) => a.name.localeCompare(b.name));
  return [
    friends.length ? pick(ctx, 'step:friend', 'Whose agent', [{ value: '', label: 'Pick a friend' }, ...friends.map((f) => ({ value: f.peerId, label: f.name }))], step.peerId, (peerId) => change({ peerId })) : dim('No friends yet: add one in Team.'),
    field(ctx, 'step:ask', 'What to ask', step.prompt, (prompt) => change({ prompt }), { rows: 4, placeholder: 'Is staging up? Look at its logs since {{date}} and say what’s wrong.' }),
    dim(TEMPLATE_HELP),
    field(ctx, 'step:their-project', 'In their project', step.project ?? '', (value) => change({ project: value.trim() || undefined } as Partial<FriendStep>), { placeholder: 'Any (their choice)' }),
    dim('Asked as you; their trust in you decides what their agent may do. Their answer is this step’s output.'),
  ];
}

function triggerFields(ctx: Ctx, s: Sentinel, step: TriggerStep, change: Change<TriggerStep>): Node[] {
  const others = otherSentinels(ctx.state.sentinel.items, s.id);
  return [
    others.length ? pick(ctx, 'step:runs', 'Runs', [{ value: '', label: 'Pick a sentinel' }, ...others], step.sentinelId, (sentinelId) => change({ sentinelId })) : dim('There’s no other sentinel yet.'),
    dim('It starts that one with this run’s last output and goes on without waiting for it. A paused one doesn’t start.'),
  ];
}

function sourceFields(ctx: Ctx, source: Source, set: (next: Source) => unknown): Node[] {
  const database = source.kind === 'postgres' || source.kind === 'sqlite';
  const words = source.kind === 'postgres' || source.kind === 'sqlite' ? source.query : source.kind === 'command' ? source.command : source.kind === 'http' ? source.url : source.path;
  const nodes: Array<Node | false> = [
    pick(ctx, 'step:source', 'Source', SOURCE_CHOICES, source.kind, (kind) => set(newSource(kind))),
    source.kind === 'postgres' && field(ctx, 'step:source-env', 'Connection in', source.env ?? '', (value) => (value.trim() ? set({ ...source, env: value.trim().replace(/^\$/, '') }) : undefined), { placeholder: 'DATABASE_URL' }),
    source.kind === 'sqlite' && field(ctx, 'step:source-file', 'Database file', source.path, (value) => (value.trim() ? set({ ...source, path: value.trim() }) : undefined), { placeholder: 'data.db' }),
    field(ctx, 'step:source-main', database ? 'Query' : source.kind === 'command' ? 'Command' : source.kind === 'http' ? 'Address' : 'Path', words, (value) => {
      if (!value.trim()) return undefined;
      return set(source.kind === 'postgres' || source.kind === 'sqlite' ? { ...source, query: value } : source.kind === 'command' ? { ...source, command: value } : source.kind === 'http' ? { ...source, url: value.trim() } : { ...source, path: value.trim() });
    }, database ? { rows: 4 } : {}),
    dim(`${source.kind === 'postgres' ? 'The connection string stays in Settings › Environment or the project’s .env, never here. ' : ''}Run as you, with your environment, each run. A query that returns rows keeps them too.`),
  ];
  return nodes.filter((n): n is Node => Boolean(n));
}

function measureFields(ctx: Ctx, s: Sentinel, step: MeasureStep, change: Change<MeasureStep>): Node[] {
  const from = MEASURE_FROM_INFO.find((f) => f.value === step.from);
  const add = async (): Promise<void> => {
    const taken = new Set(step.metrics.map((m) => m.name));
    let name = 'value';
    for (let n = 2; taken.has(name); n++) name = `value-${n}`;
    await change({ metrics: [...step.metrics, { name, label: '', unit: 'count', better: 'up' }] });
    ctx.go({ name: 'spec', params: { id: s.id, step: step.id, at: String(step.metrics.length) } });
  };
  const nodes: Array<Node | false> = [
    pick(ctx, 'step:from', 'Reads', MEASURE_FROM_INFO, step.from, (value) => (value === 'source' ? change({ from: 'source', source: step.source ?? newSource('postgres') }) : change({ from: value as MeasureFrom }))),
    from ? dim(`${from.line}.`) : false,
    ...(step.from === 'source' && step.source ? sourceFields(ctx, step.source, (source) => change({ source })) : []),
    title('Numbers it keeps'),
    step.metrics.length === 0 && dim(`${step.from === 'claude' ? 'Every number the agent keeps, as it names them.' : 'Every top-level number it finds, by its name.'} Add one to name, label and format it.`),
    ...step.metrics.map((m, i) =>
      ctx.draw.button(`spec:${i}`, m.label || m.name, () => ctx.go({ name: 'spec', params: { id: s.id, step: step.id, at: String(i) } }), {
        plain: true,
        spans: [span(m.label || m.name), span(`  ${m.pick ? m.pick : m.name}  ${UNIT_CHOICES.find((u) => u.value === unitOf(m))?.label ?? unitOf(m)}`, { dim: true })],
      }),
    ),
    ctx.draw.button('spec:add', 'Add a Number', add, { plain: true, hotkey: 'a' }),
    dim(step.from === 'claude' ? 'Its name is what the agent passes to sentinel_measure.' : 'Where: a JSON path ($.items[0].statistics.subscriberCount, rows[0].count) or a column; empty: its name.'),
    step.metrics.some((m) => m.kind === 'rows') && pick(ctx, 'step:keep', 'Rows kept', [20, 50, 100, ROWS_KEPT].map((k) => ({ value: String(k), label: `${k} rows` })), String(step.keep ?? ROWS_KEPT), (value) => change({ keep: Number(value) })),
  ];
  return nodes.filter((n): n is Node => Boolean(n));
}

const unitOf = (m: MetricSpec): string => (m.kind === 'rows' || m.kind === 'series' || m.kind === 'output' ? m.kind : (m.unit ?? 'count'));

/** A spec without its empty fields (the engine checks names; labels and paths are optional). */
const clean = (m: MetricSpec): MetricSpec => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '')) as unknown as MetricSpec;

/** One number a Keep the numbers step keeps: its label, where it is, its unit, which way is good. */
export function specPage(ctx: Ctx, s: Sentinel, step: MeasureStep, at: number): Node {
  const m = step.metrics[at];
  if (!m) return page(top(ctx, 'sentinels'), back(ctx), empty('That number is gone.'));
  const save = saver(ctx, s);
  const change = (patch: Partial<MetricSpec>): unknown => save({ steps: patchStep<MeasureStep>(s.steps, step.id, { metrics: step.metrics.map((x, n) => (n === at ? clean({ ...x, ...patch }) : x)) }) });
  // Only one just added (still "value", "value-2"...) is named by its label: another's name is its file and its tiles' link.
  const fresh = /^value(-\d+)?$/.test(m.name) && !m.label;
  const noBetter = m.kind === 'rows' || m.kind === 'output';
  return page(
    top(ctx, 'sentinels'),
    back(ctx, step.name),
    title(m.label || m.name),
    field(ctx, 'spec:label', 'Label', m.label ?? '', (label) => change({ label, ...(fresh && label.trim() ? { name: metricName(label) } : {}) }), { placeholder: 'Subscribers' }),
    step.from === 'claude'
      ? field(ctx, 'spec:name', 'Name', m.name, (name) => (metricName(name) !== m.name ? change({ name: metricName(name) }) : undefined))
      : field(ctx, 'spec:pick', 'Where', m.pick ?? '', (pickAt) => change({ pick: pickAt }), { placeholder: m.name }),
    pick(ctx, 'spec:unit', 'Unit', UNIT_CHOICES, unitOf(m), (u) => change(u === 'rows' || u === 'output' ? { kind: u, unit: undefined, better: 'none' } : u === 'series' ? { kind: 'series', unit: undefined } : { kind: undefined, unit: u as MetricUnit })),
    !noBetter && pick(ctx, 'spec:better', 'Which way is good', BETTER_CHOICES, m.better ?? 'up', (better) => change({ better: better as Better })),
    ctx.draw.button(
      'spec:remove',
      'Remove',
      async () => {
        await save({ steps: patchStep<MeasureStep>(s.steps, step.id, { metrics: step.metrics.filter((_, n) => n !== at) }) });
        ctx.nav.back(ctx.pane);
      },
      { plain: true, dim: true, hotkey: 'x' },
    ),
  );
}

export function stepPage(ctx: Ctx, s: Sentinel, step: Step): Node {
  const save = saver(ctx, s);
  const change = <S extends Step>(patch: Partial<S>): unknown => save({ steps: patchStep<S>(s.steps, step.id, patch) });
  const fields = (): Node[] => {
    switch (step.kind) {
      case 'claude':
        return agentFieldsOf(ctx, s, step, change<ClaudeStep>);
      case 'script':
        return scriptFields(ctx, step, change<ScriptStep>);
      case 'notify':
        return notifyFields(ctx, step, change<NotifyStep>);
      case 'http':
        return httpFields(ctx, step, change<HttpStep>);
      case 'pr':
        return prFields(ctx, step, change<PrStep>);
      case 'merge':
        return mergeFields(ctx, s, step, change<MergeStep>);
      case 'message':
        return messageFields(ctx, step, change<MessageStep>);
      case 'friend':
        return friendFields(ctx, step, change<FriendStep>);
      case 'trigger':
        return triggerFields(ctx, s, step, change<TriggerStep>);
      case 'measure':
        return measureFields(ctx, s, step, change<MeasureStep>);
    }
  };
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    col([title(step.name), dim(`${STEP_INFO[step.kind].label} · ${stepSentence(step, nameIn(ctx.state.sentinel))}`)]),
    field(ctx, 'step:name', 'Name', step.name, (value) => {
      const name = value.replace(/\s+/g, ' ').trim();
      return name ? change({ name }) : undefined;
    }),
    ...fields(),
    ctx.draw.button('step:more', 'More', () => ctx.go({ name: 'step-more', params: { id: s.id, step: step.id } }), { plain: true, dim: true, hotkey: 'm' }),
  );
}

/** A step's place in the list, a copy of it, and taking it out. */
export function stepMorePage(ctx: Ctx, s: Sentinel, step: Step): Node {
  const save = saver(ctx, s);
  const at = s.steps.findIndex((x) => x.id === step.id);
  return page(
    top(ctx, 'sentinels'),
    back(ctx, step.name),
    title(step.name),
    at > 0 && ctx.draw.button('step:up', 'Move Up', () => save({ steps: moveStep(s.steps, at, -1) }), { plain: true, hotkey: 'u' }),
    at < s.steps.length - 1 && ctx.draw.button('step:down', 'Move Down', () => save({ steps: moveStep(s.steps, at, 1) }), { plain: true, hotkey: 'j' }),
    ctx.draw.button(
      'step:duplicate',
      'Duplicate',
      async () => {
        await ctx.call('sentinel.update', s.id, { steps: duplicateStep(s.steps, at) });
        leave(ctx, (route) => route.name === 'step-more');
      },
      { plain: true, hotkey: 'e' },
    ),
    ctx.draw.button('step:remove', 'Remove...', () => ctx.go(askRoute('remove-step', { id: s.id, step: step.id })), { plain: true, hotkey: 'x' }),
  );
}
