# Kea LuCI App TODO

Date: 2026-05-10

Goal: build a full LuCI application for ISC Kea on OpenWrt. The app should
cover the same runtime/service controls currently exposed through `kea-uci`,
provide practical editors for Kea DHCPv4/DHCPv6 configuration, support Kea HA
hook settings when the HA hook is installed, and import static dnsmasq leases
with safe validation.

## Implementation Start

Initial package skeleton has been started under `package/luci-app-kea`:

- OpenWrt package metadata: `package/luci-app-kea/Makefile`.
- LuCI menu and rpcd ACL files.
- rpcd backend skeleton `luci.kea` with status, service controls, config validation, and dnsmasq static lease dry-run import.
- LuCI pages for overview, services, and dnsmasq static lease import preview.
- First import fixtures covering valid IPv4, invalid IPv4, valid DHCPv6 DUID, truncated DHCPv6 identity, and dnsmasq-only tag/DNS behavior.

## Current OpenWrt Kea Packages

The OpenWrt packages feed contains Kea in:

```text
feeds/packages/net/kea
```

Available packages in the current 25.12.3 tree:

```text
kea-dhcp4
kea-dhcp6
kea-dhcp-ddns
kea-ctrl
kea-admin
kea-hook-ha
kea-hook-lease-cmds
kea-lfc
kea-perfdhcp
kea-shell
kea-uci
kea-libs
```

`kea-uci` provides `/etc/config/kea` and a procd init script, but there is no
LuCI application in the current feeds.

## Proposed Package

Package name:

```text
luci-app-kea
```

Suggested location during development:

```text
package/luci-app-kea
```

or, if it is meant to live in a feed:

```text
<feed>/luci-app-kea
```

Expected package layout:

```text
luci-app-kea/
  Makefile
  htdocs/luci-static/resources/view/kea/overview.js
  htdocs/luci-static/resources/view/kea/services.js
  htdocs/luci-static/resources/view/kea/dhcp4.js
  htdocs/luci-static/resources/view/kea/dhcp6.js
  htdocs/luci-static/resources/view/kea/reservations.js
  htdocs/luci-static/resources/view/kea/ha.js
  htdocs/luci-static/resources/view/kea/import-dnsmasq.js
  htdocs/luci-static/resources/view/kea/raw.js
  root/usr/share/luci/menu.d/luci-app-kea.json
  root/usr/share/rpcd/acl.d/luci-app-kea.json
  root/usr/libexec/rpcd/luci.kea
  root/usr/share/luci/kea/importer.uc
  root/usr/share/luci/kea/validator.uc
  root/usr/share/luci/kea/model.uc
  test/fixtures/
  test/run-import-tests.sh
  test/run-rpc-tests.sh
  test/playwright/
```

Implementation preference:

- Use modern LuCI JavaScript views for the UI.
- Use an rpcd backend for filesystem access, config parsing, validation, import,
  backups, and service actions.
- Keep parsing/import/validation logic in backend-side `ucode` modules so it can
  be unit-tested without a browser.

## Scope

### Phase 1: Discovery And Schema

- Read current OpenWrt Kea package files:
  - `/etc/config/kea`
  - `/etc/init.d/kea`
  - `/etc/kea/kea-dhcp4.conf`
  - `/etc/kea/kea-dhcp6.conf`
  - `/etc/kea/kea-dhcp-ddns.conf`
- Confirm exact Kea 3.0.2 JSON schema used by the package.
- Confirm supported HA hook parameters for `libdhcp_ha.so`.
- Confirm lease storage backend used by default (`memfile` unless changed).
- Decide whether the app edits JSON directly, generates JSON from a LuCI model,
  or uses a hybrid model.

Preferred design:

- Preserve unknown Kea JSON keys.
- Provide structured UI for common settings.
- Provide raw JSON editor for advanced settings.
- Validate with Kea binaries before writing/restarting.

### Phase 2: LuCI Skeleton

- Add menu entry under `Network -> DHCP and DNS -> Kea DHCP`.
- Add rpcd ACL.
- Add backend method discovery:
  - package installed status;
  - service enabled/running status;
  - available binaries;
  - available hook libraries;
  - config file existence;
  - Kea version.
- Add overview page with:
  - installed components;
  - running services;
  - config validation status;
  - last log lines;
  - quick restart/reload buttons.

### Phase 3: Service Controls

The UI must cover what `kea-uci` can currently do:

```text
config service 'ctrl_agent'
  option disabled '1'

config service 'dhcp4'
  option disabled '1'

config service 'dhcp6'
  option disabled '1'

config service 'dhcp_ddns'
  option disabled '1'
```

Required actions:

- Enable/disable `ctrl_agent`.
- Enable/disable `dhcp4`.
- Enable/disable `dhcp6`.
- Enable/disable `dhcp_ddns`.
- Enable/disable init autostart.
- Start/stop/restart/reload service.
- Validate config before restart.
- Warn if dnsmasq DHCP is still enabled on the same interface/subnet.

### Phase 4: DHCPv4 Editor

Structured editor for common `Dhcp4` settings:

- interfaces;
- subnet4 list;
- pools;
- routers;
- DNS servers;
- domain search/name;
- valid lifetime;
- renew/rebind timers;
- reservations;
- global and subnet options;
- lease database settings;
- optional raw JSON section for unsupported fields.

Reservation editor must support:

- `hw-address`;
- `client-id` when needed;
- `ip-address`;
- `hostname`;
- user context;
- enabled/disabled state in the LuCI model.

### Phase 5: DHCPv6 Editor

Structured editor for common `Dhcp6` settings:

- interfaces;
- subnet6 list;
- address pools;
- prefix delegation pools, if used;
- DNS servers;
- domain search/name;
- valid/preferred lifetime;
- renew/rebind timers;
- reservations;
- global and subnet options;
- lease database settings;
- optional raw JSON section for unsupported fields.

Reservation editor must support:

- DUID/client-id;
- IAID where required;
- IPv6 address reservation;
- prefix reservation when supported;
- hostname;
- user context;
- enabled/disabled state in the LuCI model.

### Phase 6: Kea HA Hook UI

Show HA page only when `kea-hook-ha` is installed or when an HA hook entry is
already present in the Kea config.

Detect hook library:

```text
/usr/lib/kea/hooks/libdhcp_ha.so
```

Structured UI should cover at least:

- enable/disable HA hook for DHCPv4;
- enable/disable HA hook for DHCPv6;
- mode:
  - hot-standby;
  - load-balancing;
  - passive-backup, if supported by the installed Kea version;
- this server name;
- peer server list;
- peer URL;
- peer role;
- auto-failover;
- heartbeat delay;
- max response delay;
- max ACK delay;
- max unacked clients;
- sync timeout;
- send lease updates;
- optional advanced JSON parameters.

Integration with existing `ha-cluster`:

- Detect whether `ha-cluster` is installed.
- Detect configured HA peers and node names if possible.
- Offer an assisted fill-in mode using `ha-cluster` peers.
- Do not make Kea depend on `ha-cluster`; integration should be optional.

Important: exact HA hook schema must be verified against the installed Kea
3.0.2 package before implementation.

### Phase 7: Static Lease Import From dnsmasq

Import source:

```text
/etc/config/dhcp
config host
```

Relevant dnsmasq/OpenWrt fields:

```text
option name
option mac
option ip
option duid
option hostid
option leasetime
option tag
option match_tag
option networkid
option broadcast
option dns
option enable
```

Import workflow:

1. Read `/etc/config/dhcp`.
2. Read `/etc/config/network` to discover subnet prefixes.
3. Read existing Kea config.
4. Build a dry-run import model.
5. Show preview table before writing anything.
6. Mark each entry as:
   - ready;
   - disabled with warning;
   - duplicate/conflict;
   - unsupported.
7. Allow editing entries before import.
8. Write only valid enabled entries to Kea config.
9. Store invalid/disabled imported entries in a LuCI-owned staging file, not in
   Kea runtime JSON if they would make Kea reject the config.
10. Validate Kea config before saving.
11. Create backups before writing.

Suggested LuCI-owned staging file:

```text
/etc/kea/luci-reservations.json
```

Reason: Kea JSON must remain valid. Invalid imported entries cannot be written
directly into Kea runtime config just because they are disabled in LuCI.

The staging model should keep:

- original UCI section name;
- original raw values;
- normalized values;
- target family (`dhcp4`/`dhcp6`);
- target subnet ID/prefix;
- enabled state;
- warning/error list;
- import timestamp;
- whether it has been materialized into Kea config.

IPv4 import mapping:

```text
UCI option mac  -> Kea reservation hw-address
UCI option ip   -> Kea reservation ip-address
UCI option name -> Kea reservation hostname
```

IPv6 import mapping:

```text
UCI option duid   -> Kea reservation duid/client-id
UCI option hostid -> IPv6 address suffix, only if subnet prefix is known
UCI option ip     -> explicit IPv6 reservation, if present
UCI option name   -> hostname
```

Entries that should be imported as disabled with a warning:

- missing identifier (`mac`, `duid`, or usable hostname fallback);
- IPv4 reservation without `ip-address`;
- IPv4 address outside all known Kea/OpenWrt subnets;
- DHCPv6 entry with `hostid` but no resolvable subnet prefix;
- DHCPv6 entry with invalid or truncated DUID/client-id;
- multiple MAC addresses in one dnsmasq host entry, until split manually or by
  importer;
- unsupported `tag`, `match_tag`, `networkid`, `broadcast`, or custom option
  behavior;
- duplicate IP address;
- duplicate MAC/DUID identity;
- invalid hostname;
- disabled UCI host entry.

UI behavior for warnings:

- Show a warning icon in the import table.
- Keep the entry disabled by default.
- In the edit dialog, highlight invalid fields.
- On hover/focus, show the exact reason.
- Allow fixing the fields and enabling the entry.

### Phase 8: Raw JSON Editor

Provide raw editor pages for:

```text
/etc/kea/kea-dhcp4.conf
/etc/kea/kea-dhcp6.conf
/etc/kea/kea-dhcp-ddns.conf
```

Requirements:

- JSON syntax validation in browser.
- Backend validation with Kea test command before save.
- Backup before save.
- Restore from latest backup.
- Diff preview if practical.

### Phase 9: Backend Validation

Backend validation should include:

- JSON parse check.
- Kea binary config test:
  - `kea-dhcp4 -t -c /etc/kea/kea-dhcp4.conf`
  - `kea-dhcp6 -t -c /etc/kea/kea-dhcp6.conf`
  - equivalent checks for DDNS/control agent if available.
- Subnet overlap checks.
- Pool inside subnet checks.
- Reservation IP inside subnet checks.
- Duplicate reservation checks.
- DHCPv6 identity checks.
- HA hook library existence.
- HA peer URL format checks.
- Service conflict check with dnsmasq DHCP.

### Phase 10: Tests

#### Import Unit Tests

Implement fixture-based importer tests. Preferred location:

```text
luci-app-kea/test/fixtures/
luci-app-kea/test/run-import-tests.sh
```

Importer tests should cover:

- valid IPv4 static lease import;
- IPv4 lease outside subnet -> disabled + warning;
- IPv4 duplicate IP -> disabled + warning;
- IPv4 duplicate MAC -> disabled + warning;
- multiple MACs in one dnsmasq entry -> split or disabled with warning;
- missing IP -> disabled + warning;
- disabled UCI host entry -> disabled in import preview;
- valid DHCPv6 DUID + hostid import;
- DHCPv6 hostid without known prefix -> disabled + warning;
- DHCPv6 truncated DUID/client-id `00` -> disabled + warning;
- DHCPv6 duplicate DUID/IAID -> disabled + warning;
- unsupported dnsmasq tags/options -> disabled + warning;
- idempotent re-import: same source should not create duplicates.

#### Backend RPC Tests

Test rpcd methods with temporary config roots:

- read status;
- read service config;
- write service config;
- backup creation;
- config validation success/failure;
- import dry-run;
- import commit;
- rollback from backup.

#### LuCI GUI Tests

Use Playwright for browser-level tests with mocked RPC responses first, then an
optional OpenWrt runtime test.

Suggested Playwright coverage:

- overview renders package/service state;
- services page toggles dhcp4/dhcp6/ctrl_agent;
- DHCPv4 reservation form validates bad MAC/IP;
- DHCPv6 reservation form validates bad DUID/hostid;
- import preview displays ready/disabled/warning states;
- warning icon tooltip shows field-level reason;
- edit dialog highlights invalid fields;
- HA page appears only when HA hook is present;
- raw JSON editor blocks invalid JSON.

Optional runtime/e2e test:

- run LuCI in an OpenWrt test container/VM;
- install `luci-app-kea`;
- load each page through uhttpd;
- verify no JavaScript errors;
- perform dry-run import against fixture configs.

## Milestones

1. Create `luci-app-kea` skeleton and menu/ACL.
2. Add backend status/read/write/backup/validate RPC methods.
3. Add service control page matching `kea-uci`.
4. Add DHCPv4/DHCPv6 structured config readers and writers.
5. Add reservations model.
6. Add dnsmasq static lease import dry-run.
7. Add disabled/warning import staging model.
8. Add import commit and rollback.
9. Add HA hook editor.
10. Add raw JSON editor.
11. Add importer unit tests.
12. Add backend RPC tests.
13. Add Playwright GUI tests.
14. Build package in OpenWrt 25.12.3 tree.
15. Test package on router/VM with real Kea binaries.

## Open Questions

- Should the package live in `openwrt/packages`, `openwrt/luci`, or a separate
  custom feed first?
- Should the first version manage only `kea-uci` service state plus raw JSON, or
  immediately include structured subnet/pool/reservation forms?
- Should imported invalid reservations live only in `/etc/kea/luci-reservations.json`,
  or should there be a UCI config namespace for LuCI-managed Kea metadata?
- Should Kea HA settings integrate tightly with `ha-cluster`, or only offer
  optional assisted import from `ha-cluster` peers?
- Should the GUI support live lease viewing through Kea Control Agent in v1, or
  leave that for v2?

## Initial Recommendation

Build this in layers:

1. Backend model and importer first.
2. Service/overview UI second.
3. Static lease import UI third.
4. DHCPv4/DHCPv6 structured editors fourth.
5. HA hook UI fifth.
6. Playwright GUI tests once the first pages are stable.

The riskiest part is not LuCI itself. The riskiest part is preserving valid Kea
JSON while importing imperfect dnsmasq/OpenWrt host entries. Therefore the
importer must be designed as a dry-run validator with disabled warning entries
from the start.

## Stop Point: 2026-05-10

Current implementation state:

- Plan saved in this file.
- Initial package created under `package/luci-app-kea`.
- APK package builds successfully:

```text
bin/packages/x86_64/base/luci-app-kea-0.1.0-r1.apk
```

- Current package files:

```text
package/luci-app-kea/Makefile
package/luci-app-kea/README.md
package/luci-app-kea/htdocs/luci-static/resources/view/kea/overview.js
package/luci-app-kea/htdocs/luci-static/resources/view/kea/services.js
package/luci-app-kea/htdocs/luci-static/resources/view/kea/import-dnsmasq.js
package/luci-app-kea/root/usr/libexec/rpcd/luci.kea
package/luci-app-kea/root/usr/share/luci/menu.d/luci-app-kea.json
package/luci-app-kea/root/usr/share/rpcd/acl.d/luci-app-kea.json
package/luci-app-kea/test/fixtures/dhcp-static-leases.uci
package/luci-app-kea/test/fixtures/dhcp-static-leases.expected.md
```

Implemented so far:

- LuCI menu and ACL.
- Overview page.
- Kea service control page for the `kea-uci` service sections:
  `ctrl_agent`, `dhcp4`, `dhcp6`, `dhcp_ddns`.
- Import preview page for dnsmasq static leases.
- rpcd backend `luci.kea` with:
  - `getStatus`;
  - `getServices`;
  - `setService`;
  - `setInitAction`;
  - `validate`;
  - `importDnsmasqDryRun`;
  - placeholder `importDnsmasqCommit`.
- Dry-run importer currently reads `config host` entries from `/etc/config/dhcp`,
  detects DHCPv4 vs DHCPv6, validates IPv4 addresses, MAC addresses, DHCPv6
  DUID/client-id, and marks unsupported/problematic entries as disabled with
  warnings.
- DHCPv6 importer explicitly rejects empty, `*`, and truncated `00` identities,
  so it does not reproduce the previous DHCPv6 client-id truncation bug.

Checks already run:

```text
sh -n package/luci-app-kea/root/usr/libexec/rpcd/luci.kea
node --check package/luci-app-kea/htdocs/luci-static/resources/view/kea/overview.js
node --check package/luci-app-kea/htdocs/luci-static/resources/view/kea/services.js
node --check package/luci-app-kea/htdocs/luci-static/resources/view/kea/import-dnsmasq.js
make package/luci-app-kea/compile CONFIG_PACKAGE_luci-app-kea=m V=s
```

Build result after the latest rebuild includes APK metadata:

```text
name:luci-app-kea
version:0.1.0-r1
arch:noarch
license:Apache-2.0
depends:libc luci-base rpcd rpcd-mod-file kea-uci
```

Where work stopped:

- I started inspecting the existing OpenWrt Kea package before implementing real
  import commit logic.
- Confirmed `feeds/packages/net/kea/files/kea.config` only exposes `config
  service` sections.
- Confirmed `feeds/packages/net/kea/files/kea.init` starts Kea daemons directly
  from `/etc/kea/kea-*.conf`; there is no rich UCI model for subnets,
  reservations, or HA settings in `kea-uci`.
- This means the LuCI app cannot simply write reservations to `/etc/config/kea`.
  It needs its own backend model/staging file and then must merge/generate Kea
  JSON safely.

Next step:

1. Add backend-side importer modules, preferably under
   `root/usr/share/luci/kea/`, instead of keeping all logic inside the rpcd shell
   script.
2. Implement `importDnsmasqCommit` as a safe staging operation first:
   - write ready reservations to `/etc/kea/luci-reservations.json`;
   - preserve disabled/problem entries with warnings;
   - do not modify `/etc/kea/kea-dhcp4.conf` or `/etc/kea/kea-dhcp6.conf` yet.
3. Add a generated preview/output schema for:
   - DHCPv4 reservations;
   - DHCPv6 reservations;
   - disabled entries;
   - warnings with field names.
4. Add a runnable importer test script using the fixture in
   `package/luci-app-kea/test/fixtures/dhcp-static-leases.uci`.
5. After staging is tested, implement actual Kea JSON merge/write with backup
   and validation through `kea-dhcp4 -t` / `kea-dhcp6 -t`.
