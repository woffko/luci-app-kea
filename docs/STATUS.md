# Project Status

Status date: 2026-11-12. Package version `0.4.0-r1`, alpha.

This is a code-level inventory of what exists and what is missing. The work
needed to close the gaps is ordered in [ROADMAP.md](ROADMAP.md). Packaging
issues are listed separately in [PACKAGING.md](PACKAGING.md).

## Summary

| Area | State |
|------|-------|
| Package skeleton, menu, ACL | Done |
| rpcd backend (`luci.kea`, 14 methods) | Done, in ucode |
| Overview page | Done |
| Services page | Done |
| Raw configuration editor | Done, with backups and restore |
| DHCPv4 structured editor | Common settings; everything else in the file is preserved |
| DHCPv6 structured editor | Common settings; everything else in the file is preserved |
| Static lease import | Done for DHCPv4 and DHCPv6 |
| HA hook editor | Not started |
| Lease viewer | Not started |
| Backend semantic validation | Not started (only `kea-* -t`) |
| Automated tests | Unit tests (JavaScript and ucode), on-target tests, browser tests |
| CI | GitHub Actions: lint, unit tests, SDK package build |
| Releases, translations | Not started |

## Verification state

`0.4.0-r1` was built with the official OpenWrt 25.12.6 x86-64 SDK and
installed with `apk` on two machines running Kea 3.0.4 from the official
package repository (November 2026): an OpenWrt 25.12.6 x86-64 virtual machine
under QEMU, and an OpenWrt 25.12.5 x86-64 virtual machine under VMware. On
the first:

- all six pages open in a headless browser without JavaScript errors;
- the end-to-end browser test passes for DHCPv4 and DHCPv6: every save made
  by the editors is accepted by `kea-dhcp4 -t` / `kea-dhcp6 -t`, and only the
  edited values change in the file;
- the ucode tests pass, both for the repository copy of the library and for
  the installed one;
- **Save & Apply** was checked by hand with `kea-dhcp4` running (the daemon is
  restarted with the new configuration) and stopped (it stays stopped);
- the import browser test passes: a dual-stack static lease becomes a DHCPv4
  and a DHCPv6 reservation, both files are accepted by Kea, and a second
  import finds nothing to do.

On the second machine the ucode tests and all three browser tests pass, and
Save & Apply was checked with `kea-dhcp-ddns` running. That machine has a
static lease of its own, which the import test leaves alone.

Not exercised: DHCP clients actually obtaining leases, `kea-dhcp6` and the
DDNS daemon running, and upgrades from `0.1.0`.

The first runtime tests were made in May 2026 on OpenWrt 25.12.3 with
Kea 3.0.2.

## Implemented

### Backend

`root/usr/share/rpcd/ucode/luci.kea` is an rpcd ucode plugin. It only maps
the ubus methods below to the library in `ucode/kea/`, which is installed as
the `luci.kea.*` ucode modules:

| Module | Content |
|--------|---------|
| `config.uc` | Paths, validation with `kea-* -t`, read, save, backups, restore |
| `service.uc` | Component and service state from procd, init actions, runtime files |
| `importer.uc` | Static lease classification against the Kea configuration, and import |
| `jsonc.uc` | JSON with `//`, `#` and `/* */` comments |
| `net.uc` | IPv4 helpers |

| Method | ACL | Purpose |
|--------|-----|---------|
| `getStatus` | read | Init script state, binaries, hook libraries, config files, runtime paths, dnsmasq/odhcpd state |
| `getServices` | read | `config service` sections of `/etc/config/kea` with enabled and running flags |
| `getNetworkInterfaces` | read | Interfaces from `/etc/config/network` (name, device, proto, addresses) |
| `validate` | read | `kea-* -t` for the DHCPv4, DHCPv6, DDNS and control agent configs |
| `getConfigList` | read | The four Kea config files with size and presence |
| `getConfig` | read | File content, byte for byte, plus validation result |
| `listBackups` | read | Backups of one config file, newest first |
| `importDnsmasqDryRun` | read | What an import of the static leases in `/etc/config/dhcp` would do |
| `saveConfig` | write | Write to a temporary file, validate with the Kea binary, back up, replace |
| `restoreBackup` | write | Validate a backup, back up the current file, replace it |
| `setService` | write | Enable or disable a Kea component in UCI |
| `setInitAction` | write | `enable`, `disable`, `start`, `stop`, `restart`, `reload` for `/etc/init.d/kea` |
| `setConflictAction` | write | The same actions, restricted to `dnsmasq` and `odhcpd` |
| `importDnsmasqCommit` | write | Write the selected entries (or all ready ones) to `kea-dhcp4.conf` and `kea-dhcp6.conf` |

Backups are kept in `/etc/kea/backups/` as `<config>.<UTC timestamp>.conf`,
readable by root only. The ten newest per config file are kept. Every write
path (`saveConfig`, `restoreBackup`, `importDnsmasqCommit`) makes one.

Before `start`, `restart` and `reload` the backend creates `/var/run/kea`,
`/var/lib/kea` and, if missing, `/etc/kea/kea-api-password` with 24 random
bytes. It refuses the action if no random source is available.

Whether a component is running is taken from procd (`ubus call service
list`), by the instance names the Kea init script registers.

### Shared JavaScript modules: `htdocs/luci-static/resources/kea/`

- `model.js`: the Kea configuration model behind both structured editors. It
  keeps the original subnet objects and writes back only the values the user
  changed. No DOM or RPC code; unit-tested under Node.
- `backend.js`: the RPC calls shared by the configuration pages and the
  save-then-apply sequence.
- `editor.js`: the subnet editor page, instantiated for DHCPv4 and DHCPv6.

### Pages

- **Overview** (`overview.js`): runtime state, installed components and hooks,
  config file presence, validation output.
- **Services** (`services.js`): init service table with actions; Kea
  component table with staged enable/disable checkboxes committed by Save or
  Save & Apply; conflict table for dnsmasq and odhcpd with explicit actions.
- **DHCPv4** and **DHCPv6** (`dhcp4.js`, `dhcp6.js`): one tab per OpenWrt
  interface plus one per subnet that is not bound to an interface.
  - Fields: listen toggle, device, subnet, first address pool, first prefix
    delegation pool (DHCPv6), router and domain name (DHCPv4), DNS servers,
    domain search, timers and lifetimes.
  - Reservations by MAC address, client ID, DUID, circuit ID or flex ID
    (DHCPv4) and DUID, MAC address or flex ID (DHCPv6). A reservation that is
    not enabled is kept in the subnet's `user-context` and ignored by Kea.
  - A subnet can be removed with an explicit, confirmed action.
  - The example entries of the stock Kea config are announced and removed
    only on request.
  - **Save** writes the file. **Save & Apply** also reloads Kea if the daemon
    is running, and reports whether it is still running afterwards.
- **Configuration** (`configuration.js`): raw editor for `kea-dhcp4.conf`,
  `kea-dhcp6.conf`, `kea-dhcp-ddns.conf` and `kea-ctrl-agent.conf` with
  validation output, the same Save / Save & Apply behavior, and restore from
  backup.
- **Import dnsmasq** (`import-dnsmasq.js`): one row per static lease and
  protocol with its state and the reasons, checkboxes to choose what to
  import, and a confirmed import.

### What a save from the structured editors preserves

The editors show a few settings of each subnet. On save, everything else is
written back as it was:

- additional pools and prefix delegation pools, and extra keys of the first;
- options the form does not show, and extra fields (`always-send`,
  `csv-format`, `space`) of the ones it does;
- `relay`, `client-classes`, `user-context` and any other subnet key;
- reservation fields the form does not show (`option-data`, `next-server`,
  `boot-file-name`, `client-classes`);
- subnets inside `shared-networks`, and all top-level keys;
- entries of `interfaces-config.interfaces` for devices that have no tab,
  including `*` and the `device/address` form;
- the formatting of values that were not edited.

A save without edits writes nothing. New subnets get the lowest ID that no
subnet or shared network uses.

### Import

- Source: the `config host` sections of `/etc/config/dhcp`. One section
  yields a DHCPv4 entry (`mac`, `ip`) and a DHCPv6 entry (`duid`, `hostid`),
  as in OpenWrt.
- Each entry is compared with the Kea subnets and reservations and gets a
  state: ready, needs review, changes Kea, already in Kea, or cannot import
  with the reason. [DESIGN.md](DESIGN.md#static-lease-import) lists them.
- The IPv6 token (`hostid`) is combined with the prefix of the DHCPv6
  subnet. DUIDs are accepted in the OpenWrt hex notation, with or without an
  IAID.
- The user chooses what to import. Both files are validated before either is
  replaced, and each replaced file is backed up.
- A disabled static lease is imported as a disabled reservation.
- Nothing is kept between runs; imported leases are recognized in Kea, so a
  second import changes nothing.

### Tests

| Test | Runs on | Covers |
|------|---------|--------|
| `node --test "test/js/*.test.js"` | Any machine with Node.js | The configuration model: 30 cases, plus the stock Kea configs when `KEA_STOCK_DIR` is set |
| `test/run-ucode-tests.sh` | Any machine with a ucode interpreter | The backend library with a stand-in for the Kea binary: comment stripping, JSON writing, IPv4 and IPv6 helpers, save, backups, restore, retention, import classification and commit (60 cases) |
| `test/run-ucode-tests.sh --target` | OpenWrt with the Kea daemons | The same plus 21 cases with the real Kea binaries, UCI and procd: validation, service state, init actions, API password, import from a UCI fixture. Uses a temporary root |
| `test/browser/smoke.js` | Node.js + Playwright against a target | Every page renders without JavaScript errors |
| `test/browser/editor.js` | Node.js + Playwright against a test target | Editors, raw editor, backups and example removal end to end, with Kea validating every save |
| `test/browser/import.js` | Node.js + Playwright against a test target that has the fixture static leases | The import page end to end for both protocols, including a second import |

## Known defects and limits

### Structured editors

- Only the first pool and the first prefix delegation pool of a subnet can be
  edited. The others are preserved but not shown.
- Subnets inside `shared-networks` are preserved but not shown.
- Global options, option definitions, client classes and lease database
  settings can only be edited on the Configuration page.
- Saving removes JSON comments, because the file is re-serialized. The page
  says so when the file has comments.
- No browser-side validation of addresses, MAC addresses, DUIDs or CIDR
  values. Mistakes surface as `kea-* -t` output.
- A DHCPv6 subnet without an `interface` is matched to an interface tab only
  when Kea listens on exactly one interface.

### Backend

- `kea-* -t` accepts configurations that the daemon then refuses to start
  with. Save & Apply reports a daemon that is gone after the reload, but
  nothing warns before.
- The plugin runs inside `rpcd`, so a call blocks other LuCI requests for
  the second or two that `kea-* -t` or an init action takes. `luci-base`
  runs init actions the same way.
- Backend error messages and import warnings are English only.
- Files named `*.bak.luci` and `*.bak.import` left by `0.1.0` are not listed
  as backups and are not cleaned up.

### Import

- Only top-level subnets are considered; subnets inside `shared-networks`
  are not.
- A host with several MAC addresses or DUIDs cannot be imported
  automatically.
- Per-host lease times, dnsmasq tags and the hosts file flag are not carried
  over.
- The import rewrites the Kea file as plain JSON and removes comments. The
  page says so when the file has comments.
- The import does not reload Kea.
- `/etc/kea/luci-reservations.json`, written by versions before `0.4.0`, is
  no longer read or written. It can be deleted.

## Not implemented

- HA hook editor (only detection of `libdhcp_ha.so` exists).
- Lease viewer through the control agent or `lease_cmds` hook.
- Backend semantic checks: subnet overlap, pool inside subnet, reservation
  inside subnet, duplicate reservations, HA peer URLs.
- Diff preview before saving.
- Browser tests and on-target tests in CI (they need a running OpenWrt).
- Translations (only the template exists), releases, prebuilt packages.
