#!/usr/bin/env bash
set -euo pipefail

if [[ -n ${REQUESTED_TAG:-} ]]; then
  jq -cn --arg tag "$REQUESTED_TAG" '[$tag]' | sed 's/^/tags=/' >> "$GITHUB_OUTPUT"
  exit 0
fi
if [[ ${REPLACE_MISMATCHED:-false} == true ]]; then
  echo "Select a specific release tag to replace mismatched attachments." >&2
  exit 1
fi

: "${GITEE_TOKEN:?Set the GITEE_TOKEN repository secret before releasing.}"
api="https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}"

gitee_get() {
  curl --fail --silent --proto '=https' --proto-redir '=https' \
    --connect-timeout 8 --max-time 25 "$@"
}

mirror_is_complete() {
  local release=$1 tag=$2 tag_uri release_id attachments actual_assets expected_assets
  local checksum_id expected_digest actual_digest

  tag_uri=$(jq -rn --arg tag "$tag" '$tag | @uri')
  release_id=$(gitee_get "$api/releases/tags/$tag_uri?access_token=$GITEE_TOKEN" |
    jq -er --arg tag "$tag" 'select(.tag_name == $tag) | .id | numbers') || return 1
  attachments=$(gitee_get "$api/releases/$release_id/attach_files?per_page=100&access_token=$GITEE_TOKEN") ||
    return 1

  actual_assets=$(jq -ec 'map({name,size}) | sort_by(.name)' <<<"$attachments") || return 1
  expected_assets=$(jq -ec '.assets | map({name,size}) | sort_by(.name)' <<<"$release") || return 1
  [[ $actual_assets == "$expected_assets" ]] || return 1

  checksum_id=$(jq -er '.[] | select(.name == "SHA256SUMS.txt") | .id | numbers' <<<"$attachments") ||
    return 1
  expected_digest=$(jq -r '.assets[] | select(.name == "SHA256SUMS.txt") | .digest // ""' <<<"$release")
  if [[ ! $expected_digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
    expected_digest=$(gh release download "$tag" --repo "$GITHUB_REPOSITORY" \
      --pattern SHA256SUMS.txt --output - | sha256sum | cut -d ' ' -f 1) || return 1
    expected_digest="sha256:$expected_digest"
  fi
  # The mirror writes the manifest after all installers have passed SHA-256.
  actual_digest=$(gitee_get --location \
    "$api/releases/$release_id/attach_files/$checksum_id/download?access_token=$GITEE_TOKEN" |
    sha256sum | cut -d ' ' -f 1) || return 1
  [[ "sha256:$actual_digest" == "$expected_digest" ]]
}

# Drafts and historical releases without a build manifest are outside the
# automatic mirror. Keep older pending releases in the queue across newer tags.
releases=$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/releases?per_page=100" |
  jq -ce '[.[][] | select(.draft == false and (.tag_name | startswith("v"))) |
    select(any(.assets[]; .name == "SHA256SUMS.txt"))] | sort_by(.published_at)')
pending=()
while IFS= read -r release; do
  tag=$(jq -r '.tag_name' <<<"$release")
  if mirror_is_complete "$release" "$tag"; then
    echo "Gitee already has the verified release: $tag"
  else
    pending+=("$tag")
  fi
  if [[ ${#pending[@]} -eq 256 ]]; then
    echo "Reached the Actions matrix limit. The next scheduled run will check again."
    break
  fi
done < <(jq -c '.[]' <<<"$releases")
tags=$(jq -cn '$ARGS.positional' --args "${pending[@]}")
echo "tags=$tags" >> "$GITHUB_OUTPUT"
