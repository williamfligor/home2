#!/usr/bin/env python3
"""
chezmoi-prune (run_always_after_chezmoi-prune.py)

Scans the git history of this chezmoi dotfiles repo for files that were
deleted from the repo but whose installed counterparts still linger in
the home directory. Runs automatically after every `chezmoi apply`.

In non-interactive mode (default when run by chezmoi), quarantines all
orphans to ~/.local/share/chezmoi-orphans/.  Run from the terminal to
get prompted per file.

Usage:
    chezmoi-prune [-y] [--no-skip-existing]

Options:
    -y, --yes           Non-interactive: quarantine all orphans without prompting
    --no-skip-existing  Include files that still exist in the current chezmoi source
"""

from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def find_repo_root() -> Path:
    """Locate the chezmoi dotfiles repo root."""
    # Check if we're inside the repo or running alongside it
    script_dir = Path(sys.argv[0]).resolve().parent

    for candidate in (script_dir.parent, script_dir.parent.parent):
        if (candidate / ".git").is_dir():
            return candidate.resolve()

    # Check if cwd is inside a git repo
    try:
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return Path(root).resolve()
    except subprocess.CalledProcessError:
        pass

    # Common fallback locations
    for candidate in (
        Path.home() / ".local/share/chezmoi",
        Path.home() / "src/dotfiles",
        Path.home() / "dotfiles",
    ):
        if (candidate / ".git").is_dir():
            return candidate.resolve()

    print("Error: Cannot find the chezmoi dotfiles repo.", file=sys.stderr)
    print("Run this script from within the repo.", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Chezmoi path mapping
# ---------------------------------------------------------------------------

# Prefixes on the first path component that map to a dotfile in $HOME
# All chezmoi attribute prefixes (from chezmoi.io/reference/source-state-attributes).
# These are stripped iteratively during path mapping; "dot_" is tracked
# separately because it's the only one that changes the target name (prepends ".").
# "literal_" stops attribute parsing entirely.
ATTRIBUTE_PREFIXES = (
    "after_",
    "before_",
    "create_",
    "dot_",
    "empty_",
    "encrypted_",
    "exact_",
    "executable_",
    "external_",
    "literal_",
    "modify_",
    "once_",
    "onchange_",
    "private_",
    "readonly_",
    "remove_",
    "run_",
    "symlink_",
)

# Prefixes stripped from any path component (no special behaviour for path).
STRIP_PREFIXES = (
    "after_",
    "before_",
    "create_",
    "empty_",
    "encrypted_",
    "exact_",
    "executable_",
    "external_",
    "literal_",
    "modify_",
    "once_",
    "onchange_",
    "private_",
    "readonly_",
    "remove_",
    "run_",
    "symlink_",
)

# Paths that shouldn't be installed to the home directory
INTERNAL_PATTERNS = (
    ".git/",
    ".github/",
    ".chezmoi",
    ".data",
    ".data/",
    ".docs",
    ".docs/",
    ".chezmoiscripts",
    ".chezmoiscripts/",
    ".chezmoitemplates",
    ".chezmoitemplates/",
    ".chezmoiexternal.toml",
    ".chezmoiexternal.toml.tmpl",
)

INTERNAL_FILES = frozenset({
    "AGENTS.md",
    "README.md",
    ".dockerignore",
    ".test.sh",
    "mise.lock",
    ".gitignore",
    ".Dockerfile",
})

INTERNAL_SUFFIXES = frozenset({".zwc", ".md"})


def is_chezmoi_internal(source_path: str) -> bool:
    """Return True if the path is a chezmoi internal file (not installed)."""
    if source_path.startswith(INTERNAL_PATTERNS):
        return True
    if source_path in INTERNAL_FILES:
        return True
    if any(source_path.endswith(s) for s in INTERNAL_SUFFIXES):
        return True
    if source_path.startswith("bin/") or source_path == "bin":
        return True
    return False


def strip_component_prefixes(component: str) -> str:
    """Strip all chezmoi attribute prefixes from a single path component.
    The "literal_" prefix stops further stripping.
    """
    while True:
        matched = False
        for prefix in STRIP_PREFIXES:
            if component.startswith(prefix):
                component = component[len(prefix) :]
                if prefix == "literal_":
                    return component  # stop stripping
                matched = True
                break  # restart from the top after each strip
        if not matched:
            break
    return component


def source_to_target(source_path: str, home: Path) -> Path | None:
    """
    Convert a chezmoi source-relative path to the $HOME target path.
    Returns None if the path doesn't map to a home-directory file.
    """
    # Normalise — strip leading ./ prefix only, not dots from .dir names
    source = source_path.removeprefix("./")

    # Strip trailing suffixes: .tmpl (template), .age/.asc (encrypted),
    # .literal (stop suffix parsing)
    while source.endswith((".tmpl", ".age", ".asc", ".literal")):
        if source.endswith(".tmpl"):
            source = source.removesuffix(".tmpl")
        elif source.endswith(".age"):
            source = source.removesuffix(".age")
        elif source.endswith(".asc"):
            source = source.removesuffix(".asc")
        elif source.endswith(".literal"):
            source = source.removesuffix(".literal")
        else:
            break

    # Skip scripts / templates / externals
    if source.startswith((
        ".chezmoiscripts",
        ".chezmoitemplates",
    )):
        return None
    if source == ".chezmoiexternal.toml":
        return None

    parts = source.split("/")
    first = parts[0]

    # Strip all known attribute prefixes from the first component,
    # keeping track of whether "dot_" was seen (which prepends ".").
    # "literal_" stops prefix parsing.
    basename = first
    has_dot = False
    literal_mode = False
    while not literal_mode:
        matched = False
        for prefix in ATTRIBUTE_PREFIXES:
            if basename.startswith(prefix):
                basename = basename[len(prefix) :]
                if prefix == "dot_":
                    has_dot = True
                if prefix == "literal_":
                    literal_mode = True
                matched = True
                break
        if not matched:
            break

    if has_dot:
        target_first = "." + basename
    elif basename.startswith("."):
        # Top-level dotfiles/directories (.local/, .config/) map to home
        target_first = basename
    elif not basename.startswith("."):
        # Plain directories (Library/, data/) map directly
        target_first = basename
    else:
        return None

    remaining = [strip_component_prefixes(p) for p in parts[1:]]

    target = home / target_first
    for r in remaining:
        target /= r

    return target


def currently_in_source(source_path: str, repo_root: Path) -> bool:
    """Check if a source path still exists in the current repo state."""
    # Check git tracked (with relative path for reliability)
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--error-unmatch", source_path],
        capture_output=True,
        cwd=repo_root,
    )
    if result.returncode == 0:
        return True

    # Check without .tmpl — the tracked file may not have a .tmpl suffix
    if source_path.endswith(".tmpl"):
        no_tmpl = source_path.removesuffix(".tmpl")
        if currently_in_source(no_tmpl, repo_root):
            return True

    # Check working tree (the original path, e.g. dot_gitconfig.tmpl)
    if (repo_root / source_path).exists():
        return True

    return False


# ---------------------------------------------------------------------------
# Git history scanning
# ---------------------------------------------------------------------------

def get_deleted_files(repo_root: Path) -> set[str]:
    """Return a set of source-relative paths that have been deleted."""
    result = subprocess.run(
        ["git", "log", "--all", "--diff-filter=D", "--name-only", "--format="],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    files = set()
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            files.add(line)
    return files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find and quarantine orphaned chezmoi-managed files."
    )
    parser.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="Include files that still exist in the chezmoi source",
    )
    parser.add_argument(
        "-y", "--yes",
        action="store_true",
        help="Non-interactive: quarantine all orphans without prompting",
    )
    args = parser.parse_args()

    repo_root = find_repo_root()
    home = Path.home()
    quarantine = home / ".local/share/chezmoi-orphans"

    deleted = get_deleted_files(repo_root)

    if not deleted:
        return

    skip_internal = 0
    skip_existing = 0
    map_failed_count = 0
    map_failed_files: list[str] = []
    orphans: list[tuple[str, Path]] = []

    for source_path in sorted(deleted):
        if is_chezmoi_internal(source_path):
            skip_internal += 1
            continue

        target = source_to_target(source_path, home)
        if target is None:
            map_failed_count += 1
            map_failed_files.append(source_path)
            continue

        if not args.no_skip_existing and currently_in_source(source_path, repo_root):
            skip_existing += 1
            continue

        if target.exists():
            orphans.append((source_path, target))

    # Deduplicate by target path (a file may have been deleted and re-added)
    seen: set[Path] = set()
    unique_orphans: list[tuple[str, Path]] = []
    for src, tgt in orphans:
        if tgt not in seen:
            seen.add(tgt)
            unique_orphans.append((src, tgt))
    orphans = unique_orphans

    if not orphans:
        return

    print("=== Orphaned chezmoi file finder ===")
    print(f"Repo:       {repo_root}")
    print(f"Home:       {home}")
    print(f"Quarantine: {quarantine}")
    print()

    print("=== Scan results ===")
    print(f"Total deleted files found in history: {len(deleted)}")
    print(f"Skipped (chezmoi internal):           {skip_internal}")
    print(f"Skipped (exists in source):           {skip_existing}")
    print(f"Skipped (mapping failed):             {map_failed_count}")
    if map_failed_files:
        for f in map_failed_files:
            print(f"  ↳ {f}")
    print(f"Orphaned on filesystem:               {len(orphans)}")
    print()

    if not orphans:
        print("No orphaned files found! Your system is clean.")
        return

    print(
        f"Found {len(orphans)} orphaned file(s) that were previously managed by chezmoi\n"
        "but have been removed from the dotfiles repo.\n"
    )
    print(f"They will be MOVED to: {quarantine}")
    print("(instead of being deleted, so you can recover them if needed)\n")

    # Create quarantine directory
    quarantine.mkdir(parents=True, exist_ok=True)

    moved = 0
    skipped = 0

    for i, (source, target) in enumerate(orphans, 1):
        kind = "directory" if target.is_dir() else "file" if target.is_file() else "other"
        display = f"~/{target.relative_to(home)}"

        print("-" * 60)
        print(f"[{i}/{len(orphans)}] {display}")
        print(f"    (source: {source}, type: {kind})")

        # Build quarantine path preserving home-relative structure
        rel = target.relative_to(home)
        dest = quarantine / rel
        dest.parent.mkdir(parents=True, exist_ok=True)

        if args.yes:
            shutil.move(str(target), str(dest))
            print(f"  → Moved to ~/.local/share/chezmoi-orphans/{rel}")
            moved += 1
            continue

        try:
            answer = input("Move to quarantine? [Y/n] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if answer in ("n", "no"):
            print("  → Skipped")
            skipped += 1
        else:
            shutil.move(str(target), str(dest))
            print(f"  → Moved to ~/.local/share/chezmoi-orphans/{rel}")
            moved += 1

    print()
    print("=== Done ===")
    print(f"Moved to quarantine: {moved}")
    print(f"Skipped:             {skipped}")
    print(f"Quarantine location: {quarantine}")
    print()
    print("Files in quarantine can be restored by moving them back:")
    print(f"  mv {quarantine}/<path> ~/<path>")
    print()
    print("To purge the quarantine:")
    print(f"  rm -rf {quarantine}")


if __name__ == "__main__":
    main()
