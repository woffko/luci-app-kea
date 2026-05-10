"use strict";
"require rpc";
"require view";

var callImportDryRun = rpc.declare({
	object: "luci.kea",
	method: "importDnsmasqDryRun",
	expect: { import: {} }
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

	render: function(result) {
		var entries = result.entries || [];
		var rows = entries.map(function(entry) {
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

		return E("div", {}, [
			E("h2", _("Import dnsmasq Static Leases")),
			E("p", _("This is a dry-run preview. Entries that cannot be safely represented as Kea reservations are marked disabled with warnings.")),
			E("div", { "class": "cbi-section" }, [
				E("table", { "class": "table" }, [
					E("tr", { "class": "tr table-titles" }, [
						E("th", { "class": "th left" }, _("Source")),
						E("th", { "class": "th left" }, _("Family")),
						E("th", { "class": "th left" }, _("Status")),
						E("th", { "class": "th left" }, _("Name")),
						E("th", { "class": "th left" }, _("Identifier")),
						E("th", { "class": "th left" }, _("Address")),
						E("th", { "class": "th left" }, _("Warnings"))
					]),
					rows.length ? rows : E("tr", { "class": "tr" }, [
						E("td", { "class": "td left", "colspan": "7" }, _("No dnsmasq static leases were found."))
					])
				])
			])
		]);
	}
});

