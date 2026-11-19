'use strict';

import { test, equal, done } from './lib.uc';
import { dhcp_services, uci_bool, text } from 'luci.kea.openwrt';

// The sections are what "uci show dhcp" has on OpenWrt 25.12.6 after
// installation, and variations of them.

const DNSMASQ = { '.type': 'dnsmasq', domain: 'lan', localservice: '1' };
const ODHCPD = { '.type': 'odhcpd', maindhcp: '0' };
const LAN = { '.name': 'lan', 'interface': 'lan', start: '100', limit: '150',
	dhcpv4: 'server', dhcpv6: 'server', ra: 'server' };
const WAN = { '.name': 'wan', 'interface': 'wan', ignore: '1' };

test('a freshly installed OpenWrt serves everything on lan', () => {
	equal(dhcp_services({ dnsmasq: [ DNSMASQ ], dhcp: [ LAN, WAN ], odhcpd: [ ODHCPD ] }), {
		interfaces: { lan: { v4: true, v6: true, ra: true } },
		dnsmasq: { dns: true, dhcp4: [ 'lan' ] },
		odhcpd: { dhcp4: [], dhcp6: [ 'lan' ], ra: [ 'lan' ] }
	});
});

test('DHCP handed over to Kea leaves DNS and router advertisements', () => {
	let lan = { ...LAN, dhcpv4: 'disabled', dhcpv6: 'disabled' };

	equal(dhcp_services({ dnsmasq: [ DNSMASQ ], dhcp: [ lan, WAN ], odhcpd: [ ODHCPD ] }), {
		interfaces: { lan: { v4: false, v6: false, ra: true } },
		dnsmasq: { dns: true, dhcp4: [] },
		odhcpd: { dhcp4: [], dhcp6: [], ra: [ 'lan' ] }
	});
});

test('dnsmasq answers DHCPv4 unless the section says disabled or is ignored', () => {
	let plain = { 'interface': 'guest' };
	let services = dhcp_services({
		dnsmasq: [ DNSMASQ ],
		dhcp: [ plain, { 'interface': 'iot', ignore: 'true' }, { ignore: '0' } ],
		odhcpd: [ ODHCPD ]
	});

	equal(services.interfaces, { guest: { v4: true, v6: false, ra: false } },
		'a section without an interface names nothing');
	equal(services.dnsmasq.dhcp4, [ 'guest' ]);
	equal(services.odhcpd, { dhcp4: [], dhcp6: [], ra: [] });
});

test('where odhcpd is the main DHCP server it answers DHCPv4, where asked to', () => {
	let services = dhcp_services({
		dnsmasq: [ DNSMASQ ],
		dhcp: [ LAN, { 'interface': 'guest' } ],
		odhcpd: [ { maindhcp: '1' } ]
	});

	equal(services.dnsmasq, { dns: true, dhcp4: [] });
	equal(services.odhcpd.dhcp4, [ 'lan' ]);
	equal(services.interfaces.guest.v4, false, 'not asked for with dhcpv4 "server"');
});

test('dnsmasq is a DNS server unless its port is 0', () => {
	equal(dhcp_services({ dnsmasq: [ { port: '0' } ], dhcp: [], odhcpd: [] }).dnsmasq.dns, false);
	equal(dhcp_services({ dnsmasq: [ { port: '0' }, { port: '5353' } ], dhcp: [], odhcpd: [] }).dnsmasq.dns, true);
	equal(dhcp_services({ dnsmasq: [], dhcp: [], odhcpd: [] }).dnsmasq.dns, true,
		'without a section dnsmasq runs with its defaults');
	equal(dhcp_services(null), {
		interfaces: {},
		dnsmasq: { dns: true, dhcp4: [] },
		odhcpd: { dhcp4: [], dhcp6: [], ra: [] }
	});
});

test('UCI values', () => {
	equal(uci_bool('1', false), true);
	equal(uci_bool('off', true), false);
	equal(uci_bool(null, true), true);
	equal(uci_bool('maybe', false), false);
	equal(text([ 'a', 'b' ]), 'a b');
	equal(text(null), '');
	equal(text(5), '5');
});

done();
