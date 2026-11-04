---
description: Open teamod: worktrees, tasks, your team and automations
argument-hint: "[work|task|team|board|sentinel|settings|status]"
---
The person asked to open teamod (`/teamod $ARGUMENTS`), and the session got to you before teamod could answer it itself.

Call the tool `mcp__teamod__open` with `{"words": "$ARGUMENTS"}` (load it with ToolSearch if it isn't loaded). Then reply with what it returned, in one line, and nothing else.

If no such tool exists, reply only: "teamod is still starting: send /teamod again in a few seconds."
