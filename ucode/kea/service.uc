// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import * as config from 'luci.kea.config';
import * as runtime from 'luci.kea.runtime';
import { interface_addresses } from 'luci.kea.net';

// Service state and control: the Kea init service and its components, the
// competing OpenWrt DHCP services, and the runtime files Kea needs.

const INIT_ACTIONS = [ 'enable', 'disable', 'start', 'stop', 'restart', 'reload' ];
const CONFLICT_SERVICES = [ 'dnsmasq', 'odhcpd' ];

function text(value) {
	if (type(value) == 'array')
		return join(' ', value);

	return value == null ? '' : `${value}`;
}

function uci_bool(value, fallback) {
	value = text(value);

	if (value in [ '1', 'on', 'true', 'yes', 'enabled' ])
		return true;

	if (value in [ '0', 'off', 'false', 'no', 'disabled' ])
		return false;

	return fallback;
}

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

// The interfaces on which the OpenWrt DHCP services are configured to
// answer: { name: { v4, v6 } }, from the "dhcp" sections of /etc/config/dhcp.
// dnsmasq serves DHCPv4 unless the section is ignored or says "disabled";
// DHCPv6 is served only where it is asked for.
function openwrt_dhcp(uci) {
	let served = {};

	uci.foreach('dhcp', 'dhcp', s => {
		let name = text(s['interface']);

		if (name == '' || uci_bool(s.ignore, false))
			return;

		served[name] = {
			v4: text(s.dhcpv4) != 'disabled',
			v6: text(s.dhcpv6) in [ 'server', 'relay', 'hybrid' ]
		};
	});

	return served;
}

export function network_interfaces(ctx) {
	let uci = cursor(ctx.uci_dir, ctx.uci_savedir);
	let served = openwrt_dhcp(uci);
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

export function init_action(ctx, action) {
	if (!init_installed(ctx, 'kea'))
		return { result: false, error: 'Kea init script is not installed' };

	if (!(action in INIT_ACTIONS))
		return { result: false, error: 'invalid init action' };

	if (action in [ 'start', 'restart', 'reload' ] && !ensure_state(ctx))
		return { result: false, error: 'failed to prepare Kea runtime state' };

	if (run_init(ctx, 'kea', action) != 0)
		return { result: false, error: 'init action failed' };

	return { result: true };
};

// Control of the services that compete with Kea for DHCP clients. Nothing
// else can be controlled through this method.
export function conflict_action(ctx, name, action) {
	if (!(name in CONFLICT_SERVICES))
		return { result: false, error: 'invalid service name' };

	if (!(action in INIT_ACTIONS))
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
			init: '/etc/init.d/' + name
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
			lease_cmds: !!fs.access(ctx.hooks_dir + '/libdhcp_lease_cmds.so')
		},
		configs,
		conflicts
	};
};
