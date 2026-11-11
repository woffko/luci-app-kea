# OpenWrt / LuCI Packaging Conformance

Audit date: 2026-11-11. Audited revision: `b6eedcf` (package version
`0.1.0-r1`). The findings marked "fixed" below were resolved in `0.1.0-r2`
(roadmap milestone M0) and re-checked with a real build and install. The
current version is `0.2.0-r1`.

## References

The audit was made against these sources, taken from an OpenWrt 25.12.6 build
tree (LuCI feed commit `e969939b`, packages feed commit `1a304c1`):

- `feeds/luci/luci.mk` - the build glue every LuCI package includes;
- `feeds/luci/CONTRIBUTING.md`;
- `feeds/luci/applications/luci-app-example` (`Makefile`, `structure.md`,
  `BUILDING.md`) - the reference layout for a JavaScript LuCI application;
- `feeds/packages/CONTRIBUTING.md` - the feed-level summary of the OpenWrt
  package guide;
- `feeds/packages/net/kea` - the package this application manages;
- `scripts/package-metadata.pl` - how dependencies become menuconfig rules.

The OpenWrt wiki pages
[Creating packages](https://openwrt.org/docs/guide-developer/packages) and
[Submitting patches](https://openwrt.org/submitting-patches) could not be
fetched from the audit environment. Wiki rules are covered here only as far as
the feed documents above restate them. Re-check against the wiki before an
upstream submission.

## Method

- Static review of every file in the repository.
- Package metadata dumped through the real build includes, without building:

  ```sh
  make -r DUMP=1 TOPDIR=/path/to/openwrt INCLUDE_DIR=/path/to/openwrt/include \
      -C /path/to/luci-app-kea
  ```

- `node --check` on all view files, `sh -n` on the shell scripts, `jq` on the
  menu and ACL JSON.

Verification of `0.1.0-r2`:

- built with the official OpenWrt 25.12.6 x86-64 SDK;
- installed with `apk` on an OpenWrt 25.12.6 x86-64 virtual machine with
  Kea 3.0.4 from the official package repository;
- all six pages opened in a headless browser without JavaScript errors
  (`test/browser/smoke.js`);
- `test/run-import-fixture.sh` passed on that machine.

Still not done: a lint run with the LuCI ESLint configuration.

## Metadata as the build system sees it

```text
Package: luci-app-kea
Submenu: 3. Applications
Version: 0.2.0-r1
Depends: +libc +luci-base +kea-uci
Section: luci
Category: LuCI
Title: LuCI support for ISC Kea DHCP server
Maintainer: Woffko
License: Apache-2.0
LicenseFiles: LICENSE
URL: https://github.com/woffko/luci-app-kea
Description: Web interface for the ISC Kea DHCPv4 and DHCPv6 servers: service
 control, structured and raw configuration editors, and dnsmasq static lease
 import.
```

At `b6eedcf` the same dump showed `Maintainer: OpenWrt LuCI community`,
`URL: https://github.com/openwrt/luci` and a description equal to the title.

## Checklist

Audit status: **OK** conforms, **GAP** works but should be fixed, **FAIL** does
not conform.

| # | Area | Audit | Finding at `b6eedcf` | Now |
|---|------|-------|----------------------|-----|
| 1 | Makefile skeleton | OK | `rules.mk` first, `LUCI_*` variables, `luci.mk` included last, `BuildPackage` signature comment present. | - |
| 2 | Package name | OK | `luci-app-kea`, matches the directory name that `luci.mk` derives `LUCI_NAME` from. Keep the checkout directory named `luci-app-kea`. | - |
| 3 | Version and release | OK | Explicit `PKG_VERSION` and `PKG_RELEASE`. Valid out of tree. | - |
| 4 | Maintainer | FAIL | `luci.mk` ignores `PKG_MAINTAINER`; the package named the LuCI community as maintainer. | Fixed: `LUCI_MAINTAINER` set. No e-mail address, by owner decision. |
| 5 | Project URL | FAIL | `LUCI_URL` unset; the package pointed at `openwrt/luci`. | Fixed |
| 6 | License | GAP | Valid SPDX tag, but `PKG_LICENSE_FILES` unset and `LICENSE` held only the short notice. | Fixed: full Apache-2.0 text |
| 7 | Description | GAP | No `LUCI_DESCRIPTION`. | Fixed |
| 8 | Dependencies | GAP | `+rpcd +rpcd-mod-file` redundant and unused. | Fixed: `+luci-base +kea-uci` |
| 9 | File layout | OK | Views, menu, ACL and rpcd plugin in the standard locations; plugin mode 0755 preserved. | - |
| 10 | ucode location | GAP | `root/usr/share/luci/kea/importer.uc` is a private path. LuCI convention is `ucode/` (installed to `/usr/share/ucode/luci/`) or `root/usr/share/rpcd/ucode/`. | Open, with the backend rework (M2) |
| 11 | Unused files | FAIL | 10 of the 16 installed view files were unused copies. | Fixed: six views with stable names |
| 12 | Menu | GAP | Parent node repeated the Overview view. | Fixed: `firstchild` |
| 13 | ACL | GAP | Unused `file`, `uci` and `service` grants, including write access to `/etc/kea`. | Fixed: only `luci.kea` methods |
| 14 | Post-install | OK | The `luci.mk` default clears the LuCI caches and reloads `rpcd`. | - |
| 15 | Configuration files | GAP | No `conffiles`. | Fixed: `/etc/kea/luci-reservations.json` |
| 16 | Translations | GAP | No translation template. | Partly fixed: `po/templates/kea.pot` exists; backend messages are still untranslatable English text |
| 17 | JavaScript conventions | GAP | Hand-made tabs and inputs instead of `form.JSONMap` / `ui.tabs`, `window.confirm()` instead of `ui.showModal()`, no LuCI validation helpers. | Partly fixed in `0.2.0`: shared code moved to modules under `resources/kea/`, new dialogs use `ui.showModal()`. The import page still uses `window.confirm()`. Widgets and validation open (M4) |
| 18 | Tests and CI | GAP | One fixture test, which did not pass on OpenWrt. No CI. | Partly fixed: fixture test corrected; unit, backend and browser tests added. CI open (M2) |
| 19 | Repository hygiene | GAP | Unrelated helper script, no tags or releases, no repository topics. | Helper script removed. Releases open (M7) |

## Details

### Maintainer and URL (items 4, 5)

`luci.mk` defines the package with `MAINTAINER:=$(LUCI_MAINTAINER)` and
`URL:=$(LUCI_URL)`, defaulting to the LuCI community and the LuCI repository.
`PKG_MAINTAINER` alone does not change the built package. An out-of-tree
package has to set `LUCI_MAINTAINER` and `LUCI_URL` before including `luci.mk`.

The packages feed rule for the maintainer format is
`PKG_MAINTAINER:=Joe D. Hacker <jdh@jdhs-email-provider.org>`.

Owner decision, 2026-11-11: the maintainer stays `Woffko` without an e-mail
address for now. A real name and address become necessary at an upstream
submission.

### Dependencies (item 8)

`luci-base` depends on `rpcd`, `rpcd-mod-file`, `rpcd-mod-luci`,
`rpcd-mod-ucode`, `ucode`, `ucode-mod-fs`, `ucode-mod-uci`, `ucode-mod-ubus`
and others, so `importer.uc` (which needs only `ucode` and `fs`) is covered.

The shell backend also calls `jshn`, `uci` and `/lib/functions.sh` (base
system), `pgrep` and `hexdump` (enabled in the default BusyBox configuration,
but not guaranteed on custom builds) and `openssl` (optional).

`kea-uci` depends on
`@(PACKAGE_kea-ctrl||PACKAGE_kea-dhcp4||PACKAGE_kea-dhcp6||PACKAGE_kea-dhcp-ddns)`.
The metadata generator copies the dependencies of a selected package to the
selecting one, so `luci-app-kea` appears in menuconfig only after at least one
Kea daemon package is selected.

### View files (item 11)

Until `0.1.0-r1` the view directory held sixteen files, of which the menu used
six. The other ten were created while renaming modules to defeat browser
caching during development: 72% of the shipped JavaScript was never loaded.

The renames are not needed. LuCI loads every resource with
`?v=<luci-base version>-<mtime of /lib/apk/db/installed>` (see `luci-base`
`ucode/runtime.uc` and `ucode/template/header.ut`), so any package install or
upgrade changes the URL of every view. Only files copied by hand keep their
old URL; [DEVELOPMENT.md](DEVELOPMENT.md#browser-caching) describes how to
handle that.

The views are now `overview`, `services`, `dhcp4`, `dhcp6`, `configuration`
and `import-dnsmasq`. View names are part of the URL and must stay stable.

### ACL (item 13)

The views talk only to the `luci.kea` ubus object, and the ACL now grants
nothing else.

`getConfig` is a read-level method and returns complete Kea configuration
files, which can hold secrets (TSIG keys in `kea-dhcp-ddns.conf`, control
agent credentials). It stays in the read group: LuCI read access already
exposes comparable secrets stored in UCI, and the DHCP pages need the method
to display anything. Revisit if reviewers of an upstream submission object.

### Translations (item 16)

`po/templates/kea.pot` is generated with the LuCI string scanner:

```sh
tools/update-pot.sh /path/to/luci-checkout
```

Regenerate it whenever a user-visible string changes. Messages produced by
the shell backend (error texts, import warnings) are not covered.

## Additional requirements for an upstream submission

The project is a standalone repository for now and aims at a later submission
to `openwrt/luci` (see the decisions in [ROADMAP.md](ROADMAP.md#decisions)).
These apply at that point:

- place it in `applications/luci-app-kea` and use `include ../../luci.mk`;
- drop `PKG_NAME`, `PKG_VERSION` and `PKG_RELEASE` unless there is a reason to
  keep them (93 of the 107 in-tree applications let `luci.mk` derive the
  version from git);
- commit subjects prefixed with the component, for example
  `luci-app-kea: add DHCPv6 reservation import`;
- every commit carries a `Signed-off-by` line; author and sign-off must be a
  real name and a real e-mail address (GitHub private addresses are rejected
  by the packages feed);
- new packages go to the `master` branch only, never to `openwrt-xx.yy`
  release branches;
- translations are managed through Weblate;
- pass the LuCI ESLint configuration.
