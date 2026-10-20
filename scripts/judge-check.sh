#!/usr/bin/env bash
set -Eeuo pipefail

log_file="$(mktemp "${TMPDIR:-/tmp}/sheetsleuth-judge.XXXXXX.log")"

cleanup() {
  rm -f "$log_file"
}

trap cleanup EXIT

status=0

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker is unavailable: the docker command was not found.' >>"$log_file"
  status=127
else
  if (docker build -t x . && docker run --rm --network none x npm test) >>"$log_file" 2>&1; then
    :
  else
    status=$?
  fi
fi

if npm run check:project >>"$log_file" 2>&1; then
  :
else
  check_status=$?
  if (( status == 0 )); then
    status=$check_status
  fi
fi

if (( status == 0 )); then
  printf '%s\n' 'PASS'
else
  printf 'FAIL (exit status %d)\n' "$status"
fi

printf '%s\n' 'Last 20 lines of captured output:'
tail -n 20 "$log_file"

exit "$status"
