'use strict';

// Import preview from a UCI fixture, read the way the rpcd plugin reads
// /etc/config/dhcp. Needs the ucode "uci" module, so it runs on OpenWrt.

import * as fs from 'fs';
import { cursor } from 'uci';
import { test, equal, tmpdir, rm_rf, fixture, done } from '../lib.uc';
import * as importer from 'luci.kea.importer';

const root = tmpdir();

fs.writefile(root + '/dhcp', fs.readfile(fixture('dhcp-static-leases.uci')));

let hosts = [];

cursor(root).foreach('dhcp', 'host', s => push(hosts, s));

let entries = {};

for (let entry in importer.preview(hosts))
	entries[entry.source] = entry;

test('all five host sections are read', () => {
	equal(sort(keys(entries)),
		[ 'dhcpv6_duid', 'dhcpv6_truncated_duid', 'missing_mac', 'tagged_dnsmasq_only', 'valid_ipv4' ]);
});

test('the valid IPv4 host is ready', () => {
	let entry = entries.valid_ipv4;

	equal(entry.family, 'dhcp4');
	equal(entry.status, 'ready');
	equal(entry.mac, '12:00:78:59:29:8c');
	equal(entry.ip, '10.0.77.118');
	equal(entry.warnings, []);
});

test('the host without a MAC address is disabled', () => {
	equal(entries.missing_mac.status, 'disabled');
	equal(entries.missing_mac.warnings, [ 'missing MAC address' ]);
});

test('the full DHCPv6 DUID is preserved', () => {
	let entry = entries.dhcpv6_duid;

	equal(entry.family, 'dhcp6');
	equal(entry.status, 'ready');
	equal(entry.duid, '00:04:e6:f8:c8:8f:a8:5f:d8:18:25:59:60:2d:e4:b5:fc:2e');
});

test('the truncated DUID is rejected', () => {
	equal(entries.dhcpv6_truncated_duid.status, 'disabled');
	equal(entries.dhcpv6_truncated_duid.warnings,
		[ 'missing, invalid, or truncated DHCPv6 DUID/client-id' ]);
});

test('dnsmasq-only tag and DNS behavior need manual review', () => {
	equal(entries.tagged_dnsmasq_only.status, 'disabled');
	equal(entries.tagged_dnsmasq_only.warnings, [
		'dnsmasq tag import is not implemented yet',
		'dns hostfile side effect is not represented in Kea reservation'
	]);
});

rm_rf(root);
done();
