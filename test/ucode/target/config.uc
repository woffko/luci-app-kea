'use strict';

// Config handling with the real Kea binary. Needs kea-dhcp-ddns: its
// configuration validates without any network interface.

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, mode, done } from '../lib.uc';
import * as config from 'luci.kea.config';

const root = tmpdir();
const ctx = config.context({ root, run_dir: root + '/run' });
const file = config.path(ctx, 'dhcp_ddns');
const ddns = port => sprintf('{\n\t"DhcpDdns": {\n\t\t"ip-address": "127.0.0.1",\n\t\t"port": %d\n\t}\n}\n', port);

test('Kea accepts a valid config and the run directory is prepared', () => {
	let saved = config.save(ctx, 'dhcp_ddns', ddns(53001));

	equal(saved.result, true, saved.validation);
	equal(fs.readfile(file), ddns(53001));
	equal(mode(ctx.run_dir), '750');
});

test('read validates with the Kea binary', () => {
	let read = config.read(ctx, 'dhcp_ddns');

	equal(read.valid, true, read.validation);
	equal(read.content, ddns(53001));
});

test('Kea rejects an invalid config and nothing changes', () => {
	let saved = config.save(ctx, 'dhcp_ddns', '{ "DhcpDdns": { "ip-address": "not-an-address" } }');

	equal(saved.result, false);
	equal(saved.error, 'validation failed');
	ok(length(saved.validation) > 0, 'the Kea output is returned');
	equal(fs.readfile(file), ddns(53001));
	equal(config.list_backups(ctx, 'dhcp_ddns').items, []);
	equal(fs.lsdir(ctx.conf_dir), [ 'kea-dhcp-ddns.conf' ]);
});

test('a backup Kea rejects is not restored', () => {
	config.save(ctx, 'dhcp_ddns', ddns(53002));

	let id = config.list_backups(ctx, 'dhcp_ddns').items[0].id;

	fs.writefile(ctx.backup_dir + '/kea-dhcp-ddns.' + id + '.conf', '{ "DhcpDdns": { "port": "x" } }');

	let restored = config.restore(ctx, 'dhcp_ddns', id);

	equal(restored.result, false);
	equal(restored.error, 'backup failed validation');
	equal(fs.readfile(file), ddns(53002));
});

test('a missing binary is reported, not treated as valid', () => {
	let other = config.context({ root, run_dir: root + '/run', sbin_dir: root + '/nosbin' });
	let check = config.validate_file(other, 'dhcp_ddns', file);

	equal(check.valid, false);
	equal(check.output, 'binary is not installed: ' + root + '/nosbin/kea-dhcp-ddns');
});

test('validate_all on the system reports all four daemons', () => {
	let all = config.validate_all(config.context());

	equal(sort(keys(all)), [ 'ctrl_agent', 'dhcp4', 'dhcp6', 'dhcp_ddns' ]);

	for (let name, item in all) {
		equal(type(item.valid), 'bool', name);
		equal(type(item.output), 'string', name);
	}
});

rm_rf(root);
done();
