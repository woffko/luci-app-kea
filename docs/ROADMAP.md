# Roadmap

Last updated: 2026-11-11.

Goal: a LuCI application that manages ISC Kea on OpenWrt well enough to
replace dnsmasq/odhcpd DHCP on a router, without losing access to Kea's JSON
configuration model.

This file is the work plan. The current state is in [STATUS.md](STATUS.md),
packaging findings in [PACKAGING.md](PACKAGING.md), and the target behavior of
each feature in [DESIGN.md](DESIGN.md).

Milestones are in priority order. M0 and M1 come first because they affect
everyone who installs the package today: M0 fixes what the package says about
itself and ships, M1 stops the editors from destroying configuration.

## M0: Packaging hygiene

Small, mechanical, and needed before any release.

- [ ] Makefile: set `LUCI_URL`, `LUCI_MAINTAINER`, `LUCI_DESCRIPTION`,
      `PKG_LICENSE_FILES`; give `PKG_MAINTAINER` a name and address; drop the
      redundant `+rpcd +rpcd-mod-file` dependencies.
- [ ] Replace `LICENSE` with the full Apache-2.0 text.
- [ ] Delete the 10 unused view files and rename the active ones to stable
      names (`overview`, `services`, `dhcp4`, `dhcp6`, `configuration`,
      `import-dnsmasq`); update the menu.
- [ ] Menu: use a `firstchild` action on the parent node.
- [ ] ACL: remove the unused `file`, `uci` and `service` grants; decide whether
      `getConfig` moves to the write group.
- [ ] Declare `/etc/kea/luci-reservations.json` in `conffiles`.
- [ ] Generate `po/templates/kea.pot` with the LuCI `build/i18n-scan.pl`.
- [ ] Remove `create-and-push-github-repo.sh`.
- [ ] Build in an OpenWrt 25.12.6 tree (Kea 3.0.4), install with `apk` on the
      test target, and open every page.

Done when the metadata dump shows the project URL and maintainer, the package
contains six view files, and the build and install are confirmed on 25.12.6.

## M1: Configuration safety

The structured editors currently rebuild every subnet from the form. See
"Known defects" in [STATUS.md](STATUS.md).

- [ ] Merge form values into the existing subnet object instead of replacing
      it, so unknown keys, extra pools and extra options survive a save.
- [ ] Keep reservation fields the form does not edit; support DHCPv4
      reservations that are not keyed by MAC address.
- [ ] Store disabled reservations instead of deleting them (staging file or
      Kea `user-context`).
- [ ] Make removal of the stock sample subnets, options and client class an
      explicit action with a confirmation.
- [ ] Allocate subnet IDs that do not collide with existing ones.
- [ ] Timestamped backups with a retention limit, plus `listBackups` and
      `restoreBackup` methods and a restore control in the raw editor.
- [ ] Apply flow: validate, save, then reload Kea, with the result shown.
      Remove the duplicate Save/Reload buttons.
- [ ] Fail instead of writing a guessable API password when no random source
      is available.
- [ ] Read the `disabled` default the same way `/etc/init.d/kea` does.
- [ ] Warn in the UI that saving removes JSON comments.

Done when a round trip (load, change one field, save) on a config with
multiple pools, custom options, relay settings and mixed reservation types
changes only the edited field. This needs an automated test from M2.

## M2: Backend structure and tests

- [ ] Move parsing, validation and import logic from the shell script into
      ucode modules; consider replacing the shell plugin with an rpcd ucode
      plugin (`/usr/share/rpcd/ucode/kea.uc`).
- [ ] Use the procd service state instead of `pgrep`.
- [ ] Include the control agent config in `validate`.
- [ ] Tests that run without a router: ucode unit tests for the importer,
      the validator and the config merge.
- [ ] RPC tests against temporary config roots: status, service toggles,
      validation success and failure, save, backup, restore, import dry run,
      import commit.
- [ ] GitHub Actions: `node --check`, `shellcheck`, JSON validation, LuCI
      ESLint configuration, and a package build with the OpenWrt SDK.

## M3: Complete the dnsmasq import

- [ ] Make the preview aware of Kea subnets and OpenWrt networks.
- [ ] Detect duplicate MAC addresses, DUIDs and IP addresses.
- [ ] Resolve `hostid` against the subnet prefix.
- [ ] Write ready DHCPv6 entries to `kea-dhcp6.conf`.
- [ ] Stricter DUID validation.
- [ ] Edit entries before import; show and edit staged entries afterwards.
- [ ] Merge into the staging file instead of rewriting it.
- [ ] Split entries with several MAC addresses, or keep them disabled with a
      clear reason.
- [ ] Idempotency test: importing the same source twice changes nothing.

## M4: Editor completeness

- [ ] Browser-side validation of addresses, CIDR values, MAC addresses, DUIDs
      and ranges.
- [ ] Several pools and prefix delegation pools per subnet.
- [ ] Global and per-subnet `option-data` editor.
- [ ] Reservation options: `client-id`, IAID where needed, `user-context`.
- [ ] Lease database settings.
- [ ] Backend semantic checks: subnet overlap, pool and reservation inside the
      subnet, duplicate reservations, conflict with dnsmasq/odhcpd on the same
      interface.
- [ ] Raw editor: JSON syntax check in the browser, diff preview.
- [ ] Evaluate rebuilding the editors on `form.JSONMap` and `ui.tabs`.

## M5: High availability

- [ ] HA page shown only when `kea-hook-ha` is installed or an HA hook entry
      exists.
- [ ] Verify the HA hook schema against the packaged Kea version first.
- [ ] Modes, this-server name, peers, timers, lease update settings, advanced
      JSON parameters. See [DESIGN.md](DESIGN.md).
- [ ] Optional assisted fill-in from `ha-cluster` peers, without a dependency.

## M6: Runtime visibility

- [ ] Kea version and recent log lines on the Overview page.
- [ ] Lease viewer through the control agent and the `lease_cmds` hook.

## M7: Release and distribution

- [ ] Changelog and version policy; tag `v0.x` releases.
- [ ] Attach built packages to GitHub releases.
- [ ] Document installation as a custom feed.
- [ ] Decide on an upstream submission to `openwrt/luci` and meet the extra
      requirements in [PACKAGING.md](PACKAGING.md).

## Open questions

1. Which name and e-mail address should the package list as maintainer?
2. Stay a standalone repository, or aim for `openwrt/luci`? This decides the
   Makefile form, the commit conventions and the translation workflow.
3. Menu location: **Services > Kea DHCP** (current) or under **Network**?
4. Minimum supported OpenWrt and Kea versions. Is 24.10 (opkg) in scope?
5. Keep the shell backend, or move fully to ucode in M2?
6. Where should disabled and unresolved reservations live: the JSON staging
   file, a UCI namespace, or Kea `user-context`?
7. Lease viewer in the first stable release, or later?
