# Parity with teamod

Generated from `engine/src/teamod/coverage.ts` by `npx tsx src/teamod/parity-doc.ts` in `engine/`. `engine/tests/teamod-parity.test.ts` holds it to the code: a method counts as done only when the mod or bridge source names it.

## Summary

| Where | Done | To do |
|---|---|---|
| Work pane | 54 | 2 |
| Task pane | 94 | 11 |
| Team pane | 103 | 0 |
| Board pane | 8 | 60 |
| Sentinel pane | 42 | 0 |
| Settings pane | 24 | 0 |
| Needs You band | 4 | 0 |
| `/teamod` verb | 1 | 0 |
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

- Work pane (2): `git.github`, `git.githubRepo`
- Task pane (11): `diff.load`, `diff.select`, `shell.run`, `shell.openEntry`, `files.enter`, `files.openSpec`, `files.downloadSpec`, `files.closeViewer`, `files.readImage`, `workspaces.open`, `attachments.reattach`
- Board pane (60): `board.create`, `board.update`, `board.setPrivate`, `board.move`, `board.editBrief`, `board.restoreRevision`, `board.comment`, `board.relate`, `board.addProof`, `board.removeProof`, `board.remove`, `board.setAgent`, `board.start`, `board.archive`, `board.archiveDone`, `board.unarchive`, `board.emptyArchive`, `board.settleGone`, `board.setAutoTasks`, `board.createBoard`, `board.editBoard`, `board.removeBoard`, `board.setPrefix`, `board.createLabel`, `board.removeLabel`, `board.setContext`, `board.syncTeams`, `board.syncConnect`, `board.syncDisconnect`, `board.syncNow`, `board.syncAuto`, `plans.create`, `plans.here`, `plans.edit`, `plans.setAutonomy`, `plans.setPaused`, `plans.setParallel`, `plans.setTestsAt`, `plans.setWorkAgent`, `plans.tidyUp`, `plans.openPr`, `plans.mergePr`, `plans.mergeLocal`, `plans.bringInMain`, `plans.showConflict`, `plans.startTask`, `plans.remove`, `plans.setStyle`, `issues.list`, `issues.get`, `issues.investigate`, `issues.fix`, `issues.toTask`, `issues.comment`, `ci.runs`, `ci.run`, `ci.workflows`, `ci.log`, `ci.rerun`, `ci.cancel`
