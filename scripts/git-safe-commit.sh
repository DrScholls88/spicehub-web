#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# git-safe-commit — Reliable git commit + add for VirtioFS/FUSE mounts
#
# PROBLEM: On Windows filesystems mounted via VirtioFS (used by Cowork/Claude
# desktop), git cannot unlink lock files it creates. This leaves:
#   • 0-byte stale locks — visible to stat(), blockable via rename()
#   • Zombie locks — invisible to stat() and find, but block O_CREAT|O_EXCL
#
# SOLUTION: All index and commit operations use /tmp (never the FUSE mount).
# - Staging  → git update-index with GIT_INDEX_FILE=/tmp/...
# - Committing → write-tree + commit-tree + direct ref write (no HEAD.lock)
# - Index sync → cp + same-device rename (not cross-device rename)
#
# USAGE:
#   ./scripts/git-safe-commit.sh "commit message" [file1 file2 ...]
#   ./scripts/git-safe-commit.sh "commit message"   # stages everything already in index
#   git safecommit "commit message"                  # via alias
#   git safeadd file1 file2 && git safecommit "msg"  # stage then commit
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

GIT_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR_REAL="$GIT_ROOT/.git"
TMP_DIR="/tmp"
TMP_IDX="$TMP_DIR/spicehub-safecommit-$$"
TMP_IDX_STAGE="$GIT_DIR_REAL/index.safecommit-$$"

COMMIT_MSG="${1:-}"
shift 2>/dev/null || true     # remaining args = explicit file paths to stage
FILES=("$@")

if [[ -z "$COMMIT_MSG" ]]; then
  echo "Usage: git-safe-commit.sh \"commit message\" [file1 file2 ...]" >&2
  exit 1
fi

cleanup() {
  rm -f "$TMP_IDX" 2>/dev/null || true
  # Don't remove TMP_IDX_STAGE — it might have been renamed already
}
trap cleanup EXIT

# ── Step 0: Clear any stale locks (0-byte only) ───────────────────────────────
# Use find -exec for zombie locks that are invisible to stat/ls but block git
find "$GIT_DIR_REAL" -name "*.lock" 2>/dev/null \
  | while read -r lockfile; do
      sz=$(wc -c < "$lockfile" 2>/dev/null || echo "1")
      if [[ "$sz" -eq 0 ]]; then
        mv "$lockfile" "${lockfile}.dead" 2>/dev/null \
          && echo "[safe-commit] Cleared stale lock: $lockfile" \
          || true
      fi
    done

# Also try via Python for any that find missed
python3 - "$GIT_DIR_REAL" 2>/dev/null <<'PYEOF'
import os, sys
from pathlib import Path
git_dir = Path(sys.argv[1])
for root, dirs, files in os.walk(git_dir):
    for f in files:
        if f.endswith('.lock'):
            p = Path(root) / f
            try:
                if p.stat().st_size == 0:
                    p.rename(str(p) + '.dead')
            except Exception:
                pass
PYEOF

# ── Step 1: Copy real index to /tmp (outside FUSE mount) ─────────────────────
if [[ -f "$GIT_DIR_REAL/index" ]]; then
  cp "$GIT_DIR_REAL/index" "$TMP_IDX"
else
  GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
    git read-tree --empty 2>/dev/null
fi

# ── Step 2: Stage specified files (or use existing index) ─────────────────────
if [[ ${#FILES[@]} -gt 0 ]]; then
  # Stage explicitly listed files
  for f in "${FILES[@]}"; do
    if [[ -f "$GIT_ROOT/$f" ]] || [[ -f "$f" ]]; then
      GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
        git update-index --add "$f" 2>&1 | grep -v "^warning:" || true
    fi
  done
fi

# ── Step 3: Write tree from the temp index ────────────────────────────────────
TREE=$(
  GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_REAL" GIT_WORK_TREE="$GIT_ROOT" \
  git write-tree 2>/dev/null
)
if [[ -z "$TREE" ]]; then
  echo "[safe-commit] ERROR: git write-tree failed" >&2
  exit 1
fi
echo "[safe-commit] Tree: $TREE"

# ── Step 4: Create commit object ─────────────────────────────────────────────
HEAD_SHA=$(GIT_DIR="$GIT_DIR_REAL" git rev-parse HEAD 2>/dev/null || echo "")
AUTHOR_NAME=$(git config user.name 2>/dev/null || echo "Developer")
AUTHOR_EMAIL=$(git config user.email 2>/dev/null || echo "dev@localhost")

if [[ -n "$HEAD_SHA" ]]; then
  COMMIT_SHA=$(
    GIT_DIR="$GIT_DIR_REAL" \
    GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
    GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
    git commit-tree "$TREE" -p "$HEAD_SHA" -m "$COMMIT_MSG" 2>/dev/null
  )
else
  COMMIT_SHA=$(
    GIT_DIR="$GIT_DIR_REAL" \
    GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
    GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
    git commit-tree "$TREE" -m "$COMMIT_MSG" 2>/dev/null
  )
fi

if [[ -z "$COMMIT_SHA" ]]; then
  echo "[safe-commit] ERROR: git commit-tree failed" >&2
  exit 1
fi
echo "[safe-commit] Commit: $COMMIT_SHA"

# ── Step 5: Update branch ref (bypass HEAD.lock via direct file write) ────────
python3 - "$COMMIT_SHA" "$GIT_DIR_REAL" <<'PYEOF'
import os, sys
commit_sha, git_dir = sys.argv[1], sys.argv[2]
head_file = os.path.join(git_dir, 'HEAD')
with open(head_file, 'r') as f:
    head = f.read().strip()
if head.startswith('ref: '):
    ref_rel  = head[5:]
    ref_path = os.path.join(git_dir, ref_rel)
    os.makedirs(os.path.dirname(ref_path), exist_ok=True)
    with open(ref_path, 'w') as f:
        f.write(commit_sha + '\n')
    print(f'[safe-commit] Updated {ref_rel} → {commit_sha[:12]}')
else:
    with open(head_file, 'w') as f:
        f.write(commit_sha + '\n')
    print(f'[safe-commit] Updated detached HEAD → {commit_sha[:12]}')
PYEOF

# ── Step 6: Sync temp index back via same-device copy + rename ────────────────
# copy to FUSE mount first (same device), then atomic rename — avoids cross-device error
cp "$TMP_IDX" "$TMP_IDX_STAGE"
python3 -c "
import os
os.rename('$TMP_IDX_STAGE', '$GIT_DIR_REAL/index')
" && echo "[safe-commit] Index synced"

# ── Step 7: Print summary ─────────────────────────────────────────────────────
BRANCH=$(GIT_DIR="$GIT_DIR_REAL" git symbolic-ref --short HEAD 2>/dev/null || echo "HEAD")
SHORT=$(echo "$COMMIT_SHA" | cut -c1-8)
FIRST_LINE=$(echo "$COMMIT_MSG" | head -1)
echo ""
echo "[$BRANCH $SHORT] $FIRST_LINE"
GIT_DIR="$GIT_DIR_REAL" git diff-tree --no-commit-id -r --stat "$COMMIT_SHA" 2>/dev/null || true

# ── Step 8: Run post-commit hook manually (since we bypassed normal git commit) ─
HOOK="$GIT_DIR_REAL/hooks/post-commit"
if [[ -x "$HOOK" ]]; then
  cd "$GIT_ROOT" && GIT_DIR="$GIT_DIR_REAL" "$HOOK" 2>/dev/null || true
fi
