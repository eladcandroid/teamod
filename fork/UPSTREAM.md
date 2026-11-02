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
