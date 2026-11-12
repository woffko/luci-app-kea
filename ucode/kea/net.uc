// SPDX-License-Identifier: Apache-2.0

'use strict';

// IPv4 helpers shared by the import and the interface list.

export function ipv4_to_int(addr) {
	let parts = split(addr ?? '', '.');
	let value = 0;

	if (length(parts) != 4)
		return null;

	for (let part in parts) {
		if (!match(part, /^[0-9]+$/) || +part > 255)
			return null;

		value = value * 256 + +part;
	}

	return value;
};

// "192.168.1.0/24" -> { first, last } as integers. A bare address is a /32.
export function parse_cidr(value) {
	let parts = split(value ?? '', '/');
	let ip = ipv4_to_int(parts[0]);
	let prefix = length(parts) > 1 ? parts[1] : '32';

	if (ip == null || length(parts) > 2 || !match(prefix, /^[0-9]+$/) || +prefix > 32)
		return null;

	let size = 1;

	for (let i = +prefix; i < 32; i++)
		size *= 2;

	let first = ip - (ip % size);

	return { first, last: first + size - 1 };
};

export function ip_in_subnet(addr, subnet) {
	let ip = ipv4_to_int(addr);
	let cidr = parse_cidr(subnet);

	return ip != null && cidr != null && ip >= cidr.first && ip <= cidr.last;
};

// "255.255.255.0" -> 24, or null if it is not a contiguous netmask.
export function netmask_to_prefix(mask) {
	let parts = split(mask ?? '', '.');
	let prefix = 0;
	let ended = false;

	if (length(parts) != 4)
		return null;

	for (let part in parts) {
		if (!match(part, /^[0-9]+$/) || +part > 255)
			return null;

		for (let bit = 128; bit >= 1; bit /= 2) {
			if (+part & bit) {
				if (ended)
					return null;

				prefix++;
			}
			else {
				ended = true;
			}
		}
	}

	return prefix;
};

// Interface addresses as "address/prefix" separated by spaces. Covers both
// forms of /etc/config/network: a list of CIDR addresses, and one address
// with a separate "netmask" option.
export function interface_addresses(ipaddr, netmask) {
	let prefix = netmask_to_prefix(netmask);
	let list = type(ipaddr) == 'array' ? ipaddr : split(ipaddr ?? '', /\s+/);

	return join(' ', map(filter(list, addr => addr != ''), addr =>
		(index(addr, '/') < 0 && prefix != null) ? addr + '/' + prefix : addr));
};

// ---- IPv6 -------------------------------------------------------------------

// The 16 bytes of an IPv6 address, or null.
export function ipv6_bytes(addr) {
	let bytes = iptoarr(addr ?? '');

	return (type(bytes) == 'array' && length(bytes) == 16) ? bytes : null;
};

// Canonical text of an IPv6 address, or null.
export function ipv6_canonical(addr) {
	let bytes = ipv6_bytes(addr);

	return bytes ? arrtoip(bytes) : null;
};

// "fd00:1::/64" -> { bytes, prefix }, or null.
export function parse_cidr6(value) {
	let parts = split(value ?? '', '/');
	let bytes = ipv6_bytes(parts[0]);

	if (!bytes || length(parts) != 2 || !match(parts[1], /^[0-9]+$/) || +parts[1] > 128)
		return null;

	return { bytes, prefix: +parts[1] };
};

// The mask for byte number "index" of a prefix of the given length.
function byte_mask(prefix, index) {
	let bits = prefix - index * 8;

	if (bits >= 8)
		return 0xff;

	return bits <= 0 ? 0 : (0xff << (8 - bits)) & 0xff;
}

export function ip6_in_subnet(addr, subnet) {
	let bytes = ipv6_bytes(addr);
	let cidr = parse_cidr6(subnet);

	if (!bytes || !cidr)
		return false;

	for (let i = 0; i < 16; i++) {
		let mask = byte_mask(cidr.prefix, i);

		if ((bytes[i] & mask) != (cidr.bytes[i] & mask))
			return false;
	}

	return true;
};

// The address made of a subnet prefix and an interface token (the "hostid"
// of an OpenWrt static lease: up to 16 hex digits, the low 64 bits).
// Needs a prefix of /64 or shorter. Returns null if it cannot be built.
export function token_address(subnet, token) {
	let cidr = parse_cidr6(subnet);

	if (!cidr || cidr.prefix > 64 || !match(token ?? '', /^[0-9a-fA-F]{1,16}$/))
		return null;

	let digits = lc(token);

	while (length(digits) < 16)
		digits = '0' + digits;

	let bytes = [];

	for (let i = 0; i < 8; i++)
		push(bytes, cidr.bytes[i] & byte_mask(cidr.prefix, i));

	for (let i = 0; i < 8; i++)
		push(bytes, hex(substr(digits, i * 2, 2)));

	return arrtoip(bytes);
};
