'use strict';

// Service state and control against temporary UCI and init directories.
// Needs the ucode "uci" and "ubus" modules, so it runs on OpenWrt.

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, mode, done } from '../lib.uc';
import * as config from 'luci.kea.config';
import * as service from 'luci.kea.service';

const root = tmpdir();

config.mkdir_p(root + '/uci', 0o755);
config.mkdir_p(root + '/uci-state', 0o755);
config.mkdir_p(root + '/etc/init.d', 0o755);

// What procd would answer to "ubus call service list".
let procd = {};

const options = {
	root,
	run_dir: root + '/run',
	uci_dir: root + '/uci',
	uci_savedir: root + '/uci-state'
};
const ctx = config.context({
	...options,
	service_list: name => {
		let reply = {};

		if (procd[name])
			reply[name] = { instances: procd[name] };

		return reply;
	}
});

function fake_init(name) {
	let path = root + '/etc/init.d/' + name;

	fs.writefile(path, sprintf(
		'#!/bin/sh\necho "%s $1" >> "%s/init.log"\n[ ! -e "%s/fail" ]\n', name, root, root));
	fs.chmod(path, 0o755);
}

function init_log() {
	return split(trim(fs.readfile(root + '/init.log') ?? ''), '\n');
}

/* ---- components ---------------------------------------------------------- */

fs.writefile(root + '/uci/kea',
	"config service 'dhcp4'\n\n" +
	"config service 'dhcp6'\n\toption disabled '1'\n\n" +
	"config service 'dhcp_ddns'\n\toption disabled '0'\n");

test('a section without "disabled" is enabled, like in /etc/init.d/kea', () => {
	procd = { kea: { dhcp4: { running: true }, 'dhcp-ddns': { running: false } } };

	equal(service.services(ctx), {
		dhcp4: { section: 'dhcp4', enabled: true, running: true },
		dhcp6: { section: 'dhcp6', enabled: false, running: false },
		dhcp_ddns: { section: 'dhcp_ddns', enabled: true, running: false }
	});
});

test('running state follows the procd instance, by its init script name', () => {
	procd = { kea: { 'dhcp-ddns': { running: true }, 'ctrl-agent': { running: true } } };

	let services = service.services(ctx);

	equal(services.dhcp4.running, false);
	equal(services.dhcp_ddns.running, true);

	procd = {};
	equal(service.services(ctx).dhcp_ddns.running, false);
});

test('set_service writes the disabled option and creates a missing section', () => {
	equal(service.set_service(ctx, 'dhcp4', false), { result: true });
	equal(service.set_service(ctx, 'dhcp6', true), { result: true });
	equal(service.set_service(ctx, 'ctrl_agent', true), { result: true });

	let services = service.services(ctx);

	equal(services.dhcp4.enabled, false);
	equal(services.dhcp6.enabled, true);
	equal(services.ctrl_agent, { section: 'ctrl_agent', enabled: true, running: false });
	equal(service.set_service(ctx, 'rpcd', true), { result: false, error: 'invalid service name' });
});

test('service state can be read from the real procd', () => {
	let services = service.services(config.context(options));

	for (let name, item in services)
		equal(type(item.running), 'bool', name);
});

/* ---- interfaces ---------------------------------------------------------- */

fs.writefile(root + '/uci/network',
	"config interface 'loopback'\n\toption device 'lo'\n\toption proto 'static'\n\tlist ipaddr '127.0.0.1/8'\n\n" +
	"config interface 'lan'\n\toption device 'br-lan'\n\toption proto 'static'\n\tlist ipaddr '192.168.1.1/24'\n\tlist ip6addr 'fd00:1::1/64'\n\n" +
	"config interface 'old'\n\toption ifname 'eth5'\n\toption proto 'static'\n\toption ipaddr '10.5.0.1'\n\toption netmask '255.255.255.0'\n\n" +
	"config interface 'unbound'\n\toption proto 'none'\n");

test('interfaces come from UCI in both address notations', () => {
	equal(service.network_interfaces(ctx), [
		{ name: 'loopback', device: 'lo', proto: 'static', ipaddr: '127.0.0.1/8', ip6addr: '' },
		{ name: 'lan', device: 'br-lan', proto: 'static', ipaddr: '192.168.1.1/24', ip6addr: 'fd00:1::1/64' },
		{ name: 'old', device: 'eth5', proto: 'static', ipaddr: '10.5.0.1/24', ip6addr: '' }
	]);
});

/* ---- init actions -------------------------------------------------------- */

test('init actions need the init script and a known action', () => {
	equal(service.init_action(ctx, 'start'),
		{ result: false, error: 'Kea init script is not installed' });

	fake_init('kea');

	equal(service.init_action(ctx, 'start; reboot'), { result: false, error: 'invalid init action' });
	equal(service.init_action(ctx, null), { result: false, error: 'invalid init action' });
	equal(fs.access(root + '/init.log'), null, 'nothing was executed');
});

let secret;

test('start prepares the lease directory and a random API password', () => {
	equal(service.init_action(ctx, 'start'), { result: true });
	equal(init_log(), [ 'kea start' ]);
	equal(mode(ctx.lease_dir), '750');
	equal(mode(ctx.run_dir), '750');

	secret = fs.readfile(ctx.api_password);

	ok(match(secret, /^[0-9a-f]{48}\n$/), 'the password is 48 hex digits');
	equal(mode(ctx.api_password), '600');
});

test('an existing API password is kept, and stop does not need one', () => {
	equal(service.init_action(ctx, 'restart'), { result: true });
	equal(fs.readfile(ctx.api_password), secret);

	fs.unlink(ctx.api_password);
	equal(service.init_action(ctx, 'stop'), { result: true });
	equal(fs.access(ctx.api_password), null);
	equal(init_log(), [ 'kea start', 'kea restart', 'kea stop' ]);
});

test('a failing init script is reported', () => {
	fs.writefile(root + '/fail', '');
	equal(service.init_action(ctx, 'reload'), { result: false, error: 'init action failed' });
	fs.unlink(root + '/fail');
});

test('only dnsmasq and odhcpd can be controlled as conflicting services', () => {
	equal(service.conflict_action(ctx, 'rpcd', 'stop'), { result: false, error: 'invalid service name' });
	equal(service.conflict_action(ctx, '../kea', 'stop'), { result: false, error: 'invalid service name' });
	equal(service.conflict_action(ctx, 'dnsmasq', 'purge'), { result: false, error: 'invalid service action' });
	equal(service.conflict_action(ctx, 'dnsmasq', 'stop'), { result: false, error: 'init script is not installed' });

	fake_init('dnsmasq');

	equal(service.conflict_action(ctx, 'dnsmasq', 'stop'), { result: true });
	equal(init_log()[-1], 'dnsmasq stop');
});

/* ---- status -------------------------------------------------------------- */

test('status reports installed parts and running conflicts', () => {
	procd = { dnsmasq: { cfg01411c: { running: true } }, odhcpd: { instance1: { running: false } } };

	let status = service.status(ctx);

	equal(status.init_installed, true);
	equal(status.init_enabled, true);
	equal(status.runtime.lease_dir, true);
	equal(status.runtime.api_password, true, 'the reload attempt above prepared it again');
	equal(sort(keys(status.binaries)), [ 'ctrl_agent', 'dhcp4', 'dhcp6', 'dhcp_ddns', 'lfc', 'shell' ]);
	equal(status.binaries.dhcp4.path, '/usr/sbin/kea-dhcp4');
	equal(sort(keys(status.configs)), [ 'ctrl_agent', 'dhcp4', 'dhcp6', 'dhcp_ddns' ]);
	equal(status.conflicts.dnsmasq, { installed: true, enabled: true, running: true, init: '/etc/init.d/dnsmasq' });
	equal(status.conflicts.odhcpd, { installed: false, enabled: false, running: false, init: '/etc/init.d/odhcpd' });
	equal(type(status.hooks.ha), 'bool');
});

rm_rf(root);
done();
