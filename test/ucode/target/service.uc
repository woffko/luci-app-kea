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

fs.writefile(root + '/uci/dhcp',
	"config dhcp 'lan'\n\toption interface 'lan'\n\toption start '100'\n\toption dhcpv6 'server'\n\n" +
	"config dhcp 'old'\n\toption interface 'old'\n\toption ignore '1'\n\toption dhcpv6 'server'\n\n" +
	"config dhcp 'loopback'\n\toption interface 'loopback'\n\toption dhcpv4 'disabled'\n");

test('interfaces come from UCI in both address notations, with the OpenWrt DHCP state', () => {
	equal(service.network_interfaces(ctx), [
		{ name: 'loopback', device: 'lo', proto: 'static', ipaddr: '127.0.0.1/8', ip6addr: '', dhcp4_server: false, dhcp6_server: false },
		{ name: 'lan', device: 'br-lan', proto: 'static', ipaddr: '192.168.1.1/24', ip6addr: 'fd00:1::1/64', dhcp4_server: true, dhcp6_server: true },
		{ name: 'old', device: 'eth5', proto: 'static', ipaddr: '10.5.0.1/24', ip6addr: '', dhcp4_server: false, dhcp6_server: false }
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

/* ---- ha-cluster follows the Kea files -------------------------------------- */

const CLUSTER_UCI = root + '/uci/ha-cluster';
const CLUSTER_INIT = root + '/etc/init.d/ha-cluster';

function cluster_config(enabled, backend) {
	fs.writefile(CLUSTER_UCI, sprintf(
		"config global 'config'\n\toption enabled '%s'\n\toption dhcp_backend '%s'\n", enabled, backend));
}

// A stand-in for the init script of ha-cluster. "declaration" is the line
// that names its extra commands. It fails while the file "cluster-fail" is
// there and takes five seconds while "cluster-slow" is.
function fake_cluster(declaration) {
	fs.writefile(CLUSTER_INIT, sprintf(
		'#!/bin/sh\n%s\necho "ha-cluster $1" >> "%s/init.log"\n' +
		'[ ! -e "%s/cluster-slow" ] || sleep 5\n[ ! -e "%s/cluster-fail" ]\n', declaration, root, root, root));
	fs.chmod(CLUSTER_INIT, 0o755);
}

function cluster_calls() {
	return filter(init_log(), line => index(line, 'ha-cluster ') == 0);
}

test('ha-cluster looks at its firewall rules when Kea was made to read its files', () => {
	fake_cluster('EXTRA_COMMANDS="firewall"');
	cluster_config('1', 'kea');
	procd = {};

	for (let action in [ 'reload', 'restart', 'start' ])
		equal(service.init_action(ctx, action), { result: true, cluster_firewall: true }, action);

	equal(cluster_calls(), [ 'ha-cluster firewall', 'ha-cluster firewall', 'ha-cluster firewall' ],
		'only that command, also for a cluster that does not run');
});

test('not when Kea was stopped, or its autostart changed, or the action failed', () => {
	for (let action in [ 'stop', 'enable', 'disable' ])
		equal(service.init_action(ctx, action), { result: true }, action);

	fs.writefile(root + '/fail', '');
	equal(service.init_action(ctx, 'reload'), { result: false, error: 'init action failed' });
	fs.unlink(root + '/fail');

	equal(length(cluster_calls()), 3);
});

test('a failure of ha-cluster is told, and is no failure of Kea', () => {
	fs.writefile(root + '/cluster-fail', '');
	equal(service.init_action(ctx, 'reload'), { result: true, cluster_firewall: false });
	fs.unlink(root + '/cluster-fail');

	// A command that hangs is not waited for longer than the limit.
	let hasty = config.context({ ...options, service_list: name => ({}), cluster_timeout: 300 });
	let before = clock(true);

	fs.writefile(root + '/cluster-slow', '');
	equal(service.init_action(hasty, 'reload'), { result: true, cluster_firewall: false });
	fs.unlink(root + '/cluster-slow');

	let after = clock(true);
	let took = (after[0] - before[0]) * 1000 + (after[1] - before[1]) / 1000000;

	ok(took < 3000, sprintf('gave up after %d ms', took));
	equal(length(cluster_calls()), 5);
});

test('nothing for a cluster that is disabled or has dnsmasq, or without the command', () => {
	cluster_config('0', 'kea');
	equal(service.init_action(ctx, 'reload'), { result: true }, 'disabled');

	cluster_config('1', 'dnsmasq');
	equal(service.init_action(ctx, 'reload'), { result: true }, 'dnsmasq is its DHCP server');

	fs.unlink(CLUSTER_UCI);
	equal(service.init_action(ctx, 'reload'), { result: true }, 'no config');

	// A version of ha-cluster before the command: rc.common would answer
	// with its help text, and the script would look successful.
	cluster_config('1', 'kea');
	fake_cluster('USE_PROCD=1');
	equal(service.init_action(ctx, 'reload'), { result: true }, 'the script has no such command');

	fs.unlink(CLUSTER_INIT);
	equal(service.init_action(ctx, 'reload'), { result: true }, 'no init script');

	equal(length(cluster_calls()), 5, 'nothing was called');

	fs.unlink(CLUSTER_UCI);
});

/* ---- what a running daemon says ------------------------------------------- */

test('only the DHCP daemons that procd runs are asked for their state', () => {
	let asked = [];
	let sctx = config.context({
		...options,
		service_list: name => ({ kea: { instances: procd.kea } }),
		control: (name, command) => {
			push(asked, name + ' ' + command);

			return { result: 0, arguments: { sockets: { status: 'failed', errors: [ 'the interface br-lan is not running' ] } } };
		}
	});

	procd = { kea: { dhcp4: { running: true }, dhcp6: { running: false }, 'dhcp-ddns': { running: true } } };

	let states = service.daemon_states(sctx);

	equal(asked, [ 'dhcp4 status-get' ]);
	equal(keys(states), [ 'dhcp4' ]);
	equal(states.dhcp4.reachable, true);
	equal(states.dhcp4.sockets.status, 'failed');

	procd = {};
	equal(service.daemon_states(sctx), {}, 'nothing runs, nothing is asked');
});

test('a daemon without a control socket is reported as not reachable', () => {
	// The real client: the configuration file of this temporary root names
	// no socket, or does not exist.
	procd = { kea: { dhcp4: { running: true } } };

	let state = service.daemon_states(ctx).dhcp4;

	equal(state.reachable, false);
	ok(state.reason in [ 'no-control-socket', 'no-socket-module' ], state.reason);
	procd = {};
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
	equal(status.conflicts.dnsmasq, {
		installed: true, enabled: true, running: true, init: '/etc/init.d/dnsmasq',
		serves: { dns: true, dhcp4: [ 'lan' ] }
	});
	// What a service is configured to serve is reported whether or not it
	// is installed and running: it is read from /etc/config/dhcp.
	equal(status.conflicts.odhcpd, {
		installed: false, enabled: false, running: false, init: '/etc/init.d/odhcpd',
		serves: { dhcp4: [], dhcp6: [ 'lan' ], ra: [] }
	});
	equal(type(status.hooks.ha), 'bool');
	equal(status.hooks.dir, '/usr/lib/kea/hooks');
});

rm_rf(root);
done();
