#!/usr/bin/env bash
# Installs teamod, or updates it when run again: the Claude Code mod and the engine it runs.
#   curl -fsSL https://raw.githubusercontent.com/eladcandroid/teamod/main/install.sh | bash
#
# Writes to ~/.teamod/app (or $TEAMOD_HOME/app) and to Claude Code's plugin list. No sudo.
set -euo pipefail

# Everything is inside main, so a download cut short runs nothing.
main() {
  local repo="${TEAMOD_REPO:-https://github.com/eladcandroid/teamod.git}"
  local marketplace="${TEAMOD_MARKETPLACE:-eladcandroid/teamod}"
  local home="${TEAMOD_HOME:-$HOME/.teamod}"
  local src="$home/app/src"
  local engine="$src/fork/engine"

  say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
  die() { printf 'teamod: %s\n' "$1" >&2; exit 1; }

  for tool in git node npm claude; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is missing. Install it, then run this again."
  done
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "teamod needs Node 20 or newer; this is $(node -v)."

  mkdir -p "$home/app"
  chmod 700 "$home"
  if [ -d "$src/.git" ]; then
    say "Updating the engine"
    git -C "$src" pull --ff-only --quiet
  else
    say "Getting the engine"
    git clone --quiet --depth 1 -- "$repo" "$src"
  fi

  say "Building the engine (a few minutes the first time)"
  (cd "$engine" && npm ci --no-audit --no-fund --loglevel=error && npm run --silent build)
  TEAMOD_HOME="$home" node "$engine/dist/teamod/cli.js" setup --from-source >/dev/null
  # An engine from before this update must not keep serving the new mod.
  TEAMOD_HOME="$home" node "$engine/dist/teamod/cli.js" stop >/dev/null

  say "Adding the mod to Claude Code"
  claude plugin marketplace add "$marketplace" >/dev/null 2>&1 || true
  claude plugin marketplace update teamod >/dev/null
  claude plugin install teamod@teamod >/dev/null 2>&1 || true
  # Already installed: install does nothing, so bring it up to date.
  claude plugin update teamod@teamod >/dev/null

  printf '\nDone. In any git project, run:\n\n  claude\n  /teamod\n\nRun this script again to update.\n'
}

main "$@"
