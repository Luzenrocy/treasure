# 1.0.0 reset: deletion inventory

Observed on 2026-11-19 (Asia/Shanghai). This file is a read-only snapshot for
approval before the destructive cleanup stage. It is not a command list.

## GitHub tags

| Repository | Tags to remove before creating the new 1.0.0 baseline |
| --- | --- |
| `treasure` | `v1.0.0`, `v2.0.0`, `v2.1.0`, `v2.1.1`, `v2.1.2`, `v2.2.0`, `v2.3.0` |
| `treasure-sdk` | `v1.0.3`, `v1.0.4`, `v1.0.5`, `v1.0.6`, `v1.0.7`, `v1.0.8`, `v2.0.0`, `v2.1.0`, `v2.1.1`, `v2.2.0`, `v2.3.0`, `v2.3.1`, `v3.0.0` |
| `treasure-plugins` | `plugin/excalidraw/v1.0.0`, `plugin/google-authenticator/v1.0.0`, `plugin/json-formatter/v1.0.0`, `plugin/kao-cheng-ce/v1.0.0`, `plugin/kao-cheng-ce/v2.0.0`, `plugin/kao-cheng-ce/v2.0.1`, `plugin/shi-yu-lu/v1.0.0`, `plugin/shi-yu-lu/v2.0.0`, `plugin/shi-yu-lu/v2.0.1`, `plugin/text-diff/v1.0.0`, `treasure-plugin-icons/v1.0.0`, `treasure-plugin-market/v1.0.0`, `treasure-plugin-market/v1.1.0`, `treasure-plugin-market/v1.1.1`, `treasure-plugin-market/v1.1.2`, `treasure-plugin-market/v1.1.3`, `treasure-plugin-market/v1.1.4`, `treasure-plugin-market/v1.1.5`, `treasure-plugin-market/v1.1.6`, `treasure-plugin-market/v1.2.0`, `treasure-plugin-market/v1.2.1`, `treasure-plugin-market/v1.3.0`, `treasure-plugin-market/v1.3.1`, `treasure-plugin-market/v1.3.2`, `treasure-plugin-market/v1.3.3`, `treasure-plugin-market/v1.3.4`, `treasure-plugin-market/v1.3.5` |

## GitHub Releases and assets

| Repository | Releases to remove | Assets to remove |
| --- | --- | --- |
| `treasure` | none | none |
| `treasure-sdk` | 10: `v1.0.6`, `v1.0.7`, `v1.0.8`, `v2.0.0`, `v2.1.0`, `v2.1.1`, `v2.2.0`, `v2.3.0`, `v2.3.1`, `v3.0.0` | none |
| `treasure-plugins` | 10: `plugin/excalidraw/v1.0.0`, `plugin/google-authenticator/v1.0.0`, `plugin/json-formatter/v1.0.0`, `plugin/kao-cheng-ce/v1.0.0`, `plugin/kao-cheng-ce/v2.0.0`, `plugin/kao-cheng-ce/v2.0.1`, `plugin/shi-yu-lu/v1.0.0`, `plugin/shi-yu-lu/v2.0.0`, `plugin/shi-yu-lu/v2.0.1`, `plugin/text-diff/v1.0.0` | 20 ZIP assets (one plugin ZIP and one source ZIP for each Release) |

Deleting a GitHub Release deletes its attached assets. The release IDs and exact
asset names are available from the read-only API output retained with this
review; no deletion has been issued.

## npmjs package to deprecate, not delete

`treasure-sdk` has 11 published npmjs versions: `1.0.2`, `1.0.6`, `1.0.7`,
`1.0.8`, `2.0.0`, `2.1.0`, `2.1.1`, `2.2.0`, `2.3.0`, `2.3.1`, `3.0.0`.

They remain published and will receive a deprecation notice in the dedicated
manual workflow. They are explicitly outside the destructive deletion scope.

## Gitee status: source mirrors are ready; historical tags require cleanup

The Gitee Pull mirrors now contain the same `main` commit and use `main` as the
default branch. They also contain the same historical tags as GitHub, while
having zero Releases and zero Release assets.

| Repository | Gitee tags to remove | Gitee Releases / assets to remove |
| --- | ---: | --- |
| `treasure` | 7 (the same seven tags listed in the GitHub section) | 0 / 0 |
| `treasure-sdk` | 13 (the same 13 tags listed in the GitHub section) | 0 / 0 |
| `treasure-plugins` | 27 (the same 27 tags listed in the GitHub section) | 0 / 0 |

Before tag deletion, pause automatic Gitee Pull mirroring for all three
repositories. Delete the historic tags from both GitHub and Gitee while the
mirrors are paused. Re-enable automatic mirroring only after confirming the
two tag inventories are empty; this prevents a mirror race from restoring an
old tag.

| Repository | GitHub `main` SHA | Current Gitee `main` SHA | Result |
| --- | --- | --- | --- |
| `treasure` | `c03e0ef92eeff51698943a7d02b4f2a341349dab` | `c03e0ef92eeff51698943a7d02b4f2a341349dab` | ready |
| `treasure-sdk` | `94bf600169f2a567c5a7f532f5efa473778051f5` | `94bf600169f2a567c5a7f532f5efa473778051f5` | ready |
| `treasure-plugins` | `13e7c7a991ecfad92abdf3c63bb9e39c5d54162c` | `13e7c7a991ecfad92abdf3c63bb9e39c5d54162c` | ready |

The release workflows will wait for new release commits to be mirrored before
they create a Gitee Release.

## GHCR: authenticated inventory

The Docker workflows identify these two GHCR image paths:

- `ghcr.io/luzenrocy/treasure-plugins/treasure-plugin-market`
- `ghcr.io/luzenrocy/treasure-plugins/treasure-plugin-icons`

The authenticated, paginated API inventory is retained locally in these files:

| Image | Version records to remove | Tagged / untagged | Audit snapshot |
| --- | ---: | ---: | --- |
| `treasure-plugin-market` | 105 | 35 / 70 | `release-inventory/ghcr-treasure-plugin-market-2026-11-19.json` |
| `treasure-plugin-icons` | 9 | 3 / 6 | `release-inventory/ghcr-treasure-plugin-icons-2026-11-19.json` |

The exact deletion scope is every `id` in those two JSON arrays (114 version
records total). The snapshot retains each record's digest, tags, creation time,
and update time. In particular, the market image currently has version
`1548432076` tagged `main` and `latest`, while the icons image has version
`1493468409` tagged `main` and `latest`; both are historic and in scope for
removal.

Immediately before deletion, rerun `scripts/list-ghcr-inventory.sh` from the
`treasure-plugins` repository and compare its IDs with these snapshots. Any
new or changed record must be separately reviewed; it is not implicitly in the
approved deletion set.

## Cleanup execution status

The historical GitHub tags and Releases have been deleted. A final read-only
check confirmed zero remote tags in all three GitHub repositories, and zero
tags and zero Releases in all three Gitee repositories after the Pull mirrors
were resumed and updated.

GHCR deletion removed, or found already absent, 112 of the 114 reviewed
version records. GitHub rejected these two public, untagged historical versions
because its backend reports more than 5,000 downloads; GitHub Support must
delete them:

| Image | Version ID | Digest |
| --- | ---: | --- |
| `treasure-plugin-market` | `1327982142` | `sha256:26261d93e6387e4accf6a793a9aafc36d9abc0284f0a8460905ceff893716d76` |
| `treasure-plugin-icons` | `1360713967` | `sha256:c7cbf8cdb246313707226a4eadad2c9d6d0529a6a418538af38e046df2304ada` |

By owner decision, the new 1.0.0 release may proceed before GitHub Support
confirms the two deletions. The two protected historical versions remain an
open post-release cleanup item and must be rechecked after the new release.
