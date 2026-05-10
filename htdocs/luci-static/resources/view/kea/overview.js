"use strict";
"require rpc";
"require view";
"require ui";

var callStatus = rpc.declare({
	object: "luci.kea",
	method: "getStatus",
	expect: { status: {} }
});

var callValidate = rpc.declare({
	object: "luci.kea",
	method: "validate",
	expect: { validation: {} }
});

function boolLabel(value) {
	return value ? _("Yes") : _("No");
}

function renderObjectTable(title, rows) {
	return E("div", { "class": "cbi-section" }, [
		E("h3", title),
		E("table", { "class": "table" }, rows.map(function(row) {
			return E("tr", { "class": "tr" }, [
				E("td", { "class": "td left", "style": "width: 35%" }, row[0]),
				E("td", { "class": "td left" }, row[1])
			]);
		}))
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callValidate(), {})
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var validation = data[1] || {};
		var binaries = status.binaries || {};
		var hooks = status.hooks || {};
		var configs = status.configs || {};
		var validationRows = [];

		Object.keys(validation).forEach(function(name) {
			var item = validation[name] || {};
			validationRows.push([
				name,
				E("span", {}, [
					item.valid ? _("Valid") : _("Invalid"),
					item.output ? E("pre", { "style": "white-space: pre-wrap" }, item.output) : ""
				])
			]);
		});

		return E("div", {}, [
			E("h2", _("Kea DHCP")),
			E("p", _("Manage ISC Kea DHCP services, configuration, reservations, and dnsmasq static lease imports.")),

			renderObjectTable(_("Runtime"), [
				[ _("Init script installed"), boolLabel(status.init_installed) ],
				[ _("Init autostart enabled"), boolLabel(status.init_enabled) ],
				[ _("LuCI import staging file exists"), boolLabel(status.staging_exists) ]
			]),

			renderObjectTable(_("Installed Components"), [
				[ "kea-dhcp4", boolLabel(binaries.dhcp4 && binaries.dhcp4.installed) ],
				[ "kea-dhcp6", boolLabel(binaries.dhcp6 && binaries.dhcp6.installed) ],
				[ "kea-dhcp-ddns", boolLabel(binaries.dhcp_ddns && binaries.dhcp_ddns.installed) ],
				[ "kea-ctrl-agent", boolLabel(binaries.ctrl_agent && binaries.ctrl_agent.installed) ],
				[ "kea-shell", boolLabel(binaries.shell && binaries.shell.installed) ],
				[ "HA hook", boolLabel(hooks.ha) ],
				[ "Lease commands hook", boolLabel(hooks.lease_cmds) ]
			]),

			renderObjectTable(_("Configuration Files"), [
				[ "kea-dhcp4.conf", boolLabel(configs.dhcp4 && configs.dhcp4.exists) ],
				[ "kea-dhcp6.conf", boolLabel(configs.dhcp6 && configs.dhcp6.exists) ],
				[ "kea-dhcp-ddns.conf", boolLabel(configs.dhcp_ddns && configs.dhcp_ddns.exists) ],
				[ "kea-ctrl-agent.conf", boolLabel(configs.ctrl_agent && configs.ctrl_agent.exists) ]
			]),

			validationRows.length ? renderObjectTable(_("Validation"), validationRows) :
				E("div", { "class": "cbi-section" }, [
					E("h3", _("Validation")),
					E("p", _("No validation results are available."))
				])
		]);
	}
});

