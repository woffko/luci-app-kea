# Project Status

Status date: 2026-11-11. Revision reviewed: `b6eedcf` (package version
`0.1.0-r1`, alpha).

This is a code-level inventory of what exists and what is missing. The work
needed to close the gaps is ordered in [ROADMAP.md](ROADMAP.md). Packaging
issues are listed separately in [PACKAGING.md](PACKAGING.md).

## Summary

| Area | State |
|------|-------|
| Package skeleton, menu, ACL | Done, with packaging defects |
| rpcd backend (`luci.kea`, 12 methods) | Done as a single shell script |
| Overview page | Done |
| Services page | Done |
| Raw configuration editor | Done, basic |
| DHCPv4 structured editor | Partial, drops unknown subnet settings on save |
| DHCPv6 structured editor | Partial, drops unknown subnet settings on save |
| dnsmasq static lease import | Partial, DHCPv4 only |
| HA hook editor | Not started |
| Lease viewer | Not started |
| Backend semantic validation | Not started (only `kea-* -t`) |
| Automated tests | One fixture test, OpenWrt only |
| CI, releases, translations | Not started |

## Verification state

- Last runtime test: May 2026, OpenWrt 25.12.3 x86_64 VM, Kea 3.0.2, package
  built in an OpenWrt 25.12.3 tree and installed with `apk`.
- That build tree no longer exists, and the build was not repeated in this
  review.
- The current OpenWrt 25.12.6 packages feed ships Kea 3.0.4. Nothing has been
  tested against it.
- The DHCPv6 page was never visually checked in a browser.
- Checked in this review: `node --check` on all views, `sh -n` on the shell
  scripts, JSON syntax of the menu and ACL files, and the package metadata dump
  described in [PACKAGING.md](PACKAGING.md).

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
| `getConfig` | read | File content plus validation result |
| `importDnsmasqDryRun` | read | Preview of `config host` entries from `/etc/config/dhcp` |
| `saveConfig` | write | Write to a temporary file, validate with the Kea binary, back up, replace |
| `setService` | write | Enable or disable a Kea component in UCI |
| `setInitAction` | write | `enable`, `disable`, `start`, `stop`, `restart`, `reload` for `/etc/init.d/kea` |
| `setConflictAction` | write | The same actions, restricted to `dnsmasq` and `odhcpd` |
| `importDnsmasqCommit` | write | Stage all entries, merge ready DHCPv4 entries into `kea-dhcp4.conf` |

Before `start`, `restart` and `reload` the backend creates `/var/run/kea`,
`/var/lib/kea` and, if missing, `/etc/kea/kea-api-password`.

`root/usr/share/luci/kea/importer.uc` is a ucode helper used only by
`importDnsmasqCommit`.

### Pages

- **Overview** (`overview.js`): runtime state, installed components and hooks,
  config file presence, validation output.
- **Services** (`services-control.js`): init service table with actions; Kea
  component table with staged enable/disable checkboxes committed by Save or
  Save & Apply; conflict table for dnsmasq and odhcpd with explicit actions.
  Save & Apply restarts Kea only if a component was already running.
- **DHCPv4** (`dhcp4-clean-save.js`): one tab per OpenWrt interface; listen
  toggle, device, subnet, one address pool, router, DNS servers, domain name,
  domain search, renew/rebind/valid timers; reservations by MAC address.
  Subnets without an `interface` are matched to an interface by network.
- **DHCPv6** (`dhcp6-clean-save.js`): the same model with one address pool, one
  prefix delegation pool, DNS servers, domain search, four timers; reservations
  by DUID, MAC address, client ID or flex ID with address and prefix lists.
- **Configuration** (`configuration.js`): raw editor for `kea-dhcp4.conf`,
  `kea-dhcp6.conf`, `kea-dhcp-ddns.conf` and `kea-ctrl-agent.conf` with
  validation output.
- **Import dnsmasq** (`import-dnsmasq-commit.js`): preview table with status
  and warnings, and an import button.

### Import

- The preview classifies each host entry as `ready` or `disabled` and lists the
  reasons: missing or invalid MAC, missing or invalid IPv4 address, several MAC
  addresses, missing or truncated DUID, `hostid` without prefix resolution,
  `tag`, `match_tag`, `networkid`, `dns`, disabled source entry.
- The commit writes every entry to `/etc/kea/luci-reservations.json`, merges
  ready DHCPv4 entries into the Kea subnet that contains the address, validates
  the result with `kea-dhcp4 -t`, and keeps `kea-dhcp4.conf.bak.import`.
  Re-importing updates an existing reservation with the same MAC or IP.

### Tests

`test/run-import-fixture.sh` runs `importDnsmasqDryRun` against
`test/fixtures/dhcp-static-leases.uci` and checks five cases. It needs `uci`,
`jshn` and `/lib/functions.sh`, so it runs only on OpenWrt.

## Known defects

Ordered by impact. Each has a roadmap item.

### Configuration loss in the structured editors

`buildConfig()` in both editors rebuilds every subnet from the form fields and
replaces `subnet4` / `subnet6` entirely. On save:

1. Subnet settings the form does not show are removed: additional pools and
   prefix delegation pools, other `option-data` entries, `relay`,
   `client-class`, `user-context`, extra reservation fields, and anything else.
   Only top-level `Dhcp4` / `Dhcp6` keys are preserved.
2. A reservation with **Enabled** unchecked is removed from the Kea config and
   stored nowhere. It is gone after the page reloads.
3. A DHCPv4 reservation identified by anything other than `hw-address` loads
   with an empty MAC field and blocks saving.
4. Subnets in documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`,
   `203.0.113.0/24`, `2001:db8::/32`) without an interface are removed without
   notice, together with known sample options and the `voip` client class.
5. JSON comments are removed, because the file is re-serialized.
6. New subnet IDs are assigned by position (`subnets.length + 1`) and can
   collide with an existing ID. Kea then rejects the config.

### Other backend and UI defects

- Saving in the structured or raw editors does not reload Kea. The change takes
  effect only after a manual reload or restart on the Services page.
- A single backup generation (`*.bak.luci`, `*.bak.import`) with no restore
  action.
- `random_secret()` falls back to `date` plus the process ID when neither
  `openssl` nor `hexdump` is available, which would create a guessable Kea API
  password.
- The backend reads a missing `disabled` option as disabled; `/etc/init.d/kea`
  reads it as enabled. A service section without the option is started by init
  but shown as disabled.
- Running state is detected with `pgrep -f` instead of the procd service state.
- `validate` skips the control agent config.
- The DHCP pages show both the LuCI footer buttons and their own Save/Reload
  buttons.
- No browser-side validation of addresses, MAC addresses, DUIDs or CIDR
  values. Errors surface only as `kea-* -t` output.

### Import gaps

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
- Global options, option definitions, client classes, lease database settings.
- Backend semantic checks: subnet overlap, pool inside subnet, reservation
  inside subnet, duplicate reservations, HA peer URLs.
- Backup history, restore, diff preview.
- RPC tests, importer commit tests, browser tests, CI.
- Translation template, releases, prebuilt packages.
