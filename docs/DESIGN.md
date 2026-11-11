# Design Notes

This file describes the intended behavior of the application. It is a target,
not a description of the current code: see [STATUS.md](STATUS.md) for what
exists and [ROADMAP.md](ROADMAP.md) for the order of work.

## Constraints from the Kea packages

The OpenWrt packages feed provides `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns`,
`kea-ctrl`, `kea-admin`, `kea-hook-ha`, `kea-hook-lease-cmds`, `kea-lfc`,
`kea-perfdhcp`, `kea-shell`, `kea-uci` and `kea-libs`.

`kea-uci` installs `/etc/config/kea` and a procd init script. The UCI file
holds only four service switches:

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

The init script starts each enabled daemon directly from
`/etc/kea/kea-<name>.conf`. There is no UCI model for subnets, pools,
reservations or HA. The application therefore cannot store DHCP settings in
UCI and must edit Kea JSON.

## Principles

- Hybrid model: structured forms for common settings, a raw JSON editor for
  everything else.
- Never drop Kea JSON keys the forms do not understand.
- Validate with the Kea binary (`kea-dhcp4 -t`, `kea-dhcp6 -t`, and the
  equivalents for DDNS and the control agent) before replacing a config file.
- Back up before every write.
- Never stop dnsmasq or odhcpd implicitly. Show conflicts and give explicit
  controls.
- Keep Kea JSON valid at all times. A reservation the user disabled is moved
  into the subnet's `user-context`, where Kea ignores it. Import entries that
  cannot be expressed as a valid reservation live in a LuCI-owned staging
  file, not in the Kea config.
- Write back only what the user changed. The editors keep the original subnet
  object and never rebuild it from the form.
- Keep parsing, import and validation logic in backend ucode modules so it can
  be tested without a browser.

## Reservations

DHCPv4 reservations support `hw-address`, `client-id` when needed,
`ip-address`, `hostname`, `user-context`, and an enabled state held in the
LuCI model.

DHCPv6 reservations support DUID, MAC address or flex ID (Kea has no
client-ID reservations for DHCPv6), IAID where required, address
reservations, prefix reservations, `hostname`, `user-context`, and an enabled
state held in the LuCI model.

Disabled reservations are stored like this and shown in the editor with the
**Enabled** box cleared:

```json
"user-context": {
	"luci-app-kea": {
		"disabled-reservations": [
			{ "hw-address": "02:00:00:00:00:01", "ip-address": "192.168.1.10" }
		]
	}
}
```

## dnsmasq static lease import

Source: `config host` sections in `/etc/config/dhcp`. Relevant options: `name`,
`mac`, `ip`, `duid`, `hostid`, `leasetime`, `tag`, `match_tag`, `networkid`,
`broadcast`, `dns`, `enable`.

### Workflow

1. Read `/etc/config/dhcp`.
2. Read `/etc/config/network` to discover subnet prefixes.
3. Read the existing Kea config.
4. Build a dry-run import model.
5. Show a preview table before writing anything.
6. Mark each entry as ready, disabled with warning, duplicate/conflict, or
   unsupported.
7. Allow editing entries before import.
8. Write only valid enabled entries to the Kea config.
9. Store invalid and disabled entries in the staging file.
10. Validate the Kea config before saving.
11. Create a backup before writing.

### Mapping

```text
IPv4:  mac    -> hw-address
       ip     -> ip-address
       name   -> hostname

IPv6:  duid   -> duid / client-id
       hostid -> IPv6 address suffix, only if the subnet prefix is known
       ip     -> explicit IPv6 reservation, if present
       name   -> hostname
```

### Entries imported as disabled, with a warning

- missing identifier (`mac`, `duid`);
- IPv4 entry without an address;
- IPv4 address outside every known Kea/OpenWrt subnet;
- DHCPv6 entry with `hostid` but no resolvable subnet prefix;
- DHCPv6 entry with an invalid or truncated DUID or client ID (for example
  `00`);
- several MAC addresses in one entry, until split;
- `tag`, `match_tag`, `networkid`, `broadcast` or custom option behavior;
- duplicate IP address;
- duplicate MAC address or DUID;
- invalid hostname;
- source entry disabled in UCI.

### Staging file

`/etc/kea/luci-reservations.json` keeps, per entry:

- original UCI section name and raw values;
- normalized values;
- target family (`dhcp4` or `dhcp6`);
- target subnet ID and prefix;
- enabled state;
- warnings and errors, with field names;
- import timestamp;
- whether the entry has been written to the Kea config.

### Warning display

- warning icon in the import table;
- entry disabled by default;
- invalid fields highlighted in the edit dialog, with the reason on hover or
  focus;
- the entry can be fixed and enabled.

## High availability page

Shown only when `/usr/lib/kea/hooks/libdhcp_ha.so` is installed or an HA hook
entry already exists in the config.

Fields:

- enable HA for DHCPv4 and for DHCPv6;
- mode: hot-standby, load-balancing, passive-backup where supported;
- this-server name;
- peers: name, URL, role, auto-failover;
- heartbeat delay, max response delay, max ACK delay, max unacked clients,
  sync timeout;
- send lease updates;
- advanced JSON parameters.

The exact schema must be checked against the packaged Kea version before
implementation.

Optional integration with `ha-cluster`: detect it, read peers and node names
where possible, and offer an assisted fill-in. Kea must not depend on it.

## Raw editor

For `kea-dhcp4.conf`, `kea-dhcp6.conf`, `kea-dhcp-ddns.conf` and
`kea-ctrl-agent.conf`:

- JSON syntax check in the browser;
- backend validation with the Kea binary before save;
- backup before save and restore from backup;
- diff preview if practical.

## Backend validation

- JSON parse check;
- Kea binary config test;
- subnet overlap;
- pool inside subnet;
- reservation address inside subnet;
- duplicate reservations;
- DHCPv6 identity checks;
- HA hook library present, HA peer URL format;
- conflict with dnsmasq or odhcpd DHCP on the same interface.

## Test plan

### Importer

- valid IPv4 static lease;
- IPv4 lease outside every subnet;
- duplicate IPv4 address; duplicate MAC address;
- several MAC addresses in one entry;
- missing IP address;
- disabled UCI host entry;
- valid DHCPv6 DUID with `hostid`;
- `hostid` without a known prefix;
- truncated DUID or client ID `00`;
- duplicate DUID/IAID;
- unsupported dnsmasq tags and options;
- re-import of the same source creates no duplicates.

### Backend RPC, with temporary config roots

- read status; read and write service config;
- backup creation; rollback from backup;
- config validation success and failure;
- import dry run and import commit.

### Browser

Playwright with mocked RPC responses first, then an optional run against a
real OpenWrt target:

- overview renders package and service state;
- services page toggles components;
- reservation forms reject bad MAC, IP, DUID and `hostid` values;
- import preview shows ready, disabled and warning states with reasons;
- HA page appears only when the hook is present;
- raw editor blocks invalid JSON;
- no JavaScript errors on any page.
