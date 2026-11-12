# Roadmap

Last updated: 2026-11-12.

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
- [x] Declare `/etc/kea/luci-reservations.json` in `conffiles`. (Dropped in
      `0.4.0` together with the file.)
- [x] Generate `po/templates/kea.pot` with the LuCI `build/i18n-scan.pl`.
- [x] Remove `create-and-push-github-repo.sh`.
- [x] Build with the OpenWrt 25.12.6 SDK, install with `apk` on an OpenWrt
      25.12.6 virtual machine with Kea 3.0.4, and open every page.

Also fixed on the way: `test/run-import-fixture.sh` compared against compact
JSON, which `jshn` does not produce, so it never passed on OpenWrt. It now
reads fields with `jsonfilter`.

## M1: Configuration safety

Done in `0.2.0-r1`. Until `0.1.0` the structured editors rebuilt every subnet
from the form and dropped what the form did not show.

- [x] Merge form values into the existing subnet object instead of replacing
      it, so unknown keys, extra pools and extra options survive a save.
- [x] Keep reservation fields the form does not edit; support DHCPv4
      reservations that are not keyed by MAC address.
- [x] Store disabled reservations instead of deleting them. They live in the
      subnet's `user-context`.
- [x] Make removal of the stock sample subnets, options and client class an
      explicit action with a confirmation.
- [x] Allocate subnet IDs that do not collide with existing ones.
- [x] Timestamped backups with a retention limit, plus `listBackups` and
      `restoreBackup` methods and a restore control in the raw editor.
- [x] Apply flow: validate, save, then reload Kea, with the result shown.
      Remove the duplicate Save/Reload buttons.
- [x] Fail instead of writing a guessable API password when no random source
      is available.
- [x] Read the `disabled` default the same way `/etc/init.d/kea` does.
- [x] Warn in the UI that saving removes JSON comments.

The round trip (load, change one field, save) on a config with several pools,
custom options, relay settings and mixed reservation types changes only the
edited field. This is checked by unit tests of the model and by an end-to-end
browser test in which Kea validates every save.

Also fixed on the way:

- `getConfig` dropped the final newline of the file, so every save from the
  raw editor changed the file even without edits;
- the comment stripper did not know `#` comments, which Kea accepts, so such
  files could not be opened in the structured editors;
- the DHCPv6 editor offered "Client ID" as a reservation identifier, which
  Kea does not support for DHCPv6;
- the raw editor could show the wrong file when the selection changed while
  a request was in flight;
- the Overview and Import pages showed Save / Apply / Reset buttons that did
  nothing.

## M2: Backend structure and tests

Done in `0.3.0-r1`.

- [x] Move the backend from the shell script to ucode: an rpcd ucode plugin
      (`/usr/share/rpcd/ucode/luci.kea`) on top of a library installed as the
      `luci.kea.*` modules. The ubus object, its methods and their replies are
      unchanged, so the pages and the ACL were not touched.
- [x] Use the procd service state instead of `pgrep`.
- [x] Include the control agent config in `validate`.
- [x] Tests that run without a router: ucode unit tests for comment
      stripping, save, backups, restore, import classification and merge.
- [x] Tests against temporary roots on OpenWrt: validation with the real Kea
      binary, service state and toggles, init actions, API password, import
      preview from UCI.
- [x] GitHub Actions: syntax checks, ShellCheck, JSON validation, ESLint with
      the LuCI rules, unit tests, and a package build with the OpenWrt SDK.
- [x] Depend on `kea-lfc`.

Also fixed on the way:

- backups made within one second could be numbered out of order once older
  ones had been pruned, so the newest was listed as the oldest;
- `setService` reported success for a component that had no section in
  `/etc/config/kea` without writing anything;
- interfaces configured with `ipaddr` plus `netmask` were not matched to
  their Kea subnet.

Not done: running the browser tests and the on-target tests in CI. They need
a running OpenWrt system; see M7.

## M3: Complete the dnsmasq import

Done in `0.4.0-r1`.

- [x] Make the preview aware of Kea subnets and OpenWrt networks.
- [x] Detect duplicate MAC addresses, DUIDs and IP addresses.
- [x] Resolve `hostid` against the subnet prefix.
- [x] Write ready DHCPv6 entries to `kea-dhcp6.conf`.
- [x] Stricter DUID validation.
- [x] Choose what to import. Entries are edited at their source, the static
      lease in LuCI's DHCP page; the import page links to it.
- [x] No staging file. See decision 5 below.
- [x] Hosts with several MAC addresses stay unimported, with a clear reason.
- [x] Idempotency test: importing the same source twice changes nothing.

Also fixed on the way: a static lease that carries both `mac`/`ip` and
`duid`/`hostid`, the usual form in OpenWrt, was treated as DHCPv6 only and
its DHCPv4 half was dropped; DUIDs in the OpenWrt hex notation were rejected.

## M4: Editor completeness

Done in `0.5.0-r1`.

- [x] Browser-side validation of addresses, CIDR values, MAC addresses, DUIDs
      and ranges. Wrong values are marked while typing and reported by tab
      and field on save.
- [x] Several pools and prefix delegation pools per subnet.
- [x] Show and edit subnets inside `shared-networks`.
- [x] Global and per-subnet `option-data` editor.
- [x] Reservation identifiers: `client-id`, DUID, circuit ID and flex ID
      besides the MAC address (since `0.2.0`). Kea reservations have no
      IAID. The options and `user-context` of a reservation are preserved
      and edited in the raw editor.
- [x] Lease database: the lease file cleanup interval. The other keys stay
      in the raw editor; the OpenWrt Kea packages are built without the
      MySQL and PostgreSQL backends, so there is no backend to choose.
- [x] Semantic checks: the same subnet twice, pool and reservation inside the
      subnet, overlapping pools, duplicate reservations, and a warning when
      dnsmasq or odhcpd serves the same interface. They run in the browser
      model, not in the backend; see the working decisions.
- [x] Raw editor: JSON syntax check in the browser, view of the changed
      lines. The structured editors have the same view.
- [x] Evaluate rebuilding the editors on `form.JSONMap` and `ui.tabs`. Not
      adopted; see the working decisions.

Also fixed on the way: the editors offered no way to see or change a second
pool, so a pool that had become wrong could only be fixed in the raw editor.
The three hand-built confirmation dialogs became one shared module.

Not done: creating, renaming and removing shared networks, and editors for
client classes and option definitions. They stay in the raw editor until
someone needs them in a form.

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
- [ ] Run the on-target and browser tests in CI against an OpenWrt root
      filesystem or virtual machine.
- [ ] Attach built packages to GitHub releases.
- [ ] Document installation as a custom feed.
- [ ] Prepare the submission to `openwrt/luci`: meet the extra requirements in
      [PACKAGING.md](PACKAGING.md), including a maintainer with a real name
      and e-mail address.

## Decisions

Made by the project owner.

1. **Maintainer** (2026-11-11). Stays `Woffko`, without an e-mail address, for
   now. To be revisited before an upstream submission, which requires a real
   name and address.
2. **Distribution** (2026-11-11). A standalone repository for now, with a
   later submission to `openwrt/luci` as the goal. Consequences:
   - the Makefile keeps its out-of-tree form
     (`include $(TOPDIR)/feeds/luci/luci.mk`, explicit version) until the
     submission;
   - all new work follows LuCI conventions so the move stays cheap: stable
     view names, strings through `_()` with an up-to-date `kea.pot`, the LuCI
     ESLint configuration, standard LuCI widgets where practical, standard
     install paths for ucode, and no dependencies outside the OpenWrt feeds;
   - where a choice exists, prefer what `openwrt/luci` reviewers expect over
     what is quickest.
3. **Backend language** (2026-11-12). ucode if it is the better choice, and it
   is: `luci-base` and `luci-app-example` use it, it removes JSON handling in
   shell, gives access to the procd state, and lets the logic be tested
   without a router.
4. **`kea-lfc`** (2026-11-12). A dependency if it is needed, and it is: the
   configuration files shipped with Kea enable lease file cleanup, and the
   DHCP daemons do not start without that package.
5. **Static leases that cannot be imported** (2026-11-12). The owner asked
   for a separate file or whatever is customary in OpenWrt. Such data lives
   in UCI in OpenWrt, and it is already there: the host sections of
   `/etc/config/dhcp`. No second copy is kept. The import page computes its
   list from UCI and the Kea configuration each time, and
   `/etc/kea/luci-reservations.json` is gone. A disabled static lease is
   imported as a disabled reservation in the subnet's `user-context`.

### Working decisions

Taken while implementing M0 and M1, where the roadmap left a choice open.
They follow the recommendation at the time and can be revisited.

- `getConfig` stays in the read ACL group. See
  [PACKAGING.md](PACKAGING.md#acl-item-13).
- Reservations disabled in the editors are stored in the subnet's
  `user-context` under `luci-app-kea` / `disabled-reservations`. They stay in
  the same file as the subnet, are covered by its backups, and are ignored by
  Kea.
- Backups go to `/etc/kea/backups/`, ten per config file.
- Version numbers: packaging-only changes bump `PKG_RELEASE`; changes in
  behavior bump `PKG_VERSION`.

Taken while implementing M4:

- **Where the semantic checks run.** In the browser model, next to the form,
  and not a second time in ucode. The reason for the checks is to name the
  field that is wrong while the user is still typing; the backend cannot do
  that. Correctness does not depend on them, because every write still
  passes the Kea binary's own test on the router, and the import has its
  own checks in ucode since `0.4.0`.
- **Only changed values are checked.** The rules were measured against
  `kea-dhcp4 -t` and `kea-dhcp6 -t` of Kea 3.0.4, but another Kea version
  may accept more. A value the editor did not write is therefore never a
  reason to refuse a save.
- **`form.JSONMap` and `ui.tabs` are not used.** `form.JSONMap` maps an
  object of flat sections with options, the shape of a UCI file. A Kea file
  is nested several levels deep (subnets, inside them pools, options and
  reservations, and the same again inside shared networks), an option is
  found by name or by code, and a save must change only the edited values
  and leave unknown keys, key order and number formatting alone. All of
  that would remain custom code underneath, with one map per nested list on
  top. `ui.tabs` wants every pane in the document at once; the editor draws
  the active tab from the model instead, so that hundreds of reservation
  inputs of other subnets are not built up front. The pages use LuCI's own
  markup and classes for tabs, fields, tables and invalid input, and
  `ui.showModal()` for dialogs, so they look and behave like the rest of
  LuCI.

## Open questions

1. Menu location: **Services > Kea DHCP** (current) or under **Network**?
2. Minimum supported OpenWrt and Kea versions. Is 24.10 (opkg) in scope?
3. Lease viewer in the first stable release, or later?
