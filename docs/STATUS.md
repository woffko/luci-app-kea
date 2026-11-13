# Project Status

Status date: 2026-11-13. Package version `0.6.0-r1`, alpha.

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
| Raw configuration editor | Done, with syntax check, change view, backups and restore |
| DHCPv4 structured editor | Subnets, pools, options, reservations, global settings; everything else in the file is preserved |
| DHCPv6 structured editor | The same, plus prefix delegation pools |
| Static lease import | Done for DHCPv4 and DHCPv6 |
| High availability | Done for one relationship, as a tab of the DHCPv4 and DHCPv6 editors |
| Lease viewer | Not started |
| Input checks | In the browser, for what the editors write; the Kea binary on every save, with hooks loaded for the DHCP daemons |
| Automated tests | Unit tests (JavaScript and ucode), on-target tests, browser tests |
| CI | GitHub Actions: lint, unit tests, SDK package build |
| Releases, translations | Not started |

## Verification state

`0.6.0-r1` was built with the official OpenWrt 25.12.6 x86-64 SDK and
installed with `apk` on two machines running Kea 3.0.4 from the official
package repository (November 2026): an OpenWrt 25.12.6 x86-64 virtual machine
under QEMU, and an OpenWrt 25.12.5 x86-64 virtual machine under VMware. On
the first:

- all six pages open in a headless browser without JavaScript errors;
- the end-to-end browser test passes for DHCPv4 and DHCPv6 (33 checks):
  every save made by the editors is accepted by `kea-dhcp4 -T` /
  `kea-dhcp6 -T`, only the edited values change in the file, and a wrong
  value is marked in the form and not saved;
- the high availability browser test passes for both families (16 checks):
  hot standby and load balancing setups made on the tab are accepted by Kea
  with the hook loaded, and a parameter the hook refuses is reported with
  the hook's reason;
- **Save & Apply** of a hot standby setup made on the tab, with `kea-dhcp4`
  running: the daemon restarts, starts its high availability service as
  primary and listens on the URL of this server;
- the ucode tests pass, both for the repository copy of the library and for
  the installed one;
- **Save & Apply** was checked by hand with `kea-dhcp4` running (the daemon is
  restarted with the new configuration) and stopped (it stays stopped);
- the import browser test passes: a dual-stack static lease becomes a DHCPv4
  and a DHCPv6 reservation, both files are accepted by Kea, and a second
  import finds nothing to do.

On the second machine the ucode tests and all four browser tests pass with
`0.6.0-r1`; Save & Apply was checked there with `kea-dhcp-ddns` running, on
`0.3.0`. That machine has a static lease of its own, which the import test
leaves alone.

Not exercised: DHCP clients actually obtaining leases, two Kea servers
exchanging leases, `kea-dhcp6` and the DDNS daemon running, and upgrades
from `0.1.0`.

The first runtime tests were made in May 2026 on OpenWrt 25.12.3 with
Kea 3.0.2.

## Implemented

### Backend

`root/usr/share/rpcd/ucode/luci.kea` is an rpcd ucode plugin. It only maps
the ubus methods below to the library in `ucode/kea/`, which is installed as
the `luci.kea.*` ucode modules:

| Module | Content |
|--------|---------|
| `config.uc` | Paths, validation with the Kea binary, read, save, backups, restore |
| `service.uc` | Component and service state from procd, init actions, runtime files |
| `importer.uc` | Static lease classification against the Kea configuration, and import |
| `jsonc.uc` | JSON with `//`, `#` and `/* */` comments |
| `net.uc` | IPv4 helpers |

| Method | ACL | Purpose |
|--------|-----|---------|
| `getStatus` | read | Init script state, binaries, hook libraries, config files, runtime paths, dnsmasq/odhcpd state |
| `getServices` | read | `config service` sections of `/etc/config/kea` with enabled and running flags |
| `getNetworkInterfaces` | read | Interfaces from `/etc/config/network` (name, device, proto, addresses) and whether OpenWrt serves DHCPv4 or DHCPv6 on each, from `/etc/config/dhcp` |
| `validate` | read | The Kea binary's own check of the DHCPv4, DHCPv6, DDNS and control agent configs |
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

A file is checked by the daemon it belongs to. `kea-dhcp4` and `kea-dhcp6`
are asked with `-T`, which also loads the hook libraries and lets them check
their parameters; `-t` accepts any hook parameters. `kea-dhcp-ddns` and
`kea-ctrl-agent` only have `-t`, and so does a DHCP binary that answers `-T`
with its usage text. When a file is refused, the error lines of the Kea
output are put first: a hook reports its own reason, and Kea then only says
that a hook failed to load.

### Shared JavaScript modules: `htdocs/luci-static/resources/kea/`

- `model.js`: the Kea configuration model behind both structured editors. It
  keeps the original objects and writes back only the values the user
  changed, checks what the user typed, and compares two texts line by line.
  No DOM or RPC code; unit-tested under Node.
- `backend.js`: the RPC calls shared by the configuration pages and the
  save-then-apply sequence.
- `ha.js`: the model of the high availability hook settings, with the
  checks the hook makes. No DOM or RPC code; unit-tested under Node.
- `hatab.js`: the high availability tab.
- `widgets.js`: the form elements the tabs are built from.
- `dialogs.js`: the confirmation dialog and the view of pending changes.
- `editor.js`: the editor page, instantiated for DHCPv4 and DHCPv6.

### Pages

- **Overview** (`overview.js`): runtime state, installed components and hooks,
  config file presence, validation output.
- **Services** (`services.js`): init service table with actions; Kea
  component table with staged enable/disable checkboxes committed by Save or
  Save & Apply; conflict table for dnsmasq and odhcpd with explicit actions.
- **DHCPv4** and **DHCPv6** (`dhcp4.js`, `dhcp6.js`): one tab per OpenWrt
  interface, one per subnet that is not bound to an interface, one per
  subnet of a shared network, and one for the global settings.
  - Subnet fields: listen toggle, device, subnet, router and domain name
    (DHCPv4), DNS servers, domain search, timers and lifetimes.
  - Every address pool of the subnet, and every prefix delegation pool
    (DHCPv6), as a row that can be changed, added or deleted.
  - Every other option of the subnet as a row with a name or code and a
    value.
  - Reservations by MAC address, client ID, DUID, circuit ID or flex ID
    (DHCPv4) and DUID, MAC address or flex ID (DHCPv6). A reservation that is
    not enabled is kept in the subnet's `user-context` and ignored by Kea.
  - Global settings: timers and lifetimes, the lease file cleanup interval,
    and the options sent to every subnet.
  - High availability, on a tab that is offered when `kea-hook-ha` is
    installed or the file already loads the hook: mode, the name of this
    server, the peers with URL, role and automatic failover, timers, lease
    update switches, and every other parameter of the hook as JSON text.
    Switching it on also loads the lease commands hook, which the servers
    need to exchange leases.
  - A value Kea would refuse is marked while it is typed, with the reason,
    and reported by field on save. See
    [What the editors check](#what-the-editors-check).
  - A warning on the tab of an interface on which OpenWrt also serves DHCP
    while dnsmasq or odhcpd runs.
  - **Show changes** lists the lines of the file a save would change.
  - A subnet can be removed with an explicit, confirmed action.
  - The example entries of the stock Kea config are announced and removed
    only on request.
  - **Save** writes the file. **Save & Apply** also reloads Kea if the daemon
    is running, and reports whether it is still running afterwards. When Kea
    refuses the file, the form keeps what was typed.
- **Configuration** (`configuration.js`): raw editor for `kea-dhcp4.conf`,
  `kea-dhcp6.conf`, `kea-dhcp-ddns.conf` and `kea-ctrl-agent.conf` with
  validation output, the same Save / Save & Apply behavior, and restore from
  backup. A JSON syntax error is shown while typing and such a text is not
  sent to the router; **Show changes** lists the changed lines.
- **Import dnsmasq** (`import-dnsmasq.js`): one row per static lease and
  protocol with its state and the reasons, checkboxes to choose what to
  import, and a confirmed import.

### What a save from the structured editors preserves

The editors show part of the configuration. On save, everything else is
written back as it was:

- extra keys of a pool or prefix delegation pool (`option-data`,
  `client-classes`, `excluded-prefix`);
- extra fields of an option (`always-send`, `csv-format`, `space`);
- `relay`, `client-classes`, `user-context` and any other subnet key;
- reservation fields the form does not show (`option-data`, `next-server`,
  `boot-file-name`, `client-classes`, `user-context`);
- the other keys of a shared network, and all top-level keys;
- entries of `interfaces-config.interfaces` for devices that have no tab,
  including `*` and the `device/address` form;
- the formatting of values that were not edited.

A save without edits writes nothing. New subnets get the lowest ID that no
subnet or shared network uses.

### What the editors check

The checks follow what Kea 3.0.4 accepts and refuses, measured with
`kea-dhcp4 -t` and `kea-dhcp6 -t`. Only values the user changed are checked,
so a file Kea already accepts can always be saved again.

- Subnet: a prefix of the right family; not the same prefix as another
  subnet of the file. Overlapping subnets are allowed, as in Kea.
- Pool: a range or prefix inside the subnet, first address not after the
  last, no overlap with another pool of the subnet.
- Prefix delegation pool: an IPv6 prefix, lengths in range, delegated length
  not shorter than the prefix length.
- Reservation: an identifier in the form Kea takes for its type (MAC address
  with colons, hexadecimal or quoted text for the others, a DUID of at least
  three octets); addresses inside the subnet; no identifier or address used
  by two enabled reservations of a subnet.
- Options: a name or a numeric code. Whether the name exists and the value
  fits is left to Kea, which knows the option definitions.
- Timers: whole numbers of seconds. Address lists: addresses of the right
  family.
- Changing the subnet prefix checks all its pools and reservations again.
- High availability, when anything on its tab changed: a known mode; the
  name of this server among the peers; unique peer names; peer URLs with an
  IP address, and `https` only with the TLS parameters; one primary server,
  and the roles the mode takes (one standby for hot standby, one secondary
  for load balancing, only backups for passive backup); whole numbers for
  the timers; a JSON object for the additional parameters.

Every save still goes through the Kea binary on the router, which has the
last word.

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
| `node --test "test/js/*.test.js"` | Any machine with Node.js | The configuration model (47 cases, plus the stock Kea configs when `KEA_STOCK_DIR` is set) and the high availability model (20 cases) |
| `test/run-ucode-tests.sh` | Any machine with a ucode interpreter | The backend library with a stand-in for the Kea binary: comment stripping, JSON writing, IPv4 and IPv6 helpers, save, backups, restore, retention, how the Kea binary is called and its refusal reported, import classification and commit (63 cases) |
| `test/run-ucode-tests.sh --target` | OpenWrt with the Kea daemons | The same plus 22 cases with the real Kea binaries, UCI and procd: validation, a hook checking its parameters (needs `kea-hook-ha`), service state, init actions, API password, import from a UCI fixture. Uses a temporary root |
| `test/browser/smoke.js` | Node.js + Playwright against a target | Every page renders without JavaScript errors |
| `test/browser/editor.js` | Node.js + Playwright against a test target | Editors (pools, options, global settings, shared networks, input checks, change view), raw editor, backups and example removal end to end, with Kea validating every save |
| `test/browser/ha.js` | Node.js + Playwright against a test target that has `kea-hook-ha` | The high availability tab end to end for both protocols, with Kea loading the hook on every save |
| `test/browser/import.js` | Node.js + Playwright against a test target that has the fixture static leases | The import page end to end for both protocols, including a second import |

## Known defects and limits

### Structured editors

- Shared networks cannot be created, renamed or removed, and a subnet
  cannot be moved into one; their subnets are edited where they are.
- Option definitions, client classes, hook libraries, loggers and the lease
  database other than its cleanup interval can only be edited on the
  Configuration page.
- The options and `user-context` of a reservation, and the extra keys of a
  pool, are preserved but can only be edited on the Configuration page.
- Option values are not checked in the browser; a wrong one surfaces as
  output of the Kea binary.
- Saving removes JSON comments, because the file is re-serialized. The page
  says so when the file has comments.
- A DHCPv6 subnet without an `interface` is matched to an interface tab only
  when Kea listens on exactly one interface.
- The warning about a second DHCP server looks at the OpenWrt configuration
  of the interface and at whether dnsmasq or odhcpd runs. It does not see a
  DHCP server elsewhere on the network.

### High availability

- The form edits one relationship. A file with several (hub and spoke) is
  left to the Configuration page; the tab says so.
- TLS and basic authentication parameters have no fields. Those of the
  relationship are edited as JSON text; those of a peer are preserved and
  edited on the Configuration page.
- The tab shows the configuration, not the state of the running service:
  whether the partner is reachable is in the system log.
- Both routers are configured separately. The peer list has to be typed on
  each, with the other name as this server.
- The address of a peer URL must be reachable from the partner, so the
  firewall has to let the port through where the servers are not on the same
  LAN zone.
- No fill-in from `ha-cluster`: the OpenWrt 25.12 repositories have no such
  package to test against.

### Backend

- The Kea binary's check does not guarantee that the daemon starts: a port
  in use or a missing interface shows only then. Save & Apply reports a
  daemon that is gone after the reload, but nothing warns before.
- `kea-dhcp-ddns` and `kea-ctrl-agent` have no check that loads their hook
  libraries.
- The plugin runs inside `rpcd`, so a call blocks other LuCI requests for
  the second or two that the Kea binary or an init action takes. `luci-base`
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

- Lease viewer through the control agent or `lease_cmds` hook.
- Browser tests and on-target tests in CI (they need a running OpenWrt).
- Translations (only the template exists), releases, prebuilt packages.
