// SPDX-License-Identifier: Apache-2.0

'use strict';

// What the DHCP services of OpenWrt itself, dnsmasq and odhcpd, are
// configured to serve. Pure: the caller reads the sections of
// /etc/config/dhcp and passes them in.
//
// The rules follow /etc/init.d/dnsmasq and odhcpd of OpenWrt 25.12:
// - a "dhcp" section with "ignore" serves nothing on its interface;
// - dnsmasq answers DHCPv4 unless the section says dhcpv4 'disabled'.
//   Where odhcpd is the main DHCP server ("maindhcp"), odhcpd answers
//   DHCPv4 instead, on the sections that say dhcpv4 'server';
// - odhcpd answers DHCPv6 and sends router advertisements where a section
//   asks for it with 'server', 'relay' or 'hybrid';
// - dnsmasq is a DNS server unless its port is 0.
//
// A dnsmasq that also answers DHCPv6, on a system without odhcpd, is not
// told apart: DHCPv6 and router advertisements are counted for odhcpd.

const ACTIVE_MODES = [ 'server', 'relay', 'hybrid' ];

export function text(value) {
	if (type(value) == 'array')
		return join(' ', value);

	return value == null ? '' : `${value}`;
};

export function uci_bool(value, fallback) {
	value = text(value);

	if (value in [ '1', 'on', 'true', 'yes', 'enabled' ])
		return true;

	if (value in [ '0', 'off', 'false', 'no', 'disabled' ])
		return false;

	return fallback;
};

// sections: { dnsmasq: [...], dhcp: [...], odhcpd: [...] }, each a list of
// UCI sections as objects. Returns
// {
//   interfaces: { name: { v4, v6, ra } },   what is served on an interface
//   dnsmasq: { dns, dhcp4: [ names ] },
//   odhcpd: { dhcp4: [ names ], dhcp6: [ names ], ra: [ names ] }
// }
export function dhcp_services(sections) {
	let main = false;
	let dns = !length(sections?.dnsmasq);
	let result = {
		interfaces: {},
		dnsmasq: { dns: false, dhcp4: [] },
		odhcpd: { dhcp4: [], dhcp6: [], ra: [] }
	};

	for (let s in sections?.odhcpd)
		if (uci_bool(s.maindhcp, false))
			main = true;

	// Without a section dnsmasq runs with its defaults, which include DNS.
	for (let s in sections?.dnsmasq)
		if (text(s.port) != '0')
			dns = true;

	result.dnsmasq.dns = dns;

	for (let s in sections?.dhcp) {
		let name = text(s['interface']);

		if (name == '' || uci_bool(s.ignore, false))
			continue;

		let v4 = main ? text(s.dhcpv4) == 'server' : text(s.dhcpv4) != 'disabled';
		let v6 = text(s.dhcpv6) in ACTIVE_MODES;
		let ra = text(s.ra) in ACTIVE_MODES;

		result.interfaces[name] = { v4, v6, ra };

		if (v4)
			push(main ? result.odhcpd.dhcp4 : result.dnsmasq.dhcp4, name);

		if (v6)
			push(result.odhcpd.dhcp6, name);

		if (ra)
			push(result.odhcpd.ra, name);
	}

	return result;
};
