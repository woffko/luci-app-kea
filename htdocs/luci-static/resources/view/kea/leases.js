"use strict";
"require view";
"require poll";
"require kea.backend as backend";

/*
 * The leases Kea has given out, read by the backend from the lease files of
 * the daemons. The page only shows them; a lease is changed by its client
 * or by Kea.
 */

/* Seconds between two looks at the lease files. */
var REFRESH = 10;

var STATE_LABELS = {
	active: _("Active"),
	declined: _("Declined"),
	registered: _("Registered")
};

var TYPE_LABELS = {
	address: _("Address"),
	temporary: _("Temporary address"),
	prefix: _("Delegated prefix")
};

/* Why there is nothing to read, by the note of the backend. */
var NOTES = {
	"no-memfile": _("The lease database of this daemon is not a memfile, so there is no lease file to read."),
	"no-persist": _("This daemon keeps its leases in memory only (\"persist\" is false), so there is no lease file to read."),
	"too-large": _("The lease file is too large to show here.")
};

var COLUMNS = {
	dhcp4: [
		[ _("Address"), function(lease) { return lease.address; } ],
		[ _("MAC address"), function(lease) { return lease.hwaddr || "-"; } ],
		[ _("Hostname"), function(lease) { return lease.hostname || "-"; } ],
		[ _("Client ID"), function(lease) { return lease.client_id || "-"; } ]
	],
	dhcp6: [
		[ _("Address or prefix"), function(lease) {
			return lease.type === "prefix" ? lease.address + "/" + lease.prefix_len : lease.address;
		} ],
		[ _("Type"), function(lease) { return TYPE_LABELS[lease.type] || lease.type; } ],
		[ _("DUID"), function(lease) { return lease.duid || "-"; } ],
		[ _("IAID"), function(lease) { return String(lease.iaid); } ],
		[ _("MAC address"), function(lease) { return lease.hwaddr || "-"; } ],
		[ _("Hostname"), function(lease) { return lease.hostname || "-"; } ]
	]
};

var TITLES = { dhcp4: "DHCPv4", dhcp6: "DHCPv6" };

/* "1d 2h", "3h 4m", "5m 6s" or "7s". */
function duration(seconds) {
	var units = [ [ 86400, _("d") ], [ 3600, _("h") ], [ 60, _("m") ], [ 1, _("s") ] ];
	var parts = [];
	var i, count;

	seconds = Math.max(0, Math.floor(seconds));

	for (i = 0; i < units.length && parts.length < 2; i++) {
		count = Math.floor(seconds / units[i][0]);

		if (count > 0 || (i === units.length - 1 && !parts.length))
			parts.push(count + units[i][1]);

		seconds -= count * units[i][0];
	}

	return parts.join(" ");
}

function renderFamily(family, data, now) {
	var columns = COLUMNS[family].concat([
		[ _("Subnet ID"), function(lease) { return String(lease.subnet_id); } ],
		[ _("Expires in"), function(lease) { return duration(lease.expires - now); } ],
		[ _("State"), function(lease) { return STATE_LABELS[lease.state] || lease.state; } ]
	]);
	var items = data.items || [];
	var nodes = [ E("h3", TITLES[family] + " (" + (data.count || 0) + ")") ];

	if (data.note)
		nodes.push(E("p", {}, NOTES[data.note] || data.note));
	else if (!data.exists)
		nodes.push(E("p", {}, _("No lease file yet. Kea creates it when the daemon is started for the first time.")));
	else if (!items.length)
		nodes.push(E("p", {}, _("No leases are in use.")));

	if (data.truncated)
		nodes.push(E("div", { "class": "alert-message info" },
			E("p", _("The first %d of %d leases are shown.").format(items.length, data.count))));

	if (items.length)
		nodes.push(E("table", { "class": "table kea-leases-" + family }, [
			E("thead", {}, E("tr", { "class": "tr table-titles" }, columns.map(function(column) {
				return E("th", { "class": "th left" }, column[0]);
			}))),
			E("tbody", {}, items.map(function(lease) {
				return E("tr", { "class": "tr" }, columns.map(function(column) {
					return E("td", { "class": "td left" }, column[1](lease));
				}));
			}))
		]));

	if (data.file)
		nodes.push(E("div", { "class": "cbi-section-descr" }, _("Lease file") + ": " + data.file));

	return E("div", { "class": "cbi-section" }, nodes);
}

return view.extend({
	/* A read-only page: no Save / Apply / Reset footer. */
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return backend.getLeases();
	},

	draw: function(leases) {
		var now = leases.time || 0;

		this.node.replaceChildren(
			renderFamily("dhcp4", leases.dhcp4 || {}, now),
			renderFamily("dhcp6", leases.dhcp6 || {}, now)
		);
	},

	render: function(leases) {
		var self = this;

		this.node = E("div", {});
		this.draw(leases || {});

		poll.add(function() {
			return backend.getLeases().then(function(fresh) {
				self.draw(fresh || {});
			});
		}, REFRESH);

		return E("div", {}, [
			E("h2", _("Kea Leases")),
			E("p", {}, _("The addresses and prefixes Kea has given out and that are still in use, read from its lease files. The list is refreshed every %d seconds.").format(REFRESH)),
			this.node
		]);
	}
});
