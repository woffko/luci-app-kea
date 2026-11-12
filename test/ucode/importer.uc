'use strict';

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, fixture, done } from './lib.uc';
import * as config from 'luci.kea.config';
import * as importer from 'luci.kea.importer';
import { parse, stringify } from 'luci.kea.jsonc';

const rich4 = fs.readfile(fixture('kea-dhcp4-rich.conf'));
const rich6 = fs.readfile(fixture('kea-dhcp6-rich.conf'));
const interfaces = [
	{ name: 'lan', device: 'br-lan', ipaddr: '192.168.1.1/24' },
	{ name: 'guest', device: 'br-guest', ipaddr: '192.168.50.1/24' }
];

// A fresh environment: the two rich fixtures and two OpenWrt interfaces.
function env() {
	return { dhcp4: parse(rich4).config, dhcp6: parse(rich6).config, interfaces };
}

function host(name, values) {
	return { '.name': name, ...values };
}

// Classify hosts and index the entries by key.
function classify(hosts, environment) {
	let result = {};

	for (let entry in importer.classify_all(hosts, environment ?? env()))
		result[entry.key] = entry;

	return result;
}

function one(values, environment) {
	return classify([ host('h', values) ], environment);
}

/* ---- one section, two protocols ------------------------------------------ */

test('a dual-stack section yields a DHCPv4 and a DHCPv6 entry', () => {
	let entries = one({
		name: 'laptop',
		mac: [ '02:00:00:00:00:AA' ],
		ip: '192.168.1.77',
		duid: [ '00030001020000000aaa' ],
		hostid: '77'
	});

	equal(sort(keys(entries)), [ 'h:dhcp4', 'h:dhcp6' ]);
	equal(importer.to_public(entries['h:dhcp4']), {
		key: 'h:dhcp4',
		source: 'h',
		family: 'dhcp4',
		status: 'ready',
		selectable: true,
		selected: true,
		disabled: false,
		name: 'laptop',
		identifier_type: 'hw-address',
		identifier: '02:00:00:00:00:aa',
		address: '192.168.1.77',
		subnet: '192.168.1.0/24',
		notes: []
	});
	equal(entries['h:dhcp6'].status, 'ready');
	equal(entries['h:dhcp6'].identifier_type, 'duid');
	equal(entries['h:dhcp6'].identifier, '00:03:00:01:02:00:00:00:0a:aa');
	equal(entries['h:dhcp6'].address, 'fd00:1::77');
	equal(entries['h:dhcp6'].subnet, 'fd00:1::/64');
});

test('a section with only IPv4 or only IPv6 data yields one entry', () => {
	equal(keys(one({ mac: '02:00:00:00:00:aa', ip: '192.168.1.77' })), [ 'h:dhcp4' ]);
	equal(keys(one({ duid: '00030001020000000aaa', hostid: '77' })), [ 'h:dhcp6' ]);
	equal(keys(one({ name: 'empty' })), [ 'h:dhcp4' ]);
	equal(one({ name: 'empty' })['h:dhcp4'].status, 'blocked');
});

test('an IPv6 address in "ip" belongs to the DHCPv6 entry', () => {
	let entries = one({ duid: '00:03:00:01:02:00:00:00:0a:aa', ip: 'FD00:1::EA4D' });

	equal(keys(entries), [ 'h:dhcp6' ]);
	equal(entries['h:dhcp6'].status, 'ready');
	equal(entries['h:dhcp6'].address, 'fd00:1::ea4d');
});

/* ---- DHCPv4 ------------------------------------------------------------- */

function blocked4(values, environment) {
	let entry = one(values, environment)['h:dhcp4'];

	equal(entry.status, 'blocked');
	equal(entry.selectable, false);
	equal(entry.selected, false);

	return entry.notes;
}

test('DHCPv4 entries that cannot become a reservation are blocked with the reason', () => {
	equal(blocked4({ ip: '192.168.1.5' }), [ 'no MAC address' ]);
	equal(blocked4({ name: 'pc', ip: '192.168.1.5' }),
		[ 'no MAC address (dnsmasq matches this host by its name, Kea cannot)' ]);
	equal(blocked4({ mac: '02:00:00:00:00:aa' }), [ 'no IPv4 address' ]);
	equal(blocked4({ mac: '02:00:00:00:00:aa', ip: '192.168.1.300' }), [ 'invalid IPv4 address' ]);
	equal(blocked4({ mac: '02-00-00-00-00-aa', ip: '192.168.1.5' }), [ 'invalid MAC address' ]);
	equal(blocked4({ mac: '02:00:00:00:00:aa', ip: 'ignore' }),
		[ 'dnsmasq ignores this host; a Kea reservation cannot express that' ]);
	equal(blocked4({ mac: [ '02:00:00:00:00:b1', '02:00:00:00:00:b2' ], ip: '192.168.1.90' }),
		[ 'several MAC addresses share one address; Kea reserves an address for one identifier' ]);
});

test('an address outside every Kea subnet is blocked, with a hint when OpenWrt knows the network', () => {
	equal(blocked4({ mac: '02:00:00:00:00:aa', ip: '172.16.9.9' }),
		[ 'the address is outside every Kea DHCPv4 subnet' ]);
	equal(blocked4({ mac: '02:00:00:00:00:aa', ip: '192.168.50.9' }),
		[ 'the address is outside every Kea DHCPv4 subnet; create the subnet for interface guest on the DHCPv4 page first' ]);
});

test('a missing Kea configuration blocks the entries of that protocol only', () => {
	let entries = one({
		mac: '02:00:00:00:00:aa', ip: '192.168.1.77', duid: '00030001020000000aaa', hostid: '77'
	}, { dhcp4: null, dhcp6: parse(rich6).config, interfaces });

	equal(entries['h:dhcp4'].notes, [ 'the Kea DHCPv4 configuration is missing or cannot be parsed' ]);
	equal(entries['h:dhcp6'].status, 'ready');
});

test('dnsmasq settings that Kea cannot express ask for a review', () => {
	let entry = one({
		mac: '02:00:00:00:00:aa',
		ip: '192.168.1.77',
		tag: [ 'special' ],
		match_tag: [ 'known' ],
		networkid: 'lan',
		leasetime: '12h',
		instance: 'main',
		dns: '1',
		broadcast: '1'
	})['h:dhcp4'];

	equal(entry.status, 'review');
	equal(entry.selectable, true);
	equal(entry.selected, false);
	equal(entry.notes, [
		'the dnsmasq tag is not carried over',
		'the dnsmasq tag match is not carried over',
		'the dnsmasq network ID is not carried over',
		'the per-host lease time is not carried over',
		'the dnsmasq instance is not carried over',
		'the hosts file entry (dns) is not carried over',
		'the broadcast flag is not carried over'
	]);
});

test('a disabled static lease can be imported as a disabled reservation', () => {
	let entry = one({ mac: '02:00:00:00:00:aa', ip: '192.168.1.77', enable: '0' })['h:dhcp4'];

	equal(entry.status, 'review');
	equal(entry.disabled, true);
	equal(entry.notes, [ 'the static lease is disabled; it is imported as a disabled reservation' ]);
});

/* ---- what Kea already has ------------------------------------------------ */

test('a reservation Kea already has is reported as present', () => {
	let entry = one({ name: 'nas', mac: '02:00:00:00:00:01', ip: '192.168.1.10' })['h:dhcp4'];

	equal(entry.status, 'present');
	equal(entry.selectable, false);
	equal(entry.notes, [ 'already reserved in Kea' ]);

	/* A lease without a name does not ask to drop the hostname Kea has. */
	equal(one({ mac: '02:00:00:00:00:01', ip: '192.168.1.10' })['h:dhcp4'].status, 'present');
});

test('a different address or hostname for a known client is an update the user must select', () => {
	let moved = one({ name: 'nas', mac: '02:00:00:00:00:01', ip: '192.168.1.20' })['h:dhcp4'];

	equal(moved.status, 'update');
	equal(moved.selectable, true);
	equal(moved.selected, false);
	equal(moved.notes, [ 'Kea reserves 192.168.1.10 for this client; the import changes it to 192.168.1.20' ]);

	let renamed = one({ name: 'storage', mac: '02:00:00:00:00:01', ip: '192.168.1.10' })['h:dhcp4'];

	equal(renamed.status, 'update');
	equal(renamed.notes, [ 'the import sets the hostname of the existing reservation to storage' ]);
});

test('an address reserved for another client is not taken over', () => {
	equal(blocked4({ mac: '02:00:00:00:00:aa', ip: '192.168.1.11' }),
		[ 'the address is already reserved in Kea for 01:02:00:00:00:00:02' ]);
});

test('a client stored as a disabled reservation is not imported again', () => {
	let environment = env();

	environment.dhcp4.Dhcp4.subnet4[0]['user-context']['luci-app-kea'] = {
		'disabled-reservations': [ { 'hw-address': '02:00:00:00:00:AA', 'ip-address': '192.168.1.77' } ]
	};

	let entry = one({ mac: '02:00:00:00:00:aa', ip: '192.168.1.77' }, environment)['h:dhcp4'];

	equal(entry.status, 'present');
	equal(entry.notes, [ 'already stored in Kea as a disabled reservation' ]);
});

/* ---- duplicates ---------------------------------------------------------- */

test('hosts that share a MAC address or an address block each other', () => {
	let entries = classify([
		host('a', { name: 'one', mac: '02:00:00:00:00:aa', ip: '192.168.1.77' }),
		host('b', { name: 'two', mac: '02:00:00:00:00:aa', ip: '192.168.1.78' }),
		host('c', { name: 'three', mac: '02:00:00:00:00:cc', ip: '192.168.1.79' }),
		host('d', { mac: '02:00:00:00:00:dd', ip: '192.168.1.79' }),
		host('e', { name: 'fine', mac: '02:00:00:00:00:ee', ip: '192.168.1.80' })
	]);

	equal(entries['a:dhcp4'].notes, [ 'same MAC address as host two' ]);
	equal(entries['b:dhcp4'].notes, [ 'same MAC address as host one' ]);
	equal(entries['c:dhcp4'].notes, [ 'same address as host d' ]);
	equal(entries['d:dhcp4'].notes, [ 'same address as host three' ]);
	equal(entries['e:dhcp4'].status, 'ready');
});

/* ---- DHCPv6 ------------------------------------------------------------- */

test('DUIDs are read in the OpenWrt notation and normalized', () => {
	equal(importer.parse_duid('00030001020000000AAA'), { duid: '00:03:00:01:02:00:00:00:0a:aa', iaid: '' });
	equal(importer.parse_duid('00:03:00:01:02:00:00:00:0a:aa'), { duid: '00:03:00:01:02:00:00:00:0a:aa', iaid: '' });
	equal(importer.parse_duid('00030001020000000aaa%1f'), { duid: '00:03:00:01:02:00:00:00:0a:aa', iaid: '1f' });

	for (let bad in [ '', '00', '0001', '000', 'zz0102', '00030001%1%2', '*' ])
		equal(importer.parse_duid(bad), null, bad);
});

test('DHCPv6 problems are blocked with the reason', () => {
	let notes = values => one(values)['h:dhcp6'].notes;

	equal(notes({ hostid: '77' }), [ 'no DUID' ]);
	equal(notes({ duid: '00', hostid: '77' }), [ 'invalid or truncated DUID' ]);
	equal(notes({ duid: [ '00030001020000000aaa', '00030001020000000bbb' ], hostid: '77' }),
		[ 'several DUIDs share one address; Kea reserves an address for one identifier' ]);
	equal(notes({ duid: '00030001020000000aaa' }), [ 'no IPv6 token (hostid) or address' ]);
	equal(notes({ duid: '00030001020000000aaa', hostid: 'xyz' }), [ 'invalid IPv6 token' ]);
	equal(notes({ duid: '00030001020000000aaa', ip: 'fd00:9::1' }),
		[ 'the address is outside every Kea DHCPv6 subnet' ]);
});

test('an IAID is dropped with a note', () => {
	let entry = one({ duid: '00030001020000000aaa%1f', hostid: '77' })['h:dhcp6'];

	equal(entry.status, 'review');
	equal(entry.identifier, '00:03:00:01:02:00:00:00:0a:aa');
	equal(entry.notes, [ 'the IAID is not carried over; Kea reserves by DUID only' ]);
});

test('the IPv6 token is placed in the only subnet, or in the one of the host\'s interface', () => {
	let two = env();

	push(two.dhcp6.Dhcp6.subnet6, { id: 9, subnet: 'fd00:50::/64', 'interface': 'br-guest' });

	let lan = one({ mac: '02:00:00:00:00:aa', ip: '192.168.1.77', duid: '00030001020000000aaa', hostid: '77' }, two);
	let guest = one({ mac: '02:00:00:00:00:ab', ip: '192.168.50.9', duid: '00030001020000000aab', hostid: 'ab' }, two);
	let unknown = one({ duid: '00030001020000000aac', hostid: 'ac' }, two);

	equal(lan['h:dhcp6'].address, 'fd00:1::77');
	equal(guest['h:dhcp6'].address, 'fd00:50::ab');
	equal(guest['h:dhcp6'].subnet, 'fd00:50::/64');
	equal(unknown['h:dhcp6'].notes,
		[ 'several Kea DHCPv6 subnets exist; cannot tell which one this host belongs to' ]);

	let none = env();

	none.dhcp6.Dhcp6.subnet6 = [ { id: 1, subnet: 'fd00:1::/80' } ];
	equal(one({ duid: '00030001020000000aaa', hostid: '77' }, none)['h:dhcp6'].notes,
		[ 'no Kea DHCPv6 subnet of /64 or shorter to place the IPv6 token in' ]);
});

test('DHCPv6 reservations Kea already has are recognized by DUID, in either notation', () => {
	let present = one({ name: 'nas', duid: '00030001020000000001', ip: 'fd00:1::10' })['h:dhcp6'];
	let added = one({ name: 'nas', duid: '00030001020000000001', hostid: '99' })['h:dhcp6'];

	equal(present.status, 'present');
	equal(added.status, 'update');
	equal(added.notes, [ 'Kea has a reservation for this client without this address; the import adds it' ]);
});

/* ---- commit -------------------------------------------------------------- */

const root = tmpdir();
let accept = { dhcp4: true, dhcp6: true };
let now = 1794415113;

const ctx = config.context({
	root,
	run_dir: root + '/run',
	clock: () => now,
	validator: name => accept[name] ? { valid: true, output: 'ok' } : { valid: false, output: 'Kea says no' }
});

const file4 = config.path(ctx, 'dhcp4');
const file6 = config.path(ctx, 'dhcp6');
const hosts = [
	host('dual', { name: 'laptop', mac: [ '02:00:00:00:00:AA' ], ip: '192.168.1.77', duid: [ '00030001020000000aaa' ], hostid: '77' }),
	host('printer', { name: 'printer', mac: [ '02:00:00:00:00:ab' ], ip: '192.168.1.78', leasetime: '12h' }),
	host('known', { name: 'nas', mac: [ '02:00:00:00:00:01' ], ip: '192.168.1.10' }),
	host('elsewhere', { name: 'far', mac: [ '02:00:00:00:00:c1' ], ip: '172.16.9.9' }),
	host('off', { name: 'spare', mac: [ '02:00:00:00:00:d1' ], ip: '192.168.1.91', enable: '0' })
];

function reset() {
	rm_rf(ctx.conf_dir);
	config.mkdir_p(ctx.conf_dir, 0o755);
	fs.writefile(file4, rich4);
	fs.writefile(file6, rich6);
	accept = { dhcp4: true, dhcp6: true };
}

function statuses() {
	let result = {};

	for (let entry in importer.preview(ctx, hosts, interfaces).entries)
		result[entry.key] = entry.status;

	return result;
}

test('preview reports the state of both files and classifies against them', () => {
	reset();

	let preview = importer.preview(ctx, hosts, interfaces);

	equal(preview.mode, 'dry-run');
	equal(preview.files.dhcp4, { path: file4, exists: true, parsed: true, has_comments: true, error: null });
	equal(statuses(), {
		'dual:dhcp4': 'ready',
		'dual:dhcp6': 'ready',
		'printer:dhcp4': 'review',
		'known:dhcp4': 'present',
		'elsewhere:dhcp4': 'blocked',
		'off:dhcp4': 'review'
	});
	equal(fs.readfile(file4), rich4, 'a preview writes nothing');
});

test('preview copes with a missing and a broken file', () => {
	reset();
	fs.unlink(file6);
	fs.writefile(file4, '{ broken');

	let preview = importer.preview(ctx, hosts, interfaces);

	equal(preview.files.dhcp6.exists, false);
	equal(preview.files.dhcp4.parsed, false);
	ok(preview.files.dhcp4.error, 'the parser error is reported');
	equal(filter(preview.entries, entry => entry.status != 'blocked'), []);
});

test('commit without a selection imports every ready entry into both files', () => {
	reset();

	let result = importer.commit(ctx, hosts, interfaces);

	equal(result, {
		result: true,
		changed: true,
		imported: 2,
		updated: 0,
		skipped: 0,
		skipped_entries: [],
		backups: { dhcp4: '20261111T163833Z', dhcp6: '20261111T163833Z' }
	});

	let before4 = parse(rich4).config;
	let after4 = parse(fs.readfile(file4)).config;

	equal(pop(after4.Dhcp4.subnet4[0].reservations),
		{ 'hw-address': '02:00:00:00:00:aa', 'ip-address': '192.168.1.77', hostname: 'laptop' });
	equal(after4, before4, 'nothing else changed in the DHCPv4 file');

	let before6 = parse(rich6).config;
	let after6 = parse(fs.readfile(file6)).config;

	equal(pop(after6.Dhcp6.subnet6[0].reservations),
		{ duid: '00:03:00:01:02:00:00:00:0a:aa', 'ip-addresses': [ 'fd00:1::77' ], hostname: 'laptop' });
	equal(after6, before6, 'nothing else changed in the DHCPv6 file');

	equal(fs.readfile(file4), stringify(parse(fs.readfile(file4)).config),
		'the file is written in the layout the editors use');
});

test('importing again changes nothing', () => {
	let written4 = fs.readfile(file4);
	let written6 = fs.readfile(file6);

	equal(statuses()['dual:dhcp4'], 'present');
	equal(statuses()['dual:dhcp6'], 'present');

	let result = importer.commit(ctx, hosts, interfaces);

	equal(result.changed, false);
	equal(result.imported, 0);
	equal(result.backups, {});
	equal(fs.readfile(file4), written4);
	equal(fs.readfile(file6), written6);
});

test('commit imports exactly the selected entries and explains what it skipped', () => {
	reset();

	let result = importer.commit(ctx, hosts, interfaces,
		[ 'printer:dhcp4', 'off:dhcp4', 'elsewhere:dhcp4', 'known:dhcp4', 'nobody:dhcp4', 'printer:dhcp4' ]);

	equal(result.imported, 2);
	equal(result.skipped_entries, [
		{ key: 'elsewhere:dhcp4', reason: 'blocked: the address is outside every Kea DHCPv4 subnet' },
		{ key: 'known:dhcp4', reason: 'present: already reserved in Kea' },
		{ key: 'nobody:dhcp4', reason: 'no such entry' }
	]);
	equal(fs.readfile(file6), rich6, 'the DHCPv6 file was not touched');

	let subnet = parse(fs.readfile(file4)).config.Dhcp4.subnet4[0];

	equal(subnet.reservations[3],
		{ 'hw-address': '02:00:00:00:00:ab', 'ip-address': '192.168.1.78', hostname: 'printer' });
	equal(length(subnet.reservations), 4);
	equal(subnet['user-context'], {
		site: 'home',
		'luci-app-kea': {
			'disabled-reservations': [
				{ 'hw-address': '02:00:00:00:00:d1', 'ip-address': '192.168.1.91', hostname: 'spare' }
			]
		}
	});
	equal(statuses()['off:dhcp4'], 'present', 'the disabled reservation is recognized next time');
});

test('a selected update changes the existing reservation in place', () => {
	reset();

	let moved = [ host('known', { name: 'storage', mac: [ '02:00:00:00:00:01' ], ip: '192.168.1.20' }) ];
	let result = importer.commit(ctx, moved, interfaces, [ 'known:dhcp4' ]);

	equal(result.updated, 1);
	equal(result.imported, 0);

	let reservations = parse(fs.readfile(file4)).config.Dhcp4.subnet4[0].reservations;

	equal(reservations[0], { 'hw-address': '02:00:00:00:00:01', 'ip-address': '192.168.1.20', hostname: 'storage' });
	equal(length(reservations), 3);
});

test('each replaced file is backed up', () => {
	reset();
	importer.commit(ctx, hosts, interfaces);
	now += 60;

	let again = [ host('extra', { name: 'extra', mac: [ '02:00:00:00:00:ee' ], ip: '192.168.1.99' }) ];
	let result = importer.commit(ctx, again, interfaces);

	equal(result.backups, { dhcp4: '20261111T163933Z' });
	ok(index(fs.readfile(ctx.backup_dir + '/kea-dhcp4.20261111T163933Z.conf'), '02:00:00:00:00:aa') > 0);
});

test('if Kea rejects one file, neither file is replaced', () => {
	reset();
	accept.dhcp6 = false;

	let result = importer.commit(ctx, hosts, interfaces);

	equal(result, {
		result: false,
		error: 'the imported DHCPv6 configuration failed validation',
		validation: 'Kea says no'
	});
	equal(fs.readfile(file4), rich4);
	equal(fs.readfile(file6), rich6);
	equal(fs.lsdir(ctx.conf_dir), [ 'kea-dhcp4.conf', 'kea-dhcp6.conf' ]);
});

rm_rf(root);
done();
