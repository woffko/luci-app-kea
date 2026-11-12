# Screenshots

Taken with version `0.4.0` on OpenWrt 25.12.6 with Kea 3.0.4, using the test
fixtures of this repository as configuration. `test/browser/screenshots.js`
regenerates them; see [DEVELOPMENT.md](DEVELOPMENT.md#screenshots).

## Overview

Installed Kea components, configuration files, and the result of validating
each file with its Kea daemon.

![Overview page](images/overview.png)

## Services

The Kea init service, the DHCP services of OpenWrt that would compete with
Kea, and the Kea components with their enable switches.

![Services page](images/services.png)

## DHCPv4

One tab per interface, plus one per subnet that is not bound to an interface
(here the relayed subnet `10.10.0.0/16`). The second reservation is switched
off: it stays in the file but Kea does not use it.

![DHCPv4 editor](images/dhcp4.png)

## DHCPv6

The same editor for DHCPv6, with a prefix delegation pool and reservations by
DUID, MAC address and flex ID.

![DHCPv6 editor](images/dhcp6.png)

## Configuration

The raw editor with the validation result and the backups of the selected
file.

![Raw configuration editor](images/configuration.png)

## Import dnsmasq

What an import of the OpenWrt static leases would do: one row per lease and
protocol, with its state and the reason when a lease cannot be imported.

![Static lease import](images/import.png)
