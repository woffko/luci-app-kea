# History

A condensed development log. It replaces the working notes that were kept in
`LUCI_APP_KEA.md` (still available in the git history up to commit `b6eedcf`).

Section dates are the days the work was done, taken from those notes. Work was
often committed later; the [commit table](#commits) shows where each part
landed.

## 2026-11-21: The server identifier of DHCPv6, measured

No change to the package. The owner agreed to a fixed identifier "if that
is a problem at all", so it was measured first.

- 22 boots with `kea-dhcp6` enabled, 12 of them with `kea-dhcp4` as well:
  it started every time, and had a new identifier every time. The boot of
  the day before, in which it did not start because it could not make an
  identifier, did not happen again.
- A real client on a pair of virtual interfaces, lifetimes of seconds, and
  a server that lost its lease file and identifier: the renewals at 15
  seconds were not answered, the rebind at 30 seconds was, and the client
  kept its address. With a fixed identifier the renewal at 15 seconds was
  answered.
- Conclusion: a later renewal, no loss. The item is set aside in the
  roadmap, and the README no longer presents it as something to do before
  use.
- From the `ha-cluster` project: it now writes the firewall rule for the
  ports of the pair itself, reading them from the Kea files, and asks that
  it be reloaded after the URLs change.

## 2026-11-21: Release `v0.9.0`

- The owner merged the M9 pull request and pushed the tag `v0.9.0`. It
  points at the last commit of that pull request, which is part of `main`
  and has the same content as its merge commit.
- The release workflow passed: the tag and the changelog fit the version,
  the tagged commit is on `main`, the three CI jobs, and the draft release
  with the package, its checksum and the changelog section.
- The attached `luci-app-kea-0.9.0-r1.apk` holds the same files as the
  package built and tested by hand the day before (compared with
  `apk adbdump`); the checksum in the release text is the one of the file.
- It was tested in QEMU by the workflow, not on the second test machine.

## 2026-11-20: Sockets at boot, the state of a daemon, peers from a cluster (M9, `0.9.0-r1`)

Approved by the owner after the findings of the same day.

- The DHCP pages write retries for the sockets when they make Kea listen on
  an interface; the Global settings tab has the two fields; a file that
  listens without retries is warned about.
- `getDaemonState`: the backend asks the running DHCP daemons for
  `status-get` over their control sockets, with the ucode socket module, a
  new dependency. Overview and Services show whether a daemon listens and
  the state of high availability.
- `getHaNodes` and the button **Fill in from ha-cluster**: the peers of the
  high availability tab from the nodes of a cluster.
- Measured again with DHCP of dnsmasq and odhcpd switched off on the LAN,
  because the first series was mixed up with dnsmasq holding port 67:
  without retries `kea-dhcp6` did not listen after any of four boots,
  `kea-dhcp4` after two of seven; with them both listened after four of
  four. A reload does not cure the state, a restart does.
- Seen for real through the pages: a daemon that does not listen, a pair of
  two Kea processes on one machine in hot standby, the pair while it
  synchronized, and the primary after its partner was stopped.
- Found on the way: the server identifier of DHCPv6 changes at every boot,
  and in one boot `kea-dhcp6` did not start because it could not make one.
  Written down in STATUS and proposed in the roadmap; not changed.
- The firewall rule for the ports of the pair is for `ha-cluster` to write,
  by the owner's word; passed on to that project.
- Tests: 100 ucode cases on any machine, 132 on a target, 80 JavaScript
  cases, six browser tests. The fixtures now carry the retries.

## 2026-11-20: Kea at boot, and a pair of Kea servers on another bench

No change to the package. The `ha-cluster` project, another project of the
owner, ran a pair of Kea 3.0.4 servers in hot standby next to VRRP and
passed on what it found.

- Reproduced on the test machine: Kea started at boot before the LAN
  bridge is ready runs without listening and stays that way; the two
  `service-sockets` parameters in `interfaces-config` cure it. In that state
  the application shows the daemon as running.
- Measured for this application: Kea accepts `<?include?>` for a part of the
  high availability settings, and the forms cannot open such a file; a
  SIGHUP makes a daemon read a file that was saved without applying, and
  with a file it cannot load it keeps its previous configuration.
- Taken as reported, not reproduced: the pair exchanged leases and a client
  kept its addresses through a stopped server, a cut-off node and a reboot;
  a Kea goes deaf when netifd creates its device anew, until it reads its
  configuration again.
- Written down: the limits in STATUS, a note in the README on what to add to
  `interfaces-config`, and a proposed roadmap milestone M9.

## 2026-11-20: Release `v0.8.0`, the first one the workflow prepared

- The owner merged the M8 pull request and pushed the tag `v0.8.0`. It
  points at the last commit of that pull request, which is part of `main`
  and has the same content as its merge commit.
- The release workflow ran for a real tag for the first time and passed:
  the tag fits the version in the Makefile, the tagged commit is on `main`,
  the three CI jobs, and the draft release with the package, its checksum,
  the changelog section and what it was tested on. The two steps that could
  not be rehearsed on a pull request, the check against `main` and the
  creation of the draft, worked.
- The attached `luci-app-kea-0.8.0-r1.apk` holds the same files as the
  package built and tested by hand the day before (compared with
  `apk adbdump`); the checksum in the release text is the one of the file.
- It was tested in QEMU by the workflow, not on the second test machine.

## 2026-11-19: Warnings beyond the Kea check (M8, `0.8.0-r1`)

The work proposed after the measurements of the same day, approved by the
owner.

- The rules were measured first, with Kea 3.0.4 on the QEMU machine. Kea
  compares the text before the last slash of a lease or log file name with
  its directory, so a subdirectory, `./` and a doubled slash are refused
  like `/tmp`. `kea-dhcp-ddns` and `kea-ctrl-agent` refuse a wrong log
  directory in their check, the DHCP daemons only when they start. Without
  loggers, and with the output `stdout`, every message reaches the system
  log through procd; with the files of the package, only what a daemon
  prints before it has read its loggers.
- Backend: `start_warnings()` and `log_outputs()` in `config.uc`; the
  warnings travel with the result of the check, with a file that is read and
  with a save; `getLog` also returns the log outputs. `openwrt.uc` reads
  what dnsmasq and odhcpd serve. `parse_log_line()` splits the lines that
  come through procd.
- Pages: the warning box, the question before a reload of a running daemon,
  the log file note on Overview, the Log Output field, and the "Configured
  to serve" column with the question before stopping dnsmasq or odhcpd.
- Checked by hand on the QEMU machine with `kea-dhcp4` running: with the
  answer no the daemon keeps running, with the answer yes it is gone after
  the reload.
- Tests: 88 ucode cases on any machine, 117 on a target, 72 JavaScript
  cases, and a sixth browser test, `warnings.js`, which answers the calls
  that would act on a service itself.
- Found on the way and written down, not changed: on a fresh installation
  the control agent file is reported as invalid until Kea was started once,
  because its password file does not exist yet.
- Not done: the names of Kea leases in the local DNS. `0.8.0-r1` was not
  installed on the second test machine.

## 2026-11-19: Lease and log paths of Kea 3, corrected documentation

Another project ran the release with a configuration it had generated and
reported that Kea did not start with a lease file in `/tmp`, although the
check had accepted the file. Measured again on the test machine with
Kea 3.0.4; no change to the package yet.

- A lease file outside `/var/lib/kea` and a log file outside `/var/log/kea`
  pass `-t` and `-T` and stop the daemon at start. A control socket or a
  hook library in a wrong directory is refused by the check.
- The configuration files shipped with Kea name a log file. `/var/log/kea`
  does not exist on OpenWrt, so their messages are lost, except the lines a
  daemon prints before it has read its loggers.
- Two statements in these documents were wrong and are corrected: that a
  configuration can name another place for the lease file, and that the
  shipped configurations log to syslog. The Overview picture shows a full
  log because its test configuration logged to syslog.
- Log lines that arrive through procd are shown without their severity
  split off.
- Proposed as roadmap milestone M8: warnings for such paths, the log
  destination on Overview, and a Services page that says what dnsmasq and
  odhcpd still serve.

## 2026-11-18: More pictures of the high availability tab

- Three pictures added to `docs/SCREENSHOTS.md`: load balancing with a
  backup server, input the form refuses, and the lines that switching high
  availability on adds to the file. The README shows the tab on its front
  page.
- `test/browser/screenshots.js` takes them, and accepts picture names to
  take only some.

## 2026-11-17: Target tests in CI, release from a tag, feed layout (M7)

No change to the package: the files of `0.7.0-r1` built after this work are
the same as those of the release.

- The package moved into the directory `luci-app-kea/`, the layout of an
  application in `openwrt/luci`. The repository now works as an OpenWrt
  feed. It did not before: tried in the SDK, the feed scripts ignore a
  package whose Makefile is at the root of the feed. CI builds from a
  `src-link` feed. `src-git` was tried by hand with the branch of this
  work; a tag is fetched the same way (tried with `v0.7.0`), but no tag has
  the new layout yet.
- `test/qemu-target.sh` boots the official OpenWrt image under QEMU and
  installs Kea and the package; `test/run-target-tests.sh` runs the
  on-target tests and the five browser tests against a target, with the
  fixtures loaded and removed. Both replace commands that were typed by
  hand before every release.
- A third CI job runs them for every pull request and for `main`. It took
  1 minute 44 seconds in its first run, with KVM on the GitHub runner, and
  6 minutes in a run the next day, in which the runner needed four and a
  half minutes to install QEMU and the browser. The machine and the tests
  took the same 80 seconds both times.
- `.github/workflows/release.yml` prepares a draft release from a version
  tag: it checks the tag against the Makefile and the changelog, runs the CI
  jobs on the tagged commit and attaches the package with its checksum.
  `tools/release-notes.sh` writes the text and runs in CI for every build.
- Playwright became a development dependency.
- `PKG_LICENSE_FILES` was dropped from the Makefile: the license text stays
  at the root of the repository.
- Not done: a signed package repository for `apk`, and a real DHCP client in
  the CI machine. The creation of the draft itself runs for the first time
  with the next tag; everything before it is rehearsed on pull requests that
  change the workflow.

## 2026-11-17: First release, `v0.7.0`

- Tag `v0.7.0` on `main` and a GitHub release, marked as a pre-release, with
  `luci-app-kea-0.7.0-r1.apk` from the CI run of the tagged commit.
- That file was installed on both test machines first and passed the
  on-target tests and the five browser tests.
- The README now sends users to the Releases page; the package CI builds
  from `main` is described as the development version.

## 2026-11-13: Changelog, version rules, installation from CI (M7, part)

- `CHANGELOG.md` with every version since `0.1.0-r1`, written for users of
  the package.
- `docs/RELEASING.md`: how versions are numbered, what stays stable within
  0.x, what to update with a version, and the steps of a release.
- The README explains how to install the package that CI builds.
- Open in M7, for the owner: tags and releases, tests on a target in CI, a
  custom feed, the submission to `openwrt/luci`.

## 2026-11-13: Runtime visibility (M6, `0.7.0-r1`)

- A Leases page: the DHCPv4 and DHCPv6 leases in use, read from the lease
  files of the memfile backend in the order Kea loads them. No hook library
  and no control channel is needed.
- Overview shows the Kea version and the last Kea messages of the system
  log, and folds the output of a successful configuration check.
- Two new read-only backend methods, `getLeases` and `getLog`.
- The lease file format was taken from the Kea 3.0.4 sources and checked
  with a DHCP client on a virtual interface pair: its DHCPv4 address, DHCPv6
  address and delegated prefix appeared on the page.
- Tests: 11 host cases and 3 on-target cases for the new module, a browser
  test of the page with a lease fixture.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-13: High availability (M5, `0.6.0-r1`)

- A "High availability" tab in the DHCPv4 and DHCPv6 editors, offered when
  `kea-hook-ha` is installed or the file already loads the hook: mode, this
  server, peers, timers, lease update switches, other parameters as JSON.
- The hook's rules were measured with about sixty configurations against
  `kea-dhcp4 -T` and `kea-dhcp6 -T` of Kea 3.0.4, and its fallback values
  taken from the Kea 3.0.4 sources.
- Finding: `kea-dhcp4 -t` does not look at hook parameters. The backend now
  checks the DHCP daemons with `-T`, which loads the hooks, and shows the
  error lines of the Kea output first.
- A save that Kea refuses no longer discards what the user typed, in the
  editors and in the raw editor.
- The form elements of the editor moved to `kea/widgets.js`.
- Tests: 20 cases for the high availability model, 16 browser checks of the
  tab, a backend case with the real hook.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4,
  including a daemon started with a setup made on the tab.

## 2026-11-12: Editor completeness (M4, `0.5.0-r1`)

- The DHCPv4 and DHCPv6 pages show every address pool and prefix delegation
  pool of a subnet as a row, and every option that has no field of its own.
  Until now the second pool of a subnet could not be seen or changed.
- Subnets inside shared networks have tabs and are edited where they are.
- A tab for the global settings: timers, lease file cleanup interval and
  global options.
- Input is checked in the browser against what Kea 3.0.4 was measured to
  refuse: pools and reserved addresses outside the subnet, overlapping
  pools, duplicate reservations, malformed identifiers, the same subnet
  twice. Wrong values are marked while typing. Only changed values are
  checked.
- A warning on an interface that OpenWrt already serves with dnsmasq or
  odhcpd; `getNetworkInterfaces` reports that per interface.
- **Show changes** in the editors and in the raw editor; the raw editor
  refuses text that is not JSON before sending it.
- One confirmation dialog for all pages (`kea/dialogs.js`).
- Tests: 47 model cases, 32 browser checks of the editors.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-12: Static lease import completed (M3, `0.4.0-r1`)

- The import reads static leases the way OpenWrt writes them: one host
  section yields a DHCPv4 entry (`mac`, `ip`) and a DHCPv6 entry (`duid`,
  `hostid`). Until now such a section was treated as DHCPv6 only and its
  DHCPv4 half was lost, and hex DUIDs without colons were rejected.
- Entries are compared with the Kea subnets and reservations: ready, needs
  review, changes Kea, already in Kea, or cannot import with the reason.
- DHCPv6 reservations are written to `kea-dhcp6.conf`; the IPv6 token is
  combined with the subnet prefix.
- Duplicate identifiers and addresses are detected.
- The user selects what to import. Both files are validated before either is
  replaced.
- No staging file: `/etc/kea/luci-reservations.json` is no longer read or
  written, and the package has no `conffiles` any more. A disabled static
  lease becomes a disabled reservation.
- The backend writes JSON in the same layout as the editors.
- Tests: 81 ucode cases (60 without a router), a browser test of the import.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-12: ucode backend, tests and CI (M2, `0.3.0-r1`)

- The shell rpcd plugin is replaced by an rpcd ucode plugin
  (`/usr/share/rpcd/ucode/luci.kea`) on top of a library in `ucode/kea/`.
  The ubus object, its 14 methods and their replies are unchanged; the pages
  and the ACL were not touched, and the browser tests written for `0.2.0`
  pass unmodified.
- Component and service state comes from procd instead of `pgrep`.
- `validate` covers the control agent config.
- `kea-lfc` is a dependency.
- `setService` creates a missing `/etc/config/kea` section instead of
  reporting success without writing.
- Interfaces configured with `ipaddr` plus `netmask` are reported in CIDR
  form, so their subnet is matched to the interface tab.
- Backups made within one second keep their order after older ones are
  pruned. The earlier numbering reused freed numbers.
- Tests: 44 ucode cases that run on any machine with a ucode interpreter and
  23 more that run on OpenWrt; they replace `run-backend-tests.sh` and
  `run-import-fixture.sh`.
- ESLint with the JavaScript rules of the LuCI repository; GitHub Actions CI
  with lint, unit tests and an SDK build.
- Verified on OpenWrt 25.12.6 with Kea 3.0.4, as an upgrade from `0.2.0-r1`.

## 2026-11-11: Configuration safety (M1, `0.2.0-r1`)

- New shared modules under `htdocs/luci-static/resources/kea/`: `model.js`
  (configuration model), `backend.js` (RPC and save/apply sequence),
  `editor.js` (subnet editor used by both DHCP pages).
- The structured editors merge changed values into the existing subnet
  instead of rebuilding it. Extra pools, options, relay settings, client
  classes, `user-context` and reservation fields survive a save.
- DHCPv4 reservations by client ID, DUID, circuit ID and flex ID. "Client ID"
  removed from the DHCPv6 identifier list: Kea rejects it.
- Disabled reservations are stored in the subnet's `user-context`.
- Stock example entries are no longer removed silently; the page announces
  them and removes them on request.
- Subnets can be removed explicitly. New subnets get an unused ID.
- Backups in `/etc/kea/backups/` (ten per file), `listBackups` and
  `restoreBackup`, restore control on the Configuration page.
- **Save & Apply** reloads a running daemon and reports its state. The pages'
  own Save/Reload buttons are gone.
- The API password is never generated from the clock; a service section
  without `disabled` is read as enabled, like the init script does.
- `getConfig` no longer drops the final newline; `#` comments are understood.
- Tests: unit tests for the model, backend tests, end-to-end browser test.
- Verified on OpenWrt 25.12.6 with Kea 3.0.4. Finding: the stock Kea configs
  need the `kea-lfc` package to start, although `kea-* -t` accepts them
  without it.

## 2026-11-11: Packaging hygiene (M0, `0.1.0-r2`)

- Makefile reports the project URL, maintainer and a description; redundant
  dependencies dropped; `conffiles` declared; full Apache-2.0 license text.
- Ten unused view files removed; the remaining six have stable names.
- Menu parent uses `firstchild`. ACL reduced to the `luci.kea` methods.
- Translation template `po/templates/kea.pot` and `tools/update-pot.sh`.
- `create-and-push-github-repo.sh` removed.
- `test/run-import-fixture.sh` fixed: it compared against compact JSON, which
  `jshn` does not produce, so it had never passed on OpenWrt.
- Added `test/browser/smoke.js`.
- Verified with the OpenWrt 25.12.6 SDK and an OpenWrt 25.12.6 virtual machine
  running Kea 3.0.4.

## 2026-11-11: Project review

- Reviewed the code, the packaging and the documentation at `b6eedcf`.
- Compared the package with `luci.mk` and the feed contribution rules from an
  OpenWrt 25.12.6 tree. Results in [PACKAGING.md](PACKAGING.md).
- Recorded the implemented features and defects in [STATUS.md](STATUS.md) and
  reordered the plan in [ROADMAP.md](ROADMAP.md).
- Split the documentation into status, packaging, roadmap, design and
  development files. No code changes.
- Owner decisions: the maintainer entry stays as it is for now; the project
  stays a standalone repository with a later submission to `openwrt/luci` as
  the goal.

## 2026-05-16: Services page and alpha README

- Component checkboxes on the Services page are staged in the browser and
  written only by Save or Save & Apply.
- Save & Apply restarts Kea only when a component was already running.
- `setInitAction start|restart|reload` prepares `/var/run/kea`,
  `/var/lib/kea` and `/etc/kea/kea-api-password` first. This fixed start
  failures such as `Unable to open '/var/lib/kea/kea-leases4.csv'` and
  `Expected a file at path '/etc/kea/kea-api-password'`.
- `getStatus` reports runtime prerequisites and the state of dnsmasq and
  odhcpd.
- Added `setConflictAction`, limited to dnsmasq and odhcpd, and a "Potential
  Conflicts" table. The application never stops those services on its own.

## 2026-05-14: DHCPv6 editor

- Structured DHCPv6 page: one tab per interface, subnet, address pool, prefix
  delegation pool, DNS servers, domain search, timers.
- Reservations by DUID, MAC address, client ID or flex ID, with address and
  prefix lists.
- The listen checkbox reflects `interfaces-config.interfaces`; a tab with
  settings but no listen flag is still saved as a subnet.
- Unbound sample subnets under `2001:db8::/32` are hidden from the tabs.

## 2026-05-13: DHCPv4 editor, services rework, import commit

- Structured DHCPv4 page modeled on the pfSense per-interface layout.
- Added `getNetworkInterfaces`.
- Subnets without an `interface` are matched to an OpenWrt interface by
  network; unmatched subnets get a tab named after their CIDR.
- Saving from the structured pages removes the stock Kea sample subnets,
  options and client class.
- The LuCI footer buttons are wired to the editor save and reload handlers.
- Services page rebuilt as an init service table plus a component table.
- Removed `String.format()` from the views while fixing a blank page, and
  fixed nested-array rendering in the services and import tables.
- `importDnsmasqCommit` implemented: all entries staged in
  `/etc/kea/luci-reservations.json`, ready DHCPv4 entries merged into the
  matching Kea subnet.
- Views were renamed several times to defeat browser caching while files were
  copied to the test target by hand. This left the unused copies listed in
  [PACKAGING.md](PACKAGING.md#unused-view-files).

## 2026-05-12: Raw configuration editor

- Configuration page with `getConfigList`, `getConfig` and `saveConfig`.
- Validation changed to `kea-* -t <config>` (it was `-t -c <config>`).
- The backend creates `/var/run/kea` before validating, so default configs
  validate on a clean install before any Kea service has started.
- Added `test/run-import-fixture.sh`.

## 2026-05-10: Initial skeleton

- Package Makefile, menu, ACL.
- rpcd backend with `getStatus`, `getServices`, `setService`, `setInitAction`,
  `validate`, `importDnsmasqDryRun`.
- Overview, Services and Import preview pages.
- Import fixtures: valid IPv4, missing MAC, DHCPv6 DUID, truncated DUID,
  dnsmasq-only tag and DNS flag.
- Finding: `kea-uci` models only service switches, so DHCP settings must be
  edited as Kea JSON. See [DESIGN.md](DESIGN.md).
- First build as `luci-app-kea-0.1.0-r1.apk` in an OpenWrt 25.12.3 x86_64
  tree, installed on a test VM with Kea 3.0.2.

## Commits

| Commit | Date | Content |
|--------|------|---------|
| `543e2cb` | 2026-05-10 | Initial skeleton |
| `3d90e18` | 2026-05-10 | GitHub publish helper script |
| `fff2fb5` | 2026-05-13 | DHCPv4 editor, raw configuration editor, import fixture test |
| `db75250` | 2026-05-13 | Services status page |
| `b0c64d2` | 2026-05-13 | `String.format()` removal |
| `b6eedcf` | 2026-05-16 | DHCPv6 editor, import commit, staged service toggles, conflict controls, alpha README |
