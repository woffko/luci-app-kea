'use strict';

// Import preview and commit from a UCI fixture, read the way the rpcd plugin
// reads /etc/config/dhcp, and validated by the real Kea binaries. Needs the
// ucode "uci" module, kea-dhcp4 and kea-dhcp6, so it runs on OpenWrt.

import * as fs from 'fs';
import { cursor } from 'uci';
import { test, equal, tmpdir, rm_rf, fixture, done } from '../lib.uc';
import * as config from 'luci.kea.config';
import * as importer from 'luci.kea.importer';
import { parse } from 'luci.kea.jsonc';

const root = tmpdir();
const ctx = config.context({ root, run_dir: root + '/run' });
const interfaces = [ { name: 'lan', device: 'br-lan', ipaddr: '192.168.1.1/24' } ];

config.mkdir_p(root + '/uci', 0o755);
config.mkdir_p(ctx.conf_dir, 0o755);
fs.writefile(root + '/uci/dhcp', fs.readfile(fixture('dhcp-static-leases.uci')));
fs.writefile(config.path(ctx, 'dhcp4'), fs.readfile(fixture('kea-dhcp4-rich.conf')));
fs.writefile(config.path(ctx, 'dhcp6'), fs.readfile(fixture('kea-dhcp6-rich.conf')));

let hosts = [];

cursor(root + '/uci').foreach('dhcp', 'host', s => push(hosts, s));

function entries() {
	let result = {};

	for (let entry in importer.preview(ctx, hosts, interfaces).entries)
		result[entry.key] = entry;

	return result;
}

test('UCI lists and options are read as the import expects', () => {
	equal(length(hosts), 8);
	equal(hosts[0].mac, [ '02:00:00:00:00:AA' ]);
	equal(hosts[0].duid, [ '00030001020000000aaa' ]);
	equal(hosts[3].mac, [ '02:00:00:00:00:b1', '02:00:00:00:00:b2' ]);
});

test('every static lease of the fixture is classified', () => {
	let found = entries();
	let statuses = {};

	for (let key, entry in found)
		statuses[key] = entry.status;

	equal(statuses, {
		'dual:dhcp4': 'ready',
		'dual:dhcp6': 'ready',
		'printer:dhcp4': 'review',
		'known:dhcp4': 'present',
		'docked:dhcp4': 'blocked',
		'elsewhere:dhcp4': 'blocked',
		'off:dhcp4': 'review',
		'truncated:dhcp6': 'blocked',
		'byname:dhcp4': 'blocked'
	});
	equal(found['dual:dhcp6'].address, 'fd00:1::77');
	equal(found['truncated:dhcp6'].notes, [ 'invalid or truncated DUID' ]);
});

test('Kea accepts both files after the import', () => {
	let result = importer.commit(ctx, hosts, interfaces, [ 'dual:dhcp4', 'dual:dhcp6', 'off:dhcp4', 'printer:dhcp4' ]);

	equal(result.result, true, result.validation);
	equal(result.imported, 4);
	equal(config.read(ctx, 'dhcp4').valid, true);
	equal(config.read(ctx, 'dhcp6').valid, true);

	let subnet6 = parse(fs.readfile(config.path(ctx, 'dhcp6'))).config.Dhcp6.subnet6[0];

	equal(subnet6.reservations[3],
		{ duid: '00:03:00:01:02:00:00:00:0a:aa', 'ip-addresses': [ 'fd00:1::77' ], hostname: 'laptop' });
});

test('a second import finds nothing left to do', () => {
	let found = entries();

	for (let key in [ 'dual:dhcp4', 'dual:dhcp6', 'off:dhcp4', 'printer:dhcp4' ])
		equal(found[key].status, 'present', key);

	let result = importer.commit(ctx, hosts, interfaces);

	equal(result.changed, false);
	equal(result.imported, 0);
});

rm_rf(root);
done();
