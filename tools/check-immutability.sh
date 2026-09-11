#!/usr/bin/env bash
# L2/L3: contracts are append-only; deprecations.log is append-only.
set -euo pipefail
BASE="${1:-origin/main}"

if ! git rev-parse -q --verify "$BASE^{commit}" >/dev/null 2>&1; then
  echo "check-immutability: baseline '$BASE' not found — skipping (first commit)."
  exit 0
fi

bad="$(git diff --name-status --diff-filter=MDR "$BASE" HEAD -- contracts/ || true)"
if [ -n "$bad" ]; then
  echo "IMMUTABILITY VIOLATION — contracts may only be added, never modified or deleted:"
  echo "$bad"
  echo "To change a contract, deprecate it in laws/deprecations.log and publish a successor."
  exit 1
fi

f="laws/deprecations.log"
if git cat-file -e "$BASE:$f" 2>/dev/null; then
  old="$(git show "$BASE:$f")"
  new="$(git show "HEAD:$f" 2>/dev/null || true)"
  case "$new" in
    "$old"*) : ;;
    *) echo "IMMUTABILITY VIOLATION — $f must be append-only."; exit 1 ;;
  esac
fi

echo "immutability OK"
