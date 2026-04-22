#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# git-safe-add — Reliable git add for VirtioFS/FUSE mounts (Windows ↔ Linux)
#
# Stages files using a temp index in /tmp (never creates index.lock on the FUSE
# mount). The updated index is written back via copy + same-device rename.
#
# USAGE:
#   ./scripts/git-safe-add.sh file1 file2 ...
#   ./scripts/git-safe-add.sh .           # stage everything modified
#   git safeadd file1 file2              # via alias
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

GIT_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR_REAL="$GIT_ROOT/.git"
TMP_IDX="/tmp/spicehub-safeadd-$$"
TMP_IDX_STAGE="$GIT_DIR_REAL/index.safeadd-$$"
FILES=("$@")

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Usage: git-safe-add.sh <file|.> [file2 ...]" >&2
  exit 1
fi

cleanup() { rm -f "$TMP_IDX" 2>/dev/null || true; }
trap cleanup EXIT

# ── Step 0: Clear stale locks ─────────────────────────────────────────────────
find "$GIT_DIR_REAL" -name "*.lock" 2>/dev/null \
  | while read -r lf; do
      sz=$(wc -c < "$lf" 2>/dev/null || echo "1")
      [[ "$sz" -eq 0 ]] && mv "$lf" "${lf}.dead" 2>/dev/null || true
    done

# ── Step 1: Copy real index to /tmp ──────────────────────────────────────────
if [[ -f "$GIT_DIR_REAL/index" ]]; then
  cp "$GIT_DIR_REAL/index" "$TMP_IDX"
else
  GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
    git read-tree HEAD 2>/dev/null
fi

# ── Step 2: Stage each path using update-index (no lock file) ────────────────
for f in "${FILES[@]}"; do
  if [[ "$f" == "." ]]; then
    # Stage all modified tracked files
    GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
      git update-index --add --remove \
      $(GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
        git diff --name-only 2>/dev/null) 2>&1 | grep -v "^warning:" || true
  else
    abs_f="$f"
    [[ "$f" != /* ]] && abs_f="$GIT_ROOT/$f"
    if [[ -f "$abs_f" ]]; then
      GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
        git update-index --add "$f" 2>&1 | grep -v "^warning:" || true
      echo "staged: $f"
    elif [[ ! -e "$abs_f" ]]; then
      # File deleted — remove from index
      GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
        git update-index --remove "$f" 2>&1 | grep -v "^warning:" || true
      echo "removed: $f"
    fi
  fi
done

# ── Step 3: Sync index back via same-device copy + rename ─────────────────────
cp "$TMP_IDX" "$TMP_IDX_STAGE"
python3 -c "
import os
os.rename('$TMP_IDX_STAGE', '$GIT_DIR_REAL/index')
print('Index updated.')
"

# Show staged diff
echo ""
GIT_INDEX_FILE="$GIT_DIR_REAL/index" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
  git diff --cached --stat HEAD 2>/dev/null || true
