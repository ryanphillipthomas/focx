#!/usr/bin/env bash
#
# Push QA evidence from the current Paperclip issue worktree.
# A command-prefix permission cannot constrain trailing arguments: a caller
# could append another refspec to a permitted git push. The grant is therefore
# the exact command Bash(scripts/qa-push.sh), with no argument pattern. This
# script makes that grant meaningful by accepting no arguments and choosing
# exactly one branch itself. As with paperclip-issue-update.sh, values are read
# from the environment here so the call site needs no variable expansion.
# validateContext() already bound the branch to the live company's issuePrefix
# at session start; this offline guard checks its shape and current HEAD.

set -euo pipefail

die() { printf 'qa-push: %s\n' "$1" >&2; exit 1; }

[ "$#" -eq 0 ] || die "arguments are not allowed"
BRANCH="${PAPERCLIP_WORKSPACE_BRANCH:-}"
[ -n "$BRANCH" ] || die "PAPERCLIP_WORKSPACE_BRANCH is unset or empty"
[[ "$BRANCH" =~ ^[A-Z][A-Z0-9]*-[0-9]+- ]] || die "branch must have an uppercase issue prefix and issue number"
# Validate the entire value too: the prefix check alone permits shell syntax,
# whitespace, or a colon that Git would interpret as a destination refspec.
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "branch contains forbidden characters"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || die "could not resolve the current branch"
[ "$BRANCH" = "$CURRENT_BRANCH" ] || die "workspace branch does not match the current branch"
WORKSPACE="$(pwd -P)" || die "could not resolve the working directory"
[[ "$WORKSPACE" == */.paperclip/worktrees/* ]] || die "working directory must be inside .paperclip/worktrees/"

# Git errors can include credential-bearing remote URLs. Keep output fixed.
git push origin "$BRANCH" >/dev/null 2>&1 || die "git push failed"
