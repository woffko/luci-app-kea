"use strict";
"require rpc";
"require view";
"require ui";

var callImportDryRun = rpc.declare({
	object: "luci.kea",
	method: "importDnsmasqDryRun",
	expect: { import: {} }
});

var callImportCommit = rpc.declare({
	object: "luci.kea",
	method: "importDnsmasqCommit",
	expect: { "": {} }
});

function warningIcon(entry) {
	if (!entry.warnings || entry.warnings.length === 0)
		return "";

	return E("span", {
		"title": entry.warnings.join("\n"),
		"style": "color: #b7791f; font-weight: bold"
	}, "!");
}

return view.extend({
	load: function() {
		return L.resolveDefault(callImportDryRun(), {});
	},

	commitImport: function() {
		var self = this;

		if (!confirm(_("Import ready dnsmasq static leases into Kea?")))
			return Promise.resolve();

		return callImportCommit().then(function(result) {
			var details = [];

			if (!result || !result.result) {
				ui.addNotification(null, E("p", [
					result && result.error ? result.error : _("Import failed."),
					result && result.detail ? E("pre", { "style": "white-space: pre-wrap" }, result.detail) : "",
					result && result.validation ? E("pre", { "style": "white-space: pre-wrap" }, result.validation) : ""
				]), "danger");
				return;
			}

			details.push(_("Imported") + ": " + (result.imported || 0));
			details.push(_("Updated") + ": " + (result.updated || 0));
			details.push(_("Skipped") + ": " + (result.skipped || 0));
			details.push(_("Staged") + ": " + (result.staged || 0));

			if (result.skipped_entries && result.skipped_entries.length) {
				details.push("");
				result.skipped_entries.forEach(function(entry) {
					details.push((entry.source || "-") + ": " + (entry.reason || _("skipped")));
				});
			}

			ui.addNotification(null, E("pre", { "style": "white-space: pre-wrap" }, details.join("\n")), "info");
			window.setTimeout(function() {
				window.location.reload();
			}, 1200);
		});
	},

	render: function(result) {
		var entries = result.entries || [];
		var tableRows;
		var readyCount = 0;
		var rows = entries.map(function(entry) {
			if (entry.status === "ready")
				readyCount++;

			return E("tr", { "class": "tr" }, [
				E("td", { "class": "td left" }, [ warningIcon(entry), " ", entry.source || "" ]),
				E("td", { "class": "td left" }, entry.family || ""),
				E("td", { "class": "td left" }, entry.status || ""),
				E("td", { "class": "td left" }, entry.name || ""),
				E("td", { "class": "td left" }, entry.mac || entry.duid || ""),
				E("td", { "class": "td left" }, entry.ip || entry.hostid || ""),
				E("td", { "class": "td left" }, (entry.warnings || []).join("; "))
			]);
		});

		tableRows = [
			E("tr", { "class": "tr table-titles" }, [
				E("th", { "class": "th left" }, _("Source")),
				E("th", { "class": "th left" }, _("Family")),
				E("th", { "class": "th left" }, _("Status")),
				E("th", { "class": "th left" }, _("Name")),
				E("th", { "class": "th left" }, _("Identifier")),
				E("th", { "class": "th left" }, _("Address")),
				E("th", { "class": "th left" }, _("Warnings"))
			])
		];

		if (rows.length) {
			rows.forEach(function(row) {
				tableRows.push(row);
			});
		}
		else {
			tableRows.push(E("tr", { "class": "tr" }, [
				E("td", { "class": "td left", "colspan": "7" }, _("No dnsmasq static leases were found."))
			]));
		}

		return E("div", {}, [
			E("h2", _("Import dnsmasq Static Leases")),
			E("p", _("This is a dry-run preview. Entries that cannot be safely represented as Kea reservations are marked disabled with warnings.")),
			E("div", { "class": "cbi-section" }, [
				E("table", { "class": "table" }, tableRows)
			]),
			E("div", { "class": "cbi-page-actions" }, [
				E("button", {
					"class": "btn cbi-button cbi-button-apply",
					"disabled": readyCount > 0 ? null : "disabled",
					"click": function(ev) {
						ev.preventDefault();
						return this.commitImport();
					}.bind(this)
				}, _("Import Ready Entries"))
			])
		]);
	}
});
