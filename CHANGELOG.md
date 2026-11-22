# Changelog

What changed for users of the package, by package version
(`PKG_VERSION`-`PKG_RELEASE`). The version rules are in
[docs/RELEASING.md](docs/RELEASING.md); the development log, with the
reasons behind the changes, is in [docs/HISTORY.md](docs/HISTORY.md).

Released versions are tagged `vX.Y.Z` and have their package on the
[Releases page](https://github.com/woffko/luci-app-kea/releases). All
versions are alpha.

## 0.12.0-r1 (2026-11-22)

### Added

- The leases of Kea on the status overview of LuCI (Status, Overview), in
  a section of their own next to "DHCP Leases", which shows the leases of
  dnsmasq and odhcpd only. Two tables, as in that section: the DHCPv4 and
  the DHCPv6 leases in use, with interface, hostname, address, MAC address
  or DUID and IAID, and the remaining time. The section is hidden when Kea
  keeps no leases.
- A button "Reserve IP" on each lease, as LuCI has for dnsmasq: it
  reserves the address in Kea for that client, with a hostname that can be
  changed first, and makes a running Kea read the file. It goes through
  the checks of the import and is greyed out when Kea already reserves an
  address for the client, or the address for another one.
- The same tables on the Overview page of the application, with the
  number of leases in use and the ten given out last of each protocol, and
  a link to the Leases page.

## 0.11.0-r1 (2026-11-22)

For other packages that switch a router from dnsmasq to Kea, such as
`ha-cluster`.

### Added

- `/usr/libexec/luci-app-kea/import-dnsmasq`: the import of the static
  leases of `/etc/config/dhcp`, as on the Import page, from a shell. Without
  arguments it imports what is ready; `--include-review` adds the leases
  that lose a setting Kea cannot express; `--dry-run` writes nothing. It
  prints what it did and what it left as JSON, exits with 0 when done or
  when there was nothing to do, 1 when it wrote nothing, 2 for an unknown
  argument, and needs neither rpcd nor LuCI. It does not reload Kea.
- After the application starts, restarts, reloads or stops Kea, it sends
  the procd event `kea.service` with the action, so that another package
  can act on it with a trigger of its own.

### Changed

- Every change of a Kea configuration file, from the pages or from the new
  command, takes a lock, so that two writers do not lose each other's
  change. A save waits up to ten seconds for another one to finish.

## 0.10.1-r1 (2026-11-21)

### Fixed

- On a router with `luci-app-ha-cluster` installed, opening the DHCPv4 or
  DHCPv6 page stopped all of LuCI for 30 seconds, and the button that fills
  the High availability tab from the cluster never appeared. The pages
  asked for the nodes of the cluster through the backend, which runs in the
  same process that answers for `ha-cluster` and so waited for itself. They
  now ask `ha-cluster` directly. Since `0.9.0`.

## 0.10.0-r1 (2026-11-21)

Includes the fix made as `0.9.1-r1`, which was not released on its own.

### Added

- For routers that run `ha-cluster` with Kea as the DHCP server of the
  cluster. That package keeps the firewall open for the ports of the peer
  URLs and takes them from the Kea files. Whenever the application starts,
  restarts or reloads Kea, it now has `ha-cluster` look at its firewall
  rules again (`/etc/init.d/ha-cluster firewall`), so that a changed port
  is let through without a second step, and says so in its report. No
  daemon of the cluster is started, stopped or signalled by this. It needs
  a version of `ha-cluster` that has the command; with an older one, or
  without `ha-cluster`, nothing changes.

### Fixed

- The High availability tab accepted a peer URL without a port, such as
  `http://192.168.1.2/`. Kea accepts it too, and then the servers never
  meet: each listens on a port chosen at random, cannot reach the other,
  and serves as if it were alone. The tab now asks for a port, and a file
  that already has such a URL gets a warning on Overview and on its page.

## 0.9.0-r1 (2026-11-20)

Tagged `v0.9.0` on 2026-11-21. The release workflow built the package from
the tag, tested it and prepared the release.

### Added

- **Retries for the sockets.** Kea opens its sockets once, when it starts.
  Started at boot before its interface is ready, it keeps running and never
  listens. The DHCPv4 and DHCPv6 pages now write the two parameters that
  make it try again (`service-sockets-max-retries` 60,
  `service-sockets-retry-wait-time` 2000) when they make Kea listen on an
  interface and the file has neither. Both are fields of the Global
  settings tab. A file that names interfaces and has no retries gets a
  warning.
- **What a running daemon is doing.** Overview and Services ask the running
  DHCP daemons whether their sockets are open, and show the state of high
  availability: mode, role and state of this server and of its partner. A
  daemon that could not open a socket is named at the top of Overview, with
  the interface and the reason Kea gives.
- **Fill in from ha-cluster** on the High availability tab, when the
  `ha-cluster` package is installed and knows this node and a partner: the
  name of this server and the peers, with their URLs and roles, are taken
  from the cluster. Nothing is saved until you save. The application does
  not depend on `ha-cluster`.

### Changed

- The package depends on `ucode-mod-socket`, which `apk` installs with it.
- The example URLs of the High availability tab use port 8001. DHCPv4 and
  DHCPv6 need a port each; the fill-in uses 8001 and 8002.

### Upgrade notes

After the upgrade, a configuration that listens on an interface without
retries shows a warning on Overview and on its page. Set **Socket Retries**
and **Socket Retry Wait** on the Global settings tab, for example 60 and
2000, and save. No file is changed by the upgrade itself.

## 0.8.0-r1 (2026-11-19)

Tagged `v0.8.0` on 2026-11-20. The release workflow built the package from
the tag, tested it and prepared the release.

### Added

- A warning for a configuration that Kea accepts when it checks it and does
  not start with: a lease file outside `/var/lib/kea`, or a log file outside
  `/var/log/kea`. It is shown on **Overview**, on the **DHCPv4** and
  **DHCPv6** pages, on the **Configuration** page, and after a save. A save
  is never refused for it.
- **Save & Apply** asks before it reloads a running daemon with such a
  configuration. With the answer no, the file stays saved and the daemon
  keeps running with its previous configuration.
- **Overview** says which daemons write their log to a file instead of the
  system log, and when that file is in a directory that does not exist, so
  that nothing is logged at all. That is the case with the configuration
  files shipped with Kea.
- **Log Output** on the Global settings tab of the DHCPv4 and DHCPv6 pages
  moves the loggers of the daemon to the system log.
- **Services** shows what dnsmasq and odhcpd are configured to serve: DHCPv4
  and DHCPv6 by interface, router advertisements, DNS. It asks before
  stopping dnsmasq where it is the DNS server, and odhcpd where it sends
  router advertisements.

### Fixed

- **Overview** shows the severity of the Kea messages that reach the system
  log through procd: what a daemon prints while it starts, and everything
  when a logger writes to the standard output. They were shown as one text
  with Kea's own time in front.
- The warning about a second DHCP server on an interface no longer suggests
  stopping dnsmasq or odhcpd, and it follows `maindhcp` of odhcpd.

### Upgrade notes

Nothing to do. The new warnings and notes may appear for a configuration
that was there before the upgrade; no file is changed by the upgrade.

## 0.7.0-r1 (2026-11-13)

Released on 2026-11-17 as `v0.7.0`, the first release. The versions below
it were development versions without a release.

### Added

- **Leases** page: the DHCPv4 and DHCPv6 leases in use, with remaining time,
  read from the lease files of Kea.
- **Overview** shows the Kea version and the recent Kea messages of the
  system log.

### Changed

- **Overview** folds the output Kea prints for a configuration file it
  accepts.

## 0.6.0-r1 (2026-11-13)

### Added

- **High availability** tab on the DHCPv4 and DHCPv6 pages, when
  `kea-hook-ha` is installed: mode, peers, timers, and every other parameter
  of the hook as JSON.

### Changed

- The DHCPv4 and DHCPv6 configuration files are checked with the hook
  libraries loaded (`kea-dhcp4 -T`). A file with wrong hook parameters, which
  used to be saved and then kept the daemon from starting, is now refused.
- When Kea refuses a file, the reason is shown first.

### Fixed

- A save that Kea refused discarded what had been typed, on the DHCPv4 and
  DHCPv6 pages and in the raw editor.

## 0.5.0-r1 (2026-11-12)

### Added

- Every address pool and prefix delegation pool of a subnet can be edited,
  added and deleted. Before, only the first one was shown.
- Every DHCP option of a subnet, and the global options, as a list of name
  or code and value.
- **Global settings** tab: timers, lease file cleanup interval, global
  options.
- Subnets inside shared networks have tabs.
- A value Kea would refuse is marked while it is typed, with the reason.
- A warning when OpenWrt already serves DHCP on an interface that is
  enabled for Kea.
- **Show changes** lists the lines of the file a save would change, on the
  DHCPv4 and DHCPv6 pages and in the raw editor.
- The raw editor reports a JSON syntax error while typing.

## 0.4.0-r1 (2026-11-12)

### Added

- The import of OpenWrt static leases handles DHCPv6: DUIDs, and the IPv6
  token (`hostid`) combined with the prefix of the Kea subnet.
- Each static lease gets a state and, where it cannot be imported, the
  reason. You choose what to import.
- A disabled static lease is imported as a disabled reservation.

### Fixed

- A static lease with both `mac`/`ip` and `duid`/`hostid`, the usual form in
  OpenWrt, lost its DHCPv4 half in the import.
- DUIDs in the OpenWrt notation without colons were rejected.

### Removed

- `/etc/kea/luci-reservations.json` is no longer read or written. Static
  leases that cannot be imported stay where they are, in `/etc/config/dhcp`.

### Upgrade notes

- `/etc/kea/luci-reservations.json` from an earlier version can be deleted.

## 0.3.0-r1 (2026-11-12)

### Changed

- The backend is an rpcd ucode plugin instead of a shell script. The pages
  did not change.
- `kea-lfc` is a dependency: the configuration files shipped with Kea enable
  lease file cleanup, and the DHCP daemons do not start without it.
- Whether a Kea daemon runs is taken from procd.
- The check on the Overview page covers the control agent configuration.

### Fixed

- Backups made within one second could be listed in the wrong order.
- Enabling a component that had no section in `/etc/config/kea` reported
  success without writing anything.
- An interface configured with `ipaddr` and `netmask` was not matched to its
  Kea subnet.

## 0.2.0-r1 (2026-11-11)

### Changed

- The DHCPv4 and DHCPv6 pages change only what was edited. Before, they
  rebuilt every subnet from the form and dropped everything the form did not
  show: additional pools, other options, relay settings, reservation fields.
- A reservation that is switched off is kept in the file instead of deleted.
- The example entries of the configuration shipped with Kea are removed only
  on request, with a confirmation.
- **Save & Apply** validates, saves, reloads Kea and reports whether the
  daemon is still running.

### Added

- A backup of the previous file on every write, the ten newest kept in
  `/etc/kea/backups/`, and a restore control in the raw editor.
- DHCPv4 reservations by client ID, DUID, circuit ID or flex ID.
- A notice when saving will remove comments from a file.

### Fixed

- The raw editor changed a file on every save, even without edits.
- Files with `#` comments could not be opened on the DHCPv4 and DHCPv6
  pages.
- The DHCPv6 page offered "Client ID" as a reservation identifier, which Kea
  does not support.
- A new subnet could get the ID of an existing one.

## 0.1.0-r2 (2026-11-11)

### Changed

- Package metadata: project URL, description, license file, maintainer.
- Stable page addresses (`overview`, `services`, `dhcp4`, `dhcp6`,
  `configuration`, `import-dnsmasq`); earlier addresses no longer exist.
- The ACL grants only the methods of the application.

### Removed

- Ten unused copies of the pages.

## 0.1.0-r1 (May 2026)

First build: Overview, Services, DHCPv4, DHCPv6, raw configuration editor
and a first import of DHCPv4 static leases.
