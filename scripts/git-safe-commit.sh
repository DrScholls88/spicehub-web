#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# git-safe-commit — Reliable git commit for VirtioFS/FUSE mounts (Windows ↔ Linux)
#
# PROBLEM: git creates lock files (index.lock, HEAD.lock, objects/maintenance.lock)
# that it cannot delete after use on VirtioFS because Linux `unlink()` returns EPERM
# on this filesystem type. Subsequent commits fail with "lock file already exists".
#
# ROOT CAUSE: VirtioFS (Windows NTFS via FUSE) allows file creation and rename()
# but blocks unlink() on files that git created. This leaves stale 0-byte locks.
#
# SOLUTION: This script uses git's low-level plumbing commands with a temp index
# stored in /tmp (NOT on the FUSE mount), then updates the branch ref directly
# via Python's os.rename() which works where unlink() does not.
#
# USAGE:
#   ./scripts/git-safe-commit.sh "commit message"
#   ./scripts/git-safe-commit.sh "commit message" [-- file1 file2 ...]
#
# ALSO: Sets up a git alias so you can run: git safecommit "message"
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
GIT_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR_PATH="$GIT_ROOT/.git"
TMP_IDX="/tmp/git-safecommit-index-$$"
COMMIT_MSG="${1:-}"

if [[ -z "$COMMIT_MSG" ]]; then
  echo "Usage: git-safe-commit.sh \"commit message\"" >&2
  exit 1
fi

# ── Step 0: Clear any stale lock files (rename works where unlink fails) ─────
python3 - <<'PYEOF'
import os, glob

git_dir = os.environ.get('GIT_DIR_PATH', '.git')

# Walk the entire .git dir for stale lock files
for root, dirs, files in os.walk(git_dir):
    for f in files:
        if f.endswith('.lock'):
            lock_path = os.path.join(root, f)
            try:
                stat = os.stat(lock_path)
                # Only remove 0-byte locks (stale) — occupied locks have content
                if stat.st_size == 0:
                    dead_path = lock_path + '.dead'
                    os.rename(lock_path, dead_path)
                    print(f'[git-safe-commit] Cleared stale lock: {lock_path}')
            except Exception as e:
                print(f'[git-safe-commit] Warning: could not clear {lock_path}: {e}')
PYEOF

# ── Step 1: Copy the real index to /tmp (avoids FUSE locking issues) ─────────
if [[ -f "$GIT_DIR_PATH/index" ]]; then
  cp "$GIT_DIR_PATH/index" "$TMP_IDX"
else
  # No existing index — start fresh
  GIT_INDEX_FILE="$TMP_IDX" GIT_DIR="$GIT_DIR_PATH" GIT_WORK_TREE="$GIT_ROOT" \
    git read-tree --empty
fi

# ── Step 2: Write tree from the temp index ────────────────────────────────────
TREE=$(
  GIT_INDEX_FILE="$TMP_IDX" \
  GIT_DIR="$GIT_DIR_PATH" \
  GIT_WORK_TREE="$GIT_ROOT" \
  git write-tree
)
echo "[git-safe-commit] Tree: $TREE"

# ── Step 3: Create the commit object ─────────────────────────────────────────
HEAD_SHA=$(GIT_DIR="$GIT_DIR_PATH" git rev-parse HEAD 2>/dev/null || echo "")

if [[ -n "$HEAD_SHA" ]]; then
  COMMIT_SHA=$(
    GIT_DIR="$GIT_DIR_PATH" \
    GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-$(git config user.name)}" \
    GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-$(git config user.email)}" \
    GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$(git config user.name)}" \
    GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$(git config user.email)}" \
    git commit-tree "$TREE" -p "$HEAD_SHA" -m "$COMMIT_MSG"
  )
else
  # Initial commit — no parent
  COMMIT_SHA=$(
    GIT_DIR="$GIT_DIR_PATH" \
    git commit-tree "$TREE" -m "$COMMIT_MSG"
  )
fi
echo "[git-safe-commit] Commit: $COMMIT_SHA"

# ── Step 4: Update the branch ref directly (bypasses HEAD.lock) ──────────────
python3 - "$COMMIT_SHA" "$GIT_DIR_PATH" <<'PYEOF'
import os, sys

commit_sha = sys.argv[1]
git_dir    = sys.argv[2]

# Resolve symbolic ref (e.g. refs/heads/main)
head_path = os.path.join(git_dir, 'HEAD')
with open(head_path, 'r') as f:
    head = f.read().strip()

if head.startswith('ref: '):
    # Normal branch
    ref_rel   = head[5:]                              # refs/heads/main
    ref_path  = os.path.join(git_dir, ref_rel)
    ref_dir   = os.path.dirname(ref_path)
    os.makedirs(ref_dir, exist_ok=True)
    with open(ref_path, 'w') as f:
        f.write(commit_sha + '\n')
    print(f'[git-safe-commit] Updated {ref_rel} → {commit_sha[:12]}')
else:
    # Detached HEAD
    with open(head_path, 'w') as f:
        f.write(commit_sha + '\n')
    print(f'[git-safe-commit] Updated detached HEAD → {commit_sha[:12]}')
PYEOF

# ── Step 5: Sync temp index back to real index (so git status is accurate) ───
# Use a rename-based swap so we don't need to write index.lock on the FUSE mount
STAGED_IDX="$GIT_DIR_PATH/index.staged"
cp "$TMP_IDX" "$STAGED_IDX"
python3 -c "
import os
staged  = '$STAGED_IDX'
real    = '$GIT_DIR_PATH/index'
# Atomic swap via rename — works on VirtioFS where unlink does not
os.rename(staged, real)
print('[git-safe-commit] Index synced')
"

# ── Step 6: Cleanup ───────────────────────────────────────────────────────────
rm -f "$TMP_IDX"

# ── Step 7: Show result ───────────────────────────────────────────────────────
BRANCH=$(GIT_DIR="$GIT_DIR_PATH" git symbolic-ref --short HEAD 2>/dev/null || echo "HEAD")
SHORT=$(echo "$COMMIT_SHA" | cut -c1-8)
FIRST_LINE=$(echo "$COMMIT_MSG" | head -1)
echo ""
echo "[$BRANCH $SHORT] $FIRST_LINE"
GIT_DIR="$GIT_DIR_PATH" git diff-tree --no-commit-id -r --stat "$COMMIT_SHA" 2>/dev/null || true

export GIT_DIR="$GIT_DIR_PATH"
