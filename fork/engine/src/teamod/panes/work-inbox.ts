import type { Notice } from '../../core/work-store.js';
import { type NoticeFilter, NOTICE_FILTERS, filterNotices, groupNotices, noticeAgo, noticeLook, noticeTarget } from '../../ui/notice-models.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, row, span, text } from '../tree.js';
import { actions, back, card, chrome, empty, meta, openWorkspace, page, section } from './common.js';
import { draftKey, type HomeDraft } from './work-home.js';
import { CARD_LIMIT, placesOf, segments, twoPress, windowed } from './work-common.js';

/** The Inbox (what happened while you were elsewhere) and templates (saved ways to start a task). */

const TONE_STYLE: Readonly<Record<ReturnType<typeof noticeLook>['tone'], Omit<Span, 't'>>> = { warn: { color: 'warning' }, error: { color: 'error' }, claude: { color: 'claude' }, info: {}, muted: { dim: true } };

/** Where a notice goes: the conversation it's about, or the plan. Going there reads it. */
async function openNotice(ctx: Ctx, n: Notice): Promise<void> {
  await ctx.call('inbox.read', { id: n.id });
  const target = noticeTarget(ctx.state, n.channel);
  if (target?.kind === 'workspace') openWorkspace(ctx, target.id);
  else if (target?.kind === 'assistant') {
    if (target.chat) await ctx.call('assistant.openChat', target.chat);
    ctx.go({ name: 'assistant' });
  } else if (target?.kind === 'sentinel_chat') ctx.show('sentinel');
  else if (target?.kind === 'room' || target?.kind === 'shared') ctx.show('team');
  else if (n.plan) ctx.show('board', { name: 'plan', params: { id: n.plan } });
}

function noticeRow(ctx: Ctx, n: Notice): Node {
  const { tone } = noticeLook(n);
  const style = TONE_STYLE[tone];
  return col(
    [
      ctx.draw.button(`notice:${n.id}`, n.title, () => openNotice(ctx, n), { plain: true, spans: [span(n.read ? '  ' : '● ', { color: 'claude' }), span(n.title, n.read ? { dim: true } : { ...style, weight: 'semibold' }), span(`  ${noticeAgo(n.ts)}`, { dim: true })] }),
      n.body ? dim(`  ${n.body.split('\n')[0]?.slice(0, Math.max(40, ctx.columns - 10)) ?? ''}`) : undefined,
      row(
        [
          ctx.draw.button(`notice:${n.id}:read`, n.read ? 'Mark Unread' : 'Mark Read', () => (n.read ? ctx.call('inbox.unread', n.id) : ctx.call('inbox.read', { id: n.id })), { plain: true, dim: true }),
          twoPress(ctx, `notice:${n.id}:clear`, 'Clear', () => ctx.call('inbox.clear', { id: n.id })),
        ],
        { gap: 2, padX: 1 },
      ),
    ],
  );
}

type InboxRow = { readonly kind: 'label'; readonly words: string } | { readonly kind: 'notice'; readonly notice: Notice };

/** The window's notices under their day's heading, the day's in one card. */
function inboxGroups(ctx: Ctx, rows: readonly InboxRow[], groups: ReadonlyArray<{ readonly label: string; readonly notices: readonly Notice[] }>): Node[] {
  const out: Node[] = [];
  let label: string | undefined;
  let body: Node[] = [];
  const flush = (): void => {
    if (body.length || label) out.push(section(label ?? '', [card([col(body, { gap: 1 })])], label ? groups.find((g) => g.label === label)?.notices.length : undefined));
    label = undefined;
    body = [];
  };
  for (const r of rows) {
    if (r.kind === 'label') {
      flush();
      label = r.words;
    } else body.push(noticeRow(ctx, r.notice));
  }
  flush();
  return out;
}

export function inboxPage(ctx: Ctx): Node {
  const inbox = ctx.state.inbox;
  const [filter, setFilter] = ctx.local<NoticeFilter>('inbox:filter', 'all');
  const list = filterNotices(inbox, filter);
  const groups = groupNotices(list);
  const rows = groups.flatMap((g): InboxRow[] => [{ kind: 'label', words: g.label }, ...g.notices.map((notice): InboxRow => ({ kind: 'notice', notice }))]);
  const window = windowed(ctx, 'inbox', rows, { size: 30, keys: true });
  const unread = inbox.filter((n) => !n.read).length;
  return page(
    chrome(ctx, placesOf(ctx), 'inbox'),
    back(ctx),
    segments(ctx, 'inbox:filter', NOTICE_FILTERS.map((f) => ({ value: f.value, label: f.label })), filter, setFilter),
    list.length === 0 && empty(filter === 'all' ? 'Nothing here yet. What happens while you’re elsewhere shows up here.' : 'Nothing like that here.'),
    ...inboxGroups(ctx, window.shown, groups),
    window.controls,
    inbox.length > 0 &&
      actions(
        unread > 0 && ctx.draw.button('inbox:read-all', 'Mark All Read', () => ctx.call('inbox.read'), { primary: true, hotkey: 'a' }),
        twoPress(ctx, 'inbox:clear-all', 'Clear All', () => ctx.call('inbox.clear')),
      ),
  );
}

// ---------------------------------------------------------------- templates

/**
 * Saved ways to start a task. From a project's home a press fills its box, ready to finish and
 * send; the built-in ones stay, your own can go.
 */
export function templatesPage(ctx: Ctx): Node {
  const projectId = ctx.route.params?.project;
  const project = projectId ? ctx.state.projects.find((p) => p.id === projectId) : undefined;
  const [saving, setSaving] = ctx.local('templates:saving', false);
  const [planFirst, setPlanFirst] = ctx.local('templates:plan', false);
  const [, setDraft] = ctx.local<HomeDraft | undefined>(draftKey(projectId ?? ''), undefined);
  const list = ctx.state.templates;
  const window = windowed(ctx, 'templates', list, { size: 30, keys: true });
  const asCards = list.length <= CARD_LIMIT;
  const templateRow = (t: (typeof list)[number]): Node => {
    const words = `${t.prompt.replace(/\s+/g, ' ').slice(0, 70)}${t.prompt.length > 70 ? '...' : ''}`;
    const pick = (): void => {
      setDraft({ prompt: t.prompt, ...(t.plan ? { plan: true } : {}) });
      ctx.nav.back(ctx.pane);
    };
    const name = project ? ctx.draw.button(`template:${t.id}`, t.name, pick, { plain: true, spans: [span(t.name, { weight: 'bold' }), span('  ›', { dim: true })] }) : text(t.name, { weight: 'bold' });
    const remove = t.builtIn ? undefined : twoPress(ctx, `template:${t.id}:remove`, 'Remove', () => ctx.call('workbench.removeTemplate', t.id));
    const facts = meta(t.plan && span('◇ plans first', { color: 'claude' }), t.builtIn ? 'built in' : 'yours');
    return asCards ? card([row([name, remove], { justify: 'space-between', gap: 2 }), facts, dim(words)]) : col([row([name, facts, remove], { gap: 2 }), dim(`  ${words}`)]);
  };
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx),
    col([text(project ? `Start ${project.name} from a Template` : 'Templates', { weight: 'bold' }), dim(project ? 'Pick one: it fills the box, ready to finish and send.' : 'Ways to start a task. Pick one from a project’s home.')]),
    saving
      ? card(
          [
            ctx.draw.input(
              'templates:box',
              async (value) => {
                setSaving(false);
                const words = value?.trim();
                if (!words) return;
                await ctx.call('workbench.saveTemplate', words, planFirst);
                setPlanFirst(false);
              },
              { label: 'New template', placeholder: 'name: what your agent should do', rows: 3, submitLabel: 'save', autoFocus: true },
            ),
            row([
              ctx.draw.button('templates:plan', planFirst ? 'Plans First: On' : 'Plans First: Off', () => setPlanFirst(!planFirst), { plain: true, hotkey: 'e', ...(planFirst ? {} : { dim: true }) }),
              ctx.draw.button('templates:cancel', 'Cancel', () => setSaving(false), { plain: true, dim: true }),
            ], { gap: 2 }),
          ],
          { tone: 'accent' },
        )
      : ctx.draw.button('templates:save', 'Save a New Template', () => setSaving(true), { primary: true, hotkey: 'a' }),
    list.length === 0 && empty('None yet.'),
    list.length > 0 && col(window.shown.map(templateRow), asCards ? {} : { gap: 1 }),
    window.controls,
  );
}
