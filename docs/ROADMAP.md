# Roadmap

Last updated: 2026-11-17.

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

Done in `0.6.0-r1`.

- [x] High availability settings, shown only when `kea-hook-ha` is installed
      or an HA hook entry exists. They are a tab of the DHCPv4 and DHCPv6
      editors, not a page of their own; see the working decisions.
- [x] Verify the HA hook schema against the packaged Kea version first.
      About sixty configurations were run through `kea-dhcp4 -T` and
      `kea-dhcp6 -T` of Kea 3.0.4; [DESIGN.md](DESIGN.md#high-availability)
      lists what the hook takes and refuses.
- [x] Modes, this-server name, peers, timers, lease update settings, advanced
      JSON parameters.
- [ ] Optional assisted fill-in from `ha-cluster` peers, without a dependency.
      Not done in `0.6.0`: the OpenWrt 25.12 repositories have no
      `ha-cluster` package. Moved to M9, where there is one to read from.

Also fixed on the way:

- `kea-dhcp4 -t` and `kea-dhcp6 -t` do not look at hook parameters at all:
  a high availability entry with an unknown mode passed the check and the
  daemon then refused to start. The backend now asks the DHCP daemons with
  `-T`, which loads the hooks, and puts the reason a hook gives first in
  what the user sees.
- When Kea refused a save, the editors and the raw editor loaded the file
  again and discarded what the user had typed. The input now stays.

Not done: several relationships (hub and spoke) in the form, fields for TLS
and basic authentication, and the state of the running service.

## M6: Runtime visibility

Done in `0.7.0-r1`.

- [x] Kea version and recent log lines on the Overview page.
- [x] Lease viewer. It reads the lease files instead of asking the daemon
      through the control agent and the `lease_cmds` hook; see the working
      decisions.

Also changed on the way: the Overview page folds the output Kea prints for
a file it accepts, which had grown to a screen per file.

Not done: removing a lease from the page, and the history of leases that
are no longer in use.

## M7: Release and distribution

- [x] Changelog and version policy: [CHANGELOG.md](../CHANGELOG.md) and
      [RELEASING.md](RELEASING.md).
- [x] Tag `v0.x` releases. `v0.7.0` on 2026-11-17 is the first, made by
      hand with the package of its CI run attached. `v0.8.0` followed on
      2026-11-20 and `v0.9.0` on 2026-11-21.
- [x] Document installation of the package that CI builds.
- [x] Run the on-target and browser tests in CI against an OpenWrt root
      filesystem or virtual machine. Done with the official image under
      QEMU.
- [x] Attach built packages to GitHub releases automatically, from the tag.
      A workflow prepares a draft; the owner publishes it. First used for
      `v0.8.0`.
- [x] Document installation as a custom feed. The package moved into a
      subdirectory for it.
- [ ] A package repository for `apk`, with signed packages, so that a
      router installs and upgrades the application without a downloaded
      file. Needs a signing key kept in the repository secrets, which is a
      decision for the owner.
- [ ] Prepare the submission to `openwrt/luci`: meet the extra requirements in
      [PACKAGING.md](PACKAGING.md), including a maintainer with a real name
      and e-mail address. Put off by the owner; see decision 6.

## M8: After the first release

Found on 2026-11-19, when another project ran the release against a
configuration it had generated, and measured again on the test machine with
Kea 3.0.4. Approved by the owner the same day. Done in `0.8.0-r1`, except
the last item.

- [x] Warn about settings that pass the Kea check and stop the daemon at
      start: a lease file outside `/var/lib/kea`, a log file outside
      `/var/log/kea`. A warning next to the result of the check, never a
      refused save: another Kea version or build may allow other paths.
      Save & Apply asks before it reloads a running daemon with them.
- [x] Say on Overview where a daemon writes its log when that is not the
      system log, and that a log file in the missing `/var/log/kea` is lost.
      Offer the logger output as a field of the Global settings tab.
- [x] Split the severity off log lines that arrive through procd.
- [x] Services page: show what dnsmasq and odhcpd still serve (DHCP on
      which interfaces, DNS, router advertisements), and ask before stopping
      a service that the network needs for something else.
- [ ] Idea: the names of Kea leases in the local DNS. dnsmasq accepts no
      DNS updates and the OpenWrt 25.12 repository has no run-script hook
      for Kea, so it would be a copy made from the lease files.

## M9: Kea on a router that reboots, and pairs of routers

From a bench of the `ha-cluster` project (the owner's own feed) with a pair
of Kea 3.0.4 servers next to VRRP, on 2026-11-20, and from measurements on
the test machine the same day. The first three items were approved by the
owner that day and are done in `0.9.0-r1`.

- [x] Sockets at boot. Without `service-sockets-max-retries` and
      `service-sockets-retry-wait-time` in `interfaces-config`, a Kea that
      is started before its interface is ready runs without listening.
      Write the two parameters when the editors make Kea listen on an
      interface and the file has neither, and warn about a file that names
      interfaces without them.
- [x] Say what a running daemon is doing: the state of its sockets, and of
      high availability, from its control socket, on Overview and Services.
      "Running" alone is true for a daemon that answers nobody.
- [x] Fill in the high availability tab from `ha-cluster`. Its read-only
      call `ubus call ha-cluster nodes` gives each node a name that is the
      same on every node, the address the partner reaches, and a suggested
      role. The application stays the only writer of the Kea files, and
      works without `ha-cluster`.
- [ ] A fixed server identifier for DHCPv6. Not planned. The owner asked
      for it on the condition that the changing identifier is a problem,
      and the measurements of 2026-11-21 say it hardly is: a client keeps
      its address and only renews later, at its rebind time. The one boot
      in which `kea-dhcp6` did not start because it could not make an
      identifier did not happen again in 22 boots. To be taken up if that
      shows again.
- [ ] Proposed by the `ha-cluster` project, not yet decided: reload
      `ha-cluster` after a Kea file with changed peer URLs was applied, so
      that its firewall rule follows the ports.
- [ ] Open, with the `ha-cluster` project: how the Kea files of two nodes
      are kept equal. They may differ in `this-server-name` only. Kea
      accepts that value from an included file, but the application cannot
      open such a file in its forms. The firewall rule for the ports of the
      high availability listeners is for `ha-cluster` to write, by the
      owner's word of 2026-11-20.
- [ ] Idea: apply a configuration with a reload signal instead of a restart
      of the process. A daemon then keeps its previous configuration when
      the new file cannot be loaded. Kea exits when the signal arrives in
      its first moments after a start, by the same bench.

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
6. **Submission to `openwrt/luci`** (2026-11-13). Not for now. The
   repository stays standalone. New work keeps following the LuCI
   conventions of decision 2, so that a submission stays possible later
   without rework.

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
  behavior bump `PKG_VERSION`. Spelled out in [RELEASING.md](RELEASING.md).

Taken while implementing M9:

- **The form adds the retries only with a new interface.** A file that
  listens without them gets a warning and two fields, not a silent change:
  the rule that only what the user edits is written stays. Making Kea listen
  on an interface is the edit that the retries belong to.
- **Sixty retries, two seconds apart.** Two minutes cover a slow boot; the
  values are the ones the bench of `ha-cluster` used, and the ones measured
  here.
- **The state of a daemon comes from its control socket, by `status-get`.**
  One call tells the sockets and high availability. It needs the ucode
  socket module, a new dependency, and a control socket in the file, which
  the files shipped with Kea have. Without either the pages work as before
  and say that the state is unknown. Every wait on the socket has a time
  limit, because the backend runs inside rpcd.
- **Only the daemons procd runs are asked**, and only the two DHCP daemons:
  the others listen on no interface and have no high availability.
- **`ha-cluster` is asked by the backend, not by the page.** The page needs
  no access to another package's ubus object, and without that package the
  reply is simply "nothing available".
- **The fill-in fills the form and saves nothing.** The user sees the
  peers, can change a port, and saves; Kea checks the result with the hook
  loaded like any other save. Ports 8001 and 8002 are fixed so that every
  node arrives at the same URLs.
- **A daemon that does not listen is an alarm; a pair that is still
  synchronizing is not.** High availability switches the DHCP service off
  while the servers start, and on again by itself.

Taken while implementing M8:

- **A setting Kea will not start with is warned about, not refused.** The
  rule comes from measurements of one Kea version. A refusal would block a
  file that another build or a later version accepts, and would break the
  rule that a file Kea accepts can always be saved again.
- **No check of the Kea version.** The application is for OpenWrt 25.12,
  which has Kea 3. The on-target tests save such a file with the Kea of the
  target; if a later Kea refuses it in its own check, that test fails and
  says the warning is no longer needed.
- **The form offers the system log and the standard output, no log file.**
  A log file is the one output that silently loses messages on OpenWrt.
- **dnsmasq and odhcpd stay in the table of potential conflicts** when they
  no longer answer DHCP. The table now says what they serve; leaving them
  out would hide the buttons that a user moving back from Kea needs.

Taken while implementing M7:

- **The target tests run for every pull request**, not only for `main`. A
  change is then tested on a real system before it is merged, which is the
  point of having them in CI. The job takes a few minutes and costs
  nothing for a public repository. Running it for `main` only would be one
  `if:` on the job.
- **The Kea packages are not cached in CI.** Each run installs them from the
  OpenWrt package repository, as a router would that day, so a change there
  is noticed. The price is a job that can fail when the download fails;
  downloads are tried again.
- **The release workflow makes a draft.** The owner reads it and publishes
  it; nothing becomes public from a pushed tag alone. A 0.x version is
  marked as a pre-release.
- **The repository is the feed.** The package moved into `luci-app-kea/`
  instead of a second repository being kept in step with this one. It is
  also the layout of `openwrt/luci`.

Taken while implementing M6:

- **Leases come from the lease files, not from the control channel.** The
  OpenWrt Kea packages are built with the memfile backend only, so the
  files are where the leases are. Reading them needs no hook library, no
  control agent and no API password, changes nothing in the configuration,
  and works while the daemon is stopped. The format and the order in which
  Kea loads the files were taken from the Kea 3.0.4 sources and checked
  against files written for a real client. The price: the page cannot
  remove a lease, which would need the `lease_cmds` hook.
- **The log is the system log.** `logread` needs no knowledge of log file
  paths, and it also holds what a daemon says when it cannot start.
  Corrected on 2026-11-19: the reason first given here, that the
  configuration files shipped with Kea on OpenWrt log to syslog, was wrong.
  They name a log file in a directory that OpenWrt does not have, so with
  them the page shows little; see
  [STATUS.md](STATUS.md#leases-and-log) and M8.

Taken while implementing M5:

- **High availability is a tab of the editors, not a page.** The hook is
  configured per daemon, in the same file as the subnets, so DHCPv4 and
  DHCPv6 each have their own setup. As a tab it shares the save, apply and
  change view of the editor, and one save writes subnets and high
  availability together. The tab can also appear exactly when the roadmap
  asked for (hook installed, or an entry in the file), which a menu entry
  cannot: LuCI menu dependencies have no "or".
- **The DHCP daemons are checked with `-T`.** It is the only check that
  sees hook parameters. It costs nothing measurable on the stock and test
  configurations, and it works while a daemon with the same configuration
  is running.
- **A new setup uses the full path of the hook libraries**, as the examples
  in the configuration files shipped with Kea do. The backend reports the
  directory.

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
