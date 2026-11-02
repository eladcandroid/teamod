import type { Notice } from '../../core/work-store.js';
import { type NoticeFilter, NOTICE_FILTERS, filterNotices, groupNotices, noticeAgo, noticeLook, noticeTarget } from '../../ui/notice-models.js';
import type { Ctx } from '../screens.js';
import { type Node, type Span, col, dim, line, row, span, title } from '../tree.js';
import { back, chrome, empty, openWorkspace, page } from './common.js';
import { draftKey, type HomeDraft } from './work-home.js';
import { placesOf, segments, twoPress, windowed } from './work-common.js';

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
  return col([
    row([
      ctx.draw.button(`notice:${n.id}`, n.title, () => openNotice(ctx, n), { plain: true, spans: [span(n.read ? '  ' : '* ', { color: 'claude' }), span(n.title, n.read ? { dim: true } : { ...style, weight: 'semibold' }), span(`  ${noticeAgo(n.ts)}`, { dim: true })] }),
      ctx.draw.button(`notice:${n.id}:read`, n.read ? 'Mark Unread' : 'Mark Read', () => (n.read ? ctx.call('inbox.unread', n.id) : ctx.call('inbox.read', { id: n.id })), { plain: true, dim: true }),
      twoPress(ctx, `notice:${n.id}:clear`, 'Clear', () => ctx.call('inbox.clear', { id: n.id })),
    ]),
    n.body ? dim(`  ${n.body.split('\n')[0]?.slice(0, Math.max(40, ctx.columns - 4)) ?? ''}`) : undefined,
  ]);
}

type InboxRow = { readonly kind: 'label'; readonly words: string } | { readonly kind: 'notice'; readonly notice: Notice };

export function inboxPage(ctx: Ctx): Node {
  const inbox = ctx.state.inbox;
  const [filter, setFilter] = ctx.local<NoticeFilter>('inbox:filter', 'all');
  const list = filterNotices(inbox, filter);
  const rows = groupNotices(list).flatMap((g): InboxRow[] => [{ kind: 'label', words: g.label }, ...g.notices.map((notice): InboxRow => ({ kind: 'notice', notice }))]);
  const window = windowed(ctx, 'inbox', rows, { size: 30, keys: true });
  const unread = inbox.filter((n) => !n.read).length;
  return page(
    chrome(ctx, placesOf(ctx), 'inbox'),
    back(ctx),
    segments(ctx, 'inbox:filter', NOTICE_FILTERS.map((f) => ({ value: f.value, label: f.label })), filter, setFilter),
    list.length === 0 && empty(filter === 'all' ? 'Nothing here yet. What happens while you’re elsewhere shows up here.' : 'Nothing like that here.'),
    ...window.shown.map((r) => (r.kind === 'label' ? dim(r.words) : noticeRow(ctx, r.notice))),
    window.controls,
    inbox.length > 0 &&
      row([
        unread > 0 && ctx.draw.button('inbox:read-all', 'Mark All Read', () => ctx.call('inbox.read'), { primary: true, hotkey: 'a' }),
        twoPress(ctx, 'inbox:clear-all', 'Clear All', () => ctx.call('inbox.clear')),
      ]),
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
  return page(
    chrome(ctx, placesOf(ctx), 'projects'),
    back(ctx),
    title(project ? `Start ${project.name} from a Template` : 'Templates'),
    dim(project ? 'Pick one: it fills the box, ready to finish and send.' : 'Ways to start a task. Pick one from a project’s home.'),
    saving
      ? col([
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
          ]),
        ])
      : ctx.draw.button('templates:save', 'Save a New Template', () => setSaving(true), { primary: true, hotkey: 'a' }),
    list.length === 0 && empty('None yet.'),
    ...window.shown.map((t) => {
      const words = `${t.plan ? 'plans first, ' : ''}${t.prompt.replace(/\s+/g, ' ').slice(0, 70)}${t.prompt.length > 70 ? '...' : ''}`;
      const pick = (): void => {
        setDraft({ prompt: t.prompt, ...(t.plan ? { plan: true } : {}) });
        ctx.nav.back(ctx.pane);
      };
      return row([
        project ? ctx.draw.button(`template:${t.id}`, t.name, pick, { plain: true, spans: [span(t.name), span(`  ${words}`, { dim: true })] }) : line(t.name, span(`  ${words}`, { dim: true })),
        t.builtIn ? undefined : twoPress(ctx, `template:${t.id}:remove`, 'Remove', () => ctx.call('workbench.removeTemplate', t.id)),
      ]);
    }),
    window.controls,
  );
}
