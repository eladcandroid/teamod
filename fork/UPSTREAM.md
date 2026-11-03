# Where the engine came from

`engine/` started as an import of an MIT-licensed open-source project. Its copyright notice is kept
in `engine/LICENSE`, as the license requires. teamod no longer follows that project: the engine has
been renamed and changed throughout, and is maintained here.

On purpose, a few spots still name the original app, to protect a computer that runs it too:
its home folder stays secret to agents (`src/core/shares.ts`, `src/agent/policy.ts`), its
environment variables never reach teamod's agents (`src/teamod/launch.ts`), and its invite links
never open on teamod's network (`src/net/mesh/invitations.ts`).
