#!/usr/bin/env bash
set -euo pipefail

: "${GITEE_TOKEN:?Set the GITEE_TOKEN repository secret before releasing.}"
asset_dir=$1
repo_url="https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}"
api="https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}"
release_tag_uri=$(jq -rn --arg tag "$RELEASE_TAG" '$tag | @uri')
release_lookup="${api}/releases/tags/${release_tag_uri}?access_token=${GITEE_TOKEN}"
response=$(mktemp)
trap 'rm -f "$response"' EXIT
curl_options=(--silent --show-error --connect-timeout 15 --proto '=https')

read_api() {
  curl "${curl_options[@]}" --max-time 25 --retry 2 --retry-max-time 50 "$@"
}

resolve_tag() {
  local ref="refs/tags/$RELEASE_TAG"
  awk -v ref="$ref" '$2 == ref { tag=$1 } $2 == ref "^{}" { commit=$1 }
    END { print (commit ? commit : tag) }'
}

for attempt in {1..45}; do
  refs=$(timeout 15 git ls-remote "${repo_url}.git" \
    "refs/tags/${RELEASE_TAG}" "refs/tags/${RELEASE_TAG}^{}") || refs=
  if [[ $(resolve_tag <<<"$refs") == "$RELEASE_SHA" ]]; then
    break
  fi
  if [[ $attempt == 45 ]]; then
    echo "Gitee tag $RELEASE_TAG has not reached $RELEASE_SHA." >&2
    exit 1
  fi
  sleep 10
done

lookup_status=$(read_api --output "$response" --write-out '%{http_code}' "$release_lookup")
if [[ $lookup_status == 404 ]] ||
   { [[ $lookup_status == 200 ]] && jq -e 'type == "null"' "$response" >/dev/null; }; then
  # The lookup after creation also handles a response lost after the POST.
  curl "${curl_options[@]}" --max-time 45 --fail --output "$response" \
    --data-urlencode "access_token=${GITEE_TOKEN}" \
    --data-urlencode "tag_name=${RELEASE_TAG}" \
    --data-urlencode "name=Treasure ${RELEASE_TAG}" \
    --data-urlencode "body=Mirrored from https://github.com/${GITHUB_REPOSITORY}/releases/tag/${RELEASE_TAG}" \
    --data-urlencode "target_commitish=${RELEASE_SHA}" "${api}/releases" || true
  lookup_status=$(read_api --output "$response" --write-out '%{http_code}' "$release_lookup")
fi
if [[ $lookup_status != 200 ]]; then
  echo "Gitee release lookup failed (HTTP ${lookup_status})." >&2
  exit 1
fi
release_id=$(jq -er --arg tag "$RELEASE_TAG" 'select(.tag_name == $tag) | .id | numbers' "$response")
attachment_api="${api}/releases/${release_id}/attach_files"

list_attachments() {
  read_api --fail "${attachment_api}?per_page=100&access_token=${GITEE_TOKEN}" |
    jq -ec 'if type == "array" and length < 100 then .
      else error("Could not enumerate all Gitee attachments") end'
}

attachment_id() {
  jq -er --arg name "$1" '
    map(select(.name == $name)) |
    if length > 1 then error("Duplicate Gitee attachment: " + $name)
    elif length == 1 then .[0].id | numbers
    else "" end' <<<"$attachments"
}

remote_digest() {
  curl "${curl_options[@]}" --max-time 900 --speed-limit 1024 --speed-time 180 \
    --fail --location --proto-redir '=https' \
    "${attachment_api}/$1/download?access_token=${GITEE_TOKEN}" |
    sha256sum | cut -d ' ' -f 1
}

upload_asset() {
  local asset=$1 expected_digest=$2 name=${1##*/}
  local attempt result curl_status status uploaded seconds id digest
  for attempt in {1..2}; do
    echo "Uploading to Gitee: ${name} (attempt ${attempt}/2)"
    curl_status=0
    # The hosted runner previously needed over 3 minutes just to send 4 MB.
    # Let slow transfers finish and abort connections that stop making progress.
    result=$(curl "${curl_options[@]}" --http1.1 --header 'Expect:' \
      --max-time 9000 --speed-limit 1024 --speed-time 180 \
      --output "$response" --write-out '%{http_code} %{size_upload} %{time_total}' \
      --form-string "access_token=${GITEE_TOKEN}" --form "file=@${asset}" "$attachment_api") ||
      curl_status=$?
    read -r status uploaded seconds <<<"$result"
    echo "Gitee upload result for ${name}: curl=${curl_status}, HTTP=${status}, sent=${uploaded} bytes, seconds=${seconds}"

    # A timed-out POST may still have stored the file. Check before sending it again.
    attachments=$(list_attachments) || return 1
    id=$(attachment_id "$name") || return 1
    if [[ -n $id ]]; then
      digest=$(remote_digest "$id") || return 1
      if [[ $digest == "$expected_digest" ]]; then
        echo "Verified Gitee attachment: ${name}"
        return 0
      fi
      echo "Gitee returned a different SHA-256 after uploading ${name} (attachment ${id})." >&2
      return 1
    fi
    if [[ $status == 2?? ]]; then
      echo "Gitee accepted ${name} but has not listed it yet. Let the next sync verify it." >&2
      return 1
    fi
    if [[ $status == 4?? && $status != 408 && $status != 429 ]]; then
      return 1
    fi
    if [[ $attempt == 1 ]]; then
      sleep 10
    fi
  done
  echo "Gitee upload failed after 2 attempts: ${name}" >&2
  return 1
}

assets=()
for asset in "$asset_dir"/*; do
  if [[ -f $asset && ${asset##*/} != SHA256SUMS.txt ]]; then
    assets+=("$asset")
  fi
done
# Publish the checksums after the installers.
assets+=("$asset_dir/SHA256SUMS.txt")
attachments=$(list_attachments)
missing_files=()
missing_digests=()
stale_files=()
stale_digests=()
stale_ids=()
for asset in "${assets[@]}"; do
  name=${asset##*/}
  digest=$(sha256sum "$asset" | cut -d ' ' -f 1)
  id=$(attachment_id "$name")
  if [[ -z $id ]]; then
    missing_files+=("$asset")
    missing_digests+=("$digest")
    continue
  fi
  # Require a successful download before declaring an attachment stale.
  existing_digest=$(remote_digest "$id")
  if [[ $existing_digest == "$digest" ]]; then
    echo "Gitee attachment matches SHA-256: ${name}"
    continue
  fi
  echo "Gitee attachment differs from this build: ${name} (attachment ${id})" >&2
  stale_files+=("$asset")
  stale_digests+=("$digest")
  stale_ids+=("$id")
done

if [[ ${#stale_files[@]} -gt 0 && ${REPLACE_MISMATCHED:-false} != true ]]; then
  echo "Resolve the conflicting Gitee attachments before publishing." >&2
  exit 1
fi

for index in "${!missing_files[@]}"; do
  if [[ ${missing_files[index]##*/} != SHA256SUMS.txt ]]; then
    upload_asset "${missing_files[index]}" "${missing_digests[index]}"
  fi
done
for index in "${!stale_files[@]}"; do
  name=${stale_files[index]##*/}
  attachments=$(list_attachments)
  if [[ $(attachment_id "$name") != "${stale_ids[index]}" ]]; then
    echo "Gitee attachment changed since verification: ${name}" >&2
    exit 1
  fi
  echo "Replacing stale Gitee attachment: ${name}"
  curl "${curl_options[@]}" --fail --max-time 45 --request DELETE --output /dev/null \
    "${attachment_api}/${stale_ids[index]}?access_token=${GITEE_TOKEN}"
  upload_asset "${stale_files[index]}" "${stale_digests[index]}"
done
for index in "${!missing_files[@]}"; do
  if [[ ${missing_files[index]##*/} == SHA256SUMS.txt ]]; then
    upload_asset "${missing_files[index]}" "${missing_digests[index]}"
  fi
done
