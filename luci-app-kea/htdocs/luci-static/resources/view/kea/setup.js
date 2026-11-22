"use strict";
"require view";
"require ui";
"require kea.backend as backend";
"require kea.dialogs as dialogs";

/*
 * Make the DHCPv4 configuration of Kea from what dnsmasq is set up to
 * serve: the same as the command setup-from-dnsmasq, which ha-cluster runs
 * when a cluster moves to Kea. The page shows what would be written and
 * what is not carried over. It writes the file while it is missing or still
 * the example the Kea package installed; a file someone has changed only
 * after the user confirmed it, with the file kept as a backup. The command
 * never replaces such a file.
 */

var STATES = {
	missing: _("There is no DHCPv4 configuration file yet. The one below can be written."),
	sample: _("The DHCPv4 configuration file is still the example the Kea package installed. It can be replaced by the one below; the example is kept as a backup."),
	own: _("The DHCPv4 configuration file has been changed. Take what is shown below over by hand on the DHCPv4 page or on the Configuration page, or replace the file with it; the file is then kept as a backup.")
};

function cells(values) {
	return E("tr", { "class": "tr" }, values.map(function(value) {
		return E("td", { "class": "td left" }, [ value == null || value === "" ? "-" : String(value) ]);
	}));
}

function heads(values) {
	return E("tr", { "class": "tr table-titles" }, values.map(function(value) {
		return E("th", { "class": "th left" }, [ value ]);
	}));
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	/*
	 * ha-cluster answers through rpcd, which reloads for a moment when a
	 * package is installed; ask once more after a pause before taking no
	 * answer for no cluster.
	 */
	nodes: function(installed) {
		return backend.getHaNodes().then(function(cluster) {
			if (!installed || (cluster && cluster.node))
				return cluster;

			return new Promise(function(resolve) {
				window.setTimeout(resolve, 2000);
			}).then(function() {
				return backend.getHaNodes();
			});
		});
	},

	load: function() {
		var self = this;

		return backend.getStatus().then(function(status) {
			var installed = !!(status && status.ha_cluster);

			return self.nodes(installed).then(function(cluster) {
				return Promise.all([
					backend.setupFromDnsmasq(true, cluster),
					backend.getServices(),
					cluster,
					installed && !(cluster && cluster.node)
				]);
			});
		});
	},

	/* A file of the user's own is replaced only after they confirmed it. */
	handleReplace: function() {
		var self = this;

		return dialogs.ask(_("Replace the configuration"), [
			E("p", {}, [ _("The DHCPv4 configuration file has been changed by hand or by another tool. It is replaced by the configuration shown on this page; what it holds now is kept as a backup, which the Configuration page can restore.") ]),
			E("p", {}, [ _("Everything the file has beyond what dnsmasq is set up to serve is gone from the new one: reservations, other options, high availability set up by hand.") ])
		], _("Replace")).then(function(confirmed) {
			return confirmed ? self.handleWrite(true) : null;
		});
	},

	handleWrite: function(replace) {
		var self = this;

		return backend.setupFromDnsmasq(false, this.cluster, replace === true).then(function(reply) {
			if (!reply || !reply.result) {
				backend.notifyFailure(reply ? { error: reply.reason, validation: reply.validation } : null,
					_("The configuration was not written."));
				return;
			}

			if (reply.reason !== "written") {
				ui.addNotification(null, E("p", {}, [ reply.reason === "own-config" ?
					_("The file has been changed meanwhile, so it was not replaced.") :
					_("There was nothing to write.") ]), "warning");
				return;
			}

			ui.addNotification(null, E("p", {}, [ _("The DHCPv4 configuration is written. Next: import the static leases, switch the DHCP of dnsmasq off for these interfaces, and start kea-dhcp4 on the Services page.") ]), "info");

			return self.reload();
		});
	},

	handleMoveLeases: function() {
		return backend.moveDnsmasqLeases().then(function(reply) {
			var skipped = (reply && reply.skipped) || [];

			if (!reply || !reply.result) {
				ui.addNotification(null, E("p", {}, [ reply && reply.reason === "kea-not-running" ?
					_("kea-dhcp4 does not answer: start it first.") :
					_("The leases were not moved: %s").format((reply && reply.reason) || _("no answer")) ]), "danger");
				return;
			}

			ui.addNotification(null, E("div", {}, [
				E("p", {}, [ _("%d leases of dnsmasq are now leases of Kea.").format(reply.added) ]),
				skipped.length ? E("ul", {}, skipped.map(function(item) {
					return E("li", {}, [ item.address + ": " + item.reason ]);
				})) : ""
			]), "info");
		});
	},

	reload: function() {
		var self = this;

		return this.load().then(function(data) {
			self.node.replaceChildren(self.render(data));
		});
	},

	render: function(data) {
		var self = this;
		var reply = data[0] || {};
		var services = data[1] || {};
		var running = !!((services.dhcp4 || {}).running);
		var subnets = reply.subnets || [];
		var left = reply.left || [];
		var check = reply.check || {};
		var silent = !!data[3];
		var writable = reply.reason === "dry-run" && check.valid && !silent;
		var own = reply.state === "own";
		var body;

		this.cluster = data[2] || {};

		if (reply.reason === "nothing-to-set-up")
			body = E("p", {}, [ _("dnsmasq serves DHCPv4 on no interface that has a static IPv4 address, so there is nothing to make a configuration from.") ]);
		else if (!reply.result && reply.reason !== "dry-run")
			body = E("p", {}, [ _("The configuration could not be made: %s").format(reply.reason || _("no answer")) ]);
		else
			body = E("div", {}, [
				silent ? E("div", { "class": "alert-message warning kea-setup-no-cluster" }, [
					_("ha-cluster is installed but did not answer about its nodes, so the configuration below has no pair of Kea servers and is not offered for writing. Reload the page in a moment.") ]) : "",
				E("div", { "class": reply.state === "own" ? "alert-message warning" : "alert-message notice" },
					[ STATES[reply.state] || "" ]),
				E("table", { "class": "table kea-setup-subnets" }, [
					heads([ _("Interface"), _("Device"), _("Subnet"), _("Address pool") ])
				].concat(subnets.map(function(subnet) {
					return cells([ subnet.interface, subnet.device, subnet.subnet, subnet.pool || _("static leases only") ]);
				}))),
				E("p", {}, [ reply.ha ?
					_("High availability: hot standby, this server %s, peers %s.").format(reply.ha.this, reply.ha.peers.join(", ")) :
					_("High availability: none; ha-cluster names no pair.") ]),
				left.length ? E("div", { "class": "kea-setup-left" }, [
					E("h4", {}, [ _("Not carried over") ]),
					E("ul", {}, left.map(function(item) {
						return E("li", {}, [ item.what + ": " + item.why ]);
					}))
				]) : "",
				E("p", {}, [ check.valid ? _("Kea accepts this configuration.") : _("Kea does not accept this configuration:") ]),
				check.valid ? "" : E("pre", { "style": "white-space: pre-wrap" }, [ check.output || "" ]),
				E("details", {}, [
					E("summary", { "style": "cursor: pointer" }, [ _("The configuration file") ]),
					E("pre", { "class": "kea-setup-content", "style": "white-space: pre-wrap; max-height: 24rem; overflow: auto" },
						[ reply.content || "" ])
				]),
				writable ? E("div", { "class": "right" }, own ?
					E("button", {
						"class": "btn cbi-button cbi-button-negative kea-setup-replace",
						"click": ui.createHandlerFn(this, "handleReplace")
					}, [ _("Replace my configuration…") ]) :
					E("button", {
						"class": "btn cbi-button cbi-button-apply kea-setup-write",
						"click": ui.createHandlerFn(this, "handleWrite", false)
					}, [ _("Write the configuration") ])) : ""
			]);

		this.node = E("div", {}, [
			E("h2", {}, [ _("Kea Setup") ]),
			E("p", {}, [ _("Makes the DHCPv4 configuration of Kea from what dnsmasq is set up to serve: a subnet with its address pool for every interface, the lease times, the router, DNS server and domain the clients get, and, with ha-cluster, a pair of Kea servers in hot standby. Nothing changes until you write it, and Kea is not started.") ]),
			E("div", { "class": "cbi-section" }, [ E("h3", {}, [ _("DHCPv4 configuration") ]), body ]),
			E("div", { "class": "cbi-section" }, [
				E("h3", {}, [ _("Static leases and leases in use") ]),
				E("p", {}, [
					_("The static leases of OpenWrt become reservations on the"), " ",
					E("a", { "href": L.url("admin/services/kea/import-dnsmasq") }, [ _("Import dnsmasq") ]), " ",
					_("page. The leases dnsmasq has given out can be handed to Kea once kea-dhcp4 runs, so that the clients keep their addresses.")
				]),
				E("div", { "class": "right" }, E("button", {
					"class": "btn cbi-button cbi-button-action kea-setup-leases",
					"disabled": running ? null : "",
					"click": ui.createHandlerFn(self, "handleMoveLeases")
				}, [ _("Move the leases of dnsmasq to Kea") ])),
				running ? "" : E("p", { "class": "right" }, E("small", {}, [ _("kea-dhcp4 is not running.") ]))
			])
		]);

		return this.node;
	}
});
