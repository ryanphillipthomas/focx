#!/usr/bin/env bash
#
# Post a comment on the current Paperclip task, and optionally set its
# disposition, from inside an agent run.
#
# Why this file exists, and why it takes no credentials on its command line:
#
# Paperclip's built-in coordination skill tells agents to update issues with
# `curl` and `$PAPERCLIP_API_URL` / `$PAPERCLIP_API_KEY`, and it allow-lists
# `<worktree>/scripts/paperclip-issue-update.sh` in every run's
# `.claude/settings.local.json` — but ships no such script. Under the pilot's
# `approve-reads` policy that combination silently costs an agent its voice: a
# Bash command containing a variable expansion does not match a permission
# rule, so every documented curl call is denied and the run ends with its work
# done and its report undeliverable. The 2026-09-04 QA smoke test proved this
# precisely: in one run, under the same `Bash(curl:*)` rule, a curl to a
# literal URL completed while `curl -s "$PAPERCLIP_API_URL"` was refused.
#
# So the contract here is: every value that would need `$` at the call site is
# read from the environment inside this script instead. A caller writes
#
#     scripts/paperclip-issue-update.sh --status done <<'MD'
#     ## What I verified
#     ...
#     MD
#
# which contains no expansion and therefore matches a single narrow rule.
#
# Writes are verified, never inferred (Paperclip's rule): a successful PATCH
# echoes the updated issue, so an empty body or an unchanged status is a
# FAILED write even when curl exits 0.
#
# Usage:
#   scripts/paperclip-issue-update.sh [--status <status>] [--issue-id <uuid>]
#                                     [--comment-file <path>] < comment.md
#
#   --status        backlog | todo | in_progress | in_review | done | blocked | cancelled
#                   Omit to post a comment without changing the disposition.
#   --issue-id      Defaults to $PAPERCLIP_TASK_ID (the task that woke this run).
#                   Pass a literal id only; a variable here defeats the point.
#   --comment-file  Read the comment body from a file instead of stdin.
#
# Environment (read here, never passed as arguments):
#   PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_TASK_ID, PAPERCLIP_RUN_ID
#
# Exit: 0 write verified · 1 usage or environment error · 2 write FAILED.

set -euo pipefail

readonly VALID_STATUSES=(backlog todo in_progress in_review done blocked cancelled)
# Connection-level curl failures worth one retry: unresolved host, refused
# connection, timeout, and truncated transfers. An HTTP error response is a
# definite answer from the server and is never retried — a PATCH that may have
# applied must not be sent twice.
readonly RETRYABLE_CURL_CODES=(6 7 28 35 52 56)

die() { printf 'paperclip-issue-update: %s\n' "$1" >&2; exit "${2:-1}"; }

status=""
issue_id=""
comment_file=""

while [ $# -gt 0 ]; do
  case "$1" in
    --status)       [ $# -ge 2 ] || die "--status needs a value"; status="$2"; shift 2 ;;
    --issue-id)     [ $# -ge 2 ] || die "--issue-id needs a value"; issue_id="$2"; shift 2 ;;
    --comment-file) [ $# -ge 2 ] || die "--comment-file needs a value"; comment_file="$2"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
Usage: scripts/paperclip-issue-update.sh [--status <status>] [--issue-id <uuid>]
                                         [--comment-file <path>] < comment.md

  --status        backlog | todo | in_progress | in_review | done | blocked | cancelled
                  Omit to comment without changing the disposition.
  --issue-id      Defaults to $PAPERCLIP_TASK_ID. Pass a literal id only.
  --comment-file  Read the comment body from a file instead of stdin.

Credentials and the task id are read from the environment, never from the
command line, so the call site contains no variable expansion and matches a
single narrow permission rule.
USAGE
      exit 0 ;;
    *)              die "unknown argument: $1" ;;
  esac
done

if [ -n "$status" ]; then
  valid=""
  for s in "${VALID_STATUSES[@]}"; do [ "$s" = "$status" ] && valid=yes; done
  # Reject before contacting the API: a typo should not reach the control plane
  # and come back as an opaque 400 the agent then reports as a blocker.
  [ -n "$valid" ] || die "invalid status '$status' (expected one of: ${VALID_STATUSES[*]})"
fi

api_url="${PAPERCLIP_API_URL:-}"
api_key="${PAPERCLIP_API_KEY:-}"
run_id="${PAPERCLIP_RUN_ID:-}"
[ -n "$issue_id" ] || issue_id="${PAPERCLIP_TASK_ID:-}"

[ -n "$api_url" ] || die "PAPERCLIP_API_URL is not set; this must run inside a Paperclip run"
[ -n "$api_key" ] || die "PAPERCLIP_API_KEY is not set; this must run inside a Paperclip run"
[ -n "$issue_id" ] || die "no issue id: pass --issue-id, or run against a task so PAPERCLIP_TASK_ID is set"

command -v curl >/dev/null 2>&1 || die "curl not found on PATH"
command -v jq   >/dev/null 2>&1 || die "jq not found on PATH"

# Read the comment body. A heredoc on stdin is the documented path, and going
# through jq --arg is what keeps blank lines and list markers intact instead of
# collapsing the report into one smooshed line.
comment=""
if [ -n "$comment_file" ]; then
  [ -f "$comment_file" ] || die "comment file not found: $comment_file"
  comment="$(cat "$comment_file")"
elif [ ! -t 0 ]; then
  comment="$(cat)"
fi

[ -n "$comment" ] || [ -n "$status" ] || die "nothing to do: provide a comment on stdin, a --comment-file, or a --status"

payload="$(jq -nc \
  --arg status "$status" \
  --arg comment "$comment" \
  '{} + (if $status == "" then {} else {status: $status} end)
      + (if $comment == "" then {} else {comment: $comment} end)')"

# The base may or may not already end in /api; normalize without assuming.
base="${api_url%/}"
base="${base%/api}"
endpoint="$base/api/issues/$issue_id"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

send() {
  # Headers go in through --config on stdin so the bearer token never appears
  # in this host's process list, where any other agent could read it.
  {
    printf 'header = "Authorization: Bearer %s"\n' "$api_key"
    printf 'header = "Content-Type: application/json"\n'
    [ -n "$run_id" ] && printf 'header = "X-Paperclip-Run-Id: %s"\n' "$run_id"
  } | curl --config - \
        --silent --show-error \
        --request PATCH \
        --max-time 30 \
        --data "$payload" \
        --output "$body_file" \
        --write-out '%{http_code}' \
        "$endpoint"
}

http_code=""
curl_status=0
for attempt in 1 2; do
  set +e
  http_code="$(send 2>/dev/null)"
  curl_status=$?
  set -e
  [ "$curl_status" -eq 0 ] && break
  retryable=""
  for c in "${RETRYABLE_CURL_CODES[@]}"; do [ "$c" -eq "$curl_status" ] && retryable=yes; done
  # Bounded write retry: one repeat of a connection-level failure, then stop.
  # Two consecutive failures of the same write end it for this run.
  if [ -z "$retryable" ] || [ "$attempt" -eq 2 ]; then
    die "FAILED: could not reach the control plane (curl exit $curl_status) after $attempt attempt(s); the update was NOT applied" 2
  fi
done

case "$http_code" in
  2*) ;;
  *) die "FAILED: PATCH $endpoint returned HTTP $http_code; the update was NOT applied" 2 ;;
esac

# Verify, never infer. A real update echoes the issue; an empty body with a 200
# is the documented way this write fails while looking like success.
[ -s "$body_file" ] || die "FAILED: HTTP $http_code with an empty body; treat the update as NOT applied" 2
jq -e . "$body_file" >/dev/null 2>&1 || die "FAILED: HTTP $http_code with an unparseable body; treat the update as NOT applied" 2

returned_id="$(jq -r '.id // empty' "$body_file")"
[ "$returned_id" = "$issue_id" ] || die "FAILED: response describes issue '${returned_id:-<none>}', not '$issue_id'" 2

if [ -n "$status" ]; then
  returned_status="$(jq -r '.status // empty' "$body_file")"
  [ "$returned_status" = "$status" ] \
    || die "FAILED: asked for status '$status' but the issue is '${returned_status:-<none>}'" 2
fi

identifier="$(jq -r '.identifier // .id' "$body_file")"
if [ -n "$status" ]; then
  printf 'paperclip-issue-update: %s updated — status %s, comment %s\n' \
    "$identifier" "$status" "$([ -n "$comment" ] && echo attached || echo none)"
else
  printf 'paperclip-issue-update: %s commented (status unchanged)\n' "$identifier"
fi
