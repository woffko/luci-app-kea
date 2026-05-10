"use strict";
"require rpc";
"require view";
"require ui";

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

function serviceTitle(name) {
	return ({
		ctrl_agent: _("Control Agent"),
		dhcp4: _("DHCPv4 server"),
		dhcp6: _("DHCPv6 server"),
		dhcp_ddns: _("DHCP DDNS")
	})[name] || name;
}

return view.extend({
	load: function() {
		return L.resolveDefault(callServices(), {});
	},

	handleToggle: function(name, enabled) {
		return callSetService(name, enabled).then(function(result) {
			if (!result)
				ui.addNotification(null, E("p", _("Failed to update Kea service setting.")), "danger");
			else
				window.location.reload();
		});
	},

	handleInitAction: function(action) {
		return callInitAction(action).then(function(result) {
			if (!result)
				ui.addNotification(null, E("p", _("Kea init action failed.")), "danger");
			else
				window.location.reload();
		});
	},

	render: function(services) {
		var rows = [];
		var self = this;

		[ "ctrl_agent", "dhcp4", "dhcp6", "dhcp_ddns" ].forEach(function(name) {
			var service = services[name] || {};
			var checkbox = E("input", {
				"type": "checkbox",
				"checked": service.enabled ? "checked" : null,
				"click": function(ev) {
					self.handleToggle(name, ev.target.checked);
				}
			});

			rows.push(E("tr", { "class": "tr" }, [
				E("td", { "class": "td left" }, serviceTitle(name)),
				E("td", { "class": "td left" }, checkbox),
				E("td", { "class": "td left" }, service.running ? _("Running") : _("Stopped"))
			]));
		});

		return E("div", {}, [
			E("h2", _("Kea Services")),
			E("p", _("Enable or disable Kea service instances managed by /etc/config/kea.")),
			E("div", { "class": "cbi-section" }, [
				E("table", { "class": "table" }, [
					E("tr", { "class": "tr table-titles" }, [
						E("th", { "class": "th left" }, _("Service")),
						E("th", { "class": "th left" }, _("Enabled")),
						E("th", { "class": "th left" }, _("Runtime"))
					]),
					rows
				])
			]),
			E("div", { "class": "cbi-page-actions" }, [
				E("button", {
					"class": "btn cbi-button cbi-button-apply",
					"click": function() { return self.handleInitAction("restart"); }
				}, _("Restart")),
				" ",
				E("button", {
					"class": "btn cbi-button cbi-button-reload",
					"click": function() { return self.handleInitAction("reload"); }
				}, _("Reload")),
				" ",
				E("button", {
					"class": "btn cbi-button cbi-button-neutral",
					"click": function() { return self.handleInitAction("start"); }
				}, _("Start")),
				" ",
				E("button", {
					"class": "btn cbi-button cbi-button-negative",
					"click": function() { return self.handleInitAction("stop"); }
				}, _("Stop"))
			])
		]);
	}
});
