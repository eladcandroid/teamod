import { CAP_INFO, CAP_LEVEL_INFO, CAP_ORDER, CAP_TRUST, type CapLevel, DECISION_INFO, EXPIRIES, EXPIRY_INFO, type Expiry, RULE_DECISIONS, type RequestFacts, type Rule, type RuleDecision, capFor, expiryLabel, ruleFor, ruleKindOf, ruleLabel, scopeChoices } from '../../core/gateway/access.js';
import { type TaskView, isFinal, oneLine, requestGist, stateLabel, stateTone, targetLabel } from '../../core/gateway/model.js';
import type { Need } from '../../core/gateway/protocol.js';
import { TRUST_INFO } from '../../core/trust.js';
import { agentLabel } from '../../shared/agent-label.js';
import { formatBytes } from '../../shared/format.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, code, col, dim, line, md, row, span, text } from '../tree.js';
import { type Tone, actions, ago, back, card, empty, field, homePath, meta, page, pill, section } from './common.js';
import { choice, confirmPress, levelOf, listOf, nameOf, needsYou, peerLine, peerMd, picture, top, wholePath } from './team-common.js';

/**
 * Tasks between agents: what you and your agent asked of others, what they asked of yours, and how
 * you answer. Everything here that changes what a teammate may do is a press or a field of yours;
 * what they wrote is only ever drawn.
 */

const PILL_TONE: Readonly<Record<ReturnType<typeof stateTone>, Tone>> = { ok: 'ok', warn: 'warn', error: 'error', claude: 'accent', muted: 'quiet' };

/** Where a request stands, as a colored pill. */
const statePill = (t: TaskView): Span => pill(stateLabel(t), PILL_TONE[stateTone(t)]);

const whoOf = (t: TaskView): string => (t.direction === 'sent' ? targetLabel(t) : `${t.peerName}${t.by === 'agent' ? '’s agent' : ''}`);

/** "Asked by bob’s agent", "To bob’s Mac": the direction its own word, so the name stays as it is. */
const whoSpans = (t: TaskView, style: Omit<Span, 't'>): Span[] => [span(`${t.direction === 'sent' ? 'To' : 'Asked by'} `, style), span(whoOf(t), style)];

/** What it asks, in a line: the command, or the gist. */
const askLine = (t: TaskView, max = 70): string => (t.kind === 'run' && t.command ? `$ ${oneLine(t.command, max)}` : requestGist(t, max));

/**
 * One request as a card: who (it opens in full), where it stands, what it asks, and its answer once
 * there is one. One that waits for you says so in its border; on the Requests list, `decide` puts
 * Allow and Decline on it. What they asked is drawn as their words; `inChat`, where a conversation's
 * messages are its only markdown, as plain words.
 */
export function taskRow(ctx: Ctx, key: string, t: TaskView, decide = false, inChat = false): Node {
  const waits = needsYou(t);
  const quick = decide && waits && t.direction === 'received' && t.state === 'awaiting_approval' && !t.secret;
  const answer = t.result?.summary?.trim() ? peerLine(t.result.summary, 120) : undefined;
  return card(
    [
      ctx.draw.button(key, whoOf(t), () => ctx.go({ name: 'request', params: { id: t.id } }), { plain: true, spans: whoSpans(t, { weight: 'bold' }) }),
      meta(statePill(t), ago(t.createdAt)),
      inChat || (t.kind === 'run' && t.command) ? text(askLine(t)) : md(peerLine(t.summary?.trim() || t.ask, 70)),
      answer ? (inChat ? line(span('Answer  ', { dim: true }), span(answer, { dim: true })) : col([dim('Answer'), md(answer)])) : undefined,
      quick &&
        actions(
          ctx.draw.button(`decide:${t.id}:yes`, 'Allow', () => ctx.call('gateway.decide', t.id, { answer: 'yes', ...once }), {}),
          ctx.draw.button(`decide:${t.id}:no`, 'Decline', () => ctx.call('gateway.decide', t.id, { answer: 'no', ...once }), { plain: true, dim: true }),
        ),
    ],
    waits ? { tone: 'warn' } : {},
  );
}

export function requestsPage(ctx: Ctx): Node {
  const gw = ctx.state.gateway;
  if (!gw.enabled) return page(top(ctx, 'requests'), empty('Requests between agents aren’t running on this engine.'));
  const [tab, setTab] = ctx.local<'sent' | 'received'>('requests:tab', gw.tasks.some((t) => t.direction === 'received' && !isFinal(t.state)) ? 'received' : 'sent');
  const [answered, setAnswered] = ctx.local('requests:answered', false);
  const newest = [...gw.tasks].reverse();
  const waiting = newest.filter(needsYou);
  const mine = newest.filter((t) => t.direction === tab && !needsYou(t));
  const open = mine.filter((t) => !isFinal(t.state));
  const done = mine.length - open.length;
  const shown = answered ? mine : open;
  const count = (d: 'sent' | 'received'): number => gw.tasks.filter((t) => t.direction === d && !isFinal(t.state)).length;
  return page(
    top(ctx, 'requests'),
    ctx.draw.button('ask', 'Ask Someone’s Agent', () => ctx.go({ name: 'ask' }), { primary: true, hotkey: 'a' }),
    waiting.length > 0 && section('Waiting for you', [listOf(ctx, 'waiting', waiting, (t) => taskRow(ctx, `waiting:${t.id}`, t, true))], waiting.length),
    col(
      [
        row([choice(ctx, 'tab:received', `Received (${count('received')})`, tab === 'received', () => setTab('received')), choice(ctx, 'tab:sent', `Sent (${count('sent')})`, tab === 'sent', () => setTab('sent'))], { gap: 3 }),
        shown.length > 0
          ? listOf(ctx, `requests:${tab}`, shown, (t) => taskRow(ctx, `task:${t.id}`, t))
          : waiting.some((t) => t.direction === tab)
            ? undefined
            : empty(done ? 'Nothing open. Everything here has been answered.' : tab === 'sent' ? 'Nothing sent yet. Ask your agent to get something from a teammate’s agent, or ask one yourself.' : 'Nothing received yet. When a teammate’s agent asks yours for something, it shows here.'),
      ],
      { top: 1 },
    ),
    row([
      done > 0 && ctx.draw.button('answered', answered ? 'Hide Answered' : `Show Answered (${done})`, () => setAnswered(!answered), { plain: true, dim: true }),
      ctx.draw.button('requests:more', 'More', () => ctx.go({ name: 'access' }), { plain: true, dim: true, hotkey: 'm' }),
    ], { gap: 3 }),
  );
}

/** What's known about a request on this side: the rule "Always" would write comes from it. */
function factsOf(t: TaskView): RequestFacts {
  return {
    peerId: t.peerId,
    kind: ruleKindOf(t.kind),
    needs: t.needs,
    ...(t.project ? { project: t.project } : {}),
    ...(t.command ? { command: t.command } : {}),
    ...(t.folder ? { folder: t.folder } : t.kind === 'file' && t.path ? { folder: t.path.replace(/\/[^/]*$/, '') || '/' } : t.cwd ? { folder: t.cwd } : {}),
  };
}

const whereLine = (t: TaskView): string => (t.kind === 'file' ? (t.path ?? 'A file') : t.project ? `In your project ${t.project}` : t.kind === 'run' ? (t.folder ?? t.cwd ?? 'Your shared folder') : 'A new scratch folder, just for this request');

const backLine = (t: TaskView): string => (t.kind === 'run' ? 'The output and exit code' : t.kind === 'file' ? 'The file' : t.expects === 'files' ? 'Files' : t.expects ? 'Structured data' : 'A summary of what your agent did');

const needsOf = (t: TaskView): readonly Need[] => [...new Set(t.kind === 'run' ? (['shell', ...t.needs] as Need[]) : t.kind === 'file' ? (['files'] as Need[]) : t.needs)];

const once = { scope: 'this', command: 'this', expiry: 'never' } as const;

/** Your answer to a teammate's request: only ever one of these presses. */
function answerCard(ctx: Ctx, t: TaskView): Node {
  const [mode, setMode] = ctx.local<'choose' | 'always'>(`request:${t.id}:mode`, 'choose');
  const [scope, setScope] = ctx.local<'this' | 'any'>(`request:${t.id}:scope`, 'this');
  const [command, setCommand] = ctx.local<'this' | 'any'>(`request:${t.id}:command`, 'this');
  const [expiry, setExpiry] = ctx.local<Expiry>(`request:${t.id}:expiry`, 'never');
  const facts = factsOf(t);
  const decide = (decision: { answer: 'yes' | 'no' | 'always'; scope: 'this' | 'any'; command: 'this' | 'any'; expiry: Expiry }): Promise<unknown> => ctx.call('gateway.decide', t.id, decision);
  // A secret is asked about each time: nothing makes it "Always".
  if (mode === 'always' && !t.secret) {
    const scopes = scopeChoices(facts);
    const rule = ruleFor(facts, t.peerName, { scope, command, expiry }, Date.now(), 'r_preview00');
    return col([
      section('Always allow', []),
      scopes &&
        row([
          choice(ctx, `always:${t.id}:this`, scopes.this, scope === 'this', () => setScope('this')),
          // Any command anywhere would be full trust for commands: not from here.
          command === 'any' ? undefined : choice(ctx, `always:${t.id}:any`, scopes.any, scope === 'any', () => setScope('any')),
        ]),
      t.kind === 'run' &&
        row([
          choice(ctx, `always:${t.id}:this-command`, 'This command', command === 'this', () => setCommand('this')),
          choice(ctx, `always:${t.id}:any-command`, 'Any command', command === 'any', () => {
            setCommand('any');
            setScope('this');
          }),
        ]),
      row(EXPIRIES.map((e) => choice(ctx, `always:${t.id}:${e}`, e === 'never' ? 'Until I change it' : EXPIRY_INFO[e], expiry === e, () => setExpiry(e)))),
      text(`From now on, ${t.peerName}’s requests like this run without asking: ${ruleLabel(rule)}.`),
      row([
        ctx.draw.button(
          `decide:${t.id}:always-yes`,
          'Always Allow',
          async () => {
            setMode('choose');
            await decide({ answer: 'always', scope, command, expiry });
          },
          { primary: true, hotkey: 'a' },
        ),
        ctx.draw.button(`always:${t.id}:cancel`, 'Back', () => setMode('choose'), { plain: true, dim: true, hotkey: 'x' }),
      ], { gap: 2, top: 1 }),
    ]);
  }
  return actions(
    ctx.draw.button(`decide:${t.id}:yes`, t.secret ? 'Allow Once' : 'Allow', () => decide({ answer: 'yes', ...once }), { primary: true, hotkey: 'a' }),
    ctx.draw.button(`decide:${t.id}:no`, 'Decline', () => decide({ answer: 'no', ...once }), { hotkey: 'n' }),
    t.secret ? undefined : ctx.draw.button(`decide:${t.id}:always`, 'Always', () => setMode('always'), { plain: true, hotkey: 'y' }),
    ctx.draw.button(`request:${t.id}:more`, 'More', () => ctx.go({ name: 'request-more', params: { id: t.id } }), { plain: true, dim: true, hotkey: 'm' }),
  );
}

/** "Ask bob's agent?": your agent wants to send this, and waits for you. */
function confirmCard(ctx: Ctx, t: TaskView): Node {
  const [editing, setEditing] = ctx.local(`request:${t.id}:editing`, false);
  return col([
    dim(`Your agent wants to send this, so it asks you first. Always lets it ask ${t.peerName} without checking from now on; it doesn’t change what they may do here.`),
    editing &&
      ctx.draw.input(
        `confirm:${t.id}:words`,
        async (value) => {
          const words = value?.trim();
          if (!words) return;
          setEditing(false);
          await ctx.call('gateway.confirm', t.id, true, words === t.ask.trim() ? '' : words);
        },
        { label: 'What to ask', value: t.ask, rows: 4, submitLabel: 'ask', autoFocus: true },
      ),
    actions(
      ctx.draw.button(`confirm:${t.id}:yes`, 'Ask Their Agent', () => ctx.call('gateway.confirm', t.id, true), { primary: true, hotkey: 'a' }),
      ctx.draw.button(`confirm:${t.id}:always`, 'Always', () => ctx.call('gateway.confirm', t.id, true, '', true), { plain: true, hotkey: 'y' }),
      ctx.draw.button(`confirm:${t.id}:no`, 'Not Now', () => ctx.call('gateway.confirm', t.id, false), { plain: true, dim: true, hotkey: 'n' }),
      editing ? undefined : ctx.draw.button(`confirm:${t.id}:edit`, 'Edit', () => setEditing(true), { plain: true, dim: true }),
    ),
  ]);
}

/** Their agent asks something about what you sent: an answer of yours, or let them decide. */
function questionCard(ctx: Ctx, t: TaskView): Node | undefined {
  const q = t.question;
  if (!q) return undefined;
  const draft = t.answerDraft?.qid === q.qid ? t.answerDraft.answers : undefined;
  const [texts, setTexts] = ctx.local<readonly string[]>(`request:${t.id}:${q.qid}:answers`, draft ?? []);
  const send = (answers: readonly string[] | 'skip'): Promise<unknown> => ctx.call('gateway.answer', t.id, answers);
  const head = q.questions[0];
  const single = !draft && q.questions.length === 1 && head !== undefined && head.options.length > 0 && !head.multiSelect;
  return col([
    ...q.questions.map((item, i) =>
      col([
        line(span(`${t.peerName}’s agent asks:`, { weight: 'bold' })),
        text(item.question),
        single && row(item.options.map((o, n) => ctx.draw.button(`question:${t.id}:${q.qid}:${i}:${n}`, o.label, () => send([o.label]), {}))),
        !single &&
          ctx.draw.input(
            `question:${t.id}:${q.qid}:${i}:words`,
            async (value) => {
              const next = q.questions.map((_, at) => (at === i ? (value ?? '') : (texts[at] ?? '')));
              setTexts(next);
              if (q.questions.length === 1 && value?.trim()) await send(next);
            },
            { placeholder: item.options.length ? item.options.map((o) => o.label).join(' / ') : 'Your answer', submitLabel: q.questions.length === 1 ? 'send' : 'keep', ...(texts[i] ? { value: texts[i] } : {}) },
          ),
      ]),
    ),
    actions(
      !single && q.questions.length > 1 && texts.some((x) => x.trim()) ? ctx.draw.button(`question:${t.id}:send`, 'Send Answer', () => send(q.questions.map((_, i) => texts[i] ?? '')), { primary: true, hotkey: 'a' }) : undefined,
      ctx.draw.button(`question:${t.id}:skip`, 'Let Them Decide', () => send('skip'), { plain: true, dim: true, hotkey: 'n' }),
      draft ? dim('Your agent’s answer: you hadn’t seen this request, so it waits for you.') : undefined,
    ),
  ]);
}

function resultCard(ctx: Ctx, t: TaskView): Node | undefined {
  const r = t.result;
  if (!r) return undefined;
  return card(
    [
      r.summary ? md(peerMd(r.summary)) : undefined,
      r.data !== undefined && col([dim('Data'), code(JSON.stringify(r.data, null, 2).slice(0, 20_000))]),
      r.files.length > 0 &&
        col([
          dim('Files'),
          ...r.files.slice(0, 40).map((f, i) =>
            col([
              line(f.name, span(`  ${f.path ? `${formatBytes(f.size)} · ${homePath(ctx.state, f.path)}` : 'didn’t arrive'}`, { dim: true })),
              f.image && f.path
                ? picture(ctx, `task:${t.id}:picture:${i}`, f.name, async () => {
                    const url = (await ctx.call('gateway.image', t.id, f.name)) as string | undefined;
                    const found = /^data:([^;]+);base64,(.*)$/s.exec(url ?? '');
                    return { mime: found?.[1] ?? '', b64: found?.[2] ?? '' };
                  })
                : undefined,
            ]),
          ),
        ]),
      r.secret && r.status === 'done' ? dim(`A secret (${r.secret}): ${t.direction === 'sent' ? `${t.peerName} approved sending it to you` : 'you approved sending it'}, this once.`) : undefined,
      r.agent && t.direction === 'sent' ? dim(`Answered by ${agentLabel(r.agent, t.peerName, false, { model: true })}`) : undefined,
      r.problems?.length ? text(`${r.valid === false ? 'The data doesn’t match what was asked for: ' : ''}${r.problems.join(' · ')}`, { color: 'warning' }) : undefined,
    ],
    { title: 'Answer', ...(r.status === 'done' && r.valid !== false ? { tone: 'ok' as const } : {}) },
  );
}

/** A request in full: what, who, where, how it stands, and what you can do about it. */
export function requestPage(ctx: Ctx, id: string): Node {
  const t = ctx.state.gateway.tasks.find((x) => x.id === id);
  if (!t) return page(top(ctx, 'requests'), back(ctx, 'Requests'), empty('That request is gone.'));
  const sent = t.direction === 'sent';
  const live = !isFinal(t.state);
  const waiting = !sent && t.state === 'awaiting_approval';
  const level = levelOf(ctx.state, t.peerId);
  const caps = ctx.state.gateway.capabilities;
  const needs = needsOf(t);
  const asksYou = waiting || (sent && (t.state === 'confirm' || Boolean(t.question)));
  return page(
    top(ctx, 'requests'),
    back(ctx, 'Requests'),
    card(
      [
        meta(statePill(t), ago(t.createdAt), t.allowedBy, sent && t.by === 'agent' && 'asked by your agent'),
        t.secret && live ? text(sent ? `A secret: only ${t.peerName} can allow it, each time.` : 'A secret: only you can allow it, each time. Trust, rules and Always never cover it.', { color: 'warning' }) : undefined,
        col([t.kind === 'run' && t.command ? code(`$ ${t.command}`) : t.kind === 'file' ? text(`Send me ${t.path ?? 'a file'}`) : md(peerMd(t.ask))], { top: 1 }),
        t.kind === 'run' && t.ask && t.ask !== t.command ? col([dim('Why:'), md(peerLine(t.ask, 300))]) : undefined,
        !sent &&
          col(
            [
              field('Asked by', `${t.peerName} · you: ${TRUST_INFO[level].label.toLowerCase()}`),
              field('Needs', needs.length ? needs.map((n) => `${CAP_INFO[n].label}${capFor(caps, n, level) === 'ask' ? ' (asks you)' : ''}`).join(', ') : 'Nothing special'),
              field('Where', whereLine(t)),
              field('Sends back', backLine(t)),
            ],
            { top: 1 },
          ),
        waiting && answerCard(ctx, t),
        sent && t.state === 'confirm' && confirmCard(ctx, t),
        sent && questionCard(ctx, t),
      ],
      { title: t.secret ? `${whoOf(t)} wants ${t.secret.label}` : whoSpans(t, { weight: 'bold' }), ...(asksYou ? { tone: 'warn' as const } : {}) },
    ),
    live && t.steps.length > 0 && section('Steps', t.steps.slice(-6).map((step) => dim(`· ${step}`))),
    t.incoming && dim(`Receiving files: ${formatBytes(t.incoming.received)} of ${formatBytes(t.incoming.total)}`),
    resultCard(ctx, t),
    row(
      [
        live && !waiting && t.state !== 'confirm' && ctx.draw.button(`request:${t.id}:stop`, sent ? 'Cancel' : 'Stop', () => ctx.call('gateway.cancel', t.id), { plain: true, hotkey: 'x' }),
        t.chat && /^(dm|group):/.test(t.chat) ? ctx.draw.button(`request:${t.id}:chat`, 'Open Its Chat', () => ctx.go({ name: 'conversation', params: { id: t.chat! } }), { plain: true, dim: true }) : undefined,
        sent && !live && confirmPress(ctx, `request:${t.id}:forget`, 'Remove', 'It goes from your lists.', () => ctx.call('gateway.forget', t.id)),
      ],
      { gap: 3 },
    ),
  );
}

/** What's beside a request's answer: a reason with a no, trusting them instead, their card. */
export function requestMorePage(ctx: Ctx, id: string): Node {
  const t = ctx.state.gateway.tasks.find((x) => x.id === id);
  if (!t) return page(top(ctx, 'requests'), back(ctx, 'Requests'), empty('That request is gone.'));
  const waiting = t.direction === 'received' && t.state === 'awaiting_approval';
  const level = levelOf(ctx.state, t.peerId);
  const friend = ctx.state.network.friends.some((f) => f.peerId === t.peerId);
  return page(
    top(ctx, 'requests'),
    back(ctx, 'Request'),
    card(
      [
        t.kind === 'run' && t.command ? text(askLine(t, 120)) : md(peerLine(t.summary?.trim() || t.ask, 120)),
        waiting &&
      col([ctx.draw.input(
        `decide:${t.id}:reason`,
        async (value) => {
          await ctx.call('gateway.decide', t.id, { answer: 'no', ...once, ...(value?.trim() ? { reason: value.trim().slice(0, 300) } : {}) });
          ctx.nav.back(ctx.pane);
        },
        { label: 'Decline, saying why', placeholder: `${t.peerName} sees this`, submitLabel: 'decline' },
      )], { top: 1 }),
      ],
      { title: `${t.peerName}’s request` },
    ),
    waiting && !t.secret && level !== 'trusted' && level !== 'full'
      ? ctx.draw.button(
          `decide:${t.id}:trust`,
          `Trust ${t.peerName} Instead`,
          async () => {
            await ctx.call('people.setTrust', t.peerId, 'trusted');
            await ctx.call('gateway.decide', t.id, { answer: 'yes', ...once });
            ctx.nav.back(ctx.pane);
          },
          { plain: true },
        )
      : undefined,
    friend && ctx.draw.button(`request:${t.id}:card`, `${t.peerName}’s Card`, () => ctx.go({ name: 'friend', params: { id: t.peerId } }), { plain: true }),
  );
}

/** Ask a teammate's agent yourself: it goes straight to them, and you're the one asking. */
export function askPage(ctx: Ctx, to?: string): Node {
  const { network, peers, selfId, self } = ctx.state;
  const friends = network.enabled ? network.friends.map((f) => ({ id: f.peerId, name: f.name })) : [];
  const room = peers.filter((p) => p.peerId !== selfId && p.peerId !== self?.peerId && !p.guest && !friends.some((f) => f.id === p.peerId)).map((p) => ({ id: p.peerId, name: p.name }));
  const people = [...friends, ...room];
  const [picked, setPicked] = ctx.local<string | undefined>(`ask:${to ?? ''}:to`, to);
  const who = people.find((p) => p.id === picked) ?? people[0];
  if (!who) return page(top(ctx, 'requests'), back(ctx), empty('Nobody to ask yet: add a teammate, or invite someone to your room.'));
  return page(
    top(ctx, 'requests'),
    back(ctx),
    card(
      [
        dim('It goes straight to them, and you’re the one asking.'),
        people.length > 1 && ctx.draw.select('ask:who', people.map((p) => ({ value: p.id, label: `${p.name}’s agent` })), (value) => setPicked(value), { label: 'To', value: who.id }),
    ctx.draw.input(
      `ask:${who.id}:words`,
      async (value) => {
        const words = value?.trim();
        if (!words) return;
        const task = (await ctx.call('gateway.ask', who.id, words)) as TaskView | undefined;
        ctx.go(task?.id ? { name: 'request', params: { id: task.id } } : { name: 'requests' });
      },
      { placeholder: 'What should their agent do? They see only this.', rows: 3, submitLabel: 'ask', autoFocus: true },
    ),
      ],
      { title: `Ask ${who.name}’s agent` },
    ),
  );
}

// ---- what teammates' agents may do here

const levelsFor = (trust: (typeof CAP_TRUST)[number]): readonly CapLevel[] => (trust === 'ask' ? ['ask', 'off'] : ['allow', 'ask', 'off']);

/** What teammates' agents may do here, your note, the folders, who your agent asks freely, your rules. */
export function accessPage(ctx: Ctx): Node {
  const gw = ctx.state.gateway;
  if (!gw.enabled) return page(top(ctx, 'requests'), back(ctx), empty('Requests between agents aren’t running on this engine.'));
  const caps = gw.capabilities;
  const folders = caps.folders;
  const freely = gw.askFreely ?? [];
  const [adding, setAdding] = ctx.local('access:adding', false);
  const setFolders = (next: readonly string[]): Promise<unknown> => ctx.call('gateway.setCapabilities', { folders: [...next] });
  return page(
    top(ctx, 'requests'),
    back(ctx, 'Requests'),
    card(
      CAP_ORDER.map((need) =>
        col([
          ctx.draw.button(`capability:${need}`, CAP_INFO[need].label, () => ctx.go({ name: 'capability', params: { need } }), { plain: true, spans: [span(CAP_INFO[need].label, { weight: 'bold' }), span('  ›', { dim: true })] }),
          line(...CAP_TRUST.flatMap((trust, i) => [...(i ? [span(' · ', { dim: true })] : []), span(`${TRUST_INFO[trust].label}:`, { dim: true }), span(' '), span(CAP_LEVEL_INFO[caps.levels[need][trust]], { dim: true })])),
        ]),
      ),
      { title: 'What teammates’ agents can do here' },
    ),
    section('Your card', [
      dim('Ask me for: what teammates’ agents see when they look for who can help'),
      ctx.draw.input(
        'access:note',
        async (value) => {
          await ctx.call('gateway.setNote', (value ?? '').trim().slice(0, 280));
          ctx.effect({ toast: 'Saved. Teammates’ agents see it on your card.' });
        },
        { value: gw.note, placeholder: 'the API, design reviews…', submitLabel: 'save' },
      ),
    ]),
    section('Shared folders', [
      dim('Folders for “Read and write files”, besides the one each request gets for itself. Secrets stay off-limits anyway.'),
      listOf(ctx, 'access:folders', folders, (f) => row([text(homePath(ctx.state, f)), ctx.draw.button(`access:folder:${f}`, 'Remove', () => setFolders(folders.filter((x) => x !== f)), { plain: true, dim: true })])),
      adding
        ? ctx.draw.input(
            'access:folder-path',
            async (value) => {
              setAdding(false);
              const folder = value?.trim() ? wholePath(ctx.state, value) : '';
              if (folder && !folders.includes(folder)) await setFolders([...folders, folder]);
            },
            { label: 'Folder', placeholder: '/path/to/folder', submitLabel: 'add', autoFocus: true },
          )
        : ctx.draw.button('access:add-folder', 'Add Folder', () => setAdding(true), { plain: true, dim: true }),
    ], folders.length),
    freely.length > 0 &&
      section('Asked without checking', [
        dim('Your agent asks them without checking: you said Always when it wanted to.'),
        listOf(ctx, 'access:freely', freely, (peerId) => row([text(nameOf(ctx.state, peerId)), ctx.draw.button(`access:freely:${peerId}`, 'Ask Me First', () => ctx.call('gateway.setAskFreely', peerId, false), { plain: true, dim: true })])),
      ], freely.length),
    section('Rules for people’s requests', [
      gw.rules.length === 0 && empty('No rules yet. When you choose Always on a teammate’s request, the rule it makes shows up here.'),
      listOf(ctx, 'access:rules', [...gw.rules].reverse(), (r) => ruleRow(ctx, `rule:${r.id}`, r, true)),
    ], gw.rules.length),
  );
}

/** One capability, at each trust level. */
export function capabilityPage(ctx: Ctx, need: string): Node {
  const known = CAP_ORDER.find((n) => n === need);
  if (!known) return page(top(ctx, 'requests'), back(ctx), empty('There’s no such thing to set.'));
  const row_ = ctx.state.gateway.capabilities.levels[known];
  return page(
    top(ctx, 'requests'),
    back(ctx),
    card(
      [
        dim(CAP_INFO[known].detail),
        ...CAP_TRUST.map((trust) =>
          section(TRUST_INFO[trust].label, [
            row(levelsFor(trust).map((level) => choice(ctx, `capability:${known}:${trust}:${level}`, CAP_LEVEL_INFO[level], row_[trust] === level, () => ctx.call('gateway.setCapabilities', { levels: { [known]: { ...row_, [trust]: level } } }))), { gap: 2 }),
          ]),
        ),
      ],
      { title: CAP_INFO[known].label },
    ),
  );
}

/** One rule as a row. */
export function ruleRow(ctx: Ctx, key: string, r: Rule, named: boolean): Node {
  return ctx.draw.button(key, ruleLabel(r), () => ctx.go({ name: 'rule', params: { id: r.id } }), {
    plain: true,
    spans: [...(named ? [span(r.peerName, { weight: 'bold' }), span('  ')] : []), span(ruleLabel(r)), span('  '), pill(DECISION_INFO[r.decision], r.decision === 'allow' ? 'ok' : r.decision === 'decline' ? 'error' : 'quiet'), span(`  ${expiryLabel(r)}`, { dim: true })],
  });
}

const DAY = 86_400_000;

/** One rule: its answer, how long it lasts, Delete. */
export function rulePage(ctx: Ctx, id: string): Node {
  const r = ctx.state.gateway.rules.find((x) => x.id === id);
  if (!r) return page(top(ctx, 'requests'), back(ctx), empty('That rule is gone.'));
  const { peerId, peerName, kind, needs, command, project, folder, expiresAt, decision } = r;
  const base = { id, peerId, peerName, kind, needs: [...needs], ...(command ? { command } : {}), ...(project ? { project } : {}), ...(folder ? { folder } : {}) };
  const save = (patch: { decision?: RuleDecision; expiresAt?: number | undefined }): Promise<unknown> => {
    const until = 'expiresAt' in patch ? patch.expiresAt : expiresAt;
    return ctx.call('gateway.saveRule', { ...base, decision: patch.decision ?? decision, ...(until ? { expiresAt: until } : {}) });
  };
  return page(
    top(ctx, 'requests'),
    back(ctx),
    card(
      [
        text(ruleLabel(r)),
        meta(expiryLabel(r), `made ${ago(r.createdAt)} ago`),
        section('Answer', [row(RULE_DECISIONS.map((d) => choice(ctx, `rule:${id}:${d}`, DECISION_INFO[d], decision === d, () => save({ decision: d }))), { gap: 2 })]),
        section('For how long', [row([
      choice(ctx, `rule:${id}:never`, 'Until I change it', expiresAt === undefined, () => save({ expiresAt: undefined })),
      ctx.draw.button(`rule:${id}:day`, EXPIRY_INFO.day, () => save({ expiresAt: Date.now() + DAY }), { plain: true, dim: true }),
      ctx.draw.button(`rule:${id}:week`, EXPIRY_INFO.week, () => save({ expiresAt: Date.now() + 7 * DAY }), { plain: true, dim: true }),
    ], { gap: 2 })]),
      ],
      { title: [span(peerName, { weight: 'bold' }), span(' · a rule', { dim: true })] },
    ),
    confirmPress(ctx, `rule:${id}:delete`, 'Delete', 'Requests like it ask you again.', async () => {
      await ctx.call('gateway.removeRule', id);
      ctx.nav.back(ctx.pane);
    }),
  );
}
