# luci-app-kea

LuCI application for managing the ISC Kea DHCP server on OpenWrt.

This repository contains early development work for a native OpenWrt LuCI UI
around the Kea packages from the OpenWrt packages feed. The goal is to make Kea
usable from LuCI in the same practical way dnsmasq is today, while still
preserving Kea's more advanced JSON configuration model.

## Why this exists

OpenWrt already ships Kea packages such as:

- `kea-dhcp4`
- `kea-dhcp6`
- `kea-ctrl`
- `kea-hook-ha`
- `kea-hook-lease-cmds`
- `kea-uci`

At the moment there is no full LuCI application for them. This project is meant
to provide:

- service status and start/stop/restart controls;
- editors for DHCPv4 and DHCPv6 configuration;
- reservation/static lease management;
- Kea HA hook configuration when the HA hook package is installed;
- dnsmasq static lease import with validation;
- clear handling of entries that cannot be represented safely in Kea.

## Current status

This is not upstream-ready yet. It is a working skeleton intended to be expanded
into a full package.

Implemented so far:

- OpenWrt package metadata;
- LuCI menu and rpcd ACL files;
- rpcd backend skeleton for status, service control, validation, and import
  preview methods;
- LuCI pages for overview, services, and dnsmasq static lease import preview;
- first import fixtures for dnsmasq static lease conversion.

Known missing pieces:

- full `kea-uci` integration;
- real DHCPv4/DHCPv6 structured editors;
- HA hook editor;
- raw JSON editor;
- backend unit test runner;
- LuCI/browser regression tests;
- complete validation and write/apply flow.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the implementation plan.

## Intended import behavior

The dnsmasq import flow should be conservative:

- valid static leases should be importable into Kea reservations;
- entries that do not fit Kea's schema should be imported as disabled records;
- the UI should show a warning marker for disabled/problematic entries;
- editing a problematic entry should show the exact invalid fields and why they
  cannot be applied.

This is especially important for DHCPv6, where dnsmasq and Kea do not model
client identity in exactly the same way.

## OpenWrt build usage

During development this package can be copied into an OpenWrt build tree:

```sh
cp -a luci-app-kea /path/to/openwrt/package/luci-app-kea
cd /path/to/openwrt
make menuconfig
make package/luci-app-kea/compile V=s
```

The package currently depends on `kea-uci`. Do not enable it in a full image
until `kea-uci` is available in the selected package feeds and the backend is
implemented enough to install and run cleanly.

## License

Apache-2.0, matching the LuCI package style used in OpenWrt.
