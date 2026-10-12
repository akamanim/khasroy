#!/usr/bin/env bash
# Talks to the reel queue from GitHub Actions. Every call gets a fresh GitHub OIDC token, which the
# queue checks (this repository, main branch, reel-render workflow) — no stored secret is needed.
#   reels/runner.sh claim            → writes plan.json and prints the job id ("" when the queue is empty)
#   reels/runner.sh upload <id> <mp4>
#   reels/runner.sh finish <id> ok|failed [message]
set -euo pipefail
EDGE="https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-reels"

oidc() {
  curl -fsS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=khasroy-reels" | jq -r .value
}

call() {
  local token
  token="$(oidc)"
  echo "::add-mask::${token}" >&2
  curl -fsS -X POST "$EDGE" -H "Authorization: Bearer ${token}" -H "content-type: application/json" -d "$1"
}

case "${1:-}" in
  claim)
    res="$(call '{"action":"claim"}')"
    id="$(jq -r '.job.id // empty' <<<"$res")"
    if [ -n "$id" ]; then jq '.job.plan' <<<"$res" > plan.json; fi
    echo "$id"
    ;;
  upload)
    res="$(call "$(jq -nc --arg id "$2" '{action:"upload_url", id:$id}')")"
    url="$(jq -r .uploadUrl <<<"$res")"
    curl -fsS -X PUT "$url" -H "content-type: video/mp4" -H "x-upsert: true" --data-binary "@$3" > /dev/null
    ;;
  finish)
    ok=false; [ "$3" = "ok" ] && ok=true
    call "$(jq -nc --arg id "$2" --argjson ok "$ok" --arg error "${4:-}" '{action:"finish", id:$id, ok:$ok, error:$error}')" > /dev/null
    ;;
  *) echo "usage: runner.sh claim|upload|finish" >&2; exit 2 ;;
esac
