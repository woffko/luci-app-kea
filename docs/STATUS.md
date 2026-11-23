# Project Status

Status date: 2026-11-23. Package version `0.15.1-r1`, alpha.

This is a code-level inventory of what exists and what is missing. The work
needed to close the gaps is ordered in [ROADMAP.md](ROADMAP.md). Packaging
issues are listed separately in [PACKAGING.md](PACKAGING.md).

## Summary

| Area | State |
|------|-------|
| Package skeleton, menu, ACL | Done |
| rpcd backend (`luci.kea`, 21 methods) | Done, in ucode |
| Overview page | Done, with the Kea version, what the running DHCP daemons say about themselves, the recent log messages and where the daemons write their log |
| Services page | Done, with what dnsmasq and odhcpd are configured to serve and whether a running Kea daemon listens |
| Raw configuration editor | Done, with syntax check, change view, backups and restore |
| DHCPv4 structured editor | Subnets, pools, options, reservations, global settings; everything else in the file is preserved |
| DHCPv6 structured editor | The same, plus prefix delegation pools |
| Static lease import | Done for DHCPv4 and DHCPv6 |
| High availability | Done for one relationship, as a tab of the DHCPv4 and DHCPv6 editors; the peers can be filled in from `ha-cluster`, which is told to bring its firewall rules up to date when Kea takes a new configuration; the state of the running pair is shown |
| Lease viewer | Done, read from the lease files |
| Input checks | In the browser, for what the editors write; the Kea binary on every save, with hooks loaded for the DHCP daemons; a warning for the two settings known to pass that check and stop the daemon |
| Automated tests | Unit tests (JavaScript and ucode), on-target tests, browser tests |
| CI | GitHub Actions: lint, unit tests, SDK package build, and the on-target and browser tests on OpenWrt in QEMU |
| Releases | `v0.7.0` on 2026-11-17, made by hand. `v0.8.0` on 2026-11-20 and `v0.9.0`, tagged on 2026-11-21: the release workflow built and tested the package and prepared the release as a draft for the owner to publish. All are marked as pre-releases |
| Distribution | Package file on the Releases page; the repository is an OpenWrt feed for those who build |
| Translations | Not started (only the template exists) |

## Verification state

`0.7.0-r1` was built with the official OpenWrt 25.12.6 x86-64 SDK and
installed with `apk` on two machines running Kea 3.0.4 from the official
package repository (November 2026): an OpenWrt 25.12.6 x86-64 virtual machine
under QEMU, and an OpenWrt 25.12.5 x86-64 virtual machine under VMware. On
the first:

- all seven pages open in a headless browser without JavaScript errors;
- leases a DHCP client really obtained are shown: `kea-dhcp4` and
  `kea-dhcp6` served a virtual interface pair, and the DHCPv4 address, the
  DHCPv6 address and the delegated prefix of the client appeared on the
  Leases page, its exchange with the servers in the log on Overview;
- the leases browser test passes with lease files that hold leases in use
  next to leases that ran out, were released or were replaced;
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

On the second machine the ucode tests and all five browser tests pass with
`0.7.0-r1`; Save & Apply was checked there with `kea-dhcp-ddns` running, on
`0.3.0`. That machine has a static lease of its own, which the import test
leaves alone.

The package file of the release `v0.7.0`, built by CI, passed the same
tests on both machines before it was published.

Since 2026-11-17 CI repeats the ucode tests against the installed library
and the browser tests for every pull request, on a fresh OpenWrt 25.12.6
machine under QEMU with Kea from the official package repository. What was
checked by hand above (a real DHCP client, Save & Apply with a running
daemon) is not part of that run.

`0.8.0-r1` was built and tested on the QEMU machine only, by hand and by
CI: 117 backend tests on the router and six browser tests. What it warns
about was measured there with Kea 3.0.4 first: `kea-dhcp4` and `kea-dhcp6`
accept a lease file and a log file in a wrong directory with `-t` and `-T`
and exit when started with them, and the packaged configuration files log
into a directory that does not exist. Checked by hand with `kea-dhcp4`
running on that machine: Save & Apply of such a file asks first; with the
answer no the daemon keeps running, and with the answer yes it is gone
after the reload and the reason is in the log on Overview. The new browser
test does the same without a daemon, by telling the page that one runs.
`0.8.0-r1` was not installed on the second machine.

The package file of `v0.8.0` was built by the release workflow from the
tagged commit and passed the same 117 backend tests and six browser tests in
that run, on OpenWrt 25.12.6 under QEMU with Kea 3.0.4. It holds the same
files as the package that was tested by hand before.

`0.9.0-r1` was built and tested on the QEMU machine, by hand and by CI: 132
backend tests on the router and six browser tests. Checked by hand there,
with Kea 3.0.4 and with DHCP of dnsmasq and odhcpd switched off on the LAN:

- Starting from the files shipped with Kea, the DHCPv4 and DHCPv6 pages
  made Kea listen on `br-lan` and wrote the two retry parameters. After two
  boots with these files, and two more with files written by hand, both
  daemons were listening.
- Without the parameters `kea-dhcp6` did not listen after any of four boots
  (its link-local address was not usable yet), and `kea-dhcp4` did not
  after two of seven ("the interface br-lan is not running"). In that state
  Overview and Services showed the daemon as running and not listening,
  with Kea's reason. A reload did nothing; a restart made it listen.
- Two `kea-dhcp4` processes paired on the machine reached the state
  hot-standby, and the pages showed mode, roles and states; while the pair
  was still synchronizing, the pause of the DHCP service was shown without
  an alarm. After the partner was stopped the state was partner-down.
- The peers filled in from the nodes of a cluster were accepted by
  `kea-dhcp4 -T` and `kea-dhcp6 -T` with the hook loaded, in the browser
  test, which answers the call to `ha-cluster` itself. No `ha-cluster` was
  installed on the machine, and no pair of routers was run with a
  configuration made this way.

`0.9.0-r1` was not installed on the second machine.

`0.9.1-r1`, one fix, was tested on the QEMU machine by hand and by CI: 134
backend tests on the router and six browser tests. It was not released.

`0.10.0-r1` was tested on the QEMU machine and by CI: 142 backend tests on
the router and six browser tests. The call of `ha-cluster` was also tried
by hand on that machine, with the init script and the library of the
development tree of `ha-cluster` of 2026-11-21 copied to it, not its
package, and no cluster running:

| Done from the application | Rule `HA-Cluster-Kea-HA` in the firewall | Time of the call |
|---------------------------|------------------------------------------|------------------|
| Kea started, peer URLs with port 8001 | written and loaded, port 8001 | |
| URLs changed to port 8011, Kea reloaded | port 8011 | 0.6 s |
| Kea reloaded, nothing changed | as it was | under 0.1 s |
| Kea stopped | `ha-cluster` not called | |
| Cluster disabled, or with dnsmasq as its DHCP server | `ha-cluster` not called | |

procd knew of no `ha-cluster` service afterwards and no keepalived ran.

`0.10.0-r1` was not installed on the second machine.

`0.10.1-r1`, one fix, was tested on the QEMU machine and by CI: 137 backend
tests on the router and six browser tests. By hand, with the rpcd plugin,
init script and library of the development tree of `ha-cluster` copied to
the machine:

| | `0.10.0-r1` | `0.10.1-r1` |
|---|-------------|-------------|
| The DHCPv4 page appears after | more than 30 s | 0.2 s |
| Other calls to rpcd meanwhile | time out | answered |
| The button that fills the tab from the cluster | never shown | shown |
| Filled in by it | | this server and both peers, with port 8001 |

On a machine without `ha-cluster` the pages show neither an error nor the
button.

`0.10.1-r1` was not installed on the second machine.

`0.15.1-r1`, one fix of the configuration made from dnsmasq's settings,
was tested on the QEMU machine and by CI. The reason for it, measured on
that machine with an interface that had three IPv4 addresses and one
client:

| `interfaces` | Kea's warning | DISCOVER taken | OFFER sent | REQUEST taken | ACK sent |
|--------------|---------------|----------------|------------|---------------|----------|
| `kea-t0` | DHCPSRV_MULTIPLE_RAW_SOCKETS_PER_IFACE | 3 | 2 | 3 | 3 |
| `kea-t0/10.66.0.1` | none | 1 | 1 | 1 | 1 |

`0.15.0-r1` was tested on the QEMU machine and by CI: 173 backend tests on
the router, among them the setup command with the real Kea checking what
it makes, also a pair of high availability, and eight browser tests. By
hand on that machine, the whole move with a real client on a virtual
interface:

1. dnsmasq gave the client `mover` the address 10.66.0.57.
2. `setup-from-dnsmasq` wrote the configuration over the example of the
   package, with the example as a backup: the subnets of `lan` and of the
   new interface, nothing left out. Run again, it answered with exit 3:
   the file was its own now.
3. With the DHCP of dnsmasq off on both interfaces, kea-dhcp4 started and
   opened its sockets.
4. `import-dnsmasq --leases` added the lease; run again, Kea refused it as
   existing.
5. The client asked for its address again and got 10.66.0.57 from Kea,
   with its name.

`0.14.0-r1` was tested on the QEMU machine and by CI: 160 backend tests on
the router and seven browser tests, which now check that a host name and a
log line with markup are shown as text and that the Services page has no
Stop or Disable for dnsmasq and odhcpd. By hand on that machine, over the
JSON-RPC of LuCI:

| As | Call | Answer |
|----|------|--------|
| a login with only the read groups `unauthenticated`, `luci-base`, `luci-app-kea` | `getConfig` of a file with a TSIG secret | the secret masked |
| the same | `getConfigRaw`, `saveConfig`, `setConflictAction` | Access denied |
| root | `getConfigRaw` | the secret as it is |
| root | `saveConfig` with `<?include "/etc/shadow"?>` | refused before Kea ran |
| root | `saveConfig` with run_script `name` `/root/.ssh/x` | refused before Kea ran |
| root | `saveConfig` of a text with the masked secret | refused |
| root | `setConflictAction` dnsmasq `stop` | refused; dnsmasq ran on |

A DHCP client that sent the host name `<img src=x onerror=alert(1)>` to Kea
3.0.4 with its default settings got its lease stored with the host name
`img`: Kea strips such names by itself.

`0.13.0-r1` was tested on the QEMU machine and by CI, and by hand with the
packages `kea-hook-run-script` 3.0.4-r2 and `kea-dnsmasq-hosts` 1.0.0-r1
built by the `ha-cluster` project, installed with the Kea 3.0.4-r2 they
were built with:

- As built, `kea-dnsmasq-hosts` put its script in
  `/usr/lib/kea-dnsmasq-hosts/`. Kea 3.0.4 refuses that: "invalid path
  specified: '/usr/lib/kea-dnsmasq-hosts', supported path is
  '/usr/share/kea/scripts'". The check of Kea refused the file, and the
  application wrote nothing. The switch now names
  `/usr/share/kea/scripts/kea-dnsmasq-hosts`, and that package is to
  install its script there.
- With the script copied to that path: the switch was shown, Save & Apply
  wrote the hook entry and restarted Kea, a client on a virtual interface
  took 10.77.0.100 with the name `browser-client`, the name was in the
  hosts file of dnsmasq a few seconds later, and dnsmasq answered for it.
  Switched off, the entry was gone and Kea ran on.
- Not yet with a build of `kea-dnsmasq-hosts` that installs the script in
  the new place.

`0.12.0-r1` was tested on the QEMU machine and by CI: 156 backend tests on
the router and seven browser tests, the new one for the lease tables on
the status overview of LuCI and on Overview and for "Reserve IP". It was
not installed on the second machine.

`0.11.0-r1` was tested on the QEMU machine and by CI: 152 backend tests on
the router and six browser tests. By hand on that machine:

- The import command with rpcd stopped: a dry run in 0.03 seconds, an
  import of the two ready entries of the fixture in 0.13 seconds, a second
  run that wrote nothing, exit status 2 for an unknown argument and 1
  without a Kea configuration.
- A save from LuCI while another process held the lock for three seconds:
  it waited and succeeded after 3.05 seconds; rpcd answered other calls
  afterwards.
- A procd service standing in for `ha-cluster`, with
  `procd_add_raw_trigger "kea.service" 1000`: its command ran one second
  after each start, reload, stop and restart of Kea from the application,
  and not after "enable". The call of the application returned in 0.01
  seconds each time.

The package file of `v0.15.0` was built by the release workflow from the
tagged commit and passed the 173 backend tests and eight browser tests in
that run, on OpenWrt 25.12.6 under QEMU with Kea 3.0.4. It holds the same
files as a package built from the same commit by hand. A package of the
pull request before its last change ran on the pair of routers of the
`ha-cluster` project. It was not installed on the second machine.

The package file of `v0.14.0` was built by the release workflow from the
tagged commit and passed the 160 backend tests and seven browser tests in
that run, on OpenWrt 25.12.6 under QEMU with Kea 3.0.4. It holds the same
files as the package that was tested by hand before. It was not installed
on the second machine.

The package files of `v0.11.0`, `v0.12.0` and `v0.13.0` were built by the
release workflow from their tagged commits and passed the tests in those
runs, on OpenWrt 25.12.6 under QEMU with Kea 3.0.4: 152 backend tests and
six browser tests for `v0.11.0`, 156 and seven for the other two. The file
of `v0.13.0` holds the same files as the package that was tested by hand
before. `v0.10.1` was the last release before them; `v0.10.0` should not be
used on a router with `luci-app-ha-cluster`.

Not exercised: clients on a real network, two Kea servers exchanging
leases, the lease file cleanup running while the page reads the files, the
DDNS daemon serving updates, and upgrades from `0.1.0`.

The first runtime tests were made in May 2026 on OpenWrt 25.12.3 with
Kea 3.0.2.

## Implemented

### Backend

The paths below are inside the package directory, `luci-app-kea/`.

`root/usr/share/rpcd/ucode/luci.kea` is an rpcd ucode plugin. It only maps
the ubus methods below to the library in `ucode/kea/`, which is installed as
the `luci.kea.*` ucode modules:

| Module | Content |
|--------|---------|
| `config.uc` | Paths, validation with the Kea binary, read, save, backups, restore, the lock around every change of a file; the settings that pass the check and stop the daemon; where the loggers write |
| `service.uc` | Component and service state from procd, init actions, runtime files |
| `openwrt.uc` | What dnsmasq and odhcpd are configured to serve, from the sections of `/etc/config/dhcp` |
| `cluster.uc` | Whether `ha-cluster` follows the Kea files, and whether its init script has a command |
| `setup.uc` | The DHCPv4 configuration made from dnsmasq's settings, whether the file is the example of the package, and whether the server is set up |
| `runtime.uc` | Kea version, Kea messages of the system log, leases from the lease files, and a client for the control socket of a daemon |
| `importer.uc` | Static lease classification against the Kea configuration, import, the import command, and the move of the leases of dnsmasq |
| `jsonc.uc` | JSON with `//`, `#` and `/* */` comments |
| `net.uc` | IPv4 helpers |

| Method | ACL | Purpose |
|--------|-----|---------|
| `getStatus` | read | Kea version, init script state, binaries, hook libraries, config files, runtime paths, dnsmasq/odhcpd state and what they are configured to serve |
| `getLeases` | read | The DHCPv4 and DHCPv6 leases in use, from the lease files of the daemons, each marked when Kea already reserves its client or its address, and the subnets by id with their interface |
| `getLog` | read | The last Kea messages of the system log, split into time, daemon, severity and text, and the log outputs of each installed daemon |
| `getServices` | read | `config service` sections of `/etc/config/kea` with enabled and running flags |
| `getDaemonState` | read | What each running DHCP daemon answers to `status-get` on its control socket: the state of its sockets and of high availability |
| `getNetworkInterfaces` | read | Interfaces from `/etc/config/network` (name, device, proto, addresses) and whether OpenWrt serves DHCPv4 or DHCPv6 on each, from `/etc/config/dhcp` |
| `validate` | read | The Kea binary's own check of the DHCPv4, DHCPv6, DDNS and control agent configs, with the warnings for a file that passed |
| `getConfigList` | read | The four Kea config files with size and presence |
| `getConfig` | read | File content with the values of passwords and secrets masked (`masked` counts them), plus validation result and warnings |
| `getConfigRaw` | write | The same, byte for byte: for the pages that edit the files |
| `listBackups` | read | Backups of one config file, newest first |
| `importDnsmasqDryRun` | read | What an import of the static leases in `/etc/config/dhcp` would do |
| `saveConfig` | write | Refuse an include of anything but a `*.json` or `*.conf` file directly in `/etc/kea`, a run_script path outside `/usr/share/kea/scripts`, and a masked secret; then write to a temporary file, validate with the Kea binary, back up, replace; returns the warnings for the new file |
| `restoreBackup` | write | Validate a backup, back up the current file, replace it; returns the warnings as well |
| `reserveLease` | write | Reserve the address of a lease for its client, through the checks of the import; returns the warnings of the file. Does not reload Kea |
| `setService` | write | Enable or disable a Kea component in UCI |
| `setInitAction` | write | `enable`, `disable`, `start`, `stop`, `restart`, `reload` for `/etc/init.d/kea`. After `start`, `restart`, `reload` and `stop` it sends the procd event `kea.service` with the action, whether the script succeeded or not. After `start`, `restart` and `reload` it runs `/etc/init.d/ha-cluster firewall` for an enabled `ha-cluster` that has Kea as its DHCP server, and the reply then has `cluster_firewall`, true when that command succeeded |
| `setConflictAction` | write | `start`, `restart`, `reload` and `enable` for `dnsmasq` and `odhcpd`; not `stop` or `disable` |
| `importDnsmasqCommit` | write | Write the selected entries (or all ready ones) to `kea-dhcp4.conf` and `kea-dhcp6.conf` |
| `setupFromDnsmasq` | write | The DHCPv4 configuration made from dnsmasq's settings: what it would be (checked by Kea), or written while the file is missing or still the example of the package, or with `replace` over a file of the user's own |
| `moveDnsmasqLeases` | write | The leases of dnsmasq into a running kea-dhcp4, with lease4-add |

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
- `leasetable.js`: the tables of the leases in use and the dialog that
  reserves an address, shared by the Overview page and the status overview.

### Pages

- **Overview** (`overview.js`): Kea version, runtime state, installed
  components and hooks, config file presence, the result of checking each
  file, and the last thirty messages of the Kea daemons in the system log.
  For each running DHCP daemon: whether its sockets are open, and the mode,
  roles and states of high availability. A daemon that could not open a
  socket is named at the top of the page with Kea's reason, which names the
  interface. The leases in use: their number, and the ten given out last
  of each protocol in the tables of the status overview, with a link to
  the Leases page.
- **Status, Overview of LuCI** (`view/status/include/41_kea.js`): a section
  "Kea DHCP Leases" with a table of DHCPv4 and one of DHCPv6 leases, as the
  section of dnsmasq has them: interface, hostname, address, MAC address or
  DUID and IAID, remaining time, and "Reserve IP". The overview reloads it
  every few seconds. Hidden when Kea keeps no leases.
- **Leases** (`leases.js`): the DHCPv4 and DHCPv6 leases in use, with
  address or delegated prefix, MAC address, client ID or DUID, hostname,
  subnet, remaining time and state. Refreshed every ten seconds.
- **Setup** (`setup.js`): the DHCPv4 configuration made from what dnsmasq
  serves, with its subnets, the pair of high availability if any, what is
  not carried over, the answer of Kea's check and the file itself; Write
  while the file is missing or still the example of the package, Replace
  after a confirmation for a file someone has changed, the replaced file
  kept as a backup; and the move of the leases of dnsmasq into a running
  Kea.
- **Services** (`services.js`): init service table with actions; Kea
  component table with staged enable/disable checkboxes committed by Save or
  Save & Apply; conflict table for dnsmasq and odhcpd with what each is
  configured to serve (DHCPv4 and DHCPv6 by interface, router
  advertisements, DNS), start, restart and enabling autostart. They are not
  stopped or disabled from here; the page points to LuCI's settings of the
  interfaces, where their DHCP is switched off per interface. The row of a
  running Kea DHCP daemon says whether its sockets are open.
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
    the output of the loggers, the retries for the sockets, the switch for
    client names in DNS, and the options sent to every subnet. The log output can be set to the system log or the
    standard output; a log file that the file already names is shown and
    left alone.
  - When the page makes Kea listen on an interface it did not listen on,
    and the file says nothing about retries for the sockets, it adds
    `service-sockets-max-retries` 60 and `service-sockets-retry-wait-time`
    2000. See [Kea at boot and at run time](#kea-at-boot-and-at-run-time).
  - High availability, on a tab that is offered when `kea-hook-ha` is
    installed or the file already loads the hook: mode, the name of this
    server, the peers with URL, role and automatic failover, timers, lease
    update switches, and every other parameter of the hook as JSON text.
    Switching it on also loads the lease commands hook, which the servers
    need to exchange leases. With `ha-cluster` installed and a partner
    known to it, a button fills in the name of this server and the peers
    from the nodes of the cluster, with port 8001 for DHCPv4 and 8002 for
    DHCPv6; nothing is saved by it.
  - A value Kea would refuse is marked while it is typed, with the reason,
    and reported by field on save. See
    [What the editors check](#what-the-editors-check).
  - A warning on the tab of an interface on which OpenWrt also serves DHCP
    while dnsmasq or odhcpd runs.
  - A warning above the tabs when the file has a setting Kea accepts in its
    check and does not start with. See
    [What the check of Kea does not see](#what-the-check-of-kea-does-not-see).
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
  IP address and a port, and `https` only with the TLS parameters; one
  primary server,
  and the roles the mode takes (one standby for hot standby, one secondary
  for load balancing, only backups for passive backup); whole numbers for
  the timers; a JSON object for the additional parameters.

Every save still goes through the Kea binary on the router, which has the
last word.

### What the check of Kea does not see

Measured with Kea 3.0.4: `kea-dhcp4` and `kea-dhcp6` accept two settings
when they check a file, also with the hook libraries loaded (`-T`), and
exit when they start with them.

- A lease file (`lease-database`, `name`) whose directory is not
  `/var/lib/kea`. A name without a directory is fine. The name is not
  looked at when `persist` is false.
- A log file (`output` of a logger) whose directory is not `/var/log/kea`.

A third setting does not stop the daemon and can leave it deaf: interfaces
to listen on without retries for the sockets. See
[Kea at boot and at run time](#kea-at-boot-and-at-run-time).

A fourth breaks a high availability pair: a peer URL without a port, or
with port 0. Measured with two Kea 3.0.4 servers: the hook accepts it, each
server listens on a port chosen at random, the heartbeats are refused, and
both servers end up in the state partner-down, so that the standby answers
clients as well, without any exchange of leases. The tab does not take such
a URL since `0.9.1`; a file that has one is warned about.

The backend finds these in a file that passed the check and reports them as
warnings. They are shown with the result of the check on Overview and on
the Configuration page, above the tabs of the DHCPv4 and DHCPv6 pages, and
in the message after a save or a restore. A save is not refused. Save &
Apply asks before it reloads a running daemon with such a file; with the
answer no, the daemon keeps running with its previous configuration.

Overview also lists the daemons whose loggers write to a file, because the
messages below it come from the system log, and says when the directory of
that file does not exist: Kea then logs nothing after it has read its
configuration. This is the state of the configuration files shipped with
Kea, on OpenWrt.

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
| `node --test "test/js/*.test.js"` | Any machine with Node.js | The configuration model (56 cases, plus the stock Kea configs when `KEA_STOCK_DIR` is set) and the high availability model (28 cases), with what `ha-cluster` says about its nodes; one case reads the backend sources and fails when they call a ubus object that rpcd serves |
| `test/run-ucode-tests.sh` | Any machine with a ucode interpreter | The backend library with a stand-in for the Kea binary: comment stripping, JSON writing, IPv4 and IPv6 helpers, save, backups, restore, retention, how the Kea binary is called and its refusal reported, import classification and commit, lease files, log lines, version, the settings Kea does not start with, log outputs, what dnsmasq and odhcpd serve, the client of the control socket against a stand-in server, the state of a daemon, when `ha-cluster` follows the Kea files, the lock around changes of a file, the import command, the subnets of a lease, reserving a lease, masked secrets, the includes and run_script paths that are refused, the configuration made from dnsmasq's settings and when it is written, the move of the leases of dnsmasq (129 cases) |
| `test/run-ucode-tests.sh --target` | OpenWrt with the Kea daemons | The same plus 44 cases with the real Kea binaries, UCI and procd: validation, a hook checking its parameters (needs `kea-hook-ha`), that Kea accepts a lease file and a log file in a wrong directory, service state, init actions and the event after them, the call of `ha-cluster` with a stand-in for its init script, API password, import from a UCI fixture, the installed import command with a dry run on the system's own files, the setup command with Kea checking what it makes, version and system log. Uses a temporary root, except that one test line is written to the system log |
| `test/browser/smoke.js` | Node.js + Playwright against a target | Every page renders without JavaScript errors |
| `test/browser/editor.js` | Node.js + Playwright against a test target | Editors (pools, options, global settings, shared networks, input checks, change view), raw editor, backups and example removal end to end, with Kea validating every save |
| `test/browser/ha.js` | Node.js + Playwright against a test target that has `kea-hook-ha` | The high availability tab end to end for both protocols, with Kea loading the hook on every save, including the peers filled in from a cluster. It answers the call for the nodes itself |
| `test/browser/leases.js` | Node.js + Playwright against a test target that has the lease fixture | The Leases page for both protocols, and the version and log on Overview |
| `test/browser/overview-leases.js` | Node.js + Playwright against a test target that has the lease fixture | The Kea leases on the status overview of LuCI and on Overview, and "Reserve IP" with a reservation written and one refused |
| `test/browser/setup.js` | Node.js + Playwright against a test target whose DHCPv4 file is the example of the package | The note on Overview, the Setup page, Write over the example, and Replace of a changed file only after a confirmation |
| `test/browser/warnings.js` | Node.js + Playwright against a test target | The warnings for a file Kea does not start with on three pages, the question before a reload, the log file note and the Log Output field, the warning and the fields for the socket retries, what Overview and Services show for a daemon that does not listen and for a pair, and what the Services page says about dnsmasq. It answers the calls that would act on a service itself, and those for the state of a daemon |
| `test/browser/import.js` | Node.js + Playwright against a test target that has the fixture static leases | The import page end to end for both protocols, including a second import |
| `test/run-target-tests.sh` | A machine with Node.js and Playwright, against a test target; CI, against OpenWrt in QEMU | The on-target cases against the installed library and the eight browser tests in one run, with their fixtures loaded and removed |

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
- What the Services page says dnsmasq and odhcpd serve is read from
  `/etc/config/dhcp`, not asked from the running services. A dnsmasq that
  answers DHCPv6 on a system without odhcpd is not told apart: DHCPv6 and
  router advertisements are counted for odhcpd.

### High availability

- The form edits one relationship. A file with several (hub and spoke) is
  left to the Configuration page; the tab says so.
- TLS and basic authentication parameters have no fields. Those of the
  relationship are edited as JSON text; those of a peer are preserved and
  edited on the Configuration page.
- The state of the running pair is on Overview and Services, not on the
  tab, and only for the server of this router; what the partner thinks is
  on the partner.
- Both routers are configured separately. The peer list has to be typed on
  each, with the other name as this server.
- The address of a peer URL must be reachable from the partner, so the
  firewall has to let the port through where the servers are not on the same
  LAN zone.
- The fill-in from `ha-cluster` did not work from `0.9.0` to `0.10.0` on a
  router that has `luci-app-ha-cluster`, and stopped LuCI for 30 seconds on
  every visit of a DHCP page there. It had been tested only with the test
  answering in place of `ha-cluster`. Fixed in `0.10.1`, and since run on
  a pair with `ha-cluster`; see below.
- The application writes no firewall rule. The ports of the peer URLs have
  to be open between the nodes. `ha-cluster` opens them, in its version
  under development: it reads the ports from the URLs in the Kea files when
  it starts or is reloaded, and needs a port in every URL.
- The application has `ha-cluster` look at its firewall rules again when
  it starts, restarts or reloads Kea itself: Save & Apply in the editors
  and the buttons of the Services page. Not after a Save without Apply,
  when Kea still listens on the port it had; and it does not know of a Kea
  restarted from the command line, after which
  `/etc/init.d/ha-cluster firewall` has to be run by hand.
- That needs `ha-cluster` 2.0.0-r11 or later, the first version with the
  command `firewall`. On 2026-11-21 it was in the sources of that project
  and not yet built as a package. What it relies on: the options `enabled`
  and `dhcp_backend` of the section `config` in `/etc/config/ha-cluster`,
  and the command being named in the init script.
- A pair of Kea servers accepts commands from anyone who reaches its
  port, unless it uses mutual TLS. Measured with two `kea-dhcp4` 3.0.4 on
  the test machine, hot standby, with the listener of the pair:

  | Peers set up with | A `dhcp-disable` from a stranger |
  |-------------------|----------------------------------|
  | `http`, nothing else | carried out |
  | `http`, `basic-auth-user` and `basic-auth-password` on both peers | carried out |
  | `https`, `trust-anchor`, `cert-file`, `key-file`, `require-client-certs` | no answer: the TLS handshake fails, without a certificate as with a foreign one |

  In 3.0.4 the basic-auth parameters of a peer only make the server send
  credentials to that peer; the listener checks none (the sources set no
  authentication for it). With mutual TLS the pair reached hot-standby,
  also with one self-signed certificate shared by both nodes and used as
  their trust anchor. The tab takes such a setup: an `https` URL needs the
  three TLS parameters among the additional parameters.
- A pair of routers made by this application was run once, on a bench of
  the `ha-cluster` project on 2026-11-21: two OpenWrt 25.12.6 x86-64 nodes
  under KVM and a client, Kea 3.0.4, `ha-cluster` from its sources, and the
  released `0.10.1-r1`. On each node the DHCPv4 and DHCPv6 pages appeared
  in about a quarter of a second, with rpcd answering other calls; the
  button filled in this server and both peers from the reply of
  `ha-cluster`, with ports 8001 and 8002; Save & Apply on both nodes saved,
  reloaded Kea and called the firewall command of `ha-cluster`. Both Kea
  servers of each protocol then were in hot-standby with their partner,
  the firewall rule held both ports, and the client renewed its DHCPv4
  lease and kept its DHCPv6 one, answered by the primary only. Reported by
  that project; not repeated here. Here, two Kea processes were paired on
  one machine.
- A LuCI user other than root needs three ACL groups for these pages:
  `unauthenticated` and `luci-base`, which every page of LuCI needs, and
  `luci-app-kea`. With `luci-app-kea` alone LuCI says "Login session is
  expired", which is its own message for missing rights. With the three,
  the fill-in and Save & Apply worked as for root, on the same bench.

### Leases and log

- Leases are read from the lease files of the memfile backend. A daemon
  that keeps its leases in memory only (`persist` false) has nothing to
  show; the page says so.
- The page shows leases in use and declined addresses. Leases that ran out
  or were released are left out, and so is their history.
- Read only: a lease cannot be removed from the page. That needs the lease
  commands hook and the control channel of the daemon.
- On OpenWrt the lease files are in `/var/lib/kea`, which is in memory, so
  Kea itself forgets its leases at a reboot. The configuration cannot name
  another place: Kea 3.0 takes a lease file from that directory only (see
  [Backend](#backend-1)). A file name without a directory is placed there.
- The log on Overview is the system log, and the configuration files
  shipped with Kea do not write there. They name a log file, which Kea 3.0
  places in `/var/log/kea`, a directory OpenWrt does not have. With such a
  configuration the page shows only the lines a daemon prints before it has
  read its loggers, among them the reason when it cannot start; everything
  after that is lost. The page says which daemons are in that state. With
  the system log as output, all messages arrive.
- The Log Output field exists for the DHCP daemons only. For
  `kea-dhcp-ddns` and `kea-ctrl-agent` the output of the loggers is set on
  the Configuration page.
- The application does not create `/var/log/kea`. A log file there needs
  something that creates the directory after every boot.
- Messages are gone from the page after the ring buffer of the system log
  has moved on.
- At most 2000 leases per protocol are sent to the browser, and a lease
  file above 8 MB is not read.

### Kea at boot and at run time

- **A running daemon is not a listening one.** Measured on 2026-11-20 with
  Kea 3.0.4 on the test machine: Kea is started at boot (`S25`) while the
  LAN bridge may not be ready, and then does not open its sockets. It keeps
  running, `status-get` on its control socket says `"sockets": { "status":
  "failed" }`, and it stays so after the interface is up. Without retries,
  `kea-dhcp6` did not listen after any of four boots (the link-local
  address was not usable yet) and `kea-dhcp4` did not after two of seven
  ("the interface br-lan is not running"). With
  `"service-sockets-max-retries": 60` and
  `"service-sockets-retry-wait-time": 2000` in `interfaces-config`, both
  were listening after each of four boots.
- Since `0.9.0` the DHCP pages write the two parameters when they make Kea
  listen on an interface, warn about a file that listens without them, and
  Overview and Services show whether a running daemon listens. Not covered:
  a file that was made elsewhere and never opened in the application has
  no retries until someone sets them.
- A daemon in that state is not helped by a reload: procd restarts a
  process only when its file changed. A restart makes it try again.
- **Another DHCP server on the interface gives the same picture.** While
  dnsmasq answers DHCPv4 there, Kea cannot bind its socket ("Address in use
  - is another DHCP server running?"), keeps running, and does not listen.
  The pages show Kea's words; the cure is to switch DHCP off for that
  interface in dnsmasq, not the retries.
- **The server identifier of DHCPv6 does not survive a reboot.** Kea keeps
  it in `/var/lib/kea`, which is in memory on OpenWrt, and makes a new one
  at every start from the time and a hardware address: twelve boots, twelve
  identifiers. What that costs a client was measured on 2026-11-21 with a
  real client (`odhcp6c`) and a server that lost its lease file and its
  identifier, as in a reboot: the client's renewals went unanswered until
  its rebind time, the rebind was answered, and it kept its address. With a
  fixed identifier in the file (`server-id` with `type` `LL`, `htype` 1,
  the hardware address as `identifier`, `persist` false) the first renewal
  was answered. So a client renews later than it would, and loses nothing.
- In one boot, out of about forty with `kea-dhcp6` enabled, Kea found no
  interface to make the identifier from and `kea-dhcp6` did not start
  ("unable to find suitable interface for generating a DUID-LLT"). It did
  not happen again in 22 boots made to look for it. A fixed identifier
  needs no interface, which would rule this out; whether it is worth
  writing one for that was decided against for now, see roadmap milestone
  M9. The identifier can be set on the Configuration page.
- **"Failed" means one socket, not all.** Kea reports its sockets as
  failed when it could not open one of them. Told to listen on every
  interface (`"*"`), or on a list with an interface that has no address,
  it reports "the interface eth0 has no usable IPv4 addresses configured"
  and listens on the others all the same; measured. The pages therefore
  say that it could not open all of its sockets and repeat Kea's messages,
  which name the interfaces. With `"*"`, Kea also listened on the WAN
  interface of the test machine.
- The state of a daemon is asked over the control socket named in its
  file. A file without one, as another tool may write it, leaves the state
  unknown, and the pages say so.
- Reported by the bench of the `ha-cluster` project, not reproduced here: a
  Kea that listens stops answering when netifd creates the device anew
  (`ifdown` and `ifup`, a network restart), although the process lives and
  its sockets are reported as ready, until it is told to read its
  configuration again (`config-reload`, or SIGHUP). The init script of the
  Kea package has no trigger for interfaces.
- A file that was saved without applying is read by the daemon at the next
  reload from any source, a SIGHUP included. Measured: after a SIGHUP with a
  file Kea will not start with, the daemon keeps running with its previous
  configuration and logs `DHCP4_DYNAMIC_RECONFIGURATION_FAIL`; it was not
  checked whether it still gives out leases then. The application's own
  Save & Apply restarts the process through procd instead.

### Backend

- The application reads JSON, with comments. A file that uses Kea's
  `<?include "file"?>` directive, which Kea accepts, can be edited on the
  Configuration page only. The DHCPv4 and DHCPv6 pages and the import do not
  open it and write nothing, and the warnings and the log note are not
  worked out for it.
- The Kea binary's check does not guarantee that the daemon starts: a port
  in use or a missing interface shows only then. Save & Apply reports a
  daemon that is gone after the reload, but nothing warns before.
- The two settings the application warns about (see
  [What the check of Kea does not see](#what-the-check-of-kea-does-not-see))
  are the ones that were found; there may be others. The rule was measured
  with Kea 3.0.4 as packaged for OpenWrt 25.12. It is not adjusted to the
  Kea version, and it does not know about `KEA_DHCP_DATA_DIR`, which moves
  the lease directory when it is set for the daemon.
- On a fresh installation the control agent file is reported as invalid
  until Kea has been started once from the Services page: the file names
  `/etc/kea/kea-api-password`, which the application creates before a
  start.
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
- The import does not reload Kea, from the page or from the command.
- The lock keeps two writers from interleaving, not a page from saving what
  it loaded before. A DHCP page that is open while the import command runs
  still holds the file as it was, and a save from it replaces the imported
  reservations. Reload the page after an import from a script.
- `/etc/kea/luci-reservations.json`, written by versions before `0.4.0`, is
  no longer read or written. It can be deleted.

## Not implemented

- Translations (only the template exists).
- A package repository that `apk` on the router can use directly, with
  signed packages and upgrades through `apk upgrade`. The package is
  installed from a downloaded file.
- A test in CI with a real DHCP client, and tests on a router architecture
  other than x86-64.
