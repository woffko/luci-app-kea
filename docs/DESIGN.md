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
  into the subnet's `user-context`, where Kea ignores it. Static leases that
  cannot be expressed as a valid reservation are not copied anywhere: they
  stay in `/etc/config/dhcp`, and the import page says why.
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

## Static lease import

Source: the `config host` sections of `/etc/config/dhcp`, as dnsmasq and
odhcpd read them. One section describes a host for both protocols:

```text
config host
	option name 'laptop'
	list mac '02:00:00:00:00:AA'      DHCPv4 identifier (a list in UCI)
	option ip '192.168.1.77'          DHCPv4 address
	list duid '00030001020000000aaa'  DHCPv6 identifier, hex, optionally %IAID
	option hostid '77'                IPv6 token: the low 64 bits of the address
```

Other options that matter: `enable`, `leasetime`, `tag`, `match_tag`,
`networkid`, `instance`, `broadcast`, `dns`.

### No second copy

The import keeps nothing between runs. Static leases already live in UCI,
which is where OpenWrt keeps such data, so a staging file would only be a
copy that can drift. Each time the page is opened, the backend builds the
list from the UCI sections and the current Kea configuration:

1. Read the host sections, the OpenWrt interfaces and both Kea files.
2. Turn each section into up to two entries, one per protocol.
3. Compare each entry with the Kea subnets and their reservations.
4. Show the result. Nothing is written.
5. On import, write the selected entries to `kea-dhcp4.conf` and
   `kea-dhcp6.conf`. Both files are validated before either is replaced, and
   each is backed up.

To change an entry, the user edits the static lease in LuCI's own DHCP page.
A lease that was imported is recognized in Kea on the next run, so importing
twice changes nothing.

### Mapping

```text
DHCPv4:  mac     -> hw-address
         ip      -> ip-address
         name    -> hostname

DHCPv6:  duid    -> duid (normalized to colon-separated octets)
         hostid  -> ip-addresses: [ <subnet prefix> + token ]
         name    -> hostname
```

The subnet for a token is the only DHCPv6 subnet of `/64` or shorter, or, if
there are several, the one bound to the interface that the host's IPv4
address belongs to.

### Entry states

| State | Meaning | Selected by default |
|-------|---------|---------------------|
| Ready | Becomes a reservation as it is | yes |
| Needs review | Valid, but something is not carried over (lease time, tags, the hosts file flag, an IAID), or the static lease is disabled | no |
| Changes Kea | Kea has a reservation for this client with another address or hostname | no |
| Already in Kea | Nothing to do | - |
| Cannot import | Cannot be expressed as a reservation; the reason is shown | - |

Reasons for "Cannot import":

- no MAC address or no DUID (dnsmasq can match a host by name, Kea cannot);
- no address, an invalid address, or `ip 'ignore'`;
- an invalid or truncated DUID (for example `00`), an invalid token;
- several MAC addresses or DUIDs for one address: Kea reserves an address for
  one identifier;
- an address outside every Kea subnet, or no subnet to place a token in;
- an address that Kea already reserves for another client;
- two static leases with the same identifier or the same address;
- a missing or unparsable Kea configuration file.

A disabled static lease that the user selects is imported as a disabled
reservation, in the subnet's `user-context`, where the DHCP editors show it
switched off.

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

Covered by `test/ucode/importer.uc` and `test/ucode/target/import.uc`:

- a dual-stack section yields two reservations;
- every "Cannot import" reason above;
- settings that are not carried over;
- a reservation Kea already has, a changed address, a changed hostname;
- duplicates among the static leases;
- token placement with one and with several DHCPv6 subnets;
- import of a selection, of a disabled lease, of an update;
- a second import changes nothing;
- if Kea rejects one file, neither is replaced.

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
