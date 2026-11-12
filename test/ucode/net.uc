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

test('IPv6 addresses are parsed, compared and made canonical', () => {
	equal(net.ipv6_canonical('FD00:0001:0000:0000:0000:0000:0000:0010'), 'fd00:1::10');
	equal(net.ipv6_canonical('192.168.1.1'), null);
	equal(net.ipv6_canonical('nope'), null);
	equal(net.parse_cidr6('fd00:1::/64').prefix, 64);
	equal(net.parse_cidr6('fd00:1::'), null);
	equal(net.parse_cidr6('fd00:1::/129'), null);
	equal(net.ip6_in_subnet('fd00:1::10', 'fd00:1::/64'), true);
	equal(net.ip6_in_subnet('fd00:2::10', 'fd00:1::/64'), false);
	equal(net.ip6_in_subnet('fd00:1:0:80::1', 'fd00:1::/57'), false);
	equal(net.ip6_in_subnet('fd00:1:0:7f::1', 'fd00:1::/57'), true);
	equal(net.ip6_in_subnet('fd00:1::10', 'nope'), false);
});

test('an IPv6 token is combined with the subnet prefix', () => {
	equal(net.token_address('fd00:1::/64', '23'), 'fd00:1::23');
	equal(net.token_address('fd00:1::/64', 'AABBCCDDEEFF0011'), 'fd00:1::aabb:ccdd:eeff:11');
	equal(net.token_address('fd00:1:2:3::/56', '1'), 'fd00:1:2::1');
	equal(net.token_address('fd00:1::/48', 'beef'), 'fd00:1::beef');
	equal(net.token_address('fd00:1::/72', '1'), null, 'the prefix leaves no room for a 64-bit token');
	equal(net.token_address('fd00:1::/64', 'xyz'), null);
	equal(net.token_address('fd00:1::/64', '11223344556677889'), null, 'more than 64 bits');
	equal(net.token_address('fd00:1::/64', ''), null);
});

done();
