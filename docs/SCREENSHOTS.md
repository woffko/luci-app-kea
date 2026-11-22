# Screenshots

Taken on OpenWrt 25.12.6 with Kea 3.0.4, using the test fixtures of this
repository as configuration. The pictures of the leases, the raw editor and
the import are from version `0.7.0`, where these pages look the same; those
of the DHCP pages and the warning are from `0.8.0`, the Overview page as a
whole and the leases on the status overview of LuCI from `0.12.0`, the
Services page from `0.14.0`, the others from `0.9.0`. `test/browser/screenshots.js` regenerates them; see
[DEVELOPMENT.md](DEVELOPMENT.md#screenshots).

## Overview

The Kea version, the leases in use, installed components, configuration
files, the result of checking each file with its Kea daemon, and the recent
Kea messages of the system log: here a DHCPv4 and a DHCPv6 client being
served. The messages
are there because the configuration of this test logs to syslog; the
configuration files shipped with Kea do not.

![Overview page](images/overview.png)

## Services

The Kea init service, the DHCP services of OpenWrt that would compete with
Kea, and the Kea components with their enable switches. The middle table
says what dnsmasq and odhcpd are configured to serve: here both still answer
DHCP on `lan`, and dnsmasq is the DNS server as well. They can be restarted
here, not stopped; the link leads to the settings of the interfaces, where
their DHCP is switched off.

![Services page](images/services.png)

## DHCPv4

One tab per interface, one per subnet that is not bound to an interface
(here the relayed subnet `10.10.0.0/16`) and one per subnet of a shared
network (`floor2`). The subnet has two address pools and one option besides
the ones with a field of their own. The second reservation is switched off:
it stays in the file but Kea does not use it. The warning is there because
dnsmasq serves DHCP on the same interface of the test machine.

![DHCPv4 editor](images/dhcp4.png)

## Global settings

The last tab: timers and lifetimes for every subnet that does not set its
own, the lease file cleanup interval, where the loggers write, how often
Kea tries again to open its sockets, and the options sent to every subnet.

![Global settings tab](images/global.png)

## High availability

The tab appears when `kea-hook-ha` is installed. A hot standby pair, as it is
typed in on the first of the two routers.

![High availability tab](images/ha.png)

Load balancing: two servers share the clients, and a third only keeps a copy
of the leases. Two timers are set shorter than the Kea defaults, which the
empty fields show as placeholders, and one parameter that has no field of
its own is given as JSON.

![High availability tab in load balancing mode](images/ha-load-balancing.png)

Input that Kea would refuse is marked while it is typed: here a name for
this server that no peer has, a host name in a peer URL, and two primary
servers. **Save** lists the reasons and writes nothing.

![High availability tab with refused input](images/ha-checks.png)

**Show changes** for the hot standby pair above. Switching high
availability on adds two entries to the file: the lease commands hook, which
the servers need to exchange leases, and the high availability hook with
its parameters.

![Lines that switching high availability on adds to the file](images/ha-changes.png)

With the `ha-cluster` package installed, the name of this server and the
peers can be taken from the nodes of the cluster. The picture shows the
form after **Fill in from ha-cluster**; nothing is saved yet.

![High availability tab filled in from the nodes of a cluster](images/ha-fill.png)

## Changes before saving

**Show changes** lists the lines of the file that a save would change. Here
the gateway was changed and one reservation switched off, which moves it
into the subnet's `user-context`.

![View of the pending changes](images/changes.png)

## What the running daemons say

The top of Overview with two daemons running. The DHCPv4 server listens and
is the primary of a pair that has settled. The DHCPv6 server was started at
boot before its interface was ready: it runs, and answers nobody. The
answers shown are the ones Kea gave on a test machine; for the picture the
page was told them instead of asking a daemon.

![Overview with a daemon that listens and one that does not](images/runtime.png)

## What Kea would not start with

Kea accepts a lease file outside `/var/lib/kea` when it checks a
configuration, and then does not start with it. The application reports the
file as valid, which it is for Kea, and says what will happen. Below that,
Overview names the daemons whose log goes to a file and never arrives
there: here the two that still have the configuration shipped with Kea.

![Overview with a warning for the DHCPv4 file and a note on two log files](images/warnings.png)

**Save & Apply** with such a file and the daemon running: the file is
saved, and the reload is a question.

![Question before the reload of a running daemon](images/reload.png)

## DHCPv6

The same editor for DHCPv6, with prefix delegation pools and reservations by
DUID, MAC address and flex ID.

![DHCPv6 editor](images/dhcp6.png)

## Leases

The leases in use, from the lease files of Kea. The declined address is one
a client refused because it found it taken.

![Leases page](images/leases.png)

## Client names in DNS

The end of the Global settings tab of the DHCPv4 page on a router that has
`kea-hook-run-script` and `kea-dnsmasq-hosts`: the switch that gives the
names of the clients to dnsmasq.

![Global settings with the switch for client names in DNS](images/dns-names.png)

## Leases on the status overview of LuCI

The section "Kea DHCP Leases" under Status, Overview, next to the section
of dnsmasq, which has nothing to show when Kea serves DHCP. Each lease has
a button that reserves its address in Kea. It is greyed out for the client
"nas", for which Kea already reserves an address, and for the delegated
prefix.

![Kea leases on the status overview](images/status-leases.png)

## Configuration

The raw editor with the validation result and the backups of the selected
file. A JSON syntax error is reported under the text while typing.

![Raw configuration editor](images/configuration.png)

## Setup

The DHCPv4 configuration made from what dnsmasq serves on a fresh router:
one subnet for `lan`, with the pool dnsmasq had, and the answer of Kea's
check. The file is still the example of the Kea package, so it can be
written; the leases of dnsmasq can be moved once kea-dhcp4 runs.

![Setup page](images/setup.png)

## Import dnsmasq

What an import of the OpenWrt static leases would do: one row per lease and
protocol, with its state and the reason when a lease cannot be imported.

![Static lease import](images/import.png)
