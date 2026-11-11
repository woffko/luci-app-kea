"use strict";
"require baseclass";
"require view";
"require ui";
"require kea.model as model";
"require kea.backend as backend";

/*
 * Structured subnet editor shared by the DHCPv4 and DHCPv6 pages.
 *
 * The page shows one tab per OpenWrt interface plus one per Kea subnet that
 * is not bound to an interface. Inputs write straight into the tab model;
 * kea.model merges the changed values back into the Kea configuration.
 */

var ID_TYPE_LABELS = {
	"hw-address": _("MAC address"),
	"client-id": _("Client ID"),
	"duid": _("DUID"),
	"circuit-id": _("Circuit ID"),
	"flex-id": _("Flex ID")
};

var PAGES = {
	dhcp4: {
		title: _("Kea DHCPv4"),
		enable: _("Enable DHCPv4 server on this interface"),
		unparsable: _("The DHCPv4 config cannot be parsed by the structured editor. Use the Configuration page to fix it.")
	},
	dhcp6: {
		title: _("Kea DHCPv6"),
		enable: _("Enable DHCPv6 server on this interface"),
		unparsable: _("The DHCPv6 config cannot be parsed by the structured editor. Use the Configuration page to fix it.")
	}
};

function field(label, child, description) {
	return E("div", { "class": "cbi-value" }, [
		E("label", { "class": "cbi-value-title" }, label),
		E("div", { "class": "cbi-value-field" }, [
			child,
			description ? E("div", { "class": "cbi-value-description" }, description) : ""
		])
	]);
}

/* Text input bound to object[key]. */
function textInput(object, key, placeholder, type) {
	return E("input", {
		"class": "cbi-input-text",
		"type": type || "text",
		"min": type === "number" ? "0" : null,
		"value": object[key],
		"placeholder": placeholder || "",
		"input": function(ev) {
			object[key] = ev.target.value.trim();
		}
	});
}

function checkbox(object, key, onChange) {
	return E("input", {
		"type": "checkbox",
		"checked": object[key] ? "checked" : null,
		"change": function(ev) {
			object[key] = ev.target.checked;

			if (onChange)
				onChange();
		}
	});
}

function confirmModal(title, message, confirmLabel, action) {
	ui.showModal(title, [
		E("p", message),
		E("div", { "class": "right" }, [
			E("button", { "class": "btn", "click": ui.hideModal }, _("Cancel")),
			" ",
			E("button", {
				"class": "btn cbi-button-negative important",
				"click": function() {
					ui.hideModal();
					action();
				}
			}, confirmLabel)
		])
	]);
}

function notice(kind, children) {
	return E("div", { "class": "alert-message " + kind }, children);
}

function createView(familyName) {
	var family = model.family(familyName);
	var page = PAGES[familyName];
	var isV4 = familyName === "dhcp4";

	return view.extend({
		load: function() {
			return Promise.all([
				backend.getConfig(familyName),
				backend.getInterfaces()
			]);
		},

		/* Replace the page state with the configuration read from disk. */
		setConfig: function(response) {
			var parsed = model.parseConfig(response.content || "{}");

			this.parseError = parsed.error;
			this.config = parsed.config;
			this.hasComments = parsed.hasComments;
			this.tabs = parsed.error ? [] : model.buildTabs(familyName, parsed.config, this.interfaces);
			this.activeIndex = Math.min(this.activeIndex || 0, Math.max(this.tabs.length - 1, 0));
		},

		reload: function() {
			var self = this;

			return backend.getConfig(familyName).then(function(response) {
				self.setConfig(response);
				self.redraw();
			});
		},

		redraw: function() {
			this.renderNotices();
			this.renderTabBar();
			this.renderTab();
		},

		/* ---- notices ---- */

		renderNotices: function() {
			var self = this;
			var nodes = [];
			var samples;

			if (this.parseError) {
				this.noticesNode.replaceChildren(notice("warning", [
					E("p", page.unparsable),
					E("pre", { "style": "white-space: pre-wrap" }, this.parseError)
				]));
				return;
			}

			samples = model.countSamples(familyName, this.config);

			if (samples.subnets + samples.options + samples.classes > 0)
				nodes.push(notice("warning", [
					E("p", _("This configuration still contains example entries shipped with Kea: a subnet from a documentation address range, example global options or an example client class. Example global options are handed to the clients of every subnet that does not override them.")),
					E("button", {
						"class": "btn cbi-button cbi-button-remove",
						"click": function(ev) {
							ev.preventDefault();
							self.removeSamples();
						}
					}, _("Remove example entries"))
				]));

			if (this.hasComments)
				nodes.push(notice("info", E("p", _("The configuration file contains comments. Saving from this page rewrites the file as plain JSON and removes them."))));

			if (model.listensOnAll(familyName, this.config))
				nodes.push(notice("info", E("p", _("Kea is configured to listen on all interfaces (\"*\"). The per-interface checkbox below does not restrict it."))));

			this.noticesNode.replaceChildren.apply(this.noticesNode, nodes);
		},

		/* ---- tabs ---- */

		renderTabBar: function() {
			var self = this;

			this.tabBarNode.replaceChildren.apply(this.tabBarNode, this.tabs.map(function(tab, index) {
				return E("button", {
					"class": "btn cbi-button " + (index === self.activeIndex ? "cbi-button-apply" : ""),
					"style": "margin-right: .35rem; margin-bottom: .35rem" +
						(tab.removed ? "; text-decoration: line-through" : ""),
					"click": function(ev) {
						ev.preventDefault();
						self.activeIndex = index;
						self.renderTabBar();
						self.renderTab();
					}
				}, tab.label);
			}));
		},

		renderFields: function(tab) {
			var nodes = [
				field(_("Enable"), E("label", {}, [ checkbox(tab, "enabled"), " ", page.enable ])),
				field(_("Interface"), textInput(tab, "device", "br-lan")),
				field(_("Subnet"), textInput(tab, "subnet", isV4 ? "192.168.1.0/24" : "fd00:1234:abcd:1::/64"))
			];

			if (isV4) {
				nodes.push(
					field(_("Address Pool"), E("span", {}, [
						textInput(tab, "poolStart", "192.168.1.100"),
						" ", _("to"), " ",
						textInput(tab, "poolEnd", "192.168.1.199")
					])),
					field(_("Gateway"), textInput(tab, "router", "192.168.1.1")),
					field(_("DNS Servers"), textInput(tab, "dnsServers", "192.168.1.1, 1.1.1.1")),
					field(_("Domain Name"), textInput(tab, "domainName", "lan")),
					field(_("Domain Search"), textInput(tab, "domainSearch", "lan, example.org"))
				);
			}
			else {
				nodes.push(
					field(_("Address Pool"), textInput(tab, "pool", "fd00:1234:abcd:1::100 - fd00:1234:abcd:1::ffff")),
					field(_("Prefix Delegation"), E("span", {}, [
						textInput(tab, "pdPrefix", "fd00:1234:abcd:100::"),
						" ",
						textInput(tab, "pdPrefixLen", "56", "number"),
						" ",
						textInput(tab, "pdDelegatedLen", "64", "number")
					]), _("Prefix, prefix length, and delegated prefix length.")),
					field(_("DNS Servers"), textInput(tab, "dnsServers", "fd00:1234:abcd:1::1, 2001:4860:4860::8888")),
					field(_("Domain Search"), textInput(tab, "domainSearch", "lan, example.org"))
				);
			}

			nodes.push(
				field(_("Renew Timer"), textInput(tab, "renewTimer", tab.defaults.renewTimer, "number")),
				field(_("Rebind Timer"), textInput(tab, "rebindTimer", tab.defaults.rebindTimer, "number"))
			);

			if (!isV4)
				nodes.push(field(_("Preferred Lifetime"), textInput(tab, "preferredLifetime", tab.defaults.preferredLifetime, "number")));

			nodes.push(field(_("Valid Lifetime"), textInput(tab, "validLifetime", tab.defaults.validLifetime, "number"),
				_("Timers are in seconds. Empty fields use the global Kea value shown as placeholder.")));

			return nodes;
		},

		renderReservationRow: function(tab, row, body) {
			var self = this;
			var cells = [
				E("td", { "class": "td left" }, textInput(row, "hostname")),
				E("td", { "class": "td left" }, [
					E("select", {
						"class": "cbi-input-select",
						"change": function(ev) {
							row.type = ev.target.value;
						}
					}, family.idTypes.map(function(type) {
						return E("option", {
							"value": type,
							"selected": row.type === type ? "selected" : null
						}, ID_TYPE_LABELS[type]);
					})),
					" ",
					textInput(row, "identity", isV4 ? "00:11:22:33:44:55" : "00:03:00:01:...")
				])
			];

			if (isV4) {
				cells.push(E("td", { "class": "td left" }, textInput(row, "address", "192.168.1.10")));
			}
			else {
				cells.push(
					E("td", { "class": "td left" }, textInput(row, "addresses", "fd00:1234:abcd:1::100")),
					E("td", { "class": "td left" }, textInput(row, "prefixes", "fd00:1234:abcd:100::/64"))
				);
			}

			cells.push(
				E("td", { "class": "td left" }, checkbox(row, "enabled")),
				E("td", { "class": "td right" }, E("button", {
					"class": "btn cbi-button cbi-button-remove",
					"click": function(ev) {
						ev.preventDefault();
						tab.reservations.splice(tab.reservations.indexOf(row), 1);
						self.renderReservationRows(tab, body);
					}
				}, _("Delete")))
			);

			return E("tr", { "class": "tr" }, cells);
		},

		renderReservationRows: function(tab, body) {
			var self = this;
			var rows = tab.reservations.map(function(row) {
				return self.renderReservationRow(tab, row, body);
			});

			if (!rows.length)
				rows = [ E("tr", { "class": "tr" }, [
					E("td", { "class": "td left", "colspan": isV4 ? "5" : "6" }, _("No static reservations."))
				]) ];

			body.replaceChildren.apply(body, rows);
		},

		renderReservations: function(tab) {
			var self = this;
			var body = E("tbody", {});
			var titles = [ _("Hostname"), _("Identifier") ];

			if (isV4)
				titles.push(_("IPv4 Address"));
			else
				titles.push(_("IPv6 Addresses"), _("Prefixes"));

			titles.push(_("Enabled"), "");

			this.renderReservationRows(tab, body);

			return E("div", { "class": "cbi-section" }, [
				E("h3", _("Static Reservations")),
				E("div", { "class": "cbi-section-descr" },
					_("A reservation that is not enabled is kept in the configuration file but not used by Kea.")),
				E("table", { "class": "table" }, [
					E("thead", {}, E("tr", { "class": "tr table-titles" }, titles.map(function(title, index) {
						return E("th", {
							"class": "th " + (index === titles.length - 1 ? "right" : "left")
						}, title);
					}))),
					body
				]),
				E("div", { "class": "cbi-section-create" }, E("button", {
					"class": "btn cbi-button cbi-button-add",
					"click": function(ev) {
						ev.preventDefault();
						tab.reservations.push(model.newReservation(familyName));
						self.renderReservationRows(tab, body);
					}
				}, _("Add Reservation")))
			]);
		},

		renderTab: function() {
			var self = this;
			var tab = this.tabs[this.activeIndex];

			if (!tab) {
				this.editorNode.replaceChildren();
				return;
			}

			if (tab.removed) {
				this.editorNode.replaceChildren(E("div", { "class": "cbi-section" }, [
					E("h3", tab.label),
					notice("warning", [
						E("p", _("This subnet will be removed from the Kea configuration when you save.")),
						E("button", {
							"class": "btn cbi-button",
							"click": function(ev) {
								ev.preventDefault();
								tab.removed = false;
								self.renderTabBar();
								self.renderTab();
							}
						}, _("Keep the subnet"))
					])
				]));
				return;
			}

			this.editorNode.replaceChildren(
				E("div", { "class": "cbi-section" }, [ E("h3", tab.label) ].concat(
					this.renderFields(tab),
					tab.source ? [ field("", E("button", {
						"class": "btn cbi-button cbi-button-remove",
						"click": function(ev) {
							ev.preventDefault();
							confirmModal(_("Remove subnet"),
								_("Remove this subnet with all its pools, options and reservations from the Kea configuration? Nothing is written until you save."),
								_("Remove subnet"),
								function() {
									tab.removed = true;
									self.renderTabBar();
									self.renderTab();
								});
						}
					}, _("Remove subnet"))) ] : []
				)),
				this.renderReservations(tab)
			);
		},

		/* ---- saving ---- */

		/* Merge the form into the configuration; null if the form has errors. */
		buildConfig: function() {
			var result = model.applyTabs(familyName, this.config, this.tabs);

			if (result.errors) {
				ui.addNotification(null, E("pre", {
					"style": "white-space: pre-wrap"
				}, result.errors.join("\n")), "danger");
				return null;
			}

			return result.config;
		},

		write: function(config, apply) {
			var self = this;

			return backend.saveConfig(familyName, model.serialize(config)).then(function(saved) {
				if (!saved)
					return;

				if (apply)
					return backend.applyConfig(familyName);

				backend.notify(backend.daemonName(familyName) + ": " +
					_("configuration saved. Reload or restart Kea to apply it."));
			}).then(function() {
				return self.reload();
			});
		},

		save: function(apply) {
			var config;

			if (this.parseError)
				return Promise.resolve();

			config = this.buildConfig();

			if (!config)
				return Promise.resolve();

			if (model.deepEqual(config, this.config)) {
				backend.notify(_("There are no changes to save."));
				return Promise.resolve();
			}

			return this.write(config, apply);
		},

		removeSamples: function() {
			var self = this;

			confirmModal(_("Remove example entries"),
				_("Remove the example subnet, example global options and example client class shipped with Kea, and save the configuration together with your current changes?"),
				_("Remove and save"),
				function() {
					var config = self.buildConfig();

					if (config)
						return self.write(model.removeSamples(familyName, config), false);
				});
		},

		handleSave: function(ev) {
			return this.save(false);
		},

		handleSaveApply: function(ev, mode) {
			return this.save(true);
		},

		handleReset: function(ev) {
			return this.reload();
		},

		render: function(data) {
			this.interfaces = data[1] || [];
			this.activeIndex = 0;
			this.noticesNode = E("div", {});
			this.tabBarNode = E("div", { "class": "cbi-section" });
			this.editorNode = E("div", {});

			this.setConfig(data[0] || {});
			this.redraw();

			return E("div", {}, [
				E("h2", page.title),
				this.noticesNode,
				this.tabBarNode,
				this.editorNode
			]);
		}
	});
}

return baseclass.extend({
	createView: createView
});
