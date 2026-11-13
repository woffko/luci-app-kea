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
- Validate with the Kea binary (`kea-dhcp4 -T`, `kea-dhcp6 -T`, and `-t` for
  DDNS and the control agent) before replacing a config file.
- Back up before every write.
- Never stop dnsmasq or odhcpd implicitly. Show conflicts and give explicit
  controls.
- Keep Kea JSON valid at all times. A reservation the user disabled is moved
  into the subnet's `user-context`, where Kea ignores it. Static leases that
  cannot be expressed as a valid reservation are not copied anywhere: they
  stay in `/etc/config/dhcp`, and the import page says why.
- Write back only what the user changed. The editors keep the original subnet
  object and never rebuild it from the form.
- Check only what the user changed. A file that Kea accepts must stay
  savable even where the editor would be stricter.
- Keep logic out of the pages so it can be tested without a browser: the
  backend in ucode modules, the configuration model in a JavaScript module
  without DOM code.

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

## High availability

A tab of the DHCPv4 and DHCPv6 editors, offered when
`/usr/lib/kea/hooks/libdhcp_ha.so` is installed or the file already has an
entry for it. The settings live in the `hooks-libraries` entry of the hook,
one per daemon.

Fields:

- enable: adds or removes the entry. Enabling also adds an entry for
  `libdhcp_lease_cmds.so` if there is none, because the servers exchange
  leases with its commands;
- mode: hot standby, load balancing, passive backup;
- the name of this server;
- peers: name, URL, role, automatic failover;
- heartbeat delay, maximum response delay, maximum ACK delay, maximum
  unacked clients, synchronization timeout; the placeholders are the values
  Kea uses when a field is empty;
- send lease updates, synchronize leases;
- additional parameters: every other key of the relationship as a JSON
  object.

Rules of the form:

- Nothing is written unless something on the tab changed. Then the
  relationship is merged: known keys keep their place, unknown keys of a
  peer are kept, a number is removed when its field is emptied, and a switch
  is written only when it was moved, never to spell out a default.
- The form edits one relationship. A file with several is not touched and
  the tab says where to edit it.

### What the hook takes and refuses

Measured with `kea-dhcp4 -T` and `kea-dhcp6 -T` of Kea 3.0.4. `-t` accepts
everything in the first list except the last item, because it does not load
hooks.

Refused:

- no `this-server-name`, or one that no peer has; no `mode`, or an unknown
  one; an empty list of relationships;
- a peer without `name`, `url` or `role`; an empty or repeated peer name; an
  unknown role;
- a host name in a peer URL (the hook resolves nothing); an `https` URL
  without TLS configured; a URL without a scheme;
- any mode without a primary, or with two;
- hot standby without a standby, with two, or with a secondary;
- load balancing without a secondary, with two, or with a standby;
- passive backup with a standby or a secondary;
- `delayed-updates-limit` other than 0 outside load balancing;
  `wait-backup-ack` set in hot standby or load balancing;
- negative numbers, and values of the wrong JSON type;
- two relationships with the same `this-server-name`;
- a hook library outside `/usr/lib/kea/hooks`.

Accepted, some of it surprisingly:

- a setup without the lease commands hook;
- two peers with the same URL, a URL without a port, with port 0 or with a
  path;
- a heartbeat delay longer than the maximum response delay;
- unknown keys in the relationship;
- passive backup with a primary and no backup;
- this server in the backup role;
- IPv6 addresses in brackets;
- two relationships with different names for this server.

The form checks what it has fields for and leaves the rest to the hook,
whose message is shown when a save is refused.

### At run time

With multi-threading, the default, the DHCP daemon itself listens on the URL
of this server; the control agent is not involved. `kea-dhcp4 -T` works
while a daemon with the same configuration is running.

Optional integration with `ha-cluster` (detect it, read peers and node names,
offer a fill-in) stays open: the OpenWrt 25.12 repositories have no such
package. Kea must not depend on it.

## Runtime view

What Kea is doing, without changing anything.

- **Version**: asked from the first installed daemon (`kea-dhcp4 -v`).
- **Log**: the Kea messages of the system log (`logread`), the last thirty,
  split into time, daemon, severity and text. `logread` counts before it
  filters and takes no alternatives in its pattern, so the backend filters
  and cuts the tail itself.
- **Leases**: read from the lease files of the memfile backend.

### Lease files

Taken from the Kea 3.0.4 sources (`memfile_lease_mgr.cc`, `csv_file.cc`) and
checked against files Kea wrote for a test client.

- A lease file is a journal. Every change of a lease appends a row; the
  last row for an address is the one that counts. For DHCPv6 the address
  and the lease type together name a lease.
- The columns are found by the names in the header line, so a column added
  by a later Kea version does not shift the others.
- A comma inside a value is written as `&#x2c`.
- State 0 is a lease in use, 1 an address a client declined, 2 a lease that
  ran out and was reclaimed, 3 a released lease, 4 a registered address. A
  released lease is first written with a lifetime of 0.
- The page shows states 0, 1 and 4 with a lifetime above 0 that has not run
  out, counted from the clock of the router.
- The lease file cleanup works with several files. Kea loads the result of
  the last cleanup (`.completed`), or its two inputs (`.2`, then `.1`) when
  it did not finish, and then the file it is writing. The backend reads
  them in the same order.
- The file name comes from `lease-database` in the configuration, with the
  default of the daemon (`kea-leases4.csv`, `kea-leases6.csv`) in
  `/var/lib/kea`.

## Raw editor

For `kea-dhcp4.conf`, `kea-dhcp6.conf`, `kea-dhcp-ddns.conf` and
`kea-ctrl-agent.conf`:

- JSON syntax check in the browser while typing; a text that is not JSON is
  not sent. A file that uses Kea's `<?include ?>` directive is not checked
  in the browser, because only Kea can read it;
- backend validation with the Kea binary before save;
- backup before save and restore from backup;
- a view of the changed lines before saving.

## Validation

There are two layers, and the second one decides.

1. **In the browser**, for the structured editors. The model checks the
   values the user changed and names the tab and field of each mistake, so
   the user does not have to map a Kea parser message back to a form field.
   [STATUS.md](STATUS.md#what-the-editors-check) lists the checks. They were
   written from measurements of what `kea-dhcp4 -t` and `kea-dhcp6 -t` of
   Kea 3.0.4 accept and refuse, not from the documentation alone: Kea takes
   a reservation without an address, a five-octet MAC address and
   overlapping subnets, and refuses a MAC address written with dashes, bare
   text as a client ID and two pools that overlap.
2. **On the router**, for every write: a JSON parse and the Kea binary's
   own configuration test, for the DHCP daemons the one that loads the hook
   libraries (`-T`). Nothing replaces a file without passing it.

Semantic checks are not repeated in ucode. The Kea binary already refuses
what they would refuse, and a second implementation of the same rules would
only drift from the first.

Still open: a check that the daemon can actually start with the file. The
Kea binary's test does not open sockets or interfaces.

### Second DHCP server on an interface

The backend reports for each OpenWrt interface whether `/etc/config/dhcp`
makes dnsmasq or odhcpd serve DHCPv4 or DHCPv6 on it. The editor warns on the
tab of such an interface while Kea is enabled on it and dnsmasq or odhcpd is
running. It is a warning, not a block: moving a network from dnsmasq to Kea
passes through this state.

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

Playwright against a real OpenWrt target. Done: no JavaScript errors on any
page; the editors, the high availability tab, the raw editor, the backups
and the import end to end, including a refused wrong value and invalid JSON.
Still to do:

- overview renders package and service state;
- services page toggles components.
