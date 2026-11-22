// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import * as config from 'luci.kea.config';
import * as runtime from 'luci.kea.runtime';
import { interface_addresses } from 'luci.kea.net';
import { text, uci_bool, dhcp_services } from 'luci.kea.openwrt';
import * as cluster from 'luci.kea.cluster';

// Service state and control: the Kea init service and its components, the
// competing OpenWrt DHCP services, and the runtime files Kea needs.

const INIT_ACTIONS = [ 'enable', 'disable', 'start', 'stop', 'restart', 'reload' ];
const CONFLICT_SERVICES = [ 'dnsmasq', 'odhcpd' ];

function init_script(ctx, name) {
	return ctx.init_dir + '/' + name;
}

function init_installed(ctx, name) {
	return !!fs.access(init_script(ctx, name), 'x');
}

function run_init(ctx, name, action) {
	return system(config.shellquote(init_script(ctx, name)) + ' ' + action + ' >/dev/null 2>&1');
}

function init_enabled(ctx, name) {
	return init_installed(ctx, name) && run_init(ctx, name, 'enabled') == 0;
}

// Running state of the procd instances of a service: { instance: bool }.
// procd knows which instances it started and whether they are still alive,
// which a search of the process list cannot tell reliably.
function instances(ctx, name) {
	let reply = ctx.service_list ?
		ctx.service_list(name) :
		connect()?.call('service', 'list', { name });
	let result = {};

	for (let instance, state in reply?.[name]?.instances)
		result[instance] = state?.running == true;

	return result;
}

function any_running(states) {
	for (let instance, running in states)
		if (running)
			return true;

	return false;
}

// What dnsmasq and odhcpd are configured to serve, from /etc/config/dhcp.
function openwrt_dhcp(uci) {
	let sections = { dnsmasq: [], dhcp: [], odhcpd: [] };

	for (let kind in sections)
		uci.foreach('dhcp', kind, s => push(sections[kind], s));

	return dhcp_services(sections);
}

export function network_interfaces(ctx) {
	let uci = cursor(ctx.uci_dir, ctx.uci_savedir);
	let served = openwrt_dhcp(uci).interfaces;
	let items = [];

	uci.foreach('network', 'interface', s => {
		let device = text(s.device) || text(s.ifname);

		if (device == '')
			return;

		push(items, {
			name: s['.name'],
			device,
			proto: text(s.proto),
			ipaddr: interface_addresses(s.ipaddr, s.netmask),
			ip6addr: text(s.ip6addr),
			dhcp4_server: served[s['.name']]?.v4 == true,
			dhcp6_server: served[s['.name']]?.v6 == true
		});
	});

	return items;
};

// The components listed in /etc/config/kea. A section without the
// "disabled" option is enabled, as in /etc/init.d/kea.
export function services(ctx) {
	let states = instances(ctx, 'kea');
	let result = {};

	cursor(ctx.uci_dir, ctx.uci_savedir).foreach('kea', 'service', s => {
		let name = text(s.name) || s['.name'];

		result[name] = {
			section: s['.name'],
			enabled: !uci_bool(s.disabled, false),
			running: states[config.CONFIGS[name]?.instance] == true
		};
	});

	return result;
};

// What each running DHCP daemon says about itself on its control socket:
// { dhcp4: {...}, dhcp6: {...} }, see runtime.daemon_state(). A daemon that
// procd does not run is not asked and not listed. "Running" is what procd
// knows; whether a daemon listens is only known to the daemon.
export function daemon_states(ctx) {
	let states = instances(ctx, 'kea');
	let result = {};

	for (let name in [ 'dhcp4', 'dhcp6' ])
		if (states[config.CONFIGS[name].instance] == true)
			result[name] = runtime.daemon_state(runtime.control(ctx, name, 'status-get'));

	return result;
};

// Nothing here asks another package over ubus, apart from procd above.
// This code runs inside rpcd, and a call from rpcd to an object that rpcd
// serves itself, such as the one of luci-app-ha-cluster, is answered only
// when it has timed out, with every other call to rpcd waiting behind it.
// What the pages need from such an object, they ask for themselves.

export function set_service(ctx, name, enabled) {
	if (!config.CONFIGS[name])
		return { result: false, error: 'invalid service name' };

	let uci = cursor(ctx.uci_dir, ctx.uci_savedir);
	let section = null;

	uci.foreach('kea', 'service', s => {
		if ((text(s.name) || s['.name']) == name)
			section = s['.name'];
	});

	if (section == null) {
		section = name;
		uci.set('kea', section, 'service');
	}

	uci.set('kea', section, 'disabled', enabled ? '0' : '1');

	if (!uci.commit('kea'))
		return { result: false, error: 'failed to commit UCI config' };

	return { result: true };
};

// 24 random bytes as 48 hex digits, or null. There is deliberately no
// fallback: a guessable secret must never be written.
function random_secret() {
	let file = fs.open('/dev/urandom', 'r');

	if (!file)
		return null;

	let bytes = file.read(24);

	file.close();

	if (length(bytes) != 24)
		return null;

	let hex = '';

	for (let i = 0; i < 24; i++)
		hex += sprintf('%02x', ord(bytes, i));

	return hex;
}

// Create what the Kea daemons need to start: the runtime and lease
// directories and the control agent's API password file.
export function ensure_state(ctx) {
	config.ensure_run_dir(ctx);

	if (!config.mkdir_p(ctx.lease_dir, 0o750) || !config.mkdir_p(ctx.conf_dir, 0o755))
		return false;

	fs.chmod(ctx.lease_dir, 0o750);

	if ((fs.stat(ctx.api_password)?.size ?? 0) > 0)
		return true;

	let secret = random_secret();

	return secret != null && config.write_private(ctx.api_password, secret + '\n');
};

// Have ha-cluster bring its firewall rules up to date, when it follows the
// Kea files: see cluster.follows_kea. Its command for that touches the
// rules and no daemon, whether the cluster runs or was stopped, and reloads
// the firewall only when a rule changed.
//
// Returns null when there was nothing to call, otherwise whether the
// command succeeded.
//
// It is waited for. Calls that came at the same time would write the
// firewall config together, and rpcd runs one call after the other. The
// limit is for a command that hangs: rpcd answers nothing else meanwhile.
function cluster_firewall(ctx) {
	let script = init_script(ctx, 'ha-cluster');

	if (!init_installed(ctx, 'ha-cluster') || !cluster.declares_command(fs.readfile(script, 65536), 'firewall'))
		return null;

	if (!cluster.follows_kea(cursor(ctx.uci_dir, ctx.uci_savedir).get_all('ha-cluster', 'config')))
		return null;

	return system(config.shellquote(script) + ' firewall </dev/null >/dev/null 2>&1', ctx.cluster_timeout) == 0;
}

// The actions after which other packages are told, by kea_event().
const EVENT_ACTIONS = [ 'start', 'restart', 'reload', 'stop' ];

// Tell other packages that this application ran /etc/init.d/kea with one of
// EVENT_ACTIONS: a procd event of the type "kea.service" with the action.
// procd runs what a package has registered for it, such as ha-cluster with
//   procd_add_raw_trigger "kea.service" 1000 /etc/init.d/ha-cluster dhcp-backend
// on its own, later; nothing is waited for here. The event says only that
// the init script ran, not how it went: a listener looks at Kea itself.
function kea_event(ctx, action) {
	let event = { type: 'kea.service', data: { action } };

	if (ctx.service_event)
		return ctx.service_event(event);

	connect()?.call('service', 'event', event);
}

// With "cluster_firewall" in the answer, ha-cluster was called as well,
// because Kea was made to read its files: true when its command succeeded.
// Its failure is not a failure of the action.
export function init_action(ctx, action) {
	if (!init_installed(ctx, 'kea'))
		return { result: false, error: 'Kea init script is not installed' };

	if (!(action in INIT_ACTIONS))
		return { result: false, error: 'invalid init action' };

	let reads_files = action in [ 'start', 'restart', 'reload' ];

	if (reads_files && !ensure_state(ctx))
		return { result: false, error: 'failed to prepare Kea runtime state' };

	let status = run_init(ctx, 'kea', action);

	if (action in EVENT_ACTIONS)
		kea_event(ctx, action);

	if (status != 0)
		return { result: false, error: 'init action failed' };

	let reply = { result: true };
	let followed = reads_files ? cluster_firewall(ctx) : null;

	if (followed != null)
		reply.cluster_firewall = followed;

	return reply;
};

// Control of the services that compete with Kea for DHCP clients. Nothing
// else can be controlled through this method.
// Not stopped and not taken out of the boot sequence: dnsmasq is the DNS
// server of most routers and odhcpd sends the IPv6 router advertisements.
// To make room for Kea, DHCP is switched off for an interface in
// /etc/config/dhcp, which is LuCI's own page and the ACL of "dhcp".
const CONFLICT_ACTIONS = [ 'start', 'restart', 'reload', 'enable' ];

export function conflict_action(ctx, name, action) {
	if (!(name in CONFLICT_SERVICES))
		return { result: false, error: 'invalid service name' };

	if (action in [ 'stop', 'disable' ])
		return { result: false, error: name + ' is not stopped or disabled from here: switch off its DHCP for the interface instead' };

	if (!(action in CONFLICT_ACTIONS))
		return { result: false, error: 'invalid service action' };

	if (!init_installed(ctx, name))
		return { result: false, error: 'init script is not installed' };

	if (run_init(ctx, name, action) != 0)
		return { result: false, error: 'service action failed' };

	return { result: true };
};

export function status(ctx) {
	let binaries = {};
	let configs = {};
	let conflicts = {};
	let serves = openwrt_dhcp(cursor(ctx.uci_dir, ctx.uci_savedir));

	for (let name in config.CONFIG_ORDER) {
		let bin = config.binary(ctx, name);
		let file = config.path(ctx, name);

		binaries[name] = { installed: !!fs.access(bin, 'x'), path: bin };
		configs[name] = { exists: config.is_file(file), path: file };
	}

	for (let name in [ 'shell', 'lfc' ]) {
		let bin = ctx.sbin_dir + '/kea-' + name;

		binaries[name] = { installed: !!fs.access(bin, 'x'), path: bin };
	}

	for (let name in CONFLICT_SERVICES)
		conflicts[name] = {
			installed: init_installed(ctx, name),
			enabled: init_enabled(ctx, name),
			running: any_running(instances(ctx, name)),
			init: '/etc/init.d/' + name,
			// What the service is configured to serve, whether it runs or not.
			serves: serves[name]
		};

	return {
		version: runtime.version(ctx),
		init_installed: init_installed(ctx, 'kea'),
		init_enabled: init_enabled(ctx, 'kea'),
		runtime: {
			run_dir: config.is_dir(ctx.run_dir),
			run_dir_path: ctx.run_dir,
			lease_dir: config.is_dir(ctx.lease_dir),
			lease_dir_path: ctx.lease_dir,
			api_password: config.is_file(ctx.api_password),
			api_password_path: ctx.api_password
		},
		binaries,
		hooks: {
			dir: ctx.hooks_dir,
			ha: !!fs.access(ctx.hooks_dir + '/libdhcp_ha.so'),
			lease_cmds: !!fs.access(ctx.hooks_dir + '/libdhcp_lease_cmds.so'),
			// What the switch for client names in DNS needs: the run_script
			// hook of Kea and the script of kea-dnsmasq-hosts
			run_script: !!fs.access(ctx.hooks_dir + '/libdhcp_run_script.so', 'r'),
			dns_hosts: !!fs.access(ctx.dns_hosts_script, 'x')
		},
		configs,
		conflicts
	};
};
