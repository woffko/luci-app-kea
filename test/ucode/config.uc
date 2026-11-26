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

	equal(saved, { result: true, path: file, backup: '', validation: 'accepted dhcp4', warnings: [] });
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

	equal(restored, { result: true, path: file, restored: '20261111T163833Z', backup: '20261111T163933Z', warnings: [] });
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
	equal(all.dhcp4, { config: file, installed: true, exists: true, valid: true, output: 'accepted dhcp4', warnings: [] });
	equal(all.ctrl_agent.installed, false);
	equal(all.ctrl_agent.valid, false);
	equal(all.ctrl_agent.output, 'binary or config file is missing');
});

// ---- the command line of the Kea binary ------------------------------------
//
// Stand-in binaries: shell scripts that tell how they were called.

const sbin = root + '/fake-sbin';
const real = config.context({ root, run_dir: root + '/run', sbin_dir: sbin });

function fake(name, script) {
	config.mkdir_p(sbin, 0o755);
	fs.writefile(sbin + '/' + name, '#!/bin/sh\n' + script + '\n');
	fs.chmod(sbin + '/' + name, 0o755);
}

test('the DHCP daemons are checked with their hooks loaded, the others are not', () => {
	fake('kea-dhcp4', 'echo "called with $1"');
	fake('kea-dhcp-ddns', 'echo "called with $1"');
	fs.writefile(config.path(real, 'dhcp_ddns'), '{}');

	equal(config.validate_file(real, 'dhcp4', file), { valid: true, output: 'called with -T' });
	equal(config.validate_file(real, 'dhcp_ddns', config.path(real, 'dhcp_ddns')),
		{ valid: true, output: 'called with -t' });
});

test('a Kea binary without the stricter check is asked the old way', () => {
	fake('kea-dhcp4', 'case "$1" in -t) echo checked;; *) echo "Usage: kea-dhcp4 [-v] [-t file]"; exit 1;; esac');

	equal(config.validate_file(real, 'dhcp4', file), { valid: true, output: 'checked' });
});

test('the reason a hook gives for a refusal is put first', () => {
	const log = [
		'2026-11-12 20:07:41.231 INFO  [kea-dhcp4.hooks/9166.1406] HOOKS_LIBRARY_LOADED hooks library loaded',
		'2026-11-12 20:07:41.231 ERROR [kea-dhcp4.ha-hooks/9166.1406] HA_CONFIGURATION_FAILED unsupported value for mode',
		'2026-11-12 20:07:41.232 ERROR [kea-dhcp4.dhcp4/9166.1406] DHCP4_PARSER_COMMIT_FAIL hook libraries failed to load',
		'2026-11-12 20:07:41.232 ERROR [kea-dhcp4.dhcp4/9166.1406] DHCP4_PARSER_COMMIT_FAIL hook libraries failed to load',
		'Error encountered: One or more hook libraries failed to load',
		'Usage: kea-dhcp4 -[v|V|W|X] [-d] [-{c|t|T} cfgfile]',
		'  -T file: check the configuration file doing hooks load and extra checks and exit'
	];

	equal(config.error_lines(join('\n', log)), [
		'HA_CONFIGURATION_FAILED unsupported value for mode',
		'DHCP4_PARSER_COMMIT_FAIL hook libraries failed to load'
	]);
	equal(config.error_lines('no log lines here'), []);
	equal(config.error_lines(null), []);

	fs.writefile(root + '/kea.log', join('\n', log) + '\n');
	fake('kea-dhcp4', 'cat ' + config.shellquote(root + '/kea.log') + '; exit 1');

	let check = config.validate_file(real, 'dhcp4', file);

	equal(check.valid, false);
	equal(split(check.output, '\n')[0], 'HA_CONFIGURATION_FAILED unsupported value for mode');
	equal(split(check.output, '\n')[2], '', 'a blank line separates the reasons from the full output');
	equal(split(check.output, '\n')[3], log[0]);
});

// ---- what the check of the Kea binary does not see -------------------------
//
// The cases are the ones measured with Kea 3.0.4: each of the refused names
// below passed "kea-dhcp4 -t" and "-T" and stopped the daemon at start.

const dhcp4 = members => sprintf('{ "Dhcp4": { %s } }', members);
const lease = name => dhcp4(sprintf('"lease-database": { "type": "memfile", "name": "%s" }', name));
const logger = output => dhcp4(sprintf(
	'"loggers": [ { "name": "kea-dhcp4", "output-options": [ { "output": "%s" } ] } ]', output));

test('a lease file outside the lease directory is reported', () => {
	for (let name in [ '/tmp/kea-leases4.csv', '/var/lib/kea/sub/x.csv', 'sub/x.csv', './x.csv',
	                   '/var/lib/kea//x.csv', '/var/lib/../lib/kea/x.csv', '/var/lib/kea/' ])
		equal(config.warnings(ctx, 'dhcp4', lease(name)),
			[ { code: 'lease-path', effect: 'no-start', value: name, directory: '/var/lib/kea' } ], name);

	equal(config.warnings(ctx, 'dhcp6',
		'{ "Dhcp6": { "lease-database": { "name": "/tmp/x6.csv" } } }'),
		[ { code: 'lease-path', effect: 'no-start', value: '/tmp/x6.csv', directory: '/var/lib/kea' } ],
		'memfile is the type when none is named');
});

test('a lease file Kea starts with is not reported', () => {
	for (let name in [ 'other4.csv', '/var/lib/kea/other4.csv' ])
		equal(config.warnings(ctx, 'dhcp4', lease(name)), [], name);

	equal(config.warnings(ctx, 'dhcp4', dhcp4('"lease-database": { "type": "memfile" }')), []);
	equal(config.warnings(ctx, 'dhcp4', dhcp4('"valid-lifetime": 600')), []);
	equal(config.warnings(ctx, 'dhcp4', dhcp4(
		'"lease-database": { "type": "memfile", "persist": false, "name": "/tmp/x.csv" }')), [],
		'the name is not used when the leases are not written');
});

test('a log file outside the log directory is reported with its logger', () => {
	for (let output in [ '/tmp/kea.log', '/var/log/kea/sub/x.log', 'sub/x.log', '/var/log/kea//x.log' ])
		equal(config.warnings(ctx, 'dhcp4', logger(output)),
			[ { code: 'log-path', effect: 'no-start', value: output, logger: 'kea-dhcp4', directory: '/var/log/kea' } ], output);

	for (let output in [ 'kea-dhcp4.log', '/var/log/kea/kea-dhcp4.log', 'syslog', 'syslog:kea4', 'stdout', 'stderr' ])
		equal(config.warnings(ctx, 'dhcp4', logger(output)), [], output);

	equal(length(config.warnings(ctx, 'dhcp4', dhcp4(
		'"loggers": [ { "name": "a", "output_options": [ { "output": "/tmp/a.log" }, { "output": "syslog" } ] },' +
		' { "name": "b", "output-options": [ { "output": "/tmp/b.log" } ] } ],' +
		' "lease-database": { "name": "/tmp/x.csv" }'))), 3,
		'both spellings of the option list, every logger, and the lease file');
});

test('only the DHCP daemons are checked, and only files that can be read', () => {
	// kea-dhcp-ddns and kea-ctrl-agent refuse such a log file in their check.
	equal(config.warnings(ctx, 'dhcp_ddns',
		'{ "DhcpDdns": { "loggers": [ { "name": "x", "output-options": [ { "output": "/tmp/x.log" } ] } ] } }'), []);
	equal(config.warnings(ctx, 'ctrl_agent',
		'{ "Control-agent": { "loggers": [ { "name": "x", "output-options": [ { "output": "/tmp/x.log" } ] } ] } }'), []);
	equal(config.warnings(ctx, 'dhcp4', 'not json'), []);
	equal(config.warnings(ctx, 'dhcp4', null), []);
	equal(config.warnings(ctx, 'dhcp4', '{ "Dhcp6": { "lease-database": { "name": "/tmp/x.csv" } } }'), []);
	equal(config.warnings(ctx, 'nope', lease('/tmp/x.csv')), []);
	equal(length(config.warnings(ctx, 'dhcp4',
		'// a comment\n{ "Dhcp4": { /* another */ "lease-database": { "name": "/tmp/x.csv" } } }\n')), 1,
		'comments do not hide the setting');
});

test('interfaces to listen on without retries for the sockets are reported', () => {
	const listen = members => dhcp4(sprintf('"interfaces-config": { %s }', members));
	const expected = value => [ { code: 'socket-retries', effect: 'no-listen', value } ];

	equal(config.warnings(ctx, 'dhcp4', listen('"interfaces": [ "br-lan" ]')), expected('br-lan'));
	equal(config.warnings(ctx, 'dhcp4', listen('"interfaces": [ "br-lan", "eth1/10.0.0.1" ]')),
		expected('br-lan, eth1/10.0.0.1'));
	equal(config.warnings(ctx, 'dhcp4', listen('"interfaces": [ "*" ]')), expected('*'));
	equal(config.warnings(ctx, 'dhcp4',
		listen('"interfaces": [ "br-lan" ], "service-sockets-max-retries": 0')), expected('br-lan'),
		'no retries is what Kea does without the parameter');
	equal(config.warnings(ctx, 'dhcp6',
		'{ "Dhcp6": { "interfaces-config": { "interfaces": [ "br-lan" ] } } }'), expected('br-lan'));

	equal(config.warnings(ctx, 'dhcp4',
		listen('"interfaces": [ "br-lan" ], "service-sockets-max-retries": 60')), []);
	equal(config.warnings(ctx, 'dhcp4', listen('"interfaces": [ ]')), [],
		'the file shipped with Kea listens on nothing');
	equal(config.warnings(ctx, 'dhcp4', dhcp4('"valid-lifetime": 600')), []);
	equal(config.warnings(ctx, 'dhcp_ddns',
		'{ "DhcpDdns": { "interfaces-config": { "interfaces": [ "br-lan" ] } } }'), []);
});

test('a peer URL without a port is reported: the pair cannot meet', () => {
	const pair = urls => dhcp4(sprintf(
		'"hooks-libraries": [ { "library": "/usr/lib/kea/hooks/libdhcp_lease_cmds.so" },' +
		' { "library": "/usr/lib/kea/hooks/libdhcp_ha.so", "parameters": { "high-availability": [ {' +
		' "this-server-name": "a", "mode": "hot-standby", "peers": [' +
		' { "name": "a", "url": "%s", "role": "primary" }, { "name": "b", "url": "%s", "role": "standby" } ] } ] } } ]',
		urls[0], urls[1]));
	const expected = (url, peer) => ({ code: 'ha-url-port', effect: 'no-pair', value: url, peer });

	equal(config.warnings(ctx, 'dhcp4', pair([ 'http://192.168.1.1/', 'http://192.168.1.2/' ])),
		[ expected('http://192.168.1.1/', 'a'), expected('http://192.168.1.2/', 'b') ]);
	equal(config.warnings(ctx, 'dhcp4', pair([ 'http://192.168.1.1:8001/', 'http://192.168.1.2' ])),
		[ expected('http://192.168.1.2', 'b') ]);
	equal(config.warnings(ctx, 'dhcp4', pair([ 'http://[fd00::1]/', 'http://192.168.1.2:0/' ])),
		[ expected('http://[fd00::1]/', 'a'), expected('http://192.168.1.2:0/', 'b') ]);

	equal(config.warnings(ctx, 'dhcp4', pair([ 'http://192.168.1.1:8001/', 'http://192.168.1.2:8001/' ])), []);
	equal(config.warnings(ctx, 'dhcp4', pair([ 'http://[fd00::1]:8002/', 'https://192.168.1.2:8443/kea' ])), []);
	equal(config.warnings(ctx, 'dhcp4', dhcp4(
		'"hooks-libraries": [ { "library": "/usr/lib/kea/hooks/libdhcp_other.so",' +
		' "parameters": { "high-availability": [ { "peers": [ { "name": "x", "url": "http://10.0.0.1/" } ] } ] } } ]')), [],
		'only the high availability hook is looked at');
});

test('the control socket of a daemon is found in its configuration', () => {
	const socket = members => dhcp4(members);

	equal(config.control_socket(ctx, 'dhcp4',
		socket('"control-socket": { "socket-type": "unix", "socket-name": "kea4-ctrl-socket" }')),
		root + '/run/kea4-ctrl-socket', 'a name without a directory is in the runtime directory');
	equal(config.control_socket(ctx, 'dhcp4',
		socket('"control-socket": { "socket-type": "unix", "socket-name": "/var/run/kea/x" }')),
		'/var/run/kea/x');
	equal(config.control_socket(ctx, 'dhcp4', socket(
		'"control-sockets": [ { "socket-type": "http", "socket-address": "127.0.0.1" },' +
		' { "socket-type": "unix", "socket-name": "second" } ]')),
		root + '/run/second', 'the list form, and only a socket of the kind that can be opened here');
	equal(config.control_socket(ctx, 'dhcp_ddns',
		'{ "DhcpDdns": { "control-socket": { "socket-name": "kea-ddns-ctrl-socket" } } }'),
		root + '/run/kea-ddns-ctrl-socket');
	equal(config.control_socket(ctx, 'dhcp4', socket('"valid-lifetime": 600')), null);
	equal(config.control_socket(ctx, 'dhcp4', socket('"control-socket": { "socket-type": "unix" }')), null);
	equal(config.control_socket(ctx, 'dhcp4', 'not json'), null);
});

test('save, read and validate_all pass the warnings on; nothing is refused for them', () => {
	let before = fs.readfile(file);
	let saved = config.save(ctx, 'dhcp4', lease('/tmp/x.csv'));
	let expected = [ { code: 'lease-path', effect: 'no-start', value: '/tmp/x.csv', directory: '/var/lib/kea' } ];

	equal(saved.result, true);
	equal(saved.warnings, expected);
	equal(fs.readfile(file), lease('/tmp/x.csv'));
	equal(config.read(ctx, 'dhcp4').warnings, expected);
	equal(config.validate_all(ctx).dhcp4.warnings, expected);
	equal(config.save(ctx, 'dhcp4', before).warnings, []);
});

test('where the loggers write', () => {
	equal(config.log_outputs(ctx, 'dhcp4', dhcp4('"valid-lifetime": 600')),
		[ { output: 'stdout', kind: 'console' } ], 'without loggers Kea prints');
	equal(config.log_outputs(ctx, 'dhcp4', logger('syslog')), [ { output: 'syslog', kind: 'syslog' } ]);
	equal(config.log_outputs(ctx, 'dhcp4', logger('syslog:kea4')), [ { output: 'syslog:kea4', kind: 'syslog' } ]);
	equal(config.log_outputs(ctx, 'dhcp4', logger('stderr')), [ { output: 'stderr', kind: 'console' } ]);
	equal(config.log_outputs(ctx, 'dhcp4', 'not json'), []);

	// As in the files shipped with Kea: a name without a directory, and
	// OpenWrt has no /var/log/kea.
	equal(config.log_outputs(ctx, 'dhcp4', logger('kea-dhcp4.log')),
		[ { output: 'kea-dhcp4.log', kind: 'file', path: '/var/log/kea/kea-dhcp4.log', lost: true } ]);
	equal(config.log_outputs(ctx, 'dhcp_ddns',
		'{ "DhcpDdns": { "loggers": [ { "name": "x", "output-options": [ { "output": "kea-ddns.log" } ] } ] } }'),
		[ { output: 'kea-ddns.log', kind: 'file', path: '/var/log/kea/kea-ddns.log', lost: true } ]);

	config.mkdir_p(root + '/var/log/kea', 0o755);

	equal(config.log_outputs(ctx, 'dhcp4', logger('kea-dhcp4.log'))[0].lost, false);
	equal(config.log_outputs(ctx, 'dhcp4', logger('/var/log/kea/x.log')),
		[ { output: '/var/log/kea/x.log', kind: 'file', path: '/var/log/kea/x.log', lost: false } ]);
	equal(config.log_outputs(ctx, 'dhcp4', logger('/tmp/x.log')),
		[ { output: '/tmp/x.log', kind: 'file', path: '/tmp/x.log', lost: false } ],
		'a file elsewhere is a matter for start_warnings');
	equal(map(config.log_outputs(ctx, 'dhcp4', dhcp4(
		'"loggers": [ { "name": "a", "output-options": [ { "output": "syslog" }, { "output": "a.log" } ] },' +
		' { "name": "b", "output-options": [ { "output": "syslog" } ] } ]')), item => item.output),
		[ 'syslog', 'a.log' ], 'each output once');
});

/* ---- a subnet on an interface Kea does not listen on ---------------------- */

test('a subnet bound to an interface that interfaces-config does not list is warned about', () => {
	const conf = (interfaces, extra) => sprintf('{ "Dhcp4": { "interfaces-config": { "interfaces": %J, "service-sockets-max-retries": 60 }, ' +
		'"subnet4": [ { "id": 1, "subnet": "10.0.87.0/24", "interface": "bond0.87" }, { "id": 2, "subnet": "10.9.0.0/24" } ]%s } }',
		interfaces, extra ?? '');
	const warned = (interfaces, extra) => filter(config.warnings(ctx, 'dhcp4', conf(interfaces, extra)), w => w.code == 'subnet-interface');

	// As on a router of the owner: a subnet on bond0.87, and an empty list.
	equal(warned([]), [ { code: 'subnet-interface', effect: 'no-listen', value: '10.0.87.0/24', interface: 'bond0.87' } ]);
	equal(warned([ 'br-lan' ]), [ { code: 'subnet-interface', effect: 'no-listen', value: '10.0.87.0/24', interface: 'bond0.87' } ]);
	equal(warned([ 'bond0.87' ]), []);
	equal(warned([ 'bond0.87/10.0.87.1' ]), [], 'a device with an address');
	equal(warned([ '*' ]), [], 'every interface');
	equal(warned([ 'bond0.87' ], ', "shared-networks": [ { "name": "x", "interface": "eth5", "subnet4": [ { "id": 3, "subnet": "10.5.0.0/24" } ] } ]'),
		[ { code: 'subnet-interface', effect: 'no-listen', value: '10.5.0.0/24', interface: 'eth5' } ], 'the interface of a shared network');
});

/* ---- secrets, includes and scripts ---------------------------------------- */

const DDNS = '{\n' +
	'\t// the key the DNS server knows\n' +
	'\t"DhcpDdns": {\n' +
	'\t\t"tsig-keys": [ { "name": "k", "algorithm": "HMAC-SHA256", "secret": "c2VjcmV0" } ],\n' +
	'\t\t"hooks-libraries": [ { "library": "x", "parameters": { "basic-auth-password" : "p\\"w", "password-file": "/etc/kea/pw" } } ],\n' +
	'\t\t"user-context": { "password-hint": "none", "secretary": "x" }\n' +
	'\t}\n' +
	'}\n';

test('a reader gets the passwords and secrets of a file masked, and nothing else changed', () => {
	let masked = config.mask_secrets(DDNS);

	equal(masked.masked, 2);
	ok(index(masked.content, '"secret": "' + config.MASK + '"') > 0, 'the TSIG secret');
	ok(index(masked.content, '"basic-auth-password" : "' + config.MASK + '"') > 0, 'with the space before the colon kept');
	ok(index(masked.content, '"password-file": "/etc/kea/pw"') > 0, 'a path to a secret stays');
	ok(index(masked.content, '"password-hint": "none"') > 0 && index(masked.content, '"secretary": "x"') > 0,
		'other names that only contain the word stay');
	ok(index(masked.content, '// the key the DNS server knows') > 0, 'comments stay');
	equal(index(masked.content, 'c2VjcmV0'), -1);

	fs.writefile(config.path(ctx, 'dhcp_ddns'), DDNS);

	let reply = config.read_masked(ctx, 'dhcp_ddns');

	equal(reply.masked, 2);
	equal(index(reply.content, 'c2VjcmV0'), -1);
	equal(config.read(ctx, 'dhcp_ddns').content, DDNS, 'a writer reads the file as it is');
	fs.unlink(config.path(ctx, 'dhcp_ddns'));
});

test('a text with a masked secret is not written back', () => {
	let before = fs.readfile(file);
	let masked = config.mask_secrets(DDNS).content;

	equal(config.forbidden(ctx, 'dhcp_ddns', masked),
		'a secret in this text is masked; open the page with write access to change the file');
	equal(config.forbidden(ctx, 'dhcp_ddns', DDNS), null);
	equal(config.save(ctx, 'dhcp4', '{ "Dhcp4": { "user-context": { "password": "' + config.MASK + '" } } }').error,
		'refused: a secret in this text is masked; open the page with write access to change the file');
	equal(fs.readfile(file), before, 'nothing was written');
});

// Kea's lexer allows comments between a name and its colon, and escapes in
// a name; a secret written so is a secret all the same.
test('a secret is masked also behind comments and escapes', () => {
	let text = '{ "DhcpDdns": { "tsig-keys": [ {\n' +
		'\t"name": "k",\n' +
		'\t"secret" /* the key */ : "c2VjcmV0",\n' +
		'\t"\\u0070assword": # the name is escaped\n\t\t"hunter2",\n' +
		'\t"user-password"\n\t// a line comment\n\t: "p4ss",\n' +
		'\t"comment": "\\"password\\": text in a value is not a member"\n' +
		'} ] } }\n' +
		'// "password": "old-one", left in a comment\n';
	let masked = config.mask_secrets(text);

	equal(masked.masked, 3);

	for (let secret in [ 'c2VjcmV0', 'hunter2', 'p4ss', 'old-one' ])
		equal(index(masked.content, secret), -1, secret);

	ok(index(masked.content, '"secret" /* the key */ : "' + config.MASK + '"') > 0, 'the layout and comments stay');
	ok(index(masked.content, '// "password": "' + config.MASK + '", left in a comment') > 0, 'a member in a comment is masked');
	ok(index(masked.content, 'text in a value is not a member') > 0);
	equal(config.forbidden(ctx, 'dhcp_ddns', masked.content),
		'a secret in this text is masked; open the page with write access to change the file');
	equal(config.forbidden(ctx, 'dhcp_ddns', text), null);
	equal(config.forbidden(ctx, 'dhcp_ddns', '{ "DhcpDdns": {} } // "secret": "' + config.MASK + '"'),
		'a secret in this text is masked; open the page with write access to change the file',
		'also a mask in a comment is not written back');
	equal(config.mask_secrets('{ "secret": "unterminated'), { content: '{ "secret": "' + config.MASK + '"', masked: 1 });
});

test('an include is allowed only of a *.json or *.conf file directly in the configuration directory', () => {
	const include = path => sprintf('{ "Dhcp4": { <?include "%s"?> } }', path);
	const refused = path => sprintf('the include of %s: only a *.json or *.conf file directly in %s can be included', path, ctx.conf_dir);

	equal(config.forbidden(ctx, 'dhcp4', include(ctx.conf_dir + '/subnets.json')), null);
	equal(config.forbidden(ctx, 'dhcp4', include(ctx.conf_dir + '/kea-dhcp6.conf')), null);

	for (let path in [ '/etc/shadow', '/tmp/x.json', ctx.conf_dir + '/kea-api-password', ctx.conf_dir + '/backups/kea-dhcp4.x.conf',
	                   ctx.conf_dir + '/../x.json', 'kea-dhcp6.conf', ctx.conf_dir + '/.hidden.json' ])
		equal(config.forbidden(ctx, 'dhcp4', include(path)), refused(path), path);

	// A link in the directory, to a file elsewhere or to nothing, and a directory.
	fs.symlink('/etc/passwd', ctx.conf_dir + '/elsewhere.json');
	fs.symlink(ctx.conf_dir + '/missing', ctx.conf_dir + '/dangling.json');
	config.mkdir_p(ctx.conf_dir + '/dir.json', 0o755);

	for (let name in [ 'elsewhere.json', 'dangling.json', 'dir.json' ])
		equal(config.forbidden(ctx, 'dhcp4', include(ctx.conf_dir + '/' + name)), refused(ctx.conf_dir + '/' + name), name);

	fs.unlink(ctx.conf_dir + '/elsewhere.json');
	fs.unlink(ctx.conf_dir + '/dangling.json');
	fs.rmdir(ctx.conf_dir + '/dir.json');

	equal(config.forbidden(ctx, 'dhcp4', '{ <?include /etc/shadow ?> }'), 'an include directive that the application cannot read');
	equal(config.forbidden(ctx, 'dhcp4', include(ctx.conf_dir + '/a.json') + include('/etc/shadow')), refused('/etc/shadow'),
		'every directive of the text is looked at');
});

test('the run_script hook may run a script of Kea\'s script directory only', () => {
	const hook = script => sprintf('{ "Dhcp4": { "hooks-libraries": [ { "library": "/usr/lib/kea/hooks/libdhcp_run_script.so", "parameters": { "name": %J } } ] } }', script);
	const refused = 'the script of the run_script hook: Kea runs scripts from /usr/share/kea/scripts only';

	equal(ctx.scripts_dir, '/usr/share/kea/scripts');
	equal(config.forbidden(ctx, 'dhcp4', hook('/usr/share/kea/scripts/kea-dnsmasq-hosts')), null);

	for (let script in [ '/root/.ssh/id_rsa', '/usr/share/kea/scripts/../../../etc/shadow', '/usr/share/kea/scripts/sub/x',
	                     '/usr/share/kea/scriptsX/y', 'kea-dnsmasq-hosts', null ])
		equal(config.forbidden(ctx, 'dhcp4', hook(script)), refused, `${script}`);

	equal(config.forbidden(ctx, 'dhcp4', '{ "Dhcp4": { "hooks-libraries": [ { "library": "libdhcp_run_script.so" ' + "\n"),
		'the run_script hook in a file the application cannot read');
	equal(config.forbidden(ctx, 'dhcp4', hook('/root/x') + ' // other hooks are not looked at: libdhcp_ha.so'), refused);
});

// Kea's lexer (dhcp4_lexer.ll) takes "<?" for the start of a directive and
// skips blanks and line ends inside it.
test('an include is checked however Kea allows it to be written', () => {
	const refused = sprintf('the include of /etc/shadow: only a *.json or *.conf file directly in %s can be included', ctx.conf_dir);

	for (let text in [
		'{ <? include "/etc/shadow" ?> }',
		'{ <?\ninclude\t"/etc/shadow"\r\n?> }',
		'{ <?include"/etc/shadow"?> }',
		'{ "Dhcp4": {} } // <? include "/etc/shadow" ?> also in a comment'
	])
		equal(config.forbidden(ctx, 'dhcp4', text), refused, text);

	equal(config.forbidden(ctx, 'dhcp4', sprintf('{ "Dhcp4": { <? include "%s/a.json" ?> } }', ctx.conf_dir)), null);
	equal(config.forbidden(ctx, 'dhcp4', '{ <? inclde "/etc/kea/a.json" ?> }'), 'an include directive that the application cannot read');
	equal(config.forbidden(ctx, 'dhcp4', '{ "Dhcp4": { "comment": "<?" } }'), 'an include directive that the application cannot read',
		'any "<?" is taken for a directive');
});

test('an escape does not hide the run_script hook', () => {
	const hook = '{ "library": "/usr/lib/kea/hooks/libdhcp_run_scr\\u0069pt.so", "parameters": { "name": "/root/x" } }';

	equal(config.forbidden(ctx, 'dhcp4', '{ "Dhcp4": { "hooks-libraries": [ ' + hook + ' ] } }'),
		'the script of the run_script hook: Kea runs scripts from /usr/share/kea/scripts only', 'in a text that parses');
	equal(config.forbidden(ctx, 'dhcp4', sprintf('{ "Dhcp4": { <?include "%s/a.json"?>, "hooks-libraries": [ %s ] } }', ctx.conf_dir, hook)),
		'the run_script hook in a file the application cannot read', 'in a text with an include');
});

/* ---- the lock around changes of a file ------------------------------------ */

test('the lock is taken for a save and given back afterwards', () => {
	equal(ctx.lock_file, root + '/var/run/luci-app-kea/config.lock');

	let inner = null;

	equal(config.locked(ctx, () => {
		// Inside, another holder is refused at once.
		let other = fs.open(ctx.lock_file, 'a');

		inner = other.lock('xn');
		other.close();

		// A call from inside runs at once: the lock belongs to the process.
		return config.locked(ctx, () => 'nested');
	}), 'nested');

	equal(inner, null, 'the lock was held');

	let after = fs.open(ctx.lock_file, 'a');

	equal(after.lock('xn'), true, 'and given back');
	after.lock('u');
	after.close();
});

// In a directory anyone can write to, another user could take the lock
// first or put a pipe in its place.
test('the lock is kept in a directory only its owner can change', () => {
	equal(mode(root + '/var/run/luci-app-kea'), '700', 'made for its owner alone');

	config.mkdir_p(root + '/var/shared', 0o755);
	fs.chmod(root + '/var/shared', 0o1777);
	fs.symlink(root + '/var/run/luci-app-kea', root + '/var/linked');

	for (let dir in [ root + '/var/shared', root + '/var/linked' ])
		equal(config.locked(config.context({ ...ctx, lock_file: dir + '/config.lock' }), () => 'held'),
			{ result: false, error: 'the lock directory ' + dir + ' is not a directory only its owner can change' }, dir);
});

test('a save waits for another holder of the lock, and gives up', () => {
	let hasty = config.context({ ...ctx, lock_wait: 300 });
	let holder = fs.open(ctx.lock_file, 'a');
	let before = fs.readfile(file);

	equal(holder.lock('x'), true);

	let result = config.save(hasty, 'dhcp4', body(9000));

	holder.lock('u');
	holder.close();

	equal(result, { result: false, error: 'another change of the Kea configuration is in progress' });
	equal(fs.readfile(file), before, 'nothing was written');
	equal(config.save(hasty, 'dhcp4', body(9000)).result, true, 'it works once the lock is free');
});

test('the lock is given back when the function fails', () => {
	let failed = false;

	try {
		config.locked(ctx, () => die('broken'));
	}
	catch (e) {
		failed = index(e.message, 'broken') >= 0;
	}

	equal(failed, true, 'the error reaches the caller');

	let probe = fs.open(ctx.lock_file, 'a');

	equal(probe.lock('xn'), true);
	probe.lock('u');
	probe.close();
	equal(config.locked(ctx, () => 'again'), 'again', 'and the next call is not taken for a nested one');
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
