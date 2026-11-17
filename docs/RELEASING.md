# Versions and Releases

How the package is numbered, what a version number promises, and how a
release is made. The first release was `v0.7.0` on 2026-11-17, made by
hand. A release is made on the word of the repository owner: a workflow
prepares it from a tag as a draft, and the owner publishes it.

## Version numbers

The version is `PKG_VERSION`-r`PKG_RELEASE` in `luci-app-kea/Makefile`, for
example `0.7.0-r1`. That is what `apk` shows on the router.

| Change | What is raised |
|--------|----------------|
| New feature, or an existing one behaves differently | Second number of `PKG_VERSION` (`0.7.0` to `0.8.0`), third back to 0 |
| Fix that changes nothing else | Third number of `PKG_VERSION` (`0.7.0` to `0.7.1`) |
| Packaging only: metadata, dependencies, installed files | `PKG_RELEASE` (`r1` to `r2`) |

`PKG_RELEASE` goes back to 1 whenever `PKG_VERSION` changes.

The first number stays 0 while the package is alpha. It becomes 1 when the
owner decides the application can be trusted with the DHCP service of a
production router; the open points until then are in
[STATUS.md](STATUS.md) and [ROADMAP.md](ROADMAP.md).

## What stays stable

Within the 0.x versions:

- **Page addresses** (`admin/services/kea/overview` and so on) do not
  change.
- **Kea configuration files** are never converted behind the user's back.
  A new version reads the files the old one wrote.
- **Data the application keeps inside Kea files**, the disabled
  reservations under `user-context` / `luci-app-kea`, keeps its form. A
  change of that form needs code that reads the old one, and a note in the
  changelog.

Not promised within 0.x: the methods and replies of the `luci.kea` ubus
object. They serve the pages of the same version and change with them.

## With every version change

- Add the version to [CHANGELOG.md](../CHANGELOG.md): what a user of the
  package notices, not how it was done. Anything a user has to do when
  upgrading goes under "Upgrade notes".
- Update the places that name the version: the status line of `README.md`,
  the first line of `docs/STATUS.md`, the two version lines of
  `docs/PACKAGING.md`, and the first line of `docs/SCREENSHOTS.md` when the
  pictures were taken again.
- Add an entry to `docs/HISTORY.md` and tick the roadmap.

## Making a release

For the repository owner. Pushing the tag is the only step done by hand
before the release exists as a draft; publishing the draft is the decision.

1. `main` holds the version to release, and its CI run is green. That run
   includes the tests on OpenWrt in QEMU. `tools/release-notes.sh --tag`
   prints the tag of the version; `tools/release-notes.sh <tag>` prints the
   text the release will get.
2. Tag the commit, with the package version without the release number
   unless it is above 1 (`v0.8.0` for `0.8.0-r1`, `v0.8.0-r2` for
   `0.8.0-r2`):

   ```sh
   git tag -a v0.8.0 -m "luci-app-kea 0.8.0"
   git push origin v0.8.0
   ```

3. The tag starts `.github/workflows/release.yml`. It stops at once when the
   tag does not fit the version in the Makefile, when the changelog has no
   section for the version, or when the tagged commit is not on `main`.
   Otherwise it builds the package from the tagged commit, runs every CI
   job on it, including the tests on OpenWrt in QEMU, and creates a
   **draft** release: the package file, its checksum, the section of the
   changelog as text, and what the file was tested on. A 0.x version is
   marked as a pre-release.
4. Read the draft on the
   [Releases page](https://github.com/woffko/luci-app-kea/releases), where
   only people with write access see it. Test the attached file on a real
   router if the changes call for it; CI tests it on a virtual machine only.
   Then publish the draft, or delete it and the tag.
5. Note the release in the changelog, and update the documents that say
   which release is the newest.

GitHub's `/releases/latest` address skips pre-releases, so link to the list
of releases instead.

When the workflow fails after the checks, for example because a download
from `downloads.openwrt.org` failed, run its failed jobs again from the
Actions page; the tag stays. The same release can also be made by hand from
the CI run of the tagged commit, as `v0.7.0` was:

```sh
gh run download <run id> --name luci-app-kea --dir .
tools/release-notes.sh v0.8.0 luci-app-kea-0.8.0-r1.apk > notes.md
gh release create v0.8.0 luci-app-kea-0.8.0-r1.apk --verify-tag --draft \
    --prerelease --title "luci-app-kea 0.8.0" --notes-file notes.md
```

Only the newest version is supported. There are no maintenance branches.
