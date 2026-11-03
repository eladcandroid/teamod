# teamod engine

The background engine of [teamod](../../README.md): projects, a worktree and an agent per task,
boards and plans, automations, and the peer-to-peer network between teammates. The Claude Code mod
in `../mod` draws its screens; they are written here, in `src/teamod`.

```bash
npm ci
npm run build
node dist/teamod/cli.js setup --from-source
```

Checks: `npm run typecheck`, `npx vitest run`.

How it fits together: `docs/how-it-works.md`. MIT licensed: see `LICENSE`.
