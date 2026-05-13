"use strict";
"require rpc";
"require view";
"require ui";

var callStatus = rpc.declare({
	object: "luci.kea",
	method: "getStatus",
	expect: { status: {} }
});

var callServices = rpc.declare({
	object: "luci.kea",
	method: "getServices",
	expect: { services: {} }
});

var callSetService = rpc.declare({
	object: "luci.kea",
	method: "setService",
	params: [ "name", "enabled" ],
	expect: { result: false }
});

var callInitAction = rpc.declare({
	object: "luci.kea",
	method: "setInitAction",
	params: [ "action" ],
	expect: { result: false }
});

var SERVICE_ORDER = [
	{
		name: "dhcp4",
		title: _("DHCPv4 server"),
		binary: "dhcp4",
		config: "dhcp4",
		process: "kea-dhcp4"
	},
	{
		name: "dhcp6",
		title: _("DHCPv6 server"),
		binary: "dhcp6",
		config: "dhcp6",
		process: "kea-dhcp6"
	},
	{
		name: "dhcp_ddns",
		title: _("DHCP DDNS"),
		binary: "dhcp_ddns",
		config: "dhcp_ddns",
		process: "kea-dhcp-ddns"
	},
	{
		name: "ctrl_agent",
		title: _("Control Agent"),
		binary: "ctrl_agent",
		config: "ctrl_agent",
		process: "kea-ctrl-agent"
	}
];

function badge(active, text, mutedText) {
	var color = active ? "#1f7a1f" : "#7a1f1f";
	var background = active ? "#e8f6e8" : "#f8e8e8";

	return E("span", {
		"style": "display:inline-block; min-width:6.5em; text-align:center; padding:.15rem .45rem; border-radius:.35rem; color:%s; background:%s; font-weight:600".format(color, background)
	}, active ? text : mutedText);
}

function neutralBadge(text) {
	return E("span", {
		"style": "display:inline-block; min-width:6.5em; text-align:center; padding:.15rem .45rem; border-radius:.35rem; color:#555; background:#eee; font-weight:600"
	}, text);
}

function actionButton(title, action, buttonClass, handler) {
	return E("button", {
		"class": "btn cbi-button " + buttonClass,
		"click": function(ev) {
			ev.preventDefault();
			return handler(action);
		}
	}, title);
}

function boolValue(value) {
	return value === true || value === 1 || value === "1";
}

function hasAnyRunningService(services) {
	var i, item;

	for (i = 0; i < SERVICE_ORDER.length; i++) {
		item = services[SERVICE_ORDER[i].name] || {};
		if (boolValue(item.running))
			return true;
	}

	return false;
}

function serviceRow(serviceDef, services, status, self) {
	var service = services[serviceDef.name] || {};
	var binaries = status.binaries || {};
	var configs = status.configs || {};
	var binary = binaries[serviceDef.binary] || {};
	var config = configs[serviceDef.config] || {};
	var configured = service.section ? true : false;
	var enabled = boolValue(service.enabled);
	var running = boolValue(service.running);
	var checkbox;

	checkbox = E("input", {
		"type": "checkbox",
		"checked": enabled ? "checked" : null,
		"disabled": configured ? null : "disabled",
		"change": function(ev) {
			return self.handleToggle(serviceDef.name, ev.target.checked);
		}
	});

	return E("tr", { "class": "tr" }, [
		E("td", { "class": "td left" }, [
			E("strong", {}, serviceDef.title),
			E("br"),
			E("small", {}, serviceDef.process)
		]),
		E("td", { "class": "td left" }, binary.installed ? badge(true, _("Installed"), _("Missing")) : badge(false, _("Installed"), _("Missing"))),
		E("td", { "class": "td left" }, config.exists ? badge(true, _("Present"), _("Missing")) : badge(false, _("Present"), _("Missing"))),
		E("td", { "class": "td left" }, configured ? E("label", {}, [
			checkbox,
			" ",
			enabled ? _("Enabled") : _("Disabled")
		]) : neutralBadge(_("Not configured"))),
		E("td", { "class": "td left" }, running ? badge(true, _("Running"), _("Stopped")) : badge(false, _("Running"), _("Stopped"))),
		E("td", { "class": "td left" }, service.section || "-")
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callServices(), {})
		]);
	},

	refresh: function() {
		var self = this;

		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callServices(), {})
		]).then(function(data) {
			self.status = data[0] || {};
			self.services = data[1] || {};
			self.renderContent();
		});
	},

	handleToggle: function(name, enabled) {
		var self = this;

		return callSetService(name, enabled).then(function(result) {
			if (!result) {
				ui.addNotification(null, E("p", _("Failed to update Kea service setting.")), "danger");
				return;
			}

			ui.addNotification(null, E("p", _("Kea service setting saved. Restart Kea to apply it.")), "info");
			return self.refresh();
		});
	},

	handleInitAction: function(action) {
		var self = this;

		return callInitAction(action).then(function(result) {
			if (!result) {
				ui.addNotification(null, E("p", _("Kea init action failed.")), "danger");
				return;
			}

			ui.addNotification(null, E("p", _("Kea init action completed.")), "info");
			return self.refresh();
		});
	},

	renderInitSection: function() {
		var status = this.status || {};
		var services = this.services || {};
		var initInstalled = boolValue(status.init_installed);
		var initEnabled = boolValue(status.init_enabled);
		var anyRunning = hasAnyRunningService(services);
		var actions;

		actions = [
			actionButton(_("Start"), "start", "cbi-button-apply", this.handleInitAction.bind(this)),
			" ",
			actionButton(_("Stop"), "stop", "cbi-button-negative", this.handleInitAction.bind(this)),
			" ",
			actionButton(_("Restart"), "restart", "cbi-button-reload", this.handleInitAction.bind(this)),
			" ",
			actionButton(_("Reload"), "reload", "cbi-button-neutral", this.handleInitAction.bind(this)),
			" ",
			initEnabled ?
				actionButton(_("Disable autostart"), "disable", "cbi-button-negative", this.handleInitAction.bind(this)) :
				actionButton(_("Enable autostart"), "enable", "cbi-button-apply", this.handleInitAction.bind(this))
		];

		return E("div", { "class": "cbi-section" }, [
			E("h3", _("Init Service")),
			E("table", { "class": "table" }, [
				E("tr", { "class": "tr table-titles" }, [
					E("th", { "class": "th left" }, _("Service")),
					E("th", { "class": "th left" }, _("Installed")),
					E("th", { "class": "th left" }, _("Autostart")),
					E("th", { "class": "th left" }, _("Runtime")),
					E("th", { "class": "th left" }, _("Actions"))
				]),
				E("tr", { "class": "tr" }, [
					E("td", { "class": "td left" }, [
						E("strong", {}, "kea"),
						E("br"),
						E("small", {}, "/etc/init.d/kea")
					]),
					E("td", { "class": "td left" }, initInstalled ? badge(true, _("Installed"), _("Missing")) : badge(false, _("Installed"), _("Missing"))),
					E("td", { "class": "td left" }, initEnabled ? badge(true, _("Enabled"), _("Disabled")) : badge(false, _("Enabled"), _("Disabled"))),
					E("td", { "class": "td left" }, anyRunning ? badge(true, _("Running"), _("Stopped")) : badge(false, _("Running"), _("Stopped"))),
					E("td", { "class": "td left" }, initInstalled ? actions : neutralBadge(_("Unavailable")))
				])
			])
		]);
	},

	renderServiceSection: function() {
		var self = this;
		var rows = SERVICE_ORDER.map(function(serviceDef) {
			return serviceRow(serviceDef, self.services || {}, self.status || {}, self);
		});

		return E("div", { "class": "cbi-section" }, [
			E("h3", _("Kea Components")),
			E("table", { "class": "table" }, [
				E("tr", { "class": "tr table-titles" }, [
					E("th", { "class": "th left" }, _("Component")),
					E("th", { "class": "th left" }, _("Binary")),
					E("th", { "class": "th left" }, _("Config")),
					E("th", { "class": "th left" }, _("Enabled")),
					E("th", { "class": "th left" }, _("Runtime")),
					E("th", { "class": "th left" }, _("UCI section"))
				]),
				rows
			])
		]);
	},

	renderContent: function() {
		var container = document.querySelector("#kea-services-content");

		if (!container)
			return;

		container.replaceChildren(
			this.renderInitSection(),
			this.renderServiceSection()
		);
	},

	render: function(data) {
		this.status = data[0] || {};
		this.services = data[1] || {};

		return E("div", {}, [
			E("h2", _("Kea Services")),
			E("div", { "id": "kea-services-content" }, [
				this.renderInitSection(),
				this.renderServiceSection()
			])
		]);
	}
});
