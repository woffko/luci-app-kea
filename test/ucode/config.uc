'use strict';

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, mode, done } from './lib.uc';
import * as config from 'luci.kea.config';

// These tests replace the Kea binary with a validator that accepts any JSON
// object, so they run on any machine. test/ucode/target/config.uc repeats
// the important cases with the real binary.

const root = tmpdir();
let now = 1794415113;        // 2026-11-11 16:38:33 UTC

const ctx = config.context({
	root,
	run_dir: root + '/run',
	sbin_dir: root + '/sbin',
	clock: () => now,
	validator: (name, file) => {
		try {
			return type(json(fs.readfile(file))) == 'object' ?
				{ valid: true, output: 'accepted ' + name } :
				{ valid: false, output: 'not an object' };
		}
		catch (e) {
			return { valid: false, output: e.message };
		}
	}
});

const file = config.path(ctx, 'dhcp4');
const body = n => sprintf('{\n\t"Dhcp4": {\n\t\t"valid-lifetime": %d\n\t}\n}\n', n);

function backups() {
	return map(config.list_backups(ctx, 'dhcp4').items, item => item.id);
}

test('paths and names', () => {
	equal(file, root + '/etc/kea/kea-dhcp4.conf');
	equal(config.path(ctx, 'dhcp_ddns'), root + '/etc/kea/kea-dhcp-ddns.conf');
	equal(config.path(ctx, 'nope'), null);
	equal(config.binary(ctx, 'ctrl_agent'), root + '/sbin/kea-ctrl-agent');
});

test('read reports a missing file and an unknown name', () => {
	equal(config.read(ctx, 'nope'), { result: false, error: 'invalid config name' });
	equal(config.read(ctx, 'dhcp4'),
		{ result: false, error: 'config file does not exist', path: file });
});

test('the first save creates the file without a backup', () => {
	let saved = config.save(ctx, 'dhcp4', body(1));

	equal(saved, { result: true, path: file, backup: '', validation: 'accepted dhcp4' });
	equal(fs.readfile(file), body(1));
	equal(mode(file), '600');
	equal(backups(), []);
});

test('read returns the content byte for byte', () => {
	let read = config.read(ctx, 'dhcp4');

	equal(read.result, true);
	equal(read.content, body(1));
	equal(read.valid, true);
	equal(read.path, file);
});

test('a save backs up the previous file', () => {
	let saved = config.save(ctx, 'dhcp4', body(2));

	equal(saved.backup, '20261111T163833Z');
	equal(fs.readfile(file), body(2));
	equal(fs.readfile(ctx.backup_dir + '/kea-dhcp4.20261111T163833Z.conf'), body(1));
	equal(mode(ctx.backup_dir), '700');
	equal(mode(ctx.backup_dir + '/kea-dhcp4.20261111T163833Z.conf'), '600');
});

test('content the validator rejects changes nothing', () => {
	let saved = config.save(ctx, 'dhcp4', '{ broken');

	equal(saved.result, false);
	equal(saved.error, 'validation failed');
	ok(saved.validation, 'the validator output is returned');
	equal(fs.readfile(file), body(2));
	equal(backups(), [ '20261111T163833Z' ]);
	equal(fs.lsdir(ctx.conf_dir), [ 'backups', 'kea-dhcp4.conf' ]);
});

test('check validates content without touching the file or making a backup', () => {
	equal(config.check(ctx, 'dhcp4', body(9)), { valid: true, output: 'accepted dhcp4' });
	equal(config.check(ctx, 'dhcp4', '{ broken').valid, false);
	equal(config.check(ctx, 'nope', body(9)).valid, false);
	equal(config.check(ctx, 'dhcp4', null).valid, false);
	equal(fs.readfile(file), body(2));
	equal(backups(), [ '20261111T163833Z' ]);
	equal(fs.lsdir(ctx.conf_dir), [ 'backups', 'kea-dhcp4.conf' ]);
});

test('save refuses unknown names and non-string content', () => {
	equal(config.save(ctx, '../x', body(1)), { result: false, error: 'invalid config name' });
	equal(config.save(ctx, 'dhcp4', null), { result: false, error: 'invalid config content' });
	equal(config.save(ctx, 'dhcp4', { a: 1 }), { result: false, error: 'invalid config content' });
});

test('backups made in the same second get a sequence number', () => {
	config.save(ctx, 'dhcp4', body(3));
	config.save(ctx, 'dhcp4', body(4));

	equal(backups(), [ '20261111T163833Z_3', '20261111T163833Z_2', '20261111T163833Z' ]);
	equal(fs.readfile(ctx.backup_dir + '/kea-dhcp4.20261111T163833Z_3.conf'), body(3));
});

test('list_backups reports sizes and refuses unknown names', () => {
	let listed = config.list_backups(ctx, 'dhcp4');

	equal(listed.result, true);
	equal(listed.items[0], { id: '20261111T163833Z_3', size: length(body(3)) });
	equal(config.list_backups(ctx, 'nope'), { result: false, error: 'invalid config name' });
});

test('backup ids are validated strictly', () => {
	for (let id in [ '20261111T163833Z', '20261111T163833Z_12' ])
		equal(config.valid_backup_id(id), true, id);

	for (let id in [ '', '../../etc/passwd', '20261111T163833Z/..', '20261111T163833', 'x', null, 5,
	                 '20261111T163833Z_', '20261111T163833Z_x', ' 20261111T163833Z' ])
		equal(config.valid_backup_id(id), false, `${id}`);
});

test('restore puts a backup back and backs up the replaced file', () => {
	now += 60;

	let restored = config.restore(ctx, 'dhcp4', '20261111T163833Z');

	equal(restored, { result: true, path: file, restored: '20261111T163833Z', backup: '20261111T163933Z' });
	equal(fs.readfile(file), body(1));
	equal(fs.readfile(ctx.backup_dir + '/kea-dhcp4.20261111T163933Z.conf'), body(4));
});

test('restore refuses malformed, unknown and invalid backups', () => {
	equal(config.restore(ctx, 'nope', '20261111T163833Z').error, 'invalid config name');
	equal(config.restore(ctx, 'dhcp4', '../../etc/passwd').error, 'invalid backup id');
	equal(config.restore(ctx, 'dhcp4', '20991231T235959Z').error, 'backup does not exist');

	fs.writefile(ctx.backup_dir + '/kea-dhcp4.20000101T000000Z.conf', 'not json');

	let refused = config.restore(ctx, 'dhcp4', '20000101T000000Z');

	equal(refused.result, false);
	equal(refused.error, 'backup failed validation');
	equal(fs.readfile(file), body(1));

	fs.unlink(ctx.backup_dir + '/kea-dhcp4.20000101T000000Z.conf');
});

test('only the newest backups are kept, ordered across the _9/_10 boundary', () => {
	now += 60;

	for (let n = 100; n < 114; n++)
		equal(config.save(ctx, 'dhcp4', body(n)).result, true);

	let ids = backups();

	equal(length(ids), ctx.backup_keep);
	equal(ids[0], '20261111T164033Z_14');
	equal(ids[9], '20261111T164033Z_5');
	equal(fs.readfile(ctx.backup_dir + '/kea-dhcp4.' + ids[0] + '.conf'), body(112));
});

test('backups of one config do not touch those of another', () => {
	config.save(ctx, 'dhcp6', '{ "Dhcp6": {} }\n');
	config.save(ctx, 'dhcp6', '{ "Dhcp6": { "valid-lifetime": 1 } }\n');

	equal(length(config.list_backups(ctx, 'dhcp6').items), 1);
	equal(length(backups()), ctx.backup_keep);
});

test('list describes all four config files', () => {
	let items = config.list(ctx);

	equal(map(items, item => item.name), [ 'dhcp4', 'dhcp6', 'dhcp_ddns', 'ctrl_agent' ]);
	equal(items[0].exists, true);
	equal(items[0].size, length(body(113)));
	equal(items[2], {
		name: 'dhcp_ddns',
		title: 'DHCP DDNS',
		path: root + '/etc/kea/kea-dhcp-ddns.conf',
		exists: false,
		size: 0
	});
});

test('validate_all covers the control agent and reports missing parts', () => {
	fs.mkdir(root + '/sbin', 0o755);
	fs.writefile(root + '/sbin/kea-dhcp4', '#!/bin/sh\n');
	fs.chmod(root + '/sbin/kea-dhcp4', 0o755);

	let all = config.validate_all(ctx);

	equal(sort(keys(all)), [ 'ctrl_agent', 'dhcp4', 'dhcp6', 'dhcp_ddns' ]);
	equal(all.dhcp4, { config: file, installed: true, exists: true, valid: true, output: 'accepted dhcp4' });
	equal(all.ctrl_agent.installed, false);
	equal(all.ctrl_agent.valid, false);
	equal(all.ctrl_agent.output, 'binary or config file is missing');
});

test('write_private and mkdir_p', () => {
	equal(config.mkdir_p(root + '/a/b/c', 0o750), true);
	equal(config.mkdir_p(root + '/a/b/c', 0o750), true);
	equal(config.write_private(root + '/a/b/c/secret', 'x'), true);
	equal(mode(root + '/a/b/c/secret'), '600');
	equal(config.write_private(root + '/missing/dir/file', 'x'), false);
	equal(config.shellquote("it's"), "'it'\\''s'");
});

rm_rf(root);
done();
