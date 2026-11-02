# Parity with teamod

Generated from `engine/src/teamod/coverage.ts` by `npx tsx src/teamod/parity-doc.ts` in `engine/`. `engine/tests/teamod-parity.test.ts` holds it to the code: a method counts as done only when the mod or bridge source names it.

## Summary

| Where | Done | To do |
|---|---|---|
| Work pane | 54 | 0 |
| Task pane | 94 | 0 |
| Team pane | 103 | 0 |
| Board pane | 68 | 0 |
| Sentinel pane | 42 | 0 |
| Settings pane | 24 | 0 |
| Needs You band | 4 | 0 |
| `/teamod` verb | 1 | 0 |
| Internal | 13 | 0 |
| Dropped | 66 | |

## Dropped, and why

- Window zoom: the terminal and desktop app have their own. (1): `session.zoom`
- Quitting the Mac app: Claude Code closes on its own, and `/teamod stop` stops the engine. (1): `session.quit`
- A shared workspace's diff tab on the Mac: not built here. A shared project's own Changes aren't shown; open it as a fork. (2): `diff.load`, `diff.select`
- The search over a shared workspace's files: Team browses them by folder instead. (1): `shell.run`
- Unused by upstream's Mac app too. (1): `shell.openEntry`
- A cursor-driven file browser: panes press a row and read by path. (5): `files.enter`, `files.openSpec`, `files.downloadSpec`, `files.closeViewer`, `files.readImage`
- A message pulled back from the queue keeps its images as links, with no thumbnails to restore. (1): `attachments.reattach`
- Project icons: panes list projects as text. (3): `projects.icon`, `projects.setIcon`, `projects.iconAt`
- Stripe earnings: not selected for teamod. (3): `stripe.connect`, `stripe.disconnect`, `stripe.refresh`
- teamod's own star and coffee prompts. (1): `support.answer`
- Each pull request and issue already carries its GitHub link. (2): `git.github`, `git.githubRepo`
- Phone companion and phone control: not selected for teamod. (41): `companion.pair.start`, `companion.pair.approve`, `companion.pair.cancel`, `companion.devices.remove`, `companion.phone.use`, `companion.phone.pairAdb`, `companion.phone.wifi`, `companion.phone.pairCable`, `companion.phone.setUpLink`, `companion.phone.settings`, `companion.phone.act`, `companion.phone.macros`, `companion.phone.macroRun`, `companion.phone.macroDelete`, `companion.older`, `companion.ask`, `companion.post`, `companion.askPerson`, `companion.signOut`, `companion.keepAwake`, `companion.defaultAgent`, `companion.openOnMac`, `companion.icon`, `companion.mergeCheck`, `companion.merge`, `companion.resolve`, `companion.branchStep`, `companion.viewFetch`, `companion.draftTask`, `companion.addTask`, `companion.files.list`, `companion.files.find`, `companion.files.read`, `companion.terminals`, `companion.termOpen`, `companion.termClose`, `companion.subAgent`, `companion.gone`, `companion.voice`, `companion.voicePrepare`, `companion.transcribe`
- Voice dictation: not selected for teamod. (3): `voice.models`, `voice.prepare`, `voice.transcribe`
- Importing a terminal app's look: the Terminal pane draws in the surface's own colours. (1): `terminalImport.detect`

## Slash commands dropped

- `/zoom`: Window zoom: the terminal and desktop app have their own.
- `/theme`: The Mac app's theme: panes draw in the surface's own.
- `/quit`: Quitting the Mac app: `/teamod stop` stops the engine.

## Still to do

