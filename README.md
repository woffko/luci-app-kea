# luci-app-kea

LuCI application for managing the ISC Kea DHCP server on OpenWrt.

> **Status: alpha (0.1.0).** Usable for testing on a lab router. Not ready to
> replace a production dnsmasq/odhcpd setup. Read
> [Known limitations](#known-limitations) before saving from the DHCPv4 or
> DHCPv6 pages: they can remove settings from an existing Kea configuration.

## Purpose

OpenWrt packages Kea but has no LuCI application for it. `kea-uci` only
provides on/off switches for the Kea daemons; subnets, pools, reservations and
everything else live in Kea's JSON files.

This application adds a LuCI interface for the common DHCP settings and keeps
the JSON files reachable for everything else.

## Features

Menu location: **Services > Kea DHCP**.

- **Overview**: installed Kea components and hooks, config files, validation
  result.
- **Services**: start, stop, restart, reload and autostart for the Kea init
  service; enable or disable `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns` and
  `kea-ctrl-agent`; state and explicit controls for `dnsmasq` and `odhcpd`.
- **DHCPv4**: one tab per interface with subnet, address pool, gateway, DNS
  servers, domain, timers and MAC-based reservations.
- **DHCPv6**: one tab per interface with subnet, address pool, prefix
  delegation pool, DNS servers, timers and reservations by DUID, MAC address,
  client ID or flex ID.
- **Configuration**: raw editor for the four Kea config files.
- **Import dnsmasq**: preview of dnsmasq static leases with warnings, and
  import of the DHCPv4 entries that map cleanly to a Kea subnet.

Every config write is validated with the Kea binary (`kea-dhcp4 -t` and so on)
before the file is replaced. The previous file is kept as `<file>.bak.luci`,
or as `kea-dhcp4.conf.bak.import` after an import.

## Known limitations

- **The DHCPv4 and DHCPv6 pages rewrite every subnet from the form.** Subnet
  settings the form does not show are removed on save: additional pools, other
  DHCP options, relay settings, client classes, `user-context`, and extra
  reservation fields. Use the Configuration page for configs that contain
  them.
- A reservation with **Enabled** unchecked is deleted on save.
- Saving from these pages also removes JSON comments and the sample subnets,
  options and client class that ship in the stock Kea config files.
- Saving does not reload Kea. Apply changes with **Reload** or **Restart** on
  the Services page.
- Only one backup generation is kept, and there is no restore button.
- The import writes DHCPv4 entries only. DHCPv6 entries and entries with
  warnings are stored in `/etc/kea/luci-reservations.json` and not applied.
- No high-availability page and no lease viewer.
- English only.

The full list is in [docs/STATUS.md](docs/STATUS.md).

## Requirements

- OpenWrt with LuCI.
- `kea-uci` and at least one of `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns`,
  `kea-ctrl` from the OpenWrt packages feed.

Tested in May 2026 on OpenWrt 25.12.3 x86_64 with Kea 3.0.2. The current
25.12.6 feed ships Kea 3.0.4, which has not been tested yet.

## Installation

There are no prebuilt packages yet. Build the package in an OpenWrt tree that
has the `luci` and `packages` feeds installed:

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
