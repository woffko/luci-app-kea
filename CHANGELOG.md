# Changelog

What changed for users of the package, by package version
(`PKG_VERSION`-`PKG_RELEASE`). The version rules are in
[docs/RELEASING.md](docs/RELEASING.md); the development log, with the
reasons behind the changes, is in [docs/HISTORY.md](docs/HISTORY.md).

No version has been tagged or released yet. All versions are alpha.

## 0.7.0-r1 (2026-11-13)

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
