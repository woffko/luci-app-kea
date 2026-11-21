# OpenWrt / LuCI Packaging Conformance

Audit date: 2026-11-11. Audited revision: `b6eedcf` (package version
`0.1.0-r1`). The findings marked "fixed" below were resolved in `0.1.0-r2`
(roadmap milestone M0) and re-checked with a real build and install. The
current version is `0.10.1-r1`.

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

`eslint.config.mjs` in this repository repeats the JavaScript rules of the
LuCI ESLint configuration; the views pass it without warnings. A run with the
configuration file of `openwrt/luci` itself is still to be done at submission
time.

## Metadata as the build system sees it

```text
Package: luci-app-kea
Submenu: 3. Applications
Version: 0.10.1-r1
Depends: +libc +luci-base +kea-uci +kea-lfc +ucode-mod-socket
Section: luci
Category: LuCI
Title: LuCI support for ISC Kea DHCP server
Maintainer: Woffko
License: Apache-2.0
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
| 2 | Package name | OK | `luci-app-kea`, matches the directory name that `luci.mk` derives `LUCI_NAME` from. The checkout directory had to keep that name. | Since the package is in `luci-app-kea/` inside the repository, the name of the checkout does not matter |
| 3 | Version and release | OK | Explicit `PKG_VERSION` and `PKG_RELEASE`. Valid out of tree. | - |
| 4 | Maintainer | FAIL | `luci.mk` ignores `PKG_MAINTAINER`; the package named the LuCI community as maintainer. | Fixed: `LUCI_MAINTAINER` set. No e-mail address, by owner decision. |
| 5 | Project URL | FAIL | `LUCI_URL` unset; the package pointed at `openwrt/luci`. | Fixed |
| 6 | License | GAP | Valid SPDX tag, but `LICENSE` held only the short notice. | Fixed: full Apache-2.0 text at the root of the repository, where `openwrt/luci` keeps its own. `PKG_LICENSE_FILES` is not set: the file is not inside the package directory |
| 7 | Description | GAP | No `LUCI_DESCRIPTION`. | Fixed |
| 8 | Dependencies | GAP | `+rpcd +rpcd-mod-file` redundant and unused. | Fixed: `+luci-base +kea-uci`, plus `+kea-lfc` since `0.3.0` |
| 9 | File layout | OK | Views, menu, ACL and rpcd plugin in the standard locations; plugin mode 0755 preserved. | - |
| 10 | ucode location | GAP | `root/usr/share/luci/kea/importer.uc` is a private path. LuCI convention is `ucode/` (installed to `/usr/share/ucode/luci/`) or `root/usr/share/rpcd/ucode/`. | Fixed in `0.3.0`: plugin in `root/usr/share/rpcd/ucode/luci.kea`, library in `ucode/kea/` |
| 11 | Unused files | FAIL | 10 of the 16 installed view files were unused copies. | Fixed: six views with stable names |
| 12 | Menu | GAP | Parent node repeated the Overview view. | Fixed: `firstchild` |
| 13 | ACL | GAP | Unused `file`, `uci` and `service` grants, including write access to `/etc/kea`. | Fixed: only `luci.kea` methods |
| 14 | Post-install | OK | The `luci.mk` default clears the LuCI caches and reloads `rpcd`. | - |
| 15 | Configuration files | GAP | No `conffiles`. | Not needed since `0.4.0`: the package owns no persistent file. Its backups live in `/etc/kea/`, which the Kea packages declare |
| 16 | Translations | GAP | No translation template. | Partly fixed: `po/templates/kea.pot` exists; backend messages are still untranslatable English text |
| 17 | JavaScript conventions | GAP | Hand-made tabs and inputs instead of `form.JSONMap` / `ui.tabs`, `window.confirm()` instead of `ui.showModal()`, no LuCI validation helpers. | Fixed in `0.5.0` as far as it fits: shared code is in modules under `resources/kea/`, every dialog uses `ui.showModal()`, tabs use LuCI's tab menu markup, wrong input is marked the way LuCI forms mark it. `form.JSONMap` was evaluated and not adopted; see [ROADMAP.md](ROADMAP.md#working-decisions) |
| 18 | Tests and CI | GAP | One fixture test, which did not pass on OpenWrt. No CI. | Fixed: unit, on-target and browser tests; GitHub Actions runs the lint, the unit tests, an SDK build, and the on-target and browser tests on OpenWrt in QEMU |
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

`luci-base` depends on `rpcd`, `rpcd-mod-ucode`, `ucode`, `ucode-mod-fs`,
`ucode-mod-uci`, `ucode-mod-ubus` and others. That covers everything the
ucode backend imports (`fs`, `uci`, `ubus`). Since `0.3.0` the backend calls
no shell tools: the earlier reliance on `jshn`, `pgrep` and `hexdump` is gone.

`kea-lfc` is a dependency because the configuration files shipped with Kea
enable lease file cleanup (`lfc-interval`), and `kea-dhcp4` and `kea-dhcp6`
exit at start when `/usr/sbin/kea-lfc` is missing, although `kea-dhcp4 -t`
accepts the configuration. A reviewer may prefer to see this fixed in the
`kea` package itself.

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

The views talk to the `luci.kea` ubus object, and since `0.10.1` to one
read-only method of another package, `ha-cluster` `nodes`; the ACL grants
nothing else.

`getConfig` is a read-level method and returns complete Kea configuration
files, which can hold secrets (TSIG keys in `kea-dhcp-ddns.conf`, control
agent credentials). It stays in the read group: LuCI read access already
exposes comparable secrets stored in UCI, and the DHCP pages need the method
to display anything. Revisit if reviewers of an upstream submission object.

`getLeases` and `getLog`, added in `0.7.0`, are read-level as well. They
return the addresses, MAC addresses and host names of DHCP clients, which
LuCI read access already shows for dnsmasq and odhcpd on its status pages.

`0.10.1` removed `getHaNodes` and added `ha-cluster` `nodes` to the read
group of the ACL. The pages now ask `ha-cluster` for the nodes of its
cluster themselves: the backend runs inside rpcd, which also serves that
object, and a call from rpcd to itself is not answered before it times
out. The method returns node names and addresses, which `getHaNodes`
handed out at the same level before, so a user of this application sees
nothing new. On a router without `ha-cluster` the entry grants nothing.

`0.10.0` added no method. The write-level `setInitAction` now runs a
command of another package after it started, restarted or reloaded Kea:
`/etc/init.d/ha-cluster firewall`, when that package is installed, its
script names the command, and its cluster is enabled with Kea as the DHCP
server. The command is fixed; nothing of the request reaches its command
line. A user who may start and stop Kea can thereby make `ha-cluster`
rewrite its own firewall rules from the Kea files, which the same user may
already write through `saveConfig`.

`0.9.0` added two read-level methods. `getDaemonState` returns what the
running DHCP daemons answer to `status-get` on their control sockets,
reduced to the state of their sockets and of high availability.
`getHaNodes` passed on the reply of `ubus call ha-cluster nodes`, a
read-only call of another package, when that package is installed: node
names and addresses. It was removed in `0.10.1`, see above.

The dependency `ucode-mod-socket`, new in `0.9.0`, is the ucode module that
opens the control sockets. Without it the backend still loads and reports
the state of the daemons as unknown.

`0.8.0` added no method. `getStatus` now also returns what dnsmasq and
odhcpd are configured to serve, read from `/etc/config/dhcp`, and `getLog`
the log outputs named in the Kea configuration files; both are less than
`getConfig` already returns.

### Translations (item 16)

`po/templates/kea.pot` is generated with the LuCI string scanner:

```sh
tools/update-pot.sh /path/to/luci-checkout
```

Regenerate it whenever a user-visible string changes. Messages produced by
the backend (error texts, import warnings) are not covered.

### Layout as a feed

The package is in the directory `luci-app-kea/` of the repository, with
nothing else in it than what `luci.mk` packages. Two things follow:

- The repository is an OpenWrt feed (`src-git` or `src-link` in
  `feeds.conf`). The feed scripts list the Makefiles below the feed
  directory and take the package path from the directory in front of
  `/Makefile`, so a Makefile at the root of a feed is not found
  (`Ignoring feed ... - index missing`). CI builds the package from such a
  feed on every run.
- The directory can be copied to `applications/luci-app-kea` of
  `openwrt/luci` as it is.

## Additional requirements for an upstream submission

The project is a standalone repository for now and aims at a later submission
to `openwrt/luci` (see the decisions in [ROADMAP.md](ROADMAP.md#decisions)).
These apply at that point:

- copy `luci-app-kea/` to `applications/luci-app-kea` and use
  `include ../../luci.mk`;
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
