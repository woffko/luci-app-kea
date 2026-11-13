"use strict";
"require rpc";
"require view";
"require ui";
"require kea.backend as backend";
"require kea.dialogs as dialogs";

/*
 * Import of OpenWrt static leases (the host entries of /etc/config/dhcp)
 * into Kea reservations.
 *
 * The page keeps nothing: the backend computes the list from UCI and the
 * current Kea configuration every time it is asked.
 */

var callPreview = rpc.declare({
	object: "luci.kea",
	method: "importDnsmasqDryRun",
	expect: { "import": {} }
});

var callCommit = rpc.declare({
	object: "luci.kea",
	method: "importDnsmasqCommit",
	params: [ "entries" ],
	expect: { "": {} }
});

var STATUS = {
	ready: { label: _("Ready"), color: "#1f7a1f", background: "#e8f6e8" },
	review: { label: _("Needs review"), color: "#7a5a00", background: "#fdf3d0" },
	update: { label: _("Changes Kea"), color: "#7a5a00", background: "#fdf3d0" },
	present: { label: _("Already in Kea"), color: "#555", background: "#eee" },
	blocked: { label: _("Cannot import"), color: "#7a1f1f", background: "#f8e8e8" }
};

var FAMILY = {
	dhcp4: { label: "DHCPv4", file: "kea-dhcp4.conf" },
	dhcp6: { label: "DHCPv6", file: "kea-dhcp6.conf" }
};

function badge(status) {
	var style = STATUS[status] || STATUS.blocked;

	return E("span", {
		"style": "display: inline-block; min-width: 7.5em; white-space: nowrap; text-align: center; padding: .15rem .45rem; border-radius: .35rem; font-weight: 600; color: " + style.color + "; background: " + style.background
	}, style.label);
}

function notice(kind, text) {
	return E("div", { "class": "alert-message " + kind }, E("p", text));
}

return view.extend({
	/* The page has its own import button: no Save / Apply / Reset footer. */
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return L.resolveDefault(callPreview(), {});
	},

	setPreview: function(preview) {
		var self = this;

		this.files = preview.files || {};
		this.entries = preview.entries || [];
		this.selected = {};

		this.entries.forEach(function(entry) {
			if (entry.selectable && entry.selected)
				self.selected[entry.key] = true;
		});
	},

	refresh: function() {
		var self = this;

		return L.resolveDefault(callPreview(), {}).then(function(preview) {
			self.setPreview(preview);
			self.redraw();
		});
	},

	selectedKeys: function() {
		var self = this;

		return this.entries.filter(function(entry) {
			return entry.selectable && self.selected[entry.key];
		}).map(function(entry) {
			return entry.key;
		});
	},

	/* ---- import ---- */

	commit: function() {
		var self = this;
		var keys = this.selectedKeys();

		if (!keys.length)
			return;

		dialogs.confirm(_("Import static leases"),
			_("Write the selected static leases to the Kea configuration as reservations? The current files are backed up first. Kea is not reloaded."),
			_("Import"),
			function() {
				return callCommit(keys).then(function(result) {
					self.report(result);

					return self.refresh();
				});
			},
			"positive");
	},

	report: function(result) {
		var lines;

		if (!result || !result.result) {
			backend.notifyFailure(result, _("The import failed."));
			return;
		}

		lines = [
			_("Imported") + ": " + (result.imported || 0),
			_("Updated") + ": " + (result.updated || 0),
			_("Skipped") + ": " + (result.skipped || 0)
		];

		(result.skipped_entries || []).forEach(function(entry) {
			lines.push(entry.key + ": " + entry.reason);
		});

		if (result.changed)
			lines.push("", _("Reload or restart Kea on the Services page to apply the new reservations."));

		ui.addNotification(null, E("pre", { "style": "white-space: pre-wrap" }, lines.join("\n")), "info");
	},

	/* ---- rendering ---- */

	renderNotices: function() {
		var self = this;
		var nodes = [];

		Object.keys(FAMILY).forEach(function(family) {
			var state = self.files[family];
			var used = self.entries.some(function(entry) {
				return entry.family === family;
			});

			if (!state || !used)
				return;

			if (!state.exists)
				nodes.push(notice("warning", FAMILY[family].file + ": " +
					_("the file does not exist, so these static leases cannot be imported.")));
			else if (!state.parsed)
				nodes.push(notice("warning", FAMILY[family].file + ": " +
					_("the file cannot be parsed. Fix it on the Configuration page first.") +
					(state.error ? " (" + state.error + ")" : "")));
			else if (state.has_comments)
				nodes.push(notice("info", FAMILY[family].file + ": " +
					_("the file contains comments. An import rewrites it as plain JSON and removes them.")));
		});

		this.noticesNode.replaceChildren.apply(this.noticesNode, nodes);
	},

	renderRow: function(entry) {
		var self = this;

		return E("tr", { "class": "tr" }, [
			E("td", { "class": "td left" }, E("input", {
				"type": "checkbox",
				"checked": this.selected[entry.key] ? "checked" : null,
				"disabled": entry.selectable ? null : "disabled",
				"change": function(ev) {
					self.selected[entry.key] = ev.target.checked;
					self.renderActions();
				}
			})),
			E("td", { "class": "td left" }, [
				entry.name || E("em", {}, _("unnamed")),
				E("br"),
				E("small", {}, entry.source)
			]),
			E("td", { "class": "td left" }, (FAMILY[entry.family] || {}).label || entry.family),
			E("td", { "class": "td left" }, entry.identifier || "-"),
			E("td", { "class": "td left" }, entry.address || "-"),
			E("td", { "class": "td left" }, entry.subnet || "-"),
			E("td", { "class": "td left" }, badge(entry.status)),
			E("td", { "class": "td left" }, (entry.notes || []).map(function(text) {
				return E("div", {}, text);
			}))
		]);
	},

	renderTable: function() {
		var self = this;
		var titles = [ "", _("Host"), _("Protocol"), _("Identifier"), _("Address"),
			_("Kea subnet"), _("Status"), _("Notes") ];
		var rows = this.entries.map(function(entry) {
			return self.renderRow(entry);
		});

		if (!rows.length)
			rows = [ E("tr", { "class": "tr" }, E("td", {
				"class": "td left",
				"colspan": String(titles.length)
			}, _("No static leases were found in /etc/config/dhcp."))) ];

		this.tableNode.replaceChildren(E("table", { "class": "table" }, [
			E("thead", {}, E("tr", { "class": "tr table-titles" }, titles.map(function(title) {
				return E("th", { "class": "th left" }, title);
			}))),
			E("tbody", {}, rows)
		]));
	},

	renderActions: function() {
		var self = this;
		var count = this.selectedKeys().length;

		this.actionsNode.replaceChildren(
			E("button", {
				"class": "btn cbi-button cbi-button-apply",
				"disabled": count ? null : "disabled",
				"click": function(ev) {
					ev.preventDefault();
					self.commit();
				}
			}, _("Import selected") + " (" + count + ")"),
			" ",
			E("button", {
				"class": "btn cbi-button cbi-button-reload",
				"click": function(ev) {
					ev.preventDefault();

					return self.refresh();
				}
			}, _("Refresh"))
		);
	},

	redraw: function() {
		this.renderNotices();
		this.renderTable();
		this.renderActions();
	},

	render: function(preview) {
		this.noticesNode = E("div", {});
		this.tableNode = E("div", { "class": "cbi-section" });
		this.actionsNode = E("div", { "class": "cbi-page-actions" });

		this.setPreview(preview || {});
		this.redraw();

		return E("div", {}, [
			E("h2", _("Import dnsmasq Static Leases")),
			E("p", {}, [
				_("The static leases of OpenWrt (the host entries that dnsmasq and odhcpd read from /etc/config/dhcp) can be written to Kea as reservations. This page stores nothing: the list shows what an import would do right now."),
				" ",
				_("To change an entry, edit the static lease and reload this page:"),
				" ",
				E("a", { "href": L.url("admin/network/dhcp") }, _("DHCP and DNS"))
			]),
			this.noticesNode,
			this.tableNode,
			this.actionsNode
		]);
	}
});
