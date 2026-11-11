# Project Status

Status date: 2026-11-11. Package version `0.2.0-r1`, alpha.

This is a code-level inventory of what exists and what is missing. The work
needed to close the gaps is ordered in [ROADMAP.md](ROADMAP.md). Packaging
issues are listed separately in [PACKAGING.md](PACKAGING.md).

## Summary

| Area | State |
|------|-------|
| Package skeleton, menu, ACL | Done |
| rpcd backend (`luci.kea`, 14 methods) | Done as a single shell script |
| Overview page | Done |
| Services page | Done |
| Raw configuration editor | Done, with backups and restore |
| DHCPv4 structured editor | Common settings; everything else in the file is preserved |
| DHCPv6 structured editor | Common settings; everything else in the file is preserved |
| dnsmasq static lease import | Partial, DHCPv4 only |
| HA hook editor | Not started |
| Lease viewer | Not started |
| Backend semantic validation | Not started (only `kea-* -t`) |
| Automated tests | Unit tests, backend tests, browser tests; no CI yet |
| CI, releases, translations | Not started |

## Verification state

`0.2.0-r1` was built with the official OpenWrt 25.12.6 x86-64 SDK and
installed with `apk` on an OpenWrt 25.12.6 x86-64 virtual machine running
Kea 3.0.4 from the official package repository (November 2026). On that
machine:

- all six pages open in a headless browser without JavaScript errors;
- the end-to-end browser test passes for DHCPv4 and DHCPv6: every save made
  by the editors is accepted by `kea-dhcp4 -t` / `kea-dhcp6 -t`, and only the
  edited values change in the file;
- the backend tests and the import fixture test pass;
- **Save & Apply** was checked by hand with `kea-dhcp4` running (the daemon is
  restarted with the new configuration) and stopped (it stays stopped);
- the import commit was checked by hand against a config with several pools,
  options and shared networks.

Not exercised: DHCP clients actually obtaining leases, `kea-dhcp6` and the
DDNS daemon running, and upgrades from `0.1.0`.

The first runtime tests were made in May 2026 on OpenWrt 25.12.3 with
Kea 3.0.2.

## Implemented

### Backend: `root/usr/libexec/rpcd/luci.kea`

A POSIX shell rpcd plugin using `jshn` and `/lib/functions.sh`.

| Method | ACL | Purpose |
|--------|-----|---------|
| `getStatus` | read | Init script state, binaries, hook libraries, config files, runtime paths, dnsmasq/odhcpd state |
| `getServices` | read | `config service` sections of `/etc/config/kea` with enabled and running flags |
| `getNetworkInterfaces` | read | Interfaces from `/etc/config/network` (name, device, proto, addresses) |
| `validate` | read | `kea-* -t` for the DHCPv4, DHCPv6 and DDNS configs |
| `getConfigList` | read | The four Kea config files with size and presence |
| `getConfig` | read | File content, byte for byte, plus validation result |
| `listBackups` | read | Backups of one config file, newest first |
| `importDnsmasqDryRun` | read | Preview of `config host` entries from `/etc/config/dhcp` |
| `saveConfig` | write | Write to a temporary file, validate with the Kea binary, back up, replace |
| `restoreBackup` | write | Validate a backup, back up the current file, replace it |
| `setService` | write | Enable or disable a Kea component in UCI |
| `setInitAction` | write | `enable`, `disable`, `start`, `stop`, `restart`, `reload` for `/etc/init.d/kea` |
| `setConflictAction` | write | The same actions, restricted to `dnsmasq` and `odhcpd` |
| `importDnsmasqCommit` | write | Stage all entries, merge ready DHCPv4 entries into `kea-dhcp4.conf` |

Backups are kept in `/etc/kea/backups/` as `<config>.<UTC timestamp>.conf`,
readable by root only. The ten newest per config file are kept. Every write
path (`saveConfig`, `restoreBackup`, `importDnsmasqCommit`) makes one.

Before `start`, `restart` and `reload` the backend creates `/var/run/kea`,
`/var/lib/kea` and, if missing, `/etc/kea/kea-api-password` with 24 random
bytes. It refuses the action if no random source is available.

`root/usr/share/luci/kea/importer.uc` is a ucode helper used only by
`importDnsmasqCommit`.

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
- **Import dnsmasq** (`import-dnsmasq.js`): preview table with status and
  warnings, and an import button.

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

- The preview classifies each host entry as `ready` or `disabled` and lists the
  reasons: missing or invalid MAC, missing or invalid IPv4 address, several MAC
  addresses, missing or truncated DUID, `hostid` without prefix resolution,
  `tag`, `match_tag`, `networkid`, `dns`, disabled source entry.
- The commit writes every entry to `/etc/kea/luci-reservations.json`, merges
  ready DHCPv4 entries into the Kea subnet that contains the address, and
  validates the result with `kea-dhcp4 -t`. Re-importing updates an existing
  reservation with the same MAC or IP.

### Tests

| Test | Runs on | Covers |
|------|---------|--------|
| `node --test "test/js/*.test.js"` | Any machine with Node.js | The configuration model: 30 cases, plus the stock Kea configs when `KEA_STOCK_DIR` is set |
| `test/run-import-fixture.sh` | OpenWrt | `importDnsmasqDryRun` against `test/fixtures/dhcp-static-leases.uci` |
| `test/run-backend-tests.sh` | OpenWrt with `kea-dhcp-ddns` | Save, validation, backups, restore, retention, service state, API password; uses a temporary root |
| `test/browser/smoke.js` | Node.js + Playwright against a target | Every page renders without JavaScript errors |
| `test/browser/editor.js` | Node.js + Playwright against a test target | Editors, raw editor, backups and example removal end to end, with Kea validating every save |

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

- Running state is detected with `pgrep -f`, which matches any process whose
  command line contains the daemon path, not only the daemon.
- `kea-* -t` accepts configurations that the daemon then refuses to start
  with. The stock configs enable lease file cleanup (`lfc-interval`), and the
  DHCP daemons do not start unless the `kea-lfc` package is installed. Save &
  Apply reports a daemon that is gone after the reload, but nothing warns
  before.
- `validate` skips the control agent config.
- Backend error messages and import warnings are English only.
- Files named `*.bak.luci` and `*.bak.import` left by `0.1.0` are not listed
  as backups and are not cleaned up.

### Import

- DHCPv6 entries are previewed and staged but never written to Kea.
- The preview does not know about Kea subnets, so an address outside every
  subnet looks ready and is skipped only at commit.
- No duplicate MAC, DUID or address detection across entries.
- `valid_duid` accepts any value with two colons.
- The staging file is rewritten on every commit, and no page reads it.
- Entries cannot be edited before import.

## Not implemented

- HA hook editor (only detection of `libdhcp_ha.so` exists).
- Lease viewer through the control agent or `lease_cmds` hook.
- Backend semantic checks: subnet overlap, pool inside subnet, reservation
  inside subnet, duplicate reservations, HA peer URLs.
- Diff preview before saving.
- CI.
- Translations (only the template exists), releases, prebuilt packages.
