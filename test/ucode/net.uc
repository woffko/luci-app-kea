'use strict';

import { test, equal, done } from './lib.uc';
import * as net from 'luci.kea.net';

test('ipv4_to_int accepts dotted quads only', () => {
	equal(net.ipv4_to_int('192.168.1.1'), 3232235777);
	equal(net.ipv4_to_int('0.0.0.0'), 0);
	equal(net.ipv4_to_int('256.1.1.1'), null);
	equal(net.ipv4_to_int('1.2.3'), null);
	equal(net.ipv4_to_int('1.2.3.x'), null);
	equal(net.ipv4_to_int(''), null);
	equal(net.ipv4_to_int(null), null);
});

test('parse_cidr yields the first and last address', () => {
	equal(net.parse_cidr('192.168.1.77/24'), { first: 3232235776, last: 3232236031 });
	equal(net.parse_cidr('10.0.0.1'), { first: 167772161, last: 167772161 });
	equal(net.parse_cidr('0.0.0.0/0'), { first: 0, last: 4294967295 });
	equal(net.parse_cidr('10.0.0.0/33'), null);
	equal(net.parse_cidr('10.0.0.0/x'), null);
	equal(net.parse_cidr('10.0.0.0/8/8'), null);
});

test('ip_in_subnet', () => {
	equal(net.ip_in_subnet('192.168.1.77', '192.168.1.0/24'), true);
	equal(net.ip_in_subnet('192.168.2.77', '192.168.1.0/24'), false);
	equal(net.ip_in_subnet('172.16.9.9', '172.16.0.0/12'), true);
	equal(net.ip_in_subnet('bogus', '192.168.1.0/24'), false);
	equal(net.ip_in_subnet('192.168.1.1', null), false);
});

test('netmask_to_prefix rejects masks with holes', () => {
	equal(net.netmask_to_prefix('255.255.255.0'), 24);
	equal(net.netmask_to_prefix('255.255.240.0'), 20);
	equal(net.netmask_to_prefix('0.0.0.0'), 0);
	equal(net.netmask_to_prefix('255.255.255.255'), 32);
	equal(net.netmask_to_prefix('255.0.255.0'), null);
	equal(net.netmask_to_prefix('255.255.255'), null);
	equal(net.netmask_to_prefix(null), null);
});

test('interface_addresses covers both forms of /etc/config/network', () => {
	equal(net.interface_addresses([ '192.168.1.1/24' ], null), '192.168.1.1/24');
	equal(net.interface_addresses([ '192.168.1.1/24', '10.0.0.1/8' ], null), '192.168.1.1/24 10.0.0.1/8');
	equal(net.interface_addresses('192.168.1.1', '255.255.255.0'), '192.168.1.1/24');
	equal(net.interface_addresses('192.168.1.1/24', '255.255.0.0'), '192.168.1.1/24');
	equal(net.interface_addresses('192.168.1.1', null), '192.168.1.1');
	equal(net.interface_addresses(null, null), '');
});

done();
