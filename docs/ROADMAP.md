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

Done in `0.1.0-r2`.

- [x] Makefile: set `LUCI_URL`, `LUCI_DESCRIPTION`, `PKG_LICENSE_FILES`, and
      `LUCI_MAINTAINER:=$(PKG_MAINTAINER)` so the package stops naming the
      LuCI community as maintainer; drop the redundant
      `+rpcd +rpcd-mod-file` dependencies. The maintainer identity itself is
      unchanged (see [Decisions](#decisions)).
- [x] Replace `LICENSE` with the full Apache-2.0 text.
- [x] Delete the 10 unused view files and rename the active ones to stable
      names (`overview`, `services`, `dhcp4`, `dhcp6`, `configuration`,
      `import-dnsmasq`); update the menu.
- [x] Menu: use a `firstchild` action on the parent node.
- [x] ACL: remove the unused `file`, `uci` and `service` grants. `getConfig`
      stays in the read group; see [PACKAGING.md](PACKAGING.md#acl-item-13).
- [x] Declare `/etc/kea/luci-reservations.json` in `conffiles`.
- [x] Generate `po/templates/kea.pot` with the LuCI `build/i18n-scan.pl`.
- [x] Remove `create-and-push-github-repo.sh`.
- [x] Build with the OpenWrt 25.12.6 SDK, install with `apk` on an OpenWrt
      25.12.6 virtual machine with Kea 3.0.4, and open every page.

Also fixed on the way: `test/run-import-fixture.sh` compared against compact
JSON, which `jshn` does not produce, so it never passed on OpenWrt. It now
reads fields with `jsonfilter`.

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
- [ ] Prepare the submission to `openwrt/luci`: meet the extra requirements in
      [PACKAGING.md](PACKAGING.md), including a maintainer with a real name
      and e-mail address.

## Decisions

Made by the project owner on 2026-11-11.

1. **Maintainer.** Stays `Woffko`, without an e-mail address, for now. To be
   revisited before an upstream submission, which requires a real name and
   address.
2. **Distribution.** A standalone repository for now, with a later submission
   to `openwrt/luci` as the goal. Consequences:
   - the Makefile keeps its out-of-tree form
     (`include $(TOPDIR)/feeds/luci/luci.mk`, explicit version) until the
     submission;
   - all new work follows LuCI conventions so the move stays cheap: stable
     view names, strings through `_()` with an up-to-date `kea.pot`, the LuCI
     ESLint configuration, standard LuCI widgets where practical, standard
     install paths for ucode, and no dependencies outside the OpenWrt feeds;
   - where a choice exists, prefer what `openwrt/luci` reviewers expect over
     what is quickest.

## Open questions

1. Menu location: **Services > Kea DHCP** (current) or under **Network**?
2. Minimum supported OpenWrt and Kea versions. Is 24.10 (opkg) in scope?
3. Keep the shell backend, or move fully to ucode in M2?
4. Where should disabled and unresolved reservations live: the JSON staging
   file, a UCI namespace, or Kea `user-context`?
5. Lease viewer in the first stable release, or later?
