#!/usr/bin/env bash
# L2/L3: a contract's SEMANTIC CORE (name, interface, acceptance, env) is
# immutable — it carries the audits and the verdicts, and changes only by
# revision (tools/revise.mjs). Descriptive fields (title, nl_description,
# serves) may be edited in place: nothing builds against them. Deleting or
# renaming a contract, or rewriting laws/deprecations.log, is never allowed.
set -euo pipefail
BASE="${1:-origin/main}"

if ! git rev-parse -q --verify "$BASE^{commit}" >/dev/null 2>&1; then
  echo "check-immutability: baseline '$BASE' not found — skipping (first commit)."
  exit 0
fi

bad="$(git diff --name-status --diff-filter=DR "$BASE" HEAD -- contracts/ || true)"
if [ -n "$bad" ]; then
  echo "IMMUTABILITY VIOLATION — contracts may never be deleted or renamed:"
  echo "$bad"
  echo "To retire a contract, deprecate it (node tools/deprecate.mjs) — the file stays."
  exit 1
fi

modified="$(git diff --name-only --diff-filter=M "$BASE" HEAD -- contracts/ || true)"
if [ -n "$modified" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if ! node -e '
      const { execFileSync } = require("node:child_process");
      const [base, file] = process.argv.slice(1);
      const read = (rev) => JSON.parse(execFileSync("git", ["show", `${rev}:${file}`], { encoding: "utf8" }));
      let a, b;
      try { a = read(base); b = read("HEAD"); } catch (e) { console.error(`${file}: unreadable as JSON (${e.message.split("\n")[0]})`); process.exit(1); }
      const DESCRIPTIVE = ["title", "nl_description", "serves"];
      const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      const illegal = changed.filter((k) => !DESCRIPTIVE.includes(k));
      if (illegal.length > 0) { console.error(`${file}: non-descriptive field(s) modified: ${illegal.join(", ")}`); process.exit(1); }
    ' "$BASE" "$f"; then
      name="$(basename "$f" .json)"
      echo "IMMUTABILITY VIOLATION — only descriptive fields (title, nl_description, serves) may be edited in place."
      echo "To change the semantic core, revise: node tools/revise.mjs $name --set field=value --reason ..."
      exit 1
    fi
  done <<< "$modified"
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
