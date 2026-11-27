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
  path. Without a port the pair does not work, although nothing says so:
  a server listens on a port chosen at random and connects to port 0 of its
  partner, and both end up in the state partner-down. Measured with two
  servers. The form asks for a port for that reason, the one check that
  goes beyond what the hook refuses;
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
offer a fill-in) stays open. The OpenWrt 25.12 repositories have no such
package; the owner's own feed has one, with a read-only call for exactly
this data. The intended split: `ha-cluster` offers the data, this
application writes the Kea files, and neither depends on the other. See
roadmap milestone M9.

## Runtime view

What Kea is doing, without changing anything.

- **Version**: asked from the first installed daemon (`kea-dhcp4 -v`).
- **Log**: the Kea messages of the system log (`logread`), the last thirty,
  split into time, daemon, severity and text. `logread` counts before it
  filters and takes no alternatives in its pattern, so the backend filters
  and cuts the tail itself. What is there depends on the loggers of the
  configuration: everything with `"output": "syslog"`, little with the log
  file that the configuration files shipped with Kea name. The page
  therefore also says where each installed daemon writes its log when that
  is a file, and whether the directory of that file exists.
- A message reaches the system log in one of two shapes: written to syslog
  by Kea, or printed by the daemon and passed on by procd with Kea's own
  time in front. Both are split; the severity shown is the one Kea gave,
  not the level procd logged the line with.
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

Still open: a general check that the daemon can actually start with the
file. The Kea binary's test does not open sockets or interfaces.

### What the check accepts and the daemon refuses

Two settings are known to pass the test of Kea 3.0.4, also with `-T`, and
to stop the daemon when it starts: a lease file whose directory is not
`/var/lib/kea`, and a log file whose directory is not `/var/log/kea`. Kea
compares the text before the last slash of the name, so a subdirectory and
a doubled slash are refused too; a name without a slash is fine. The lease
file is not looked at when `persist` is false. Only the DHCP daemons are
affected: `kea-dhcp-ddns` and `kea-ctrl-agent` refuse such a log file in
their test.

The backend looks for these two settings in every file that passed the test
and returns them as warnings: with the result of the test, with a file that
is read, and with a save or a restore.

- **A warning is not a refusal.** The rule was measured with one Kea version
  on one build. Another may allow other directories, and an environment
  variable (`KEA_DHCP_DATA_DIR`) moves the lease directory. A file Kea
  accepts stays savable.
- **Applying is asked about.** When Save & Apply would reload a running
  daemon with such a file, the page asks first. The file is saved by then;
  with the answer no the daemon keeps running with what it has, and the
  page shows the warning for the file from then on.
- **The backend names the setting, the page words it.** A warning is a code
  with the value and the directory, so that the text can be translated.

### A daemon that runs without listening

Kea opens its sockets when it starts, once. On OpenWrt it is started at
boot at a point where the bridge may not be running and the IPv6
link-local address may still be tentative. It then opens nothing, says so
in its log and in `status-get`, and stays that way; procd sees a running
process. Two members of `interfaces-config` make it try again:
`service-sockets-max-retries` and `service-sockets-retry-wait-time`.

- The pages write 60 and 2000 when they make Kea listen on a device it did
  not listen on and the file has neither value. Not when the user set or
  cleared one of the two fields in the same save.
- A file that names interfaces and has no retries is warned about wherever
  the result of the check is shown. This is a second kind of warning: the
  daemon starts, but may not listen. Save & Apply does not ask about it,
  since a reload with such a file does no harm.
- Overview and Services ask each DHCP daemon that procd runs for its
  `status-get` and show the state of the sockets with Kea's own words.
  "Failed" is an alarm at the top of Overview. Kea says "failed" when one
  socket could not be opened, also while it listens on other interfaces,
  so the pages say "could not open all of its sockets" and leave the
  interface to Kea's message. The same state arises when
  another DHCP server holds the port, so the advice names both cures: the
  retries for the boot, and switching off the other server's DHCP.
- A reload does not help a daemon in that state, because procd restarts a
  process only when its file changed; the page says to restart.

The control socket is the one named in the file of the daemon
(`control-socket`, or the first unix socket of `control-sockets`; a name
without a directory is in `/var/run/kea`). Connecting and waiting for the
reply are limited to a second and a half each.

### The state of high availability

`status-get` also carries, per relationship, the mode, the role and state
of this server, and the role and last known state of the partner. The
pages show them in a sentence. While a pair starts, Kea switches the DHCP
service of a server off until the servers have synchronized; that is shown
as "not answering at the moment", not as a failure. Without high
availability, a switched-off DHCP service is a failure: only a command does
that.

### Peers from a cluster

`ha-cluster`, a package outside the OpenWrt repositories, runs VRRP and
knows the nodes of a cluster. Its call `ubus call ha-cluster nodes` returns
this node and its peers, each with a name that is the same on every node,
the address the partner reaches, and a role suggested for hot standby. A
peer that only takes part in VRRP is left out; without a partner, or
without the package, nothing is offered.

The pages make that call themselves, and the ACL of the application names
it. The backend made it at first, and must not: it runs inside rpcd, and
the object `ha-cluster` is served by rpcd as well, through the plugin of
`luci-app-ha-cluster`. rpcd handles one call at a time. A call it makes to
one of its own objects is answered only after it has given up, 30 seconds
later, and nothing else is answered meanwhile: every page of LuCI waits.
On a router without that plugin the call failed at once, which is why it
went unnoticed until a pair with `ha-cluster` was run. The rule that
follows: the backend calls no ubus object that rpcd may serve; a test reads
the sources for that.

The button on the tab puts the node names into "This server" and the list
of peers, builds the URLs from the addresses with a fixed port per protocol
(8001 for DHCPv4, 8002 for DHCPv6), and turns the suggested roles into
those of the chosen mode (the standby of hot standby is the secondary of
load balancing and a backup of passive backup). A peer of the form with the
name of a node keeps its other keys. It saves nothing.

The split between the two packages: `ha-cluster` knows the nodes and, by
the owner's word, opens the firewall for the ports; this application
writes the Kea files. Neither depends on the other.

### The firewall rules of the cluster after Kea

`ha-cluster` takes the ports for its firewall rule from the peer URLs in
the Kea files of the enabled daemons. A port changed on the tab would stay
closed until it read them again, so the backend runs
`/etc/init.d/ha-cluster firewall` after `/etc/init.d/kea` was called with
`start`, `restart` or `reload` and succeeded. That is the one place through
which every page makes Kea read its files, and at that moment the file and
the ports Kea listens on agree.

The first plan was `reload`. The reload of `ha-cluster` starts a cluster
that is enabled and not running, and stops a running one that is disabled
in its config: a node whose cluster was stopped for a reason would take its
virtual addresses back because someone saved a DHCP option. The
`ha-cluster` project made the command `firewall` instead. It brings the
rules up to date, reloads the firewall only when one changed, and starts,
stops and signals no daemon, whether the cluster runs or not.

The backend calls it when all of this holds:

- the init script of `ha-cluster` is installed and names the command.
  rc.common answers a command a script does not have with its help text
  and the exit status 0, so an older `ha-cluster` would look as if it had
  done it;
- `enabled` is set in the section `config` of `/etc/config/ha-cluster`;
- `dhcp_backend` is `kea` there, without which `ha-cluster` has no rule
  for these ports.

The command would do nothing in the last two cases by itself. They are
checked here so that the pages do not report something that did not happen.

The backend waits for the command, 15 seconds at most. Two calls at the
same time would write the firewall config together, and rpcd runs one call
after the other. The answer of `setInitAction` has `cluster_firewall`:
true when the command succeeded. The pages add a sentence to their report,
because another package was called than the one the user named; when it
failed they warn, and Kea is still reported as started or reloaded.

Whether a URL changed is not looked at. A call that finds nothing to change
takes a few hundredths of a second, and the enabled daemons, which also
decide the ports, change without any file being written.

### Where the log goes

The Global settings tab has one field for the output of the loggers. It
shows what the file has: one output, several different ones, or none, in
which case Kea prints to its standard output. It offers two outputs to
change to, the system log and the standard output, both of which end in the
system log on OpenWrt. A log file cannot be chosen there: Kea writes log
files only to `/var/log/kea`, which OpenWrt does not create, and a file
elsewhere stops the daemon. A file that is already configured stays until
the field is changed, and can still be set on the Configuration page.

Choosing an output sets it in every output option of every logger. Options
that only matter for a file (`maxsize`, `maxver`, `flush`) stay; Kea accepts
them with syslog. Without any logger the form adds one for the daemon.

### Setting Kea up from dnsmasq

A router that moves from dnsmasq to Kea, by hand or because `ha-cluster`
switches a cluster, needs a Kea configuration that serves what dnsmasq
served. On the test router of the owner, a configuration made by hand in
the forms listened on no interface and had a subnet without a pool, and
`ha-cluster` refused to switch four times. `setup.uc` makes one instead,
and both the command `setup-from-dnsmasq` and the Setup page use it.

What it reads: the pools of `/etc/config/dhcp` (or, with `ha-cluster`,
the interfaces it names as the DHCP interfaces of the cluster, with their
device and virtual addresses), the static IPv4 address of each interface
in `/etc/config/network`, and the domain of dnsmasq. What it makes, for
each interface: a subnet bound to the device, the device with the
router's own address in the list Kea listens on (named alone, the device
makes Kea open a socket for each of its IPv4 addresses, the virtual ones
of a cluster too, and take each request once per address), the pool as
dnsmasq counts
it (start and limit from the network address, ending before the
broadcast address), the lease time with renewal at a half and rebinding
at seven eighths of it, and the options. The options of the pool that
have a Kea counterpart are taken over (router, DNS, domain, domain
search, NTP, NetBIOS), 0.0.0.0 standing for the router itself as in
dnsmasq; without them the clients get the router as gateway and DNS, the
virtual address of a cluster where there is one. Tagged and vendor
options and other numbers are listed as not carried over. With a cluster
whose nodes have their Kea roles, a pair in hot standby is added, with
the timers of the bench of the `ha-cluster` project; with
`kea-hook-run-script` and `kea-dnsmasq-hosts` the hook for client names
in DNS.

It writes a file that is missing or still the example the Kea package
installed: owned by the package in the database of apk, and not marked as
changed by `apk audit --backup /etc/kea`. When `apk audit` fails it prints
nothing, so its exit code is checked: a failure counts as a changed file. A file someone has changed is
never replaced by the command, which `ha-cluster` runs on its own. The
page shows what it would write, so that the change can be made by hand,
and replaces the file only when the user asks for it and confirms that
what the file holds beyond dnsmasq's settings goes; the file is kept as a
backup. That is the owner's decision. Writing goes
through the save of the pages: Kea checks the text with its hooks, the
example is kept as a backup, and the lock is held.

The command does not ask `ha-cluster` from inside rpcd. `ha-cluster`
passes its reply with `--cluster -`; without it the command asks over
ubus itself, which is safe outside rpcd. The page fetches the reply in
the browser and passes it to the backend. rpcd, which answers for
`ha-cluster`, reloads for a moment when a package is installed, as the
bench of the `ha-cluster` project showed: both ask a second time after a
pause, and while an installed `ha-cluster` still does not answer they
write nothing, since the result would lack the pair.

The leases dnsmasq has given out are handed to a running kea-dhcp4 with
lease4-add, after it was started on the new file: each lease that has
not run out and lies in a subnet of Kea. Kea refuses an address it has
leased already, so a second run, or a run on both nodes of a pair, adds
nothing twice. dnsmasq 2.93 kept its lease file when it was restarted
without any DHCPv4 range (measured); a caller that wants to be sure can
save a copy before and pass it with `--leases-file`. The lease file is
read only when it is a plain file of root's own, no link, of at most
4 MiB: it lies in `/tmp`, where a pipe in its place would block rpcd. The
init script of dnsmasq creates it as root, and in `/tmp` a file of root's
can be replaced by root alone, so it cannot become a pipe between the
check and the read.

### Who may see and do what

The ACL of the application has two groups. An external audit of `0.11.0`
and `0.13.0` showed what that split did not cover; since `0.14.0`:

- A reader gets the configuration files with the values of passwords and
  secrets masked: any member named `password` or `secret`, or ending in
  `-password` or `-secret`. The text is masked where it stands, so that
  comments and layout stay. Since `0.15.2` it is read as Kea's lexer reads
  it: a comment between a name and its colon, or a name written with
  escapes (`"\u0070assword"`), does not hide a secret, and a secret
  written out in a comment is masked too. The pages that edit a file ask
  for it with the write-level `getConfigRaw` first and fall back to the
  masked one; a text with a masked secret is not saved, so a masked value
  cannot replace the real one.
- Kea checks a file as root, and its errors quote what it read. An include
  directive would let a writer have Kea read any file of the router, and
  the run_script hook looks at the path it is given before it checks the
  directory. So a text may include only a `*.json` or `*.conf` file
  directly in `/etc/kea`, which is no link, and may name only a script in
  `/usr/share/kea/scripts`; both are refused before Kea sees the text.
  Kea's lexer allows blanks and line ends inside a directive
  (`<? include "x" ?>`), so every `<?` of a text is checked as one, also
  within a string or a comment. That refuses a text with a `<?` that Kea
  would not take for a directive; a string can write it `\u003c?`. It is
  kept so, because any difference between this check and Kea's lexer in
  telling strings and comments apart would open the hole again. In a text
  with an include, which is not JSON, the run_script hook is looked for
  with escapes decoded, and the path of a library is trimmed as Kea trims
  it.
- Kea's check and its log quote a string they cannot read as it is
  written, a password too ("Bad escape in ..."). What `getConfig`,
  `validate` and `getLog` return has every secret of the files in
  `/etc/kea` that can be included replaced by the mask.
  `validate`, a read-level method, checks only the files on disk.
- A writer may change the Kea files and run Kea; it may not stop the DNS
  of the router. dnsmasq and odhcpd are therefore no longer stopped or
  disabled from here. Their DHCP is switched off per interface in
  `/etc/config/dhcp`, through LuCI's own page and its ACL.
- Whatever comes from the router is shown as text. LuCI's `E()` puts a
  string child into `innerHTML`; the pages give it a list, or for LuCI's
  table helper a value escaped with `%h`. `test/js/children.test.js`
  refuses a child that builds or picks a string outside a list. A text
  area gets its text as its value: as a child, its entities would be
  decoded.
- A host name goes into a reservation only when it is one (letters,
  digits, `-` and `_`, joined by dots): Kea hands it to the clients and to
  DNS as it is written, and a name in a lease may come from another server
  of a pair, which passes on what it is sent.

Not done yet: authentication of the high availability peers (Kea's
basic-auth or TLS), which the same audit asks for (CA-HACLUSTER-01). It
needs a secret shared by the nodes, which `ha-cluster` is to provide.

### Client names in DNS

dnsmasq answers for the names of the clients it serves, from its own
leases. Under Kea that is gone: dnsmasq takes no DDNS, and OpenWrt has no
package that gives the leases of Kea to it. The `ha-cluster` project made
two packages for it: `kea-hook-run-script`, the run_script hook of Kea,
which runs a script for every lease event, and `kea-dnsmasq-hosts`, whose
script only notes that something changed and whose service then writes a
hosts file for dnsmasq from the lease files of Kea, and has dnsmasq read
it. In a pair of Kea servers the leases are on both nodes, so each node
writes its own file.

This application only writes the one hook entry, by a switch on the
Global settings tab of each DHCP page:

```json
{ "library": "/usr/lib/kea/hooks/libdhcp_run_script.so",
  "parameters": { "name": "/usr/share/kea/scripts/kea-dnsmasq-hosts", "sync": false } }
```

Kea 3 runs scripts from `/usr/share/kea/scripts` only; with another path
the hook does not load and the check refuses the file. With `sync` false
Kea does not wait for the script, which in Kea 3.0.4 it does not anyway.

The switch is shown when the library and the script are installed, and
also when the file has the entry without them: Kea would not start with
it, and the switch is the way to take it out. An entry of the hook with
another script is left alone, and the tab says so instead of showing the
switch. Kea loads hooks when it starts, so the change takes effect with
Save & Apply, which restarts Kea for a changed file.

### Leases on the status overview

LuCI shows the leases of dnsmasq and odhcpd on its status overview, under
"DHCP Leases". With Kea serving, that section is empty, and the leases are
where nobody looks for them. So the application adds a section of its own
to that page, `view/status/include/41_kea.js`, which the page loads with
its other sections and reloads every few seconds, and shows the same on
its Overview page, limited to the ten leases given out last of each
protocol.

The tables follow those of LuCI: interface, hostname (with the name the
network knows for the MAC address, when it differs), address, MAC address
or DUID and IAID, remaining time, and a button "Reserve IP". The interface
is the one of the Kea subnet the lease is in; a relayed subnet has none.
A declined address is not shown there: it is nobody's lease.

"Reserve IP" turns the lease into a reservation in Kea. LuCI's button for
dnsmasq writes a static lease to UCI and lets the user apply it; here the
reservation goes into the Kea file at once, after a dialog that shows it
and lets the user change the hostname, and a running Kea is made to read
the file. The backend builds a static lease of the address and the MAC
address or DUID and passes it through the import, so the same checks apply
(a Kea subnet must hold the address; neither the client nor the address
may be reserved already; Kea must accept the file), under the same lock.
The button is greyed out when Kea already reserves an address for the
client or the address for another client, also in a disabled reservation,
and for a delegated prefix, which the import does not reserve.

### The import from a shell

Another package that switches a router from dnsmasq to Kea, as
`ha-cluster` does with its backend `auto`, has to import the static leases
first and without anyone at the page. It could call `importDnsmasqCommit`
over ubus, but not from anything the backend of this application runs and
waits for, such as the command `firewall` of `ha-cluster`: rpcd would wait
for itself, as it did for the nodes of a cluster. And rpcd has to run.

`/usr/libexec/luci-app-kea/import-dnsmasq` uses the library directly
instead. Without arguments it imports what the Import page selects by
itself, the entries that are ready. `--include-review` adds those that
lose a setting or are disabled. An entry that would change a reservation
Kea already has is never imported here: that needs someone to look.

It reports, as JSON, what it imported and what it left (by status, and
each left entry with its key, name, identifier and the reason), as the
files are after the run, so that the caller can name what it could not
carry over. The exit status says whether anything was refused: 0 also when
there was nothing to do, so that a caller can run it at every switch.

### The lock

Since the import command there are two writers of the Kea files: rpcd,
which runs one call at a time, and that command. Both read a file, change
it, check it with the Kea binary and rename a temporary file into place,
under the same name. Every change therefore runs under an exclusive lock
on `/var/run/luci-app-kea/config.lock`: a save, a restore, and an import
from reading the files to writing the last one. The lock is the kernel's
(`flock`), so it goes with a process that dies; a holder waits up to ten
seconds for another one, then gives up and writes nothing. Its directory
is made for root alone and nothing is locked when it is not such a
directory: in `/var/lock`, where it was before `0.15.2` and anyone can
write, another user could take the lock first or put a pipe in its place.

It does not cover a page that loaded a file before an import and saves it
afterwards: that save is a change of its own and replaces what the import
wrote.

### Telling other packages about Kea

After the application runs `/etc/init.d/kea` with `start`, `restart`,
`reload` or `stop`, it sends the procd event `kea.service`, with the action
as `data.action`. A package that wants to know registers a trigger, as
`ha-cluster` does with
`procd_add_raw_trigger "kea.service" 1000 /etc/init.d/ha-cluster dhcp-backend`.
procd runs that command on its own, after the delay, so nothing of it
happens inside the call of the application, which returns at once. The
event is sent whether the script succeeded or not: it says that something
was done, and a listener looks at Kea itself.

There is no event when a component is switched on or off on the Services
page. That only changes `/etc/config/kea`; Kea is not started until the
user does so, and a listener that acted on the flag would switch dnsmasq
off before Kea answers.

### Second DHCP server on an interface

The backend reports for each OpenWrt interface whether `/etc/config/dhcp`
makes dnsmasq or odhcpd serve DHCPv4 or DHCPv6 on it. The editor warns on the
tab of such an interface while Kea is enabled on it and dnsmasq or odhcpd is
running. It is a warning, not a block: moving a network from dnsmasq to Kea
passes through this state.

The same reading of `/etc/config/dhcp` is shown on the Services page, by
service: the interfaces on which dnsmasq answers DHCPv4, those on which
odhcpd answers DHCPv6 and sends router advertisements, and whether dnsmasq
is a DNS server. The rules are the ones of the init scripts of OpenWrt
25.12: a section with `ignore` serves nothing; dnsmasq answers DHCPv4 unless
the section says `dhcpv4 'disabled'`; where odhcpd is the main DHCP server
(`maindhcp`) it answers DHCPv4 instead, on sections with `dhcpv4 'server'`;
DHCPv6 and router advertisements need `server`, `relay` or `hybrid`; dnsmasq
is a DNS server unless its port is 0.

The way to hand a network to Kea is to switch DHCP off for its interface,
not to stop a service: dnsmasq is usually the DNS server as well, and odhcpd
sends the router advertisements. The page says so, and asks before it stops
either of them, or takes it out of the boot sequence, while it has such a
duty.

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
- if Kea rejects one file, neither is replaced;
- the import command: its arguments, a dry run, a run and a second run,
  what it leaves, a refusal, and no Kea configuration; on the target, the
  installed command and its exit status.

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
