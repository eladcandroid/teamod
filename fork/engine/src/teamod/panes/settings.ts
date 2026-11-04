import { BRANCH_PREFIX_RE, type NotifySettings } from '../../shared/settings-schema.js';
import { DND_CHOICES, type DndChoice, dndActive, dndFor, dndLabel } from '../../shared/quiet.js';
import { joinArgs, shellName, splitArgs } from '../../shared/shells.js';
import { TUNNEL_LABELS, TUNNEL_ORDER } from '../../ui/settings-menus.js';
import type { Project } from '../../workspaces/types.js';
import { type Prefs, systemLanguage } from '../prefs.js';
import type { Ctx, Screen } from '../screens.js';
import { type Node, col, dim, line, row, span, title } from '../tree.js';
import { actions, back, card, chrome, empty, meta, page, pill, section } from './common.js';
import { agentPane, signInPage } from './settings-agent.js';
import { SETTINGS_PLACES, choice, group, setPrefs, toggle } from './settings-common.js';
import { envPane } from './settings-env.js';
import { endpointPage, modelsPane } from './settings-models.js';
import { toolsPane } from './settings-tools.js';
import { field, plural, windowed } from './work-common.js';

/** The Settings screen: teamod's shared settings, every one that means something without a Mac window. */

const general = (ctx: Ctx): Node => {
  const p = ctx.state.prefs;
  // A rename reaches the room's list of people first: what they see you as now.
  const selfId = ctx.state.self?.peerId ?? ctx.state.selfId;
  const name = ctx.state.peers.find((peer) => peer.peerId === selfId)?.name ?? ctx.state.self?.name ?? '';
  return page(
    chrome(ctx, SETTINGS_PLACES, 'general'),
    back(ctx),
    language(ctx),
    group('Your name', [field(ctx, 'name', 'Name', name, (next) => (next ? ctx.call('session.rename', next) : undefined), { detail: 'What friends see in the room. Letters, numbers, . - _', placeholder: 'your-name', hotkey: 'c' })]),
    group('Approvals', [toggle(ctx, 'pref:selfApproval', 'Ask before running commands', p.selfApproval === 'ask', (next) => setPrefs(ctx, { selfApproval: next ? 'ask' : 'never' }), 'Your own agent. Secrets stay blocked either way.')]),
    group('Friends', [
      toggle(ctx, 'pref:friendWorktrees', 'Friends may start work here', p.friendWorktrees === 'ask', (next) => setPrefs(ctx, { friendWorktrees: next ? 'ask' : 'off' }), 'They ask to start a worktree or hand work to you; you approve each one.'),
      choice(ctx, 'pref:chatClaude', 'Who can ask your agent in chats', p.chatClaude, [{ value: 'everyone', label: 'Friends in the chat' }, { value: 'trusted', label: 'People I trust' }, { value: 'off', label: 'Only me' }], (next) => setPrefs(ctx, { chatClaude: next as typeof p.chatClaude })),
      choice(ctx, 'pref:shareUsage', 'Who sees your usage', p.shareUsage, [{ value: 'trusted', label: 'People I trust' }, { value: 'everyone', label: 'All my friends' }, { value: 'off', label: 'No one' }], (next) => setPrefs(ctx, { shareUsage: next as typeof p.shareUsage }), 'How much of your plans you have left, and when it resets, on your profile. Never your conversations or code.'),
      choice(ctx, 'pref:tunnel', 'How friends reach you', p.tunnel, TUNNEL_ORDER.map((t) => ({ value: t, label: TUNNEL_LABELS[t] })), (next) => setPrefs(ctx, { tunnel: next as typeof p.tunnel }), 'Takes effect for the next invite.'),
    ]),
  );
};

/** teamod's own: the language its screens are in, and how right-to-left letters are drawn. */
function language(ctx: Ctx): Node {
  const system = systemLanguage();
  return group('Language', [
    choice(
      ctx,
      'pref:lang',
      'Screens in',
      ctx.prefs.lang,
      [
        { value: 'auto', label: `Like this computer (${system === 'he' ? 'עברית' : 'English'})` },
        { value: 'en', label: 'English' },
        { value: 'he', label: 'עברית' },
      ],
      (next) => ctx.setPrefs({ lang: next as Prefs['lang'] }),
      'teamod’s screens. What people and agents write stays as they wrote it.',
    ),
    choice(
      ctx,
      'pref:rtl',
      'Hebrew letters',
      ctx.prefs.rtl,
      [
        { value: 'auto', label: 'Automatic' },
        { value: 'fix', label: 'teamod puts them in order' },
        { value: 'terminal', label: 'My terminal does' },
      ],
      (next) => ctx.setPrefs({ rtl: next as Prefs['rtl'] }),
      'Choose the one where this reads right: שלום, זה טקסט בעברית',
    ),
  ]);
}

type Toggle = 'needsYou' | 'done' | 'doneHere' | 'mentions' | 'people' | 'background' | 'sentinels' | 'problems' | 'pr' | 'planMilestones';

const KINDS: ReadonlyArray<readonly [Toggle, string, string]> = [
  ['needsYou', 'Your agent needs you', 'A question, a plan, or an approval'],
  ['done', 'Your agent finished', 'In a conversation you’re not looking at'],
  ['doneHere', 'Your agent finished where I’m looking', 'A run of yours that took 20 seconds or more, once nothing else is running or queued there'],
  ['mentions', 'Mentions and messages', 'Someone writes @you, or to you when it’s just the two of you'],
  ['people', 'People come and go', 'Someone joins, leaves, invites you, or hands work to you'],
  ['background', 'Background tasks', 'Something your agent runs in the background, or a new worktree’s setup, finishes'],
  ['sentinels', 'Sentinels', 'A sentinel’s run ends or fails. One that waits for you still tells you'],
  ['problems', 'Problems', 'Errors, merge conflicts, failed setups'],
  ['pr', 'Pull requests', 'Opened, checks finished, reviewed'],
  ['planMilestones', 'Plans: milestones only', 'A plan tells you when a milestone passes, fails or waits for you, and when its agent asks you something. Its tasks finishing go quietly into the inbox'],
];

const notifications = (ctx: Ctx): Node => {
  const n = ctx.state.prefs.notify;
  const save = (patch: Partial<NotifySettings>): Promise<unknown> => setPrefs(ctx, { notify: { ...n, ...patch } });
  const quiet = dndActive(n);
  return page(
    chrome(ctx, SETTINGS_PLACES, 'notifications'),
    back(ctx),
    group('On this computer', [
      toggle(ctx, 'notify:desktop', 'Desktop notifications', n.desktop, (next) => save({ desktop: next }), 'The Inbox lists everything either way.'),
      toggle(ctx, 'notify:onlyAway', 'Only when I’m away', n.onlyAway, (next) => save({ onlyAway: next }), 'Stay quiet while a screen of yours is in front.'),
      quiet
        ? col([
            row([line(pill('Do Not Disturb', 'warn'), span(`  On ${dndLabel(n)}`, { dim: true })), ctx.draw.button('notify:dnd-off', 'Turn Off', () => save({ dnd: null }), { plain: true, hotkey: 'c' })], { justify: 'space-between' }),
            dim('Desktop notifications wait. The Inbox still fills.'),
          ])
        : choice(ctx, 'notify:dnd', 'Do Not Disturb', 'off', [{ value: 'off', label: 'Off' }, ...DND_CHOICES], (next) => save({ dnd: next === 'off' ? null : dndFor(next as DndChoice) }), 'Pause desktop notifications for a while. The Inbox still fills.'),
    ]),
    group('Tell me when', KINDS.map(([key, label, detail]) => toggle(ctx, `notify:${key}`, label, n[key], (next) => save({ [key]: next }), detail)), { tight: true }),
    ctx.draw.button('notify:test', 'Send a Test Notification', () => ctx.call('session.testNotification'), { primary: true, hotkey: 'd' }),
  );
};

const OTHER_SHELL = '__other';

/** Which shell new terminals run, and how it starts. */
function shellSection(ctx: Ctx): Node {
  const p = ctx.state.prefs;
  const choices = ctx.state.shellChoices;
  const login = choices.find((c) => c.isDefault);
  const listed = !p.shell || choices.some((c) => c.path === p.shell);
  const [other, setOther] = ctx.local('shell:other', false);
  const picking = other || !listed;
  const started = [p.shell ? shellName(p.shell) : (login?.name ?? 'shell'), ...(p.shellLogin ? ['-l'] : []), ...p.shellArgs].join(' ');
  return group('Terminal', [
    choice(
      ctx,
      'pref:shell',
      'Shell',
      picking ? OTHER_SHELL : (p.shell ?? ''),
      [
        { value: '', label: login ? `Login shell (${login.name})` : 'Login shell' },
        ...choices.filter((c) => !c.isDefault || p.shell === c.path).map((c) => ({ value: c.path, label: choices.filter((x) => x.name === c.name).length > 1 ? `${c.name}, ${c.path}` : c.name })),
        { value: OTHER_SHELL, label: 'Other' },
      ],
      (next) => {
        setOther(next === OTHER_SHELL);
        if (next === OTHER_SHELL) return undefined;
        // Back to the login shell by naming it: JSON can't carry "unset" for this one.
        const shell = next || login?.path;
        return shell ? setPrefs(ctx, { shell }) : undefined;
      },
      'For new terminals; ones already open keep theirs.',
    ),
    picking &&
      field(ctx, 'pref:shell-path', 'Path', p.shell ?? '', (next) => {
        if (next && !next.startsWith('/')) throw new Error('Start with / (like /opt/homebrew/bin/fish).');
        return next ? setPrefs(ctx, { shell: next }) : undefined;
      }, { placeholder: '/opt/homebrew/bin/fish' }),
    toggle(ctx, 'pref:shellLogin', 'Login shell', p.shellLogin, (next) => setPrefs(ctx, { shellLogin: next }), 'Reads your profile (~/.zprofile, ~/.bash_profile...), like a terminal app does.'),
    field(ctx, 'pref:shellArgs', 'Extra arguments', joinArgs(p.shellArgs), (next) => setPrefs(ctx, { shellArgs: splitArgs(next).slice(0, 20) }), { detail: `Started as: ${started}`, placeholder: 'none' }),
  ]);
}

const worktrees = (ctx: Ctx): Node => {
  const p = ctx.state.prefs;
  const hidden = ctx.state.hiddenProjects.length;
  return page(
    chrome(ctx, SETTINGS_PLACES, 'worktrees'),
    back(ctx),
    group('New worktrees', [
      toggle(ctx, 'pref:autoSetup', 'Run setup in new worktrees', p.autoSetup, (next) => setPrefs(ctx, { autoSetup: next }), 'The project’s setup command (npm install...) runs in each new worktree.'),
      field(
        ctx,
        'pref:branchPrefix',
        'Branch prefix',
        p.branchPrefix,
        (next) => {
          if (!BRANCH_PREFIX_RE.test(next)) throw new Error('Use letters, digits and . _ - / only.');
          return setPrefs(ctx, { branchPrefix: next });
        },
        { detail: `New worktrees get branches like ${p.branchPrefix}fix-login. Leave it empty for no prefix.`, placeholder: 'none', hotkey: 'c' },
      ),
      row([
        ctx.draw.button('worktrees:scripts', 'Setup and Run Commands', () => ctx.go({ name: 'scripts' }), { plain: true, hotkey: 'd' }),
        ctx.draw.button('worktrees:hidden', hidden ? `Hidden Projects (${hidden})` : 'Hidden Projects', () => ctx.show('work', { name: 'hidden' }), { plain: true, dim: true, hotkey: 'h' }),
      ], { gap: 3 }),
    ]),
    shellSection(ctx),
  );
};

const SOURCES: Readonly<Record<string, string>> = { yours: 'set by you', claude: 'worked out by your agent', 'teamod.json': 'in teamod.json', 'conductor.json': 'in conductor.json', detected: 'guessed from the project' };

const sharable = (p: Project): boolean => [p.scripts?.setup, p.scripts?.run].some((s) => s?.source === 'yours' || s?.source === 'claude');

/** Your projects' commands, and putting yours in the project's file so teammates get them. */
const scriptsPage = (ctx: Ctx): Node => {
  const projects = ctx.state.projects.filter((p) => p.root && (p.scripts?.setup || p.scripts?.run));
  const window = windowed(ctx, 'scripts', [...projects].sort((a, b) => Number(sharable(b)) - Number(sharable(a))), { size: 30, keys: true });
  const script = (label: string, s: { readonly command: string; readonly source: string } | undefined): Node | undefined => (s ? line(span(`${label}  `, { dim: true }), s.command, span(`  · ${SOURCES[s.source] ?? s.source}`, { dim: true })) : undefined);
  return page(
    chrome(ctx, SETTINGS_PLACES, 'worktrees'),
    back(ctx, 'Worktrees'),
    title('Setup and Run Commands'),
    dim('Setup runs in every new worktree; Run starts the project. Change them from a worktree’s Terminal. Sharing saves them in the project’s teamod.json, to commit.'),
    projects.length === 0 && empty('No project has any yet.'),
    projects.length > 0 &&
      section(
        'Projects',
        [
          card(
            window.shown.map((p, i) =>
              col([
                row([line(span(p.name, { weight: 'bold' })), sharable(p) ? ctx.draw.button(`share:${p.id}`, 'Share with the Team', () => ctx.call('workbench.shareScripts', p.id), { plain: true }) : undefined], { justify: 'space-between' }),
                script('Setup', p.scripts?.setup),
                script('Run', p.scripts?.run),
              ], i > 0 ? { top: 1 } : {}),
            ),
          ),
        ],
        projects.length,
      ),
    window.controls,
  );
};

const engine = (ctx: Ctx): Node => {
  const workspaces = ctx.state.projects.flatMap((p) => p.workspaces).filter((w) => !w.archived && w.kind !== 'main').length;
  const projects = ctx.state.projects.filter((p) => p.root).length;
  return page(
    chrome(ctx, SETTINGS_PLACES, 'engine'),
    back(ctx),
    card(
      [
        line(pill('Running in the background', 'ok')),
        meta(plural(projects, 'project'), plural(workspaces, 'worktree and chat', 'worktrees and chats'), 'for every session on this computer'),
        row([ctx.draw.button('engine:stop', 'Stop the Engine', () => ctx.go({ name: 'stop' }), { plain: true })], { top: 1 }),
      ],
      { title: 'Engine' },
    ),
  );
};

const stopPage = (ctx: Ctx): Node =>
  page(
    chrome(ctx, SETTINGS_PLACES, 'engine'),
    back(ctx, 'Cancel'),
    card(
      [
        dim('Agents working now stop, and so do terminals and scripts it runs. Conversations and worktrees stay. A session still open starts it again.'),
        actions(ctx.draw.button('stop:confirm', 'Stop the Engine', () => ctx.call('daemon.stop'), { primary: true, hotkey: 'c' })),
      ],
      { title: 'Stop the Engine?', tone: 'warn' },
    ),
  );

export const settingsPane: Screen = (ctx) => {
  const params = ctx.route.params ?? {};
  switch (ctx.route.name) {
    case 'agent':
      return agentPane(ctx);
    case 'sign-in':
      return signInPage(ctx);
    case 'notifications':
      return notifications(ctx);
    case 'worktrees':
      return worktrees(ctx);
    case 'scripts':
      return scriptsPage(ctx);
    case 'env':
      return envPane(ctx);
    case 'models':
      return modelsPane(ctx);
    case 'endpoint':
      return endpointPage(ctx, params.id);
    case 'tools':
      return toolsPane(ctx);
    case 'engine':
      return engine(ctx);
    case 'stop':
      return stopPage(ctx);
    default:
      return general(ctx);
  }
};
