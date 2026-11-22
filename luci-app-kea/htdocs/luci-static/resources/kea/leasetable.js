"use strict";
"require baseclass";
"require ui";
"require kea.backend as backend";

/*
 * The leases in use as two tables, after the DHCP section of the status
 * overview of LuCI, which shows the leases of dnsmasq and odhcpd only: one
 * table for DHCPv4 and one for DHCPv6, each lease with a button that
 * reserves its address in Kea. Used by that overview (view/status/include)
 * and by the Overview page of this application.
 */

var FAMILIES = [ "dhcp4", "dhcp6" ];

/* The leases a client holds now; a declined address is nobody's. */
function activeLeases(reply, family) {
	var items = reply && reply[family] && Array.isArray(reply[family].items) ? reply[family].items : [];

	return items.filter(function(lease) {
		return lease.state === "active";
	});
}

/* Whether the daemon has leases to show at all: a lease file, or a reason why not. */
function inUse(reply, family) {
	var leases = reply && reply[family];

	return !!(leases && (leases.exists || leases.note || (leases.items && leases.items.length)));
}

function remaining(reply, lease) {
	var left = lease.expires - (reply.time || 0);

	return left > 0 ? "%t".format(left) : E("em", {}, _("expired"));
}

/* The name the client sent, and the name the network knows it by if that differs. */
function hostLabel(lease, hints) {
	var name = lease.hostname || "";
	var hint = null;

	if (hints && lease.hwaddr && typeof hints.getHostnameByMACAddr === "function")
		hint = hints.getHostnameByMACAddr(lease.hwaddr);

	if (hint && name && hint !== name)
		return "%s (%s)".format(name, hint);

	return name || hint || "-";
}

function interfaceOf(reply, family, lease) {
	var subnet = ((reply[family] || {}).subnets || {})[String(lease.subnet_id)];

	return (subnet && subnet.interface) || "-";
}

function addressOf(lease) {
	return lease.type === "prefix" ? lease.address + "/" + lease.prefix_len : lease.address;
}

function reserveDialog(family, lease, refresh) {
	var identifier = family === "dhcp4" ? lease.hwaddr : lease.duid;
	var name = E("input", { "class": "cbi-input-text kea-reserve-name", "type": "text", "value": lease.hostname || "" });

	ui.showModal(_("Reserve IP"), [
		E("p", {}, _("Kea is to give %s to %s every time. The reservation is added to the %s configuration, and a running Kea reads it again.")
			.format(lease.address, identifier, family === "dhcp4" ? "DHCPv4" : "DHCPv6")),
		E("div", { "class": "cbi-value" }, [
			E("label", { "class": "cbi-value-title" }, _("Hostname")),
			E("div", { "class": "cbi-value-field" }, name)
		]),
		E("div", { "class": "right" }, [
			E("button", { "class": "btn", "click": ui.hideModal }, _("Cancel")),
			" ",
			E("button", {
				"class": "btn cbi-button-action important",
				"click": ui.createHandlerFn(null, function() {
					var hostname = name.value.trim();

					ui.hideModal();

					return backend.reserveLease(family, identifier, lease.address, hostname).then(function(done) {
						return done && refresh ? refresh() : null;
					});
				})
			}, _("Reserve"))
		])
	]);
}

function reserveButton(family, lease, refresh) {
	var identifier = family === "dhcp4" ? lease.hwaddr : lease.duid;
	/* Kea reserves addresses this way, not delegated prefixes. */
	var possible = !!identifier && (family === "dhcp4" || lease.type === "address");

	return E("button", {
		"class": "cbi-button cbi-button-apply kea-reserve",
		"data-tooltip": lease.reserved ?
			_("Kea already reserves an address for this client, or this address for a client") :
			_("Reserve this address in Kea for this client"),
		"disabled": (!possible || lease.reserved) ? "" : null,
		"click": function(ev) {
			ev.currentTarget.blur();
			reserveDialog(family, lease, refresh);
		}
	}, _("Reserve IP"));
}

function table(reply, family, leases, hints, refresh) {
	var v4 = family === "dhcp4";
	var titles = v4 ?
		[ _("Interface"), _("Hostname"), _("IPv4 address"), _("MAC address"), _("Remaining time"), _("Static Lease") ] :
		[ _("Interface"), _("Hostname"), _("IPv6 address"), _("DUID"), _("IAID"), _("Remaining time"), _("Static Lease") ];
	var node = E("table", { "class": "table kea-active-leases kea-active-leases-" + family }, [
		E("tr", { "class": "tr table-titles" }, titles.map(function(title, i) {
			return E("th", { "class": i === titles.length - 1 ? "th cbi-section-actions" : "th" }, title);
		}))
	]);

	cbi_update_table(node, leases.map(function(lease) {
		var row = [ interfaceOf(reply, family, lease), "%h".format(hostLabel(lease, hints)), addressOf(lease) ];

		if (v4)
			row.push(lease.hwaddr || "-");
		else
			row.push(lease.duid || "-", String(lease.iaid));

		row.push(remaining(reply, lease), reserveButton(family, lease, refresh));

		return row;
	}), E("em", {}, _("No active leases found")));

	return node;
}

/* The leases given out last come first. */
function newestFirst(a, b) {
	return (b.expires - b.valid_lifetime) - (a.expires - a.valid_lifetime);
}

return baseclass.extend({
	activeLeases: activeLeases,

	/*
	 * The tables of the daemons that keep leases, or null when neither
	 * does. options.limit: show this many leases per protocol, the newest;
	 * options.refresh: called after a reservation was made.
	 */
	render: function(reply, hints, options) {
		var nodes = [];

		options = options || {};

		FAMILIES.forEach(function(family) {
			var leases = activeLeases(reply, family);
			var shown = leases;

			if (!inUse(reply, family))
				return;

			if (options.limit && leases.length > options.limit)
				shown = leases.slice().sort(newestFirst).slice(0, options.limit);

			nodes.push(E("h3", {}, family === "dhcp4" ? _("Active DHCPv4 Leases") : _("Active DHCPv6 Leases")));
			nodes.push(table(reply, family, shown, hints, options.refresh));

			if (shown.length < leases.length)
				nodes.push(E("p", { "class": "kea-leases-more" },
					_("The %d leases given out last of %d.").format(shown.length, leases.length)));
		});

		return nodes.length ? E("div", { "class": "kea-lease-tables" }, nodes) : null;
	}
});
