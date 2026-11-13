# Versions and Releases

How the package is numbered, what a version number promises, and how a
release is made. No release has been made yet; tags and releases are
created by the repository owner.

## Version numbers

The version is `PKG_VERSION`-r`PKG_RELEASE` in the `Makefile`, for example
`0.7.0-r1`. That is what `apk` shows on the router.

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

For the repository owner.

1. `main` holds the version to release, and its CI run is green.
2. The on-target and browser tests of
   [DEVELOPMENT.md](DEVELOPMENT.md#checks) pass on a test machine with the
   package of that CI run. CI does not run them.
3. Tag the commit, with the package version without the release number
   unless it is above 1:

   ```sh
   git tag -a v0.7.0 -m "luci-app-kea 0.7.0"
   git push origin v0.7.0
   ```

4. Create a GitHub release for the tag. Its text is the section of the
   changelog; its file is the package from the CI run of the tagged commit
   (see [Installing the package built by CI](../README.md#installation)).

Only the newest version is supported. There are no maintenance branches.
