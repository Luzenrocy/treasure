# Release operations

Treasure has one source of truth: the GitHub repositories.  Their Gitee
counterparts are one-way mirrors and contain byte-identical Release assets.

## Required repository configuration

### Gitee source mirrors

For each of `treasure`, `treasure-sdk`, and `treasure-plugins`, configure the
existing empty Gitee repository as a **Pull** mirror whose source is its GitHub
repository. Enable automatic GitHub-to-Gitee updates. Gitee's mirror feature
copies commits, branches, and tags, but not GitHub Release assets; the release
workflow copies those assets separately.

Do this in Gitee's repository settings rather than in GitHub Actions. The
GitHub credential entered into Gitee is a dedicated classic PAT with `repo`;
add `admin:repo_hook` when enabling automatic updates. This is intentionally a
different credential from `GITEE_TOKEN`: a Gitee API token is for the Release
API and must not be used as a Git source-control credential.

Before any release tag is pushed, verify that Gitee's `main` points at the same
commit as GitHub's `main`. The release workflows also wait up to 15 minutes for
the release commit to appear in Gitee, then fail without creating a partial
Gitee Release.

### GitHub repository secrets and variables

Set the following values in GitHub repository settings. Never put a token in a
workflow file, `.npmrc`, git remote URL, or commit.

| Repository | Secret / variable | Purpose |
| --- | --- | --- |
| all three | `GITEE_TOKEN` secret | Gitee personal access token that can create Releases and upload their attachments in its matching repository. |
| all three | `GITEE_OWNER` variable | Optional; omit because the repositories are all owned by `Luzenrocy`. |
| all three | `GITEE_REPO` variable | Optional; omit because the Gitee and GitHub repository names match. |
| `treasure-sdk` | `GH_PACKAGES_TOKEN` secret | A classic GitHub PAT with package administration and `write:packages`; used only to make the first `@luzenrocy/treasure-sdk` package public. |
| `treasure-sdk` | `NPM_TOKEN` Environment secret in `npm` | An npm token authorized to deprecate the legacy unscoped `treasure-sdk` versions in the later npmjs-stop workflow. |
| phase 5 operator credential | `GHCR_CLEANUP_TOKEN` | A separate classic GitHub PAT with `read:packages` and `delete:packages`, used only while deleting historical GHCR package versions. Do not add it to the release workflows. |

Docker images remain in GHCR. They are released only from version tags and
receive only their semantic-version tag; `latest`, branch, and commit-SHA tags
are intentionally not published.

### Stage-3 preflight checklist

1. Configure the three Gitee Pull mirrors and wait for their initial `main`
   import to complete.
2. Store the listed GitHub secrets; use a separate Gitee API token for each
   repository if least-privilege permissions make that practical.
3. Confirm the SDK package owner will be `luzenrocy`, and leave the package
   visibility workflow enabled. GitHub Packages creates personal packages as
   private first; the workflow changes this one package to public.
4. Do not create a tag, GitHub Release, Gitee Release, package, image, or npm
   deprecation as part of this stage.

## 1.0.0 reset runbook

The reset is deliberately a manual, reviewed operation.  It deletes public
artifacts and invalidates existing download URLs.

1. Commit the intended source snapshots in all three repositories and verify
   their trees are clean.
2. Export and retain a release/tag/image inventory for GitHub, Gitee, and GHCR.
3. Pause the three automatic Gitee Pull mirrors. Delete GitHub/Gitee Releases
   and assets, then delete all remote release tags in both platforms. Confirm
   both tag inventories are empty before re-enabling the mirrors. Finally
   remove historic GHCR image versions.
4. Publish `@luzenrocy/treasure-sdk@1.0.0` to GitHub Packages, mark it public,
   and regenerate every plugin lockfile using authenticated npm before tagging
   the plugin releases.
5. Keep the npmjs `treasure-sdk` package as history only: deprecate every
   published version.  Never unpublish and reuse an npm version.
6. Push the new `v1.0.0`, `plugin/*/v1.0.0`, and image tags only after the new
   workflows and all three Gitee mirrors are configured.
7. Verify checksums, a clean SDK installation from GitHub Packages, plugin
   installation from Gitee, and `docker pull` by digest from GHCR.

Existing clones can retain deleted tags locally; a tag reset does not rewrite
their object databases.  Existing installations must be treated as unsupported
and upgraded through a fresh 1.0.0 download.
