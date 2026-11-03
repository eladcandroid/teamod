#!/usr/bin/env bash
# Lists what the Hebrew catalog doesn't cover yet, as the tests draw the screens.
#   scripts/i18n-missing.sh [test file pattern, default: teamod-]
# Prints "count<TAB>screen/route<TAB>text", most-drawn first. Fixture names (alpha, add-login) show
# up too: they are people's words, never translated.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp)
TEAMOD_I18N_MISSING="$out" npx vitest run "tests/${1:-teamod-}" >/dev/null 2>&1 || true
sort "$out" | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); print c "\t" $0}'
rm -f "$out"
