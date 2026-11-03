# teamod engine

The engine (`src/`, the daemon) behind the teamod Claude Code mod (`../mod`). Screens are trees
written in `src/teamod/panes/`; the mod only draws them. How it fits together: `docs/how-it-works.md`.

- **A new or changed API method** (`src/ipc/*-api.ts`): account for it in `src/teamod/coverage.ts`
  (the parity test fails until you do) and regenerate `../PARITY.md` with `npx tsx src/teamod/parity-doc.ts`.
- **Screens** are written in plain English with the kit in `src/teamod/panes/common.ts`. They are
  translated on the way out: add Hebrew to `src/teamod/i18n/he/<area>.ts` (glossary in
  `src/teamod/i18n/he/GLOSSARY.md`); `scripts/i18n-missing.sh` lists what's missing.
- The core stays free of UI code (`tests/boundaries.test.ts`).

## Checks

`npm run typecheck`, `npx vitest run`.
