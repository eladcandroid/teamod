# teamod

Run a team of Claude Code agents from panes beside your session. Each task gets its own git worktree and agent. Teammates connect peer-to-peer, with no server to host.


## Install

Needs git, Node 20 or newer, and [Claude Code](https://claude.com/claude-code). Tested on Claude Code 2.1.316, macOS. The mod API is early access, so other versions may need fixes.

```bash
curl -fsSL https://raw.githubusercontent.com/eladcandroid/teamod/main/install.sh | bash
```

Then, in any git project:

```
claude
/teamod
```

Run the same command again to update.

### Or from inside Claude Code

```
/plugin marketplace add eladcandroid/teamod
/plugin install teamod@teamod
/teamod
```

The first `/teamod` downloads and builds the engine, which takes a few minutes. Run `/teamod` again when it finishes.

## Panes

| `/teamod ...` | What it does |
|---|---|
| `work` | Projects, worktrees and running tasks |
| `task` | One task: chat, agents, changes, files, terminal |
| `team` | Pair with teammates, ask their agents, answer their requests |
| `board` | Shared boards and plans |
| `sentinel` | Automations and dashboards |
| `settings` | Engine settings |

Approvals and questions appear above your prompt. Your session can also drive teamod through its `mcp__teamod__*` tools.

Press **Keys** (or `0`) to show each control's hotkey.

## עברית

teamod speaks Hebrew. It follows your computer's language, or set it in **Settings › General › Language**. Screens then read from the right.

Most terminals (Ghostty, kitty, WezTerm, iTerm2, VS Code) draw Hebrew backwards. teamod puts the letters in order itself: in its panes, in Claude's answers, and in your own prompts. Terminal.app and GNOME Terminal do this themselves; teamod detects them. If Hebrew still reads backwards, change **Hebrew letters** in the same section. Typing in the prompt is still drawn by Claude Code.

## Commands

```
/teamod status        is the engine connected
/teamod stop          stop the engine
/teamod service on    keep the engine running from login, so teammates can reach you with Claude Code closed
/teamod service off   undo that
```

The engine keeps running after Claude Code exits, so schedules and teammates' requests still work. Stop it with `/teamod stop`.

## Good to know

- Agents can edit files, commit and merge in the projects you add. Try it on a spare repository first.
- A teammate you pair with can send requests to your agents. Their answers and requests are treated as untrusted data.
- Teammates connect directly, with a Cloudflare relay as backup when a direct link fails. Change this in Settings.
- Data lives in `~/.teamod`.

Not yet tested: the panes inside the Claude desktop app, charts drawn as images, real GitHub pull requests, Linear, plan runs, scheduled automations, and pairing across networks.

## Uninstall

```bash
node ~/.teamod/app/src/fork/engine/dist/teamod/cli.js stop
claude plugin uninstall teamod@teamod
claude plugin marketplace remove teamod
rm -rf ~/.teamod
```

`rm -rf ~/.teamod` also deletes your teamod projects list, boards and pairings.

## Develop

```bash
git clone https://github.com/eladcandroid/teamod && cd teamod/fork/engine
npm ci && npm run build
node dist/teamod/cli.js setup --from-source
claude --plugin-dir ../mod
```

- `fork/engine`: the engine; teamod's screens and bridge are in `src/teamod`.
- `fork/mod`: the Claude Code mod.
- `fork/PARITY.md`: every engine API method and the pane that shows it.

Checks: `npx vitest run` and `npx tsc --noEmit` in `fork/engine`; `claude plugin validate fork/mod` and `claude plugin test fork/mod`.

## License

MIT. See [LICENSE](LICENSE) and `fork/engine/LICENSE`.
