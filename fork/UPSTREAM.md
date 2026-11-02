# Upstream

`engine/` is a squashed git subtree of teamod (https://github.com/eladcandroid/teamod, MIT, Ada Lovelace).

| | |
|---|---|
| Imported commit | `da3827ec` (`docs: shorter README with install up top and no emojis (ACME-608)`) |
| Baseline before any patch | `npm run typecheck` passes; `npx vitest run`: 409 files passed, 4351 tests passed, 3 skipped, about 112 s, macOS arm64, Node 24.11.1 |

To take upstream changes:

    git subtree pull --prefix=fork/engine --squash <teamod remote or path> main

New code goes in `engine/src/teamod/` and `engine/tests/teamod-*.test.ts`, which upstream never touches. Every other change to an upstream file is listed below, so each merge can be checked.

## Patches to upstream files

| File | Change | Why |
|---|---|---|
| `src/ipc/client.ts`, `src/ipc/protocol.ts` | Add `mod` to the screen kinds | The mod's bridge attaches as its own kind of screen |
| `src/core/home.ts`, `src/core/shares.ts` | Default home is `~/.teamod`, never migrated from `~/.teamod`; `~/.teamod` and `~/.teamod` both count as secret | The launcher always sets the home; this is the fail-safe, and a lane must not read a teammate's real teamod |
| `src/agent/policy.ts` | `CREDENTIAL_IN_COMMAND` also names the home folders, leaving their open folders usable | Upstream ignored the home folder in shell commands |
| `src/net/mesh/invitations.ts`, `src/net/invite.ts`, `src/net/crypto.ts`, `src/net/mesh/mesh.ts`, `src/protocol.ts` | `teamod://` links only, new pairing salts, new room key label | teamod's network is its own |
| `src/daemon/core.ts` | Earnings, support and companion launchers off | Dropped (`PARITY.md`) |
| `src/daemon/server.ts`, `src/daemon/main.ts` | `notify` says if a screen took it; else a native notification | A teammate's request must reach you with Claude Code closed |
| `src/agent/runtime/claude/terminal.ts` | MCP config in a 0600 file, removed on close | Its tokens showed in `ps` |
| `tests/invite.test.ts`, `tests/mesh/{friend-offers,groups,pairing,protocol}.test.ts`, `tests/rename-{teamod,compat}.test.ts` | Updated to the patches above | They pinned teamod's links and labels |
| `src/agent/types.ts`, `src/agent/runtime/claude/{runner,terminal}.ts`, `src/core/agent-host.ts` | `sessionTools`: the same tools a run gets, behind the same gate, for a Claude Code session that isn't a run | The session plays the role of "Your Mac" |
| `src/ipc/api.ts`, `src/ipc/handlers.ts`, `src/ipc/teamod-{api,handlers}.ts`, `src/companion/coverage.ts`, `docs/parity.md` | `teamod.sessionTools`, `teamod.closeSessionTools` | The bridge mounts those tools |
| `package.json`, `package-lock.json` | Add `elkjs` | Lays out graphs in the bridge; the Mac app already used it |
