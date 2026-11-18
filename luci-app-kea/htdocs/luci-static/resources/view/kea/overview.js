"use strict";
"require rpc";
"require view";
"require ui";
"require kea.backend as backend";

/* How many messages of the system log the page shows. */
var LOG_LINES = 30;

var SEVERITY_STYLE = {
	WARN: "color: #7a5a00; font-weight: 600",
	ERROR: "color: #7a1f1f; font-weight: 600",
	FATAL: "color: #7a1f1f; font-weight: 600"
};

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
	/* A read-only page: no Save / Apply / Reset footer. */
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callValidate(), {}),
			backend.getLog(LOG_LINES)
		]);
	},

	renderLog: function(lines) {
		var titles = [ _("Time"), _("Daemon"), _("Severity"), _("Message") ];

		if (!lines.length) {
			this.logNode.replaceChildren(E("p", {},
				_("No Kea messages in the system log. Kea writes there when its loggers use the syslog output and a daemon has been started since the last boot.")));
			return;
		}

		this.logNode.replaceChildren(E("table", { "class": "table kea-log" }, [
			E("thead", {}, E("tr", { "class": "tr table-titles" }, titles.map(function(title) {
				return E("th", { "class": "th left" }, title);
			}))),
			E("tbody", {}, lines.map(function(line) {
				return E("tr", { "class": "tr" }, [
					E("td", { "class": "td left", "style": "white-space: nowrap" }, line.time),
					E("td", { "class": "td left", "style": "white-space: nowrap" }, line.daemon),
					E("td", { "class": "td left", "style": SEVERITY_STYLE[line.severity] || "" }, line.severity),
					E("td", { "class": "td left", "style": "word-break: break-word" }, line.text)
				]);
			}))
		]));
	},

	render: function(data) {
		var self = this;
		var status = data[0] || {};
		var validation = data[1] || {};
		var binaries = status.binaries || {};
		var hooks = status.hooks || {};
		var configs = status.configs || {};
		var validationRows = [];

		this.logNode = E("div", {});
		this.renderLog(data[2] || []);

		Object.keys(validation).forEach(function(name) {
			var item = validation[name] || {};
			validationRows.push([
				name,
				E("span", {}, [
					item.valid ? _("Valid") : _("Invalid"),
					/* What Kea prints for a file it accepts is of interest only on demand. */
					item.output ? E("details", { "open": item.valid ? null : "open" }, [
						E("summary", { "style": "cursor: pointer" }, _("Output of the check")),
						E("pre", { "style": "white-space: pre-wrap" }, item.output)
					]) : ""
				])
			]);
		});

		return E("div", {}, [
			E("h2", _("Kea DHCP")),
			E("p", _("Manage ISC Kea DHCP services, configuration, reservations, and dnsmasq static lease imports.")),

			renderObjectTable(_("Runtime"), [
				[ _("Kea version"), status.version || _("unknown") ],
				[ _("Init script installed"), boolLabel(status.init_installed) ],
				[ _("Init autostart enabled"), boolLabel(status.init_enabled) ]
			]),

			renderObjectTable(_("Installed Components"), [
				[ "kea-dhcp4", boolLabel(binaries.dhcp4 && binaries.dhcp4.installed) ],
				[ "kea-dhcp6", boolLabel(binaries.dhcp6 && binaries.dhcp6.installed) ],
				[ "kea-dhcp-ddns", boolLabel(binaries.dhcp_ddns && binaries.dhcp_ddns.installed) ],
				[ "kea-ctrl-agent", boolLabel(binaries.ctrl_agent && binaries.ctrl_agent.installed) ],
				[ "kea-lfc", boolLabel(binaries.lfc && binaries.lfc.installed) ],
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
				]),

			E("div", { "class": "cbi-section" }, [
				E("h3", _("Recent Log Messages")),
				E("div", { "class": "cbi-section-descr" },
					_("The last messages of the Kea daemons in the system log.")),
				this.logNode,
				E("div", { "class": "right", "style": "margin-top: .5rem" }, E("button", {
					"class": "btn cbi-button cbi-button-reload",
					"click": function(ev) {
						ev.preventDefault();

						return backend.getLog(LOG_LINES).then(function(lines) {
							self.renderLog(lines);
						});
					}
				}, _("Refresh")))
			])
		]);
	}
});

