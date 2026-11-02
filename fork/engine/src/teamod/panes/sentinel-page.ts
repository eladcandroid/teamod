import { COMPARE, COMPARE_LABEL, type Compare } from '../../core/sentinel/metrics.js';
import {
  ACCESS,
  ACCESS_INFO,
  CLAUDE_CHANGED,
  CLAUDE_CHANGED_BANNER,
  DEFAULT_KEEP_CHATS,
  KEEP_CHATS,
  KEEP_CHATS_INFO,
  NOTIFY_WHERE,
  type Access,
  type KeepChats,
  type MetricSeries,
  type RunSummary,
  type Sentinel,
  type WebhookAddress,
  accessAllows,
  accessRank,
  activeSentinelChat,
  runsOf,
  scheduleSentence,
  stepSentence,
  type WebhookTrigger,
} from '../../core/sentinel/model.js';
import type { SentinelTest } from '../../core/sentinel/preview.js';
import { recipeById } from '../../core/sentinel/recipes.js';
import { ASSISTANT_TITLE } from '../../shared/assistant.js';
import { agentChoices } from '../../ui/agent-choice.js';
import { activityOf } from '../../ui/workspace-models.js';
import type { Ctx } from '../screens.js';
import { type Node, code, col, dim, line, md, row, span, text, title } from '../tree.js';
import { ago, back, empty, page, peerText } from './common.js';
import { askRoute, webhookKey } from './sentinel-asks.js';
import { attention, field, leave, loadNote, openChannel, openRun, openSentinel, pick, saver, top, windowed } from './sentinel-common.js';
import { MAC_SCOPE, METRIC_KIND_WORDS, NOTIFY_LABEL, WEBHOOK_MOVES, accessSentence, askLine, doesLine, durationText, headlineOf, isRunning, metricsOf, nameIn, nextText, numberWords, pauseAfterChoices, perDayChoices, runStyle, runWord, sharedAgent, sparkline, timeChoices, toneStyle, troubleOf, whenText, withAgent } from './sentinel-model.js';

/** A sentinel's page: what it is and how it's doing, what starts it, its steps, its numbers, its runs; what's advanced is under More. */

/** Why it's paused, or what the agent changed; what to do is the main action above. */
function banner(ctx: Ctx, s: Sentinel): Node | undefined {
  if (s.paused && s.pausedWhy === CLAUDE_CHANGED) return text(CLAUDE_CHANGED_BANNER, { color: 'warning' });
  if (s.paused && s.pausedWhy) {
    const last = runsOf(ctx.state.sentinel, s.id)[0];
    return col([
      text(`${s.pausedWhy}.`, { color: 'warning', weight: 'semibold' }),
      dim(last?.why ? `The last one: ${last.why.split('\n')[0]}` : 'Look at the last run, fix what it needs, then resume.'),
    ]);
  }
  if (s.paused) return dim(`This sentinel is paused. Turn On to let it run${s.trigger.kind === 'schedule' ? ' on its schedule' : s.trigger.kind === 'manual' || s.trigger.kind === 'after' ? '' : ' when it happens'}; Run Now tries it once first.`);
  const trouble = troubleOf(ctx.state.sentinel, s);
  return trouble ? text(`Can’t watch: ${trouble}`, { color: 'error' }) : undefined;
}

/** One sentence to the Sentinel chat, naming this sentinel; your agent changes it there. And how a Describe it is going. */
function askBox(ctx: Ctx, s: Sentinel): Node {
  const ask = ctx.state.sentinel.asks?.[s.id];
  const said = askLine(ask, ask?.state === 'writing' ? activityOf(ctx.state.log, ask.channel) : undefined);
  return col([
    ctx.draw.input(
      `ask:${s.id}`,
      async (value) => {
        const words = value?.trim();
        if (!words) return;
        await ctx.call('session.submit', `About “${s.name}”: ${words}`, { channel: activeSentinelChat(ctx.state.sentinel.chats) });
        ctx.go({ name: 'chat' });
      },
      { placeholder: 'Ask your agent about this sentinel: “make it weekly”, “why did it fail?”', submitLabel: 'ask' },
    ),
    ask && said && row([text(said.text, said.who === 'failed' ? { color: 'error' } : said.who === 'agent' ? { color: 'claude' } : { dim: true }), ctx.draw.button('ask:chat', 'Open Chat', () => openChannel(ctx, ask.channel), { plain: true, dim: true })]),
    ask && attention(ctx, ask.channel),
  ]);
}

function stepsCard(ctx: Ctx, s: Sentinel): Node {
  const nameOf = nameIn(ctx.state.sentinel);
  return col([
    row([title('Steps'), ctx.draw.button('add-step', 'Add a Step', () => ctx.go({ name: 'add-step', params: { id: s.id } }), { plain: true, hotkey: 'a' })]),
    s.steps.length === 0 && empty('No steps yet. Add what it does, in order: ask your agent, run a script, call a service, tell you.'),
    ...s.steps.map((st, i) =>
      ctx.draw.button(`step:${st.id}`, st.name, () => ctx.go({ name: 'step', params: { id: s.id, step: st.id } }), {
        plain: true,
        spans: [span(`${i + 1}  `, { dim: true }), span(st.name), span(`  ${stepSentence(st, nameOf)}`, { dim: true })],
      }),
    ),
  ]);
}

/** A sentinel's numbers: each with its change and its points; a press reads its whole history. */
function numbersCard(ctx: Ctx, s: Sentinel): Node | undefined {
  const { numbers, tables, series, outputs } = metricsOf(ctx.state.sentinel, s.id);
  if (!numbers.length && !tables.length && !series.length && !outputs.length) return undefined;
  const [compare, setCompare] = ctx.local<Compare>(`sn:numbers:compare:${s.id}`, 'previous');
  const open = (m: MetricSeries): void => ctx.go(m.kind === 'rows' ? { name: 'rows', params: { id: s.id, name: m.name } } : { name: 'metric', params: { id: s.id, name: m.name } });
  const rows = [...numbers, ...tables, ...series, ...outputs];
  const shown = windowed(ctx, `numbers:${s.id}`, rows, { page: 20 });
  return col([
    title('Numbers'),
    numbers.length > 0 && pick(ctx, 'numbers:compare', 'Compare', COMPARE.map((c) => ({ value: c, label: COMPARE_LABEL[c] })), compare, (c) => setCompare(c as Compare)),
    shown.before,
    ...shown.shown.map((m) => {
      if (m.kind === 'number') {
        const w = numberWords(m, compare);
        const spark = sparkline(w.trend);
        return ctx.draw.button(`metric:${m.name}`, m.label, () => open(m), {
          plain: true,
          spans: [span(m.label), span(`  ${w.value}${w.unit ? ` ${w.unit}` : ''}`, { weight: 'semibold' }), span(w.change ? `  ${w.change}` : '', toneStyle(w.tone)), span(spark ? `  ${spark}` : '', { dim: true })],
        });
      }
      const size = m.kind === 'rows' ? `${m.rows?.length ?? 0} rows` : m.kind === 'series' ? `${m.series?.length ?? 0} points` : METRIC_KIND_WORDS[m.kind];
      return ctx.draw.button(`metric:${m.name}`, m.label, () => open(m), { plain: true, spans: [span(m.label), span(`  ${size}${m.rowsAt ? ` · ${ago(m.rowsAt)}` : ''}`, { dim: true })] });
    }),
    shown.after,
  ]);
}

/** A run as a row: when, by what, how it went, its line, how long. */
export function runRow(ctx: Ctx, r: RunSummary, now: number, liveStep?: string): Node {
  return ctx.draw.button(`run:${r.id}`, headlineOf(r), () => openRun(ctx, r), {
    plain: true,
    spans: [span(`${whenText(r.startedAt, now)}  `, { dim: true }), span(`${runWord(r.state)}  `, runStyle(r.state)), span(liveStep ? `${liveStep}...` : headlineOf(r)), span(`  ${durationText((r.endedAt ?? now) - r.startedAt)}`, { dim: true })],
  });
}

const HISTORY_ROWS = 10;

/** The runs: the last 30 as dots, then the newest as rows; all of them are a press away. */
function history(ctx: Ctx, s: Sentinel): Node {
  const state = ctx.state.sentinel;
  const now = Date.now();
  const runs = runsOf(state, s.id);
  const dots = [...runs].sort((a, b) => a.startedAt - b.startedAt).slice(-30);
  return col([
    row([
      title('History'),
      runs.length > 0 && ctx.draw.button('runs', 'All Runs', () => ctx.go({ name: 'runs', params: { id: s.id } }), { plain: true, dim: true, hotkey: 'h' }),
      runs.length > 0 && ctx.draw.button('data', 'Kept Data', () => ctx.go({ name: 'data', params: { id: s.id } }), { plain: true, dim: true, hotkey: 'f' }),
    ]),
    runs.length === 0 && empty('No runs yet. Run Now tries it once.'),
    dots.length > 1 && line(...dots.map((r) => span('• ', runStyle(r.state)))),
    ...runs.slice(0, HISTORY_ROWS).map((r) => {
      const stepId = r.state === 'running' ? state.live[r.id]?.stepId : undefined;
      return runRow(ctx, r, now, stepId ? s.steps.find((x) => x.id === stepId)?.name : undefined);
    }),
  ]);
}

export function sentinelPage(ctx: Ctx, s: Sentinel): Node {
  const state = ctx.state.sentinel;
  const sentence = scheduleSentence(s.trigger, nameIn(state));
  const running = runsOf(state, s.id).find((r) => isRunning(r.state));
  const project = ctx.state.projects.find((p) => p.id === s.projectId);
  const turnOn = s.pausedWhy && s.pausedWhy !== CLAUDE_CHANGED ? 'Resume' : 'Turn On';
  const next = state.nextAt[s.id];
  const run = async (): Promise<void> => {
    await ctx.call('sentinel.run', s.id);
    ctx.effect({ toast: `${s.name} is running` });
  };
  return page(
    top(ctx, 'sentinels'),
    back(ctx),
    col([title(s.name), dim(project?.name ?? ASSISTANT_TITLE)]),
    banner(ctx, s),
    row([
      s.paused
        ? ctx.draw.button('pause', turnOn, () => ctx.call('sentinel.pause', s.id, false), { primary: true, hotkey: 'p' })
        : ctx.draw.button('run', 'Run Now', run, { primary: true, hotkey: 'r' }),
      s.paused
        ? ctx.draw.button('run', 'Run Now', run, { hotkey: 'r' })
        : ctx.draw.button('pause', 'Pause', () => ctx.call('sentinel.pause', s.id, true), { hotkey: 'p' }),
      running &&
        ctx.draw.button('stop', 'Stop', async () => {
          await ctx.call('sentinel.stop', running.id);
          ctx.effect({ toast: 'Stopped' });
        }, { hotkey: 'x' }),
      ctx.draw.button('more', 'More', () => ctx.go({ name: 'more', params: { id: s.id } }), { plain: true, dim: true, hotkey: 'm' }),
    ]),
    askBox(ctx, s),
    ctx.draw.button('when', sentence, () => ctx.go({ name: 'when', params: { id: s.id } }), {
      plain: true,
      hotkey: 'e',
      spans: [span('When  ', { dim: true }), span(sentence), span(next !== undefined && !s.paused ? `  next ${nextText(next, Date.now())}` : '', { dim: true })],
    }),
    stepsCard(ctx, s),
    numbersCard(ctx, s),
    history(ctx, s),
    dim(`${ACCESS_INFO[s.access].label}: ${accessSentence(s.access, s.steps)}. ${s.limits.minutes} minutes a run.`),
  );
}

/** What it may do and when it stops, the rest of what it can do. */
export function morePage(ctx: Ctx, s: Sentinel): Node {
  const save = saver(ctx, s);
  const hasAgent = s.steps.some((x) => x.kind === 'claude');
  const shared = sharedAgent(s.steps);
  const agents = agentChoices(ctx.state.runtimes, ctx.state.models).filter((c) => !c.disabled);
  const projects = ctx.state.projects.filter((p) => p.root && !p.error);
  // Less access than its steps need can't be chosen: say which step, rather than offer it and refuse.
  const allowed = ACCESS.filter((a) => s.steps.every((st) => accessAllows(a, st.kind, st.kind === 'claude' ? st.where : undefined)));
  const held = ACCESS.filter((a) => !allowed.includes(a));
  const [tested, setTested] = ctx.local<SentinelTest | 'testing' | undefined>(`sn:test:${s.id}`, undefined);
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    title('More'),
    field(ctx, 'name', 'Name', s.name, (value) => (value.replace(/\s+/g, ' ').trim() ? save({ name: value.replace(/\s+/g, ' ').trim() }) : undefined)),
    pick(ctx, 'project', 'Project', [{ value: MAC_SCOPE, label: ASSISTANT_TITLE }, ...projects.map((p) => ({ value: p.id, label: p.name }))], s.projectId ?? MAC_SCOPE, (value) => save({ projectId: value === MAC_SCOPE ? null : value })),
    pick(ctx, 'access', 'Access', allowed.map((a) => ({ value: a, label: ACCESS_INFO[a].label })), s.access, (value) => {
      const access = value as Access;
      // Letting it do more asks first; less saves at once.
      return accessRank(access) > accessRank(s.access) ? ctx.go(askRoute('access', { id: s.id, access })) : save({ access });
    }),
    dim(`${accessSentence(s.access, s.steps)}.${held.length ? ` ${held.map((a) => ACCESS_INFO[a].label).join(' and ')} isn’t offered: remove the steps that need more first.` : ''}`),
    hasAgent && pick(ctx, 'agent', 'Agent', [...(shared === undefined ? [{ value: 'mixed', label: 'Mixed' }] : []), { value: '', label: 'Your default agent' }, ...agents.map((c) => ({ value: c.value, label: c.label }))], shared ?? 'mixed', (value) => (value === 'mixed' ? undefined : save({ steps: withAgent(s.steps, value) }))),
    pick(ctx, 'time', 'Time limit', timeChoices(s.limits.minutes), String(s.limits.minutes), (value) => save({ limits: { minutes: Number(value) } })),
    pick(ctx, 'per-day', 'Runs per day', perDayChoices(s.limits.perDay ?? 0), String(s.limits.perDay ?? 0), (value) => save({ limits: { perDay: Number(value) } })),
    pick(ctx, 'pause-after', 'Pause after', pauseAfterChoices(s.limits.pauseAfter), String(s.limits.pauseAfter), (value) => save({ limits: { pauseAfter: Number(value) } })),
    hasAgent && pick(ctx, 'keep-chats', 'Keep chats', KEEP_CHATS.map((k) => ({ value: k, label: KEEP_CHATS_INFO[k].label })), s.keepChats ?? DEFAULT_KEEP_CHATS, (value) => save({ keepChats: value as KeepChats })),
    pick(ctx, 'notify', 'Notify', NOTIFY_WHERE.map((n) => ({ value: n, label: NOTIFY_LABEL[n] })), s.notify, (value) => save({ notify: value as Sentinel['notify'] })),
    col([
      ctx.draw.button(
        'test',
        'Test Its Sources',
        async () => {
          setTested('testing');
          try {
            setTested((await ctx.call('sentinel.test', s.id)) as SentinelTest | undefined);
          } catch (err) {
            setTested(undefined);
            throw err;
          }
        },
        { plain: true, hotkey: 'i' },
      ),
      tested === 'testing' ? dim('Testing...') : tested ? md(peerText(tested.text)) : dim('Its Keep the numbers sources once, without turning it on; nothing else runs.'),
      tested && tested !== 'testing' && tested.runId ? ctx.draw.button('test:run', 'Open the Test', () => openRun(ctx, { id: tested.runId!, sentinelId: s.id }), { plain: true, dim: true }) : undefined,
    ]),
    ctx.draw.button(
      'duplicate',
      'Duplicate',
      async () => {
        const copy = (await ctx.call('sentinel.duplicate', s.id)) as Sentinel | undefined;
        ctx.effect({ toast: `Made a copy of ${s.name} (paused)` });
        if (copy?.id) {
          leave(ctx, (route) => route.name === 'more');
          openSentinel(ctx, copy.id);
        }
      },
      { plain: true, hotkey: 'u' },
    ),
    ctx.draw.button('copy-json', 'Copy as JSON', () => ctx.effect({ copy: JSON.stringify(s, null, 2), toast: `Copied ${s.name} as JSON` }), { plain: true }),
    ctx.draw.button('delete', 'Delete...', () => ctx.go(askRoute('remove', { id: s.id })), { plain: true, hotkey: 'x' }),
    dim(`Id ${s.id}${s.recipe ? ` · Recipe ${recipeById(s.recipe)?.name ?? s.recipe}` : ''} · Created ${ago(s.createdAt)} · Changed ${ago(s.updatedAt)}`),
  );
}

/** Every run of a sentinel the index keeps (the state has the last 30), newest first. */
export function runsPage(ctx: Ctx, s: Sentinel): Node {
  const inState = runsOf(ctx.state.sentinel, s.id);
  const loaded = ctx.load(`sentinel:runs:${s.id}`, async () => (await ctx.call('sentinel.runs', s.id)) as readonly RunSummary[] | undefined, { ttlMs: 5000 });
  const runs = loaded.value ?? inState;
  const shown = windowed(ctx, `runs:${s.id}`, runs);
  const now = Date.now();
  return page(
    top(ctx, 'sentinels'),
    back(ctx, s.name),
    col([title('Runs'), dim(doesLine(s))]),
    loaded.error ? text(loaded.error, { color: 'error' }) : undefined,
    runs.length === 0 && (loaded.loading ? dim('Reading its runs...') : empty('No runs yet.')),
    shown.before,
    ...shown.shown.map((r) => runRow(ctx, r, now)),
    shown.after,
  );
}

/**
 * A webhook's address. The route is the press: it's fetched and drawn only here, after Show URL on
 * its When page, and Back hides it. No list and no other page ever reads it, and the signing secret
 * only ever goes to the clipboard.
 */
export function webhookPage(ctx: Ctx, s: Sentinel): Node {
  if (s.trigger.kind !== 'webhook') return page(top(ctx, 'sentinels'), back(ctx), empty('It doesn’t start from a webhook any more.'));
  const trigger: WebhookTrigger = s.trigger;
  const loaded = ctx.load<WebhookAddress | undefined>(webhookKey(s.id), async () => (await ctx.call('sentinel.webhookUrl', s.id)) as WebhookAddress | undefined, { ttlMs: 5000 });
  const address = loaded.value;
  return page(
    top(ctx, 'sentinels'),
    back(ctx, 'Hide'),
    title('Its URL'),
    loadNote(loaded, 'Looking...'),
    address?.url ? code(address.url) : undefined,
    address?.why ? dim(address.why) : undefined,
    address?.url ? ctx.draw.button('webhook:copy', 'Copy URL', () => ctx.effect({ copy: address.url!, toast: 'Copied the webhook URL' }), { primary: true, hotkey: 'y' }) : undefined,
    trigger.signature === 'github' && address?.signingSecret ? ctx.draw.button('webhook:secret', 'Copy Secret', () => ctx.effect({ copy: address.signingSecret!, toast: 'Copied the secret' }), { hotkey: 'e' }) : undefined,
    trigger.signature === 'github' && dim('GitHub’s webhook form asks for the secret as its Secret.'),
    dim(`Keep it to yourself: the URL holds its secret. ${WEBHOOK_MOVES}`),
  );
}
