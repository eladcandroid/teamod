# Parity with teamod

Generated from `engine/src/teamod/coverage.ts` by `npx tsx src/teamod/parity-doc.ts` in `engine/`. `engine/tests/teamod-parity.test.ts` holds it to the code: a method counts as done only when the mod or bridge source names it.

## Summary

| Where | Done | To do |
|---|---|---|
| Work pane | 5 | 41 |
| Task pane | 94 | 21 |
| Team pane | 103 | 0 |
| Board pane | 7 | 61 |
| Sentinel pane | 42 | 0 |
| Settings pane | 0 | 24 |
| Needs You band | 4 | 0 |
| `/teamod` verb | 0 | 1 |
| Internal | 12 | 0 |
| Dropped | 54 | |

## Dropped, and why

- Window zoom: the terminal and desktop app have their own. (1): `session.zoom`
- Quitting the Mac app: Claude Code closes on its own, and `/teamod stop` stops the engine. (1): `session.quit`
- Project icons: panes list projects as text. (3): `projects.icon`, `projects.setIcon`, `projects.iconAt`
- Stripe earnings: not selected for teamod. (3): `stripe.connect`, `stripe.disconnect`, `stripe.refresh`
- teamod's own star and coffee prompts. (1): `support.answer`
- Phone companion and phone control: not selected for teamod. (41): `companion.pair.start`, `companion.pair.approve`, `companion.pair.cancel`, `companion.devices.remove`, `companion.phone.use`, `companion.phone.pairAdb`, `companion.phone.wifi`, `companion.phone.pairCable`, `companion.phone.setUpLink`, `companion.phone.settings`, `companion.phone.act`, `companion.phone.macros`, `companion.phone.macroRun`, `companion.phone.macroDelete`, `companion.older`, `companion.ask`, `companion.post`, `companion.askPerson`, `companion.signOut`, `companion.keepAwake`, `companion.defaultAgent`, `companion.openOnMac`, `companion.icon`, `companion.mergeCheck`, `companion.merge`, `companion.resolve`, `companion.branchStep`, `companion.viewFetch`, `companion.draftTask`, `companion.addTask`, `companion.files.list`, `companion.files.find`, `companion.files.read`, `companion.terminals`, `companion.termOpen`, `companion.termClose`, `companion.subAgent`, `companion.gone`, `companion.voice`, `companion.voicePrepare`, `companion.transcribe`
- Voice dictation: not selected for teamod. (3): `voice.models`, `voice.prepare`, `voice.transcribe`
- Importing a terminal app's look: the Terminal pane draws in the surface's own colours. (1): `terminalImport.detect`

## Slash commands dropped

- `/zoom`: Window zoom: the terminal and desktop app have their own.
- `/theme`: The Mac app's theme: panes draw in the surface's own.
- `/quit`: Quitting the Mac app: `/teamod stop` stops the engine.

## Still to do

- Work pane (41): `inbox.read`, `inbox.unread`, `inbox.clear`, `workspaces.newWorktree`, `workspaces.newChat`, `workspaces.archivePlan`, `workspaces.freeSpace`, `workspaces.remove`, `workspaces.setGroup`, `workspaces.renameGroup`, `workspaces.ungroup`, `workspaces.arrange`, `workspaces.newGroup`, `workspaces.showProject`, `workspaces.hideProject`, `workspaces.removeProject`, `workspaces.cleanAgentWorktrees`, `workspaces.otherOrigins`, `workspaces.otherActivity`, `workspaces.worktreeInfo`, `workspaces.showConversation`, `workspaces.outsideConversations`, `workspaces.importOutside`, `workspaces.removeOther`, `workspaces.staleOthers`, `workspaces.cleanUpOthers`, `workspaces.addProject`, `workspaces.addFolder`, `workbench.measureDisk`, `workbench.search`, `workbench.openHit`, `workbench.saveTemplate`, `workbench.removeTemplate`, `projects.addFolder`, `projects.create`, `local.listDirs`, `local.openFolder`, `local.statFiles`, `assistant.newChat`, `assistant.openChat`, `assistant.deleteChat`
- Task pane (21): `diff.load`, `diff.select`, `shell.run`, `shell.openEntry`, `files.enter`, `files.openSpec`, `files.downloadSpec`, `files.closeViewer`, `files.readImage`, `workspaces.open`, `workspaces.branches`, `attachments.reattach`, `git.fetch`, `git.fetchIfStale`, `git.updateMain`, `git.stashAndUpdate`, `git.moveAndUpdate`, `git.switchToDefault`, `git.askClaude`, `git.github`, `git.githubRepo`
- Board pane (61): `board.create`, `board.update`, `board.setPrivate`, `board.move`, `board.editBrief`, `board.restoreRevision`, `board.comment`, `board.relate`, `board.addProof`, `board.removeProof`, `board.remove`, `board.setAgent`, `board.start`, `board.archive`, `board.archiveDone`, `board.unarchive`, `board.emptyArchive`, `board.settleGone`, `board.setAutoTasks`, `board.createBoard`, `board.editBoard`, `board.removeBoard`, `board.setPrefix`, `board.createLabel`, `board.removeLabel`, `board.setContext`, `board.syncTeams`, `board.syncConnect`, `board.syncDisconnect`, `board.syncNow`, `board.syncAuto`, `plans.create`, `plans.here`, `plans.edit`, `plans.setAutonomy`, `plans.setPaused`, `plans.setParallel`, `plans.setTestsAt`, `plans.setWorkAgent`, `plans.tidyUp`, `plans.openPr`, `plans.mergePr`, `plans.mergeLocal`, `plans.bringInMain`, `plans.showConflict`, `plans.startTask`, `plans.remove`, `plans.setStyle`, `issues.list`, `issues.pulls`, `issues.get`, `issues.investigate`, `issues.fix`, `issues.toTask`, `issues.comment`, `ci.runs`, `ci.run`, `ci.workflows`, `ci.log`, `ci.rerun`, `ci.cancel`
- Settings pane (24): `session.setPrefs`, `session.rename`, `session.testNotification`, `workbench.shareScripts`, `workbench.signInClaude`, `workbench.editPrPrompt`, `workbench.resetPrPrompt`, `workbench.checkAgents`, `workbench.agentSignIn`, `env.get`, `env.set`, `env.claudeDotenv`, `env.testDatabase`, `env.importDotenv`, `env.newKeysBack`, `env.endpoints`, `env.saveEndpoint`, `env.removeEndpoint`, `env.checkEndpoints`, `claudeCode.skills`, `claudeCode.mcpServers`, `claudeCode.mcpSignIn`, `claudeCode.mcpSignedIn`, `claudeCode.mcpSetEnabled`
- `/teamod` verb (1): `daemon.stop`
