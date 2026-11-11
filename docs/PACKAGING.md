# OpenWrt / LuCI Packaging Conformance

Audit date: 2026-11-11. Audited revision: `b6eedcf` (package version
`0.1.0-r1`).

This document records how `luci-app-kea` compares with the OpenWrt and LuCI
packaging rules, and what has to change. The fixes are tracked as milestone M0
in [ROADMAP.md](ROADMAP.md).

## References

The audit was made against these sources, taken from an OpenWrt 25.12.6 build
tree (LuCI feed commit `e969939b`, packages feed commit `1a304c1`):

- `feeds/luci/luci.mk` - the build glue every LuCI package includes;
- `feeds/luci/CONTRIBUTING.md`;
- `feeds/luci/applications/luci-app-example` (`Makefile`, `structure.md`,
  `BUILDING.md`) - the reference layout for a JavaScript LuCI application;
- `feeds/packages/CONTRIBUTING.md` - the feed-level summary of the OpenWrt
  package guide;
- `feeds/packages/net/kea` (Kea 3.0.4) - the package this application manages;
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
  menu and ACL JSON. All passed.

Not done in this audit:

- a full package build (the 25.12.3 tree used in May 2026 no longer exists);
- a runtime test against OpenWrt 25.12.6 / Kea 3.0.4;
- a lint run with the LuCI ESLint configuration.

## Metadata as the build system sees it

```text
Package: luci-app-kea
Submenu: 3. Applications
Version: 0.1.0-r1
Depends: +libc +luci-base +rpcd +rpcd-mod-file +kea-uci
Section: luci
Category: LuCI
Title: LuCI support for ISC Kea DHCP server
Maintainer: OpenWrt LuCI community
License: Apache-2.0
URL: https://github.com/openwrt/luci
Description: LuCI support for ISC Kea DHCP server
```

`Maintainer` and `URL` are wrong for an out-of-tree package. See items 4 and 5.

## Checklist

Status: **OK** conforms, **GAP** works but should be fixed, **FAIL** does not
conform.

| # | Area | Status | Finding |
|---|------|--------|---------|
| 1 | Makefile skeleton | OK | `rules.mk` first, `LUCI_*` variables, `luci.mk` included last, `BuildPackage` signature comment present. |
| 2 | Package name | OK | `luci-app-kea`, matches the directory name that `luci.mk` derives `LUCI_NAME` from. Keep the checkout directory named `luci-app-kea`. |
| 3 | Version and release | OK | Explicit `PKG_VERSION:=0.1.0`, `PKG_RELEASE:=1`. Valid out of tree. |
| 4 | Maintainer | FAIL | `PKG_MAINTAINER:=Woffko` has no e-mail address, and `luci.mk` does not use it: the package is built with `Maintainer: OpenWrt LuCI community`. |
| 5 | Project URL | FAIL | `LUCI_URL` is unset, so the package points at `https://github.com/openwrt/luci`. |
| 6 | License | GAP | `PKG_LICENSE:=Apache-2.0` is a valid SPDX tag. `PKG_LICENSE_FILES` is unset, and `LICENSE` holds only the short notice, not the license text (GitHub reports the license as "Other"). |
| 7 | Description | GAP | No `LUCI_DESCRIPTION`; the description repeats the title. |
| 8 | Dependencies | GAP | All dependencies resolve. `+rpcd +rpcd-mod-file` are redundant: `luci-base` already depends on both, and the application never uses the `file` rpcd module. |
| 9 | File layout | OK | Views in `htdocs/luci-static/resources/view/kea/`, menu in `root/usr/share/luci/menu.d/luci-app-kea.json`, ACL in `root/usr/share/rpcd/acl.d/luci-app-kea.json`, rpcd plugin in `root/usr/libexec/rpcd/luci.kea` (mode 0755, preserved by `cp -pR`). |
| 10 | ucode location | GAP | `root/usr/share/luci/kea/importer.uc` is a private path. LuCI convention is `ucode/` (installed to `/usr/share/ucode/luci/`) for libraries or `root/usr/share/rpcd/ucode/` for rpcd plugins. |
| 11 | Unused files | FAIL | 10 of the 16 installed view files are unused duplicates or stale copies. See [Unused view files](#unused-view-files). |
| 12 | Menu | GAP | Valid, under `admin/services/kea`. The parent node repeats the Overview view instead of using a `firstchild` action. |
| 13 | ACL | GAP | Grants more than the application uses. See [ACL](#acl). |
| 14 | Post-install | OK | No custom script needed: the `luci.mk` default clears the LuCI caches and reloads `rpcd`. |
| 15 | Configuration files | GAP | No `conffiles`. The application owns `/etc/kea/luci-reservations.json`. It survives upgrades today only because the Kea packages declare the whole `/etc/kea/` directory. |
| 16 | Translations | GAP | View strings are wrapped in `_()`, but there is no `po/templates/kea.pot`, and about 37 backend messages are returned as untranslatable English text. Required for an upstream submission. |
| 17 | JavaScript conventions | GAP | Strict mode, `require` directives, `view.extend`, `rpc.declare`, DOM built with `E()`, no `innerHTML`, no `String.format`. Editors use hand-made tabs and inputs instead of `form.JSONMap` / `ui.tabs`, `window.confirm()` instead of `ui.showModal()`, and no LuCI validation helpers. |
| 18 | Tests and CI | GAP | One fixture test that only runs on OpenWrt. No CI. |
| 19 | Repository hygiene | GAP | `create-and-push-github-repo.sh` is a one-time helper unrelated to the package. No tags or releases. No repository topics. |

## Details

### Maintainer and URL (items 4, 5)

`luci.mk` defines the package with `MAINTAINER:=$(LUCI_MAINTAINER)` and
`URL:=$(LUCI_URL)`, defaulting to the LuCI community and the LuCI repository.
`PKG_MAINTAINER` alone does not change the built package. An out-of-tree
package has to set `LUCI_MAINTAINER` and `LUCI_URL` before including `luci.mk`.

The packages feed rule for the maintainer format is
`PKG_MAINTAINER:=Joe D. Hacker <jdh@jdhs-email-provider.org>`.

Owner decision, 2026-11-11: the maintainer stays `Woffko` without an e-mail
address for now. `LUCI_MAINTAINER` still has to be set, so that the package
names the project maintainer instead of the LuCI community. A real name and
address become necessary at an upstream submission.

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

### Unused view files

The menu references six views. The other ten were created while renaming
modules to defeat browser caching during development:

| Active view (menu) | Identical copies | Older revisions |
|---|---|---|
| `overview.js` | - | - |
| `services-control.js` | `services-status.js` | - |
| `dhcp4-clean-save.js` | `dhcp4.js`, `dhcp4-config-save.js` | `dhcp4-config.js`, `dhcp4-editor.js` |
| `dhcp6-clean-save.js` | `dhcp6.js`, `dhcp6-config-save.js` | `dhcp6-editor.js` |
| `configuration.js` | - | - |
| `import-dnsmasq-commit.js` | `import-dnsmasq.js`, `import-dnsmasq-preview.js` | - |

The six active views are 70,949 bytes; all sixteen are 249,871 bytes, so 72% of
the JavaScript shipped in the package is never loaded.

The renames are not needed for packaged installs. LuCI loads every resource
with `?v=<luci-base version>-<mtime of /lib/apk/db/installed>` (see
`luci-base` `ucode/runtime.uc` and `ucode/template/header.ut`), so any package
install or upgrade changes the URL of every view. Only files copied by hand
keep their old URL. [DEVELOPMENT.md](DEVELOPMENT.md) describes how to handle
that case without renaming modules.

Target names: `overview`, `services`, `dhcp4`, `dhcp6`, `configuration`,
`import-dnsmasq`.

### ACL

The views talk only to the `luci.kea` ubus object. These grants are unused:

- `read.ubus.service: [ "list" ]`;
- `read.uci: [ "kea", "dhcp", "network" ]` and `write.uci: [ "kea" ]` - the
  backend runs as root and does not need them;
- every `file` entry, including write access to the whole `/etc/kea`
  directory.

`getConfig` is a read-level method and returns complete Kea configuration
files, which can hold secrets (TSIG keys in `kea-dhcp-ddns.conf`, control
agent credentials). Decide whether it belongs in the write group.

### Proposed Makefile

Not applied and not build-tested yet.

```make
# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-kea
PKG_VERSION:=0.1.0
PKG_RELEASE:=2

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Woffko

LUCI_TITLE:=LuCI support for ISC Kea DHCP server
LUCI_DESCRIPTION:=Web interface for the ISC Kea DHCPv4/DHCPv6 servers: \
	service control, structured and raw configuration editors, and \
	dnsmasq static lease import.
LUCI_URL:=https://github.com/woffko/luci-app-kea
LUCI_MAINTAINER:=$(PKG_MAINTAINER)
LUCI_DEPENDS:=+luci-base +kea-uci
LUCI_PKGARCH:=all

define Package/luci-app-kea/conffiles
/etc/kea/luci-reservations.json
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
```

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
- provide `po/templates/kea.pot`; translations are managed through Weblate;
- pass the LuCI ESLint configuration.
