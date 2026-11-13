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

// "kea-dhcp4 -t" accepts any parameters of a hook. The backend asks with
// "-T", which lets the hook check them.
const HOOKS = '/usr/lib/kea/hooks';

function with_ha(mode) {
	let hooks = [];

	if (fs.access(HOOKS + '/libdhcp_lease_cmds.so'))
		push(hooks, { library: HOOKS + '/libdhcp_lease_cmds.so' });

	push(hooks, {
		library: HOOKS + '/libdhcp_ha.so',
		parameters: {
			'high-availability': [ {
				'this-server-name': 'a',
				mode,
				peers: [
					{ name: 'a', url: 'http://192.0.2.1:8000/', role: 'primary' },
					{ name: 'b', url: 'http://192.0.2.2:8000/', role: 'standby' }
				]
			} ]
		}
	});

	return sprintf('%.J\n', {
		Dhcp4: {
			'interfaces-config': { interfaces: [] },
			'lease-database': { type: 'memfile', persist: false },
			'hooks-libraries': hooks
		}
	});
}

if (fs.access(HOOKS + '/libdhcp_ha.so') && fs.access('/usr/sbin/kea-dhcp4', 'x')) {
	test('a hook checks its parameters when a DHCP config is saved', () => {
		let good = config.save(ctx, 'dhcp4', with_ha('hot-standby'));

		equal(good.result, true, good.validation);

		let bad = config.save(ctx, 'dhcp4', with_ha('active-active'));

		equal(bad.result, false);
		ok(match(bad.validation, /^HA_CONFIGURATION_FAILED .*unsupported value 'active-active' for mode parameter/),
			bad.validation);
		equal(fs.readfile(config.path(ctx, 'dhcp4')), with_ha('hot-standby'));
	});
}
else {
	print('# skipped: the hook check needs kea-dhcp4 and kea-hook-ha\n');
}

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
