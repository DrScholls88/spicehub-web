#!/usr/bin/env python3
"""
git-clear-locks.py — Clear stale git lock files on VirtioFS/FUSE mounts.

BACKGROUND:
  On Windows filesystems mounted via VirtioFS (used by Cowork/Claude desktop),
  git creates lock files (*.lock) that it cannot delete after use because Linux
  unlink() returns EPERM on this filesystem type. Stale 0-byte locks accumulate
  and block future git operations.

  rename() DOES work on VirtioFS, so we move locks out of the way instead of
  deleting them. The renamed *.lock.dead files are harmless and ignored by git.

USAGE:
  python3 scripts/git-clear-locks.py              # from repo root
  python3 scripts/git-clear-locks.py /path/to/repo
"""

import os
import sys
import subprocess
from pathlib import Path


def find_git_dir(start: Path) -> Path | None:
    """Walk up to find the .git directory."""
    cur = start.resolve()
    for _ in range(20):
        candidate = cur / '.git'
        if candidate.is_dir():
            return candidate
        parent = cur.parent
        if parent == cur:
            return None
        cur = parent
    return None


def clear_stale_locks(git_dir: Path, dry_run: bool = False) -> list[str]:
    """
    Rename every 0-byte *.lock file in git_dir to *.lock.dead.
    Returns list of cleared lock paths.
    """
    cleared = []

    for root, dirs, files in os.walk(git_dir):
        # Skip packed-refs and other non-lock subdirs (optimization)
        dirs[:] = [d for d in dirs if d not in ('objects/pack',)]

        for fname in files:
            if not fname.endswith('.lock'):
                continue
            full = Path(root) / fname
            try:
                stat = full.stat()
                if stat.st_size > 0:
                    # Non-empty lock = an active git process owns it. Leave it alone.
                    print(f'  SKIP (active, {stat.st_size}b): {full.relative_to(git_dir.parent)}')
                    continue
                dead = Path(str(full) + '.dead')
                if not dry_run:
                    full.rename(dead)
                cleared.append(str(full.relative_to(git_dir.parent)))
                print(f'  CLEARED: {full.relative_to(git_dir.parent)}')
            except FileNotFoundError:
                pass  # Already gone
            except PermissionError as e:
                print(f'  ERROR (cannot move): {full.relative_to(git_dir.parent)}: {e}')

    return cleared


def verify_git_works(repo_root: Path) -> bool:
    """Run a read-only git command to confirm the repo is accessible."""
    try:
        result = subprocess.run(
            ['git', 'log', '--oneline', '-1'],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            print(f'  Git OK: {result.stdout.strip()}')
            return True
        print(f'  Git ERROR: {result.stderr.strip()}')
        return False
    except Exception as e:
        print(f'  Git check failed: {e}')
        return False


def main():
    repo_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    dry_run   = '--dry-run' in sys.argv

    git_dir = find_git_dir(repo_root)
    if git_dir is None:
        print(f'ERROR: No .git directory found at or above {repo_root}', file=sys.stderr)
        sys.exit(1)

    print(f'Git directory: {git_dir}')
    if dry_run:
        print('(DRY RUN — no files will be moved)')
    print()

    cleared = clear_stale_locks(git_dir, dry_run=dry_run)

    print()
    if cleared:
        print(f'Cleared {len(cleared)} stale lock(s).')
    else:
        print('No stale locks found.')

    print()
    print('Verifying git:')
    ok = verify_git_works(git_dir.parent)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
