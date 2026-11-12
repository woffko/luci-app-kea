# luci-app-kea

[![CI](https://github.com/woffko/luci-app-kea/actions/workflows/ci.yml/badge.svg)](https://github.com/woffko/luci-app-kea/actions/workflows/ci.yml)

LuCI application for managing the ISC Kea DHCP server on OpenWrt.

> **Status: alpha (0.3.0).** Usable for testing on a lab router. Not ready to
> replace a production dnsmasq/odhcpd setup yet: see
> [Known limitations](#known-limitations).

## Purpose

OpenWrt packages Kea but has no LuCI application for it. `kea-uci` only
provides on/off switches for the Kea daemons; subnets, pools, reservations and
everything else live in Kea's JSON files.

This application adds a LuCI interface for the common DHCP settings and keeps
the JSON files reachable for everything else.

It is developed as a standalone package for now, with a later submission to
[openwrt/luci](https://github.com/openwrt/luci) as the goal.

## Features

Menu location: **Services > Kea DHCP**.

- **Overview**: installed Kea components and hooks, config files, validation
  result.
- **Services**: start, stop, restart, reload and autostart for the Kea init
  service; enable or disable `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns` and
  `kea-ctrl-agent`; state and explicit controls for `dnsmasq` and `odhcpd`.
- **DHCPv4**: one tab per interface with subnet, address pool, gateway, DNS
  servers, domain, timers and reservations by MAC address, client ID, DUID,
  circuit ID or flex ID.
- **DHCPv6**: one tab per interface with subnet, address pool, prefix
  delegation pool, DNS servers, timers and reservations by DUID, MAC address
  or flex ID.
- **Configuration**: raw editor for the four Kea config files, with restore
  from backup.
- **Import dnsmasq**: preview of dnsmasq static leases with warnings, and
  import of the DHCPv4 entries that map cleanly to a Kea subnet.

The DHCPv4 and DHCPv6 pages change only what you edit. Settings they do not
show (additional pools, other options, relay settings, client classes and so
on) stay in the file as they were. A reservation can be switched off without
deleting it.

Every config write is validated with the Kea binary (`kea-dhcp4 -t` and so on)
before the file is replaced, and the previous file is kept in
`/etc/kea/backups/` (the ten newest per file). **Save & Apply** also reloads
a running Kea daemon and tells you whether it is still running afterwards.

## Known limitations

- The DHCPv4 and DHCPv6 pages edit the first address pool of a subnet and a
  fixed set of options. Everything else is preserved but has to be edited on
  the Configuration page. Subnets inside shared networks are not shown.
- Saving from the DHCPv4 and DHCPv6 pages removes comments from the file. The
  page tells you when the file has any.
- Input is checked by Kea, not by the form: a mistyped address is reported
  only when you save.
- The import writes DHCPv4 entries only. DHCPv6 entries and entries with
  warnings are stored in `/etc/kea/luci-reservations.json` and not applied.
- No high-availability page and no lease viewer.
- English only.

The full list is in [docs/STATUS.md](docs/STATUS.md).

## Requirements

- OpenWrt with LuCI.
- At least one of `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns`, `kea-ctrl` from
  the OpenWrt packages feed.

`kea-uci` and `kea-lfc` are installed as dependencies. `kea-lfc` is needed
because the configuration files shipped with Kea enable lease file cleanup,
and the DHCP daemons do not start without it.

Tested on OpenWrt 25.12.6 x86-64 with Kea 3.0.4 (November 2026). Earlier
versions were tested on OpenWrt 25.12.3 with Kea 3.0.2.

## Installation

There are no releases yet. Every CI run on `main` attaches a built package
as an artifact; to build it yourself, use an OpenWrt tree that has the `luci`
and `packages` feeds installed:

```sh
cd /path/to/openwrt
git clone https://github.com/woffko/luci-app-kea.git package/luci-app-kea
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig
make package/luci-app-kea/compile V=s
```

In menuconfig, select a Kea daemon under **Network > IP Addresses and Names**
first. `luci-app-kea` appears under **LuCI > 3. Applications** only after
that.

Copy the resulting package to the router and install it:

```sh
apk add --allow-untrusted /tmp/luci-app-kea-*.apk
```

## Before you use it

- Back up `/etc/config/dhcp`, `/etc/config/kea` and `/etc/kea/*.conf`.
- Do not run Kea and dnsmasq/odhcpd as DHCP servers on the same interface.
  The application shows the state of both and never stops them on its own.

## Documentation

- [docs/STATUS.md](docs/STATUS.md): what is implemented, known defects, what
  is missing.
- [docs/ROADMAP.md](docs/ROADMAP.md): the work plan and open questions.
- [docs/PACKAGING.md](docs/PACKAGING.md): conformance with the OpenWrt and
  LuCI packaging rules.
- [docs/DESIGN.md](docs/DESIGN.md): intended behavior of each feature.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): building, deploying to a test
  target, checks, debugging.
- [docs/HISTORY.md](docs/HISTORY.md): development log.

## License

Apache-2.0.
