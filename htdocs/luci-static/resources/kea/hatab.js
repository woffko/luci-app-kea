"use strict";
"require baseclass";
"require kea.ha as ha";
"require kea.widgets as widgets";

/*
 * The "High availability" tab of the DHCPv4 and DHCPv6 editors. It renders
 * the form state of kea.ha; the editor merges that state into the
 * configuration on save.
 */

var MODE_LABELS = {
	"hot-standby": _("Hot standby"),
	"load-balancing": _("Load balancing"),
	"passive-backup": _("Passive backup")
};

var ROLE_LABELS = {
	"primary": _("Primary"),
	"secondary": _("Secondary"),
	"standby": _("Standby"),
	"backup": _("Backup")
};

var ENABLE_LABELS = {
	dhcp4: _("Run this DHCPv4 server as part of a high availability setup"),
	dhcp6: _("Run this DHCPv6 server as part of a high availability setup")
};

function choices(values, labels) {
	return values.map(function(value) {
		return [ value, labels[value] ];
	});
}

/*
 * Returns the nodes of the tab. "hooks" tells which hook libraries are
 * installed; "redraw" draws the tab again after a change that affects
 * other fields.
 */
function render(familyName, state, hooks, redraw) {
	var nodes = [];
	var section = [
		E("h3", _("High availability")),
		E("div", { "class": "cbi-section-descr" },
			_("Two or more Kea servers share the leases of one network, so that one can fail without clients losing service. Every server gets the same list of peers; only the name of this server differs."))
	];
	var check = function(name) {
		return function() {
			return ha.fieldError(state, name);
		};
	};
	var roleNode = E("div", {});
	var thisServer = widgets.textInput(state, "thisServer", "router1", null, check("thisServer"));
	/*
	 * Some messages depend on several fields: which roles the peers have
	 * together, and whether a peer carries the name of this server. They
	 * are worked out again after every change on the tab.
	 */
	var refresh = function() {
		var messages = ha.hasPeers(state) ? ha.roleErrors(state) : [];

		roleNode.replaceChildren.apply(roleNode, messages.map(function(message) {
			return widgets.notice("warning", E("p", message));
		}));

		widgets.mark(thisServer, state.thisServer === "" ? null : ha.fieldError(state, "thisServer"));
	};

	if (state.present && !hooks.ha)
		section.push(widgets.notice("warning", E("p",
			_("The configuration loads the high availability hook, but the kea-hook-ha package is not installed. Kea does not start in this state."))));

	if (!state.editable) {
		section.push(widgets.notice("info", E("p",
			_("This configuration has several high availability relationships. They are edited on the Configuration page."))));

		return [ E("div", { "class": "cbi-section" }, section) ];
	}

	if (state.enabled && !hooks.lease_cmds)
		section.push(widgets.notice("warning", E("p",
			_("The kea-hook-lease-cmds package is not installed. The servers need it to exchange their leases."))));

	section.push(widgets.field(_("Enable"),
		E("label", {}, [
			widgets.checkbox(state, "enabled", redraw),
			" ",
			ENABLE_LABELS[familyName]
		]),
		state.present ? _("Switching this off removes the high availability settings from the file when you save.") : null));

	if (!state.enabled)
		return [ E("div", { "class": "cbi-section" }, section) ];

	section.push(
		widgets.field(ha.label("mode"),
			widgets.select(state, "mode", choices(ha.modes, MODE_LABELS), redraw),
			_("Hot standby: one server answers and the other takes over when it fails. Load balancing: both answer, each for half of the clients. Passive backup: one server answers and copies its leases to the backup servers.")),
		widgets.field(ha.label("thisServer"), thisServer,
			_("The name of this router in the list of peers."))
	);

	nodes.push(E("div", { "class": "cbi-section" }, section));

	nodes.push(widgets.rowTable({
		name: "kea-ha-peers",
		title: ha.label("peers"),
		description: _("Every server of the setup, this one included. The URL is where the Kea DHCP daemon of that server listens for its partners: an IP address and a port that nothing else uses there, for example http://192.168.1.1:8000/."),
		titles: [ ha.label("name"), ha.label("url"), ha.label("role"), _("Automatic failover") ],
		rows: state.peers,
		empty: _("No peers."),
		add: _("Add Peer"),
		create: function() {
			return ha.newPeer(state);
		},
		changed: refresh,
		renderRow: function(row) {
			var peerCheck = function(name) {
				return function() {
					return ha.peerError(state, row, name);
				};
			};
			var role = widgets.select(row, "role", choices(ha.roles, ROLE_LABELS), function() {
				widgets.mark(role, ha.peerError(state, row, "role"));
			});

			widgets.mark(role, ha.peerError(state, row, "role"));

			return [
				widgets.textInput(row, "name", "router2", null, peerCheck("name")),
				widgets.textInput(row, "url", "http://192.168.1.2:8000/", null, peerCheck("url")),
				role,
				widgets.checkbox(row, "autoFailover")
			];
		}
	}));

	nodes.push(roleNode);

	nodes.push(E("div", { "class": "cbi-section" }, [
		E("h3", _("Timers and lease updates"))
	].concat(ha.numberFields().map(function(name, index, all) {
		return widgets.field(ha.label(name),
			widgets.textInput(state, name, ha.fallback(name), "number", check(name)),
			index === all.length - 1 ?
				_("Times are in milliseconds. Empty fields use the Kea default shown as placeholder.") : null);
	}), [
		widgets.field(ha.label("sendLeaseUpdates"), E("label", {}, [
			widgets.checkbox(state, "sendLeaseUpdates"),
			" ",
			_("Tell the partner about every lease that is given out")
		])),
		widgets.field(ha.label("syncLeases"), E("label", {}, [
			widgets.checkbox(state, "syncLeases"),
			" ",
			_("Fetch the leases from the partner after a restart")
		])),
		widgets.field(ha.label("advanced"),
			widgets.textArea(state, "advanced", "{\n\t\"sync-page-limit\": 5000\n}", check("advanced")),
			_("Other parameters of the hook as a JSON object. Kea checks them when you save."))
	])));

	refresh();

	/* Events of the fields arrive here after the fields updated the state. */
	return [ E("div", { "input": refresh, "change": refresh }, nodes) ];
}

return baseclass.extend({
	render: render
});
