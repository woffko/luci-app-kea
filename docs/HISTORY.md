# History

A condensed development log. It replaces the working notes that were kept in
`LUCI_APP_KEA.md` (still available in the git history up to commit `b6eedcf`).

Section dates are the days the work was done, taken from those notes. Work was
often committed later; the [commit table](#commits) shows where each part
landed.

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
