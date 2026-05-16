# luci-app-kea

LuCI application for managing ISC Kea DHCP on OpenWrt.

> **Status: alpha.** This project is in early development. The UI and backend
> are already useful for testing, but the package is not ready to replace a
> production dnsmasq/odhcpd setup without manual review and backups.

## Purpose

OpenWrt ships Kea packages, but does not currently provide a complete native
LuCI application for day-to-day Kea management. This package aims to make Kea
manageable from LuCI while preserving access to Kea's JSON configuration model.

The long-term goal is a practical OpenWrt UI for:

- DHCPv4 server configuration;
- DHCPv6 server configuration;
- static reservations;
- dnsmasq static lease import;
- Kea service control and validation;
- Kea HA hook configuration when the required hook packages are installed.

## Current Features

- LuCI menu integration under **Services -> Kea DHCP**.
- Overview page with installed package/config/hook status.
- Services page with:
  - Kea init service status;
  - Kea component status for `kea-dhcp4`, `kea-dhcp6`,
    `kea-dhcp-ddns`, and `kea-ctrl-agent`;
  - staged enable/disable checkboxes, committed only by Save/Save & Apply;
  - explicit start/stop/restart/reload controls;
  - conflict visibility and controls for `dnsmasq` and `odhcpd`.
- DHCPv4 structured editor:
  - one tab per OpenWrt interface/subnet;
  - enable/disable listening per interface;
  - subnet and address pool fields;
  - router, DNS, domain, search domain, and timer fields;
  - basic reservation editing;
  - validation through the Kea binary before writing config.
- DHCPv6 structured editor:
  - one tab per OpenWrt interface/subnet;
  - enable/disable listening per interface;
  - subnet and address pool fields;
  - prefix delegation fields;
  - DNS/search-domain/timer fields;
  - validation through the Kea binary before writing config.
- Raw Kea JSON configuration editor for advanced/manual edits.
- dnsmasq static lease import:
  - dry-run preview;
  - validation and warning display;
  - import of ready DHCPv4 reservations into matching Kea subnets;
  - staging file for entries that need manual review.
- rpcd backend for status, validation, config save, service control, and import.
- Runtime preparation for Kea starts/reloads:
  - creates `/var/run/kea`;
  - creates `/var/lib/kea`;
  - creates `/etc/kea/kea-api-password` if missing.
- Initial OpenWrt-side import regression fixture.

## Important Notes

- This is an alpha package. Keep backups of `/etc/config/dhcp`,
  `/etc/config/kea`, and `/etc/kea/*.conf`.
- Do not run Kea and dnsmasq/odhcpd as authoritative DHCP services on the same
  interfaces unless you know exactly what is being served by each daemon.
- The Services page intentionally does not stop `dnsmasq` or `odhcpd`
  automatically. It shows their state and provides explicit controls.
- The structured editors cover common DHCP settings first. Advanced Kea
  features should still be edited through the raw configuration page.
- DHCPv6 import and HA configuration are still incomplete.

## OpenWrt Build Usage

Copy or clone the package into an OpenWrt build tree:

```sh
cd /path/to/openwrt
git clone https://github.com/woffko/luci-app-kea.git package/luci-app-kea
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig
make package/luci-app-kea/compile V=s
```

Enable `luci-app-kea` and the Kea packages you need, for example:

- `kea-dhcp4`
- `kea-dhcp6`
- `kea-dhcp-ddns`
- `kea-ctrl`
- `kea-hook-ha`
- `kea-hook-lease-cmds`
- `kea-uci`

## Test Target Notes

During development this package has been tested on OpenWrt 25.12.3 x86_64 with
Kea 3.0.2 packages.

After installing or replacing LuCI files manually, restart LuCI services and
clear LuCI caches:

```sh
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache*
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

## Tests

The current import fixture test exercises the rpcd backend shell code and should
be run on OpenWrt or inside an OpenWrt rootfs where `uci`, `jshn`, and
`/lib/functions.sh` are available:

```sh
./test/run-import-fixture.sh
```

JavaScript files can be syntax-checked with Node.js during development:

```sh
node --check htdocs/luci-static/resources/view/kea/dhcp4-clean-save.js
node --check htdocs/luci-static/resources/view/kea/dhcp6-clean-save.js
node --check htdocs/luci-static/resources/view/kea/services-control.js
node --check htdocs/luci-static/resources/view/kea/import-dnsmasq-commit.js
```

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the broader implementation plan.

Near-term work:

- complete DHCPv6 reservation/import support;
- add richer validation for conflicts and invalid option combinations;
- improve HA hook UI and configuration generation;
- add browser/UI regression tests;
- reduce temporary cache-busting view module names once the UI stabilizes.

## License

Apache-2.0, matching the LuCI package style used in OpenWrt.
