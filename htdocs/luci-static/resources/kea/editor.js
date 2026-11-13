"use strict";
"require baseclass";
"require view";
"require ui";
"require kea.model as model";
"require kea.backend as backend";
"require kea.dialogs as dialogs";
"require kea.widgets as widgets";
"require kea.ha as haModel";
"require kea.hatab as hatab";

/*
 * Structured subnet editor shared by the DHCPv4 and DHCPv6 pages.
 *
 * The page shows one tab per OpenWrt interface, one per Kea subnet that is
 * not bound to an interface or belongs to a shared network, one for the
 * global settings and, where the hook is available, one for high
 * availability. Inputs write straight into the models of kea.model and
 * kea.ha, which check them and merge the changed values back into the
 * configuration.
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

/* The tab bar entries that are not subnets. */
var GLOBAL = "global";
var HA = "ha";

var field = widgets.field;
var mark = widgets.mark;
var textInput = widgets.textInput;
var checkbox = widgets.checkbox;
var notice = widgets.notice;
var rowTable = widgets.rowTable;

function createView(familyName) {
	var family = model.family(familyName);
	var page = PAGES[familyName];
	var isV4 = familyName === "dhcp4";

	return view.extend({
		load: function() {
			return Promise.all([
				backend.getConfig(familyName),
				backend.getInterfaces(),
				backend.getStatus()
			]);
		},

		/* Replace the page state with the configuration read from disk. */
		setConfig: function(response) {
			var parsed = model.parseConfig(response.content || "{}");

			this.parseError = parsed.error;
			this.config = parsed.config;
			this.hasComments = parsed.hasComments;
			this.tabs = parsed.error ? [] : model.buildTabs(familyName, parsed.config, this.interfaces);
			this.global = parsed.error ? null : model.buildGlobal(familyName, parsed.config);
			this.ha = parsed.error ? null : haModel.build(familyName, parsed.config);

			if (this.active === HA && !this.showsHa())
				this.active = 0;

			if (this.active !== GLOBAL && this.active !== HA)
				this.active = Math.min(this.active || 0, Math.max(this.tabs.length - 1, 0));
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

		/* ---- tab bar ---- */

		/*
		 * The high availability tab is offered when the hook is installed,
		 * or when the file already has an entry for it.
		 */
		showsHa: function() {
			var hooks = this.status.hooks || {};

			return !!this.ha && (!!hooks.ha || this.ha.present);
		},

		renderTabBar: function() {
			var self = this;
			var entry = function(key, label, removed) {
				return E("li", { "class": key === self.active ? "cbi-tab" : "cbi-tab-disabled" }, E("a", {
					"href": "#",
					"style": removed ? "text-decoration: line-through" : null,
					"click": function(ev) {
						ev.preventDefault();
						self.active = key;
						self.renderTabBar();
						self.renderTab();
					}
				}, label));
			};
			var entries = this.tabs.map(function(tab, index) {
				return entry(index, tab.label, tab.removed);
			});

			if (!this.parseError)
				entries.push(entry(GLOBAL, _("Global settings"), false));

			if (this.showsHa())
				entries.push(entry(HA, _("High availability"), false));

			this.tabBarNode.replaceChildren(
				E("ul", { "class": "cbi-tabmenu" }, entries),
				E("div", { "class": "right", "style": "margin: .5rem 0" }, this.parseError ? "" : E("button", {
					"class": "btn cbi-button",
					"click": function(ev) {
						ev.preventDefault();
						self.showChanges();
					}
				}, _("Show changes")))
			);
		},

		/* ---- a subnet tab ---- */

		/*
		 * OpenWrt answers DHCP on this interface too, and Kea is about to.
		 * Two servers on one network hand out conflicting leases.
		 */
		renderConflict: function(tab, node) {
			var conflicts = this.status.conflicts || {};
			var running = (conflicts.dnsmasq && conflicts.dnsmasq.running) ||
				(conflicts.odhcpd && conflicts.odhcpd.running);

			if (tab.enabled && tab.served && running)
				node.replaceChildren(notice("warning", E("p", _("OpenWrt also serves DHCP on this interface (dnsmasq or odhcpd). Two DHCP servers on one network hand out conflicting leases. Switch the OpenWrt service off for this interface, or stop it on the Services page, before Kea answers here."))));
			else
				node.replaceChildren();
		},

		renderFields: function(tab) {
			var self = this;
			var conflictNode = E("div", {});
			var check = function(name) {
				return function() {
					return model.fieldError(familyName, tab, name);
				};
			};
			var input = function(name, placeholder, type) {
				return field(model.label(name), textInput(tab, name, placeholder, type, check(name)));
			};
			var nodes;

			this.renderConflict(tab, conflictNode);

			nodes = [
				conflictNode,
				field(_("Enable"), E("label", {}, [ checkbox(tab, "enabled", function() {
					self.renderConflict(tab, conflictNode);
				}), " ", page.enable ])),
				input("device", "br-lan"),
				input("subnet", isV4 ? "192.168.1.0/24" : "fd00:1234:abcd:1::/64")
			];

			if (isV4)
				nodes.push(
					input("router", "192.168.1.1"),
					input("dnsServers", "192.168.1.1, 1.1.1.1"),
					input("domainName", "lan"),
					input("domainSearch", "lan, example.org")
				);
			else
				nodes.push(
					input("dnsServers", "fd00:1234:abcd:1::1, 2001:4860:4860::8888"),
					input("domainSearch", "lan, example.org")
				);

			nodes.push(
				input("renewTimer", tab.defaults.renewTimer, "number"),
				input("rebindTimer", tab.defaults.rebindTimer, "number")
			);

			if (!isV4)
				nodes.push(input("preferredLifetime", tab.defaults.preferredLifetime, "number"));

			nodes.push(field(model.label("validLifetime"),
				textInput(tab, "validLifetime", tab.defaults.validLifetime, "number", check("validLifetime")),
				_("Timers are in seconds. Empty fields use the global Kea value shown as placeholder.")));

			return nodes;
		},

		renderPools: function(tab) {
			return rowTable({
				name: "kea-pools",
				title: _("Address Pools"),
				titles: [ _("Range or prefix") ],
				rows: tab.pools,
				empty: _("No address pools: Kea hands out no dynamic addresses in this subnet."),
				add: _("Add Pool"),
				create: function() {
					return model.newPool();
				},
				renderRow: function(row) {
					return [ textInput(row, "pool",
						isV4 ? "192.168.1.100 - 192.168.1.199" : "fd00:1234:abcd:1::100 - fd00:1234:abcd:1::ffff",
						null, function() {
							return model.poolError(familyName, tab, row);
						}) ];
				}
			});
		},

		renderPdPools: function(tab) {
			return rowTable({
				name: "kea-pd-pools",
				title: _("Prefix Delegation"),
				titles: [ _("Prefix"), _("Prefix length"), _("Delegated length") ],
				rows: tab.pdPools,
				empty: _("No prefix delegation pools."),
				add: _("Add Prefix Pool"),
				create: function() {
					return model.newPdPool();
				},
				renderRow: function(row) {
					var check = function() {
						return model.pdPoolError(row);
					};

					return [
						textInput(row, "prefix", "fd00:1234:abcd:100::", null, check),
						textInput(row, "prefixLen", "56", "number", check),
						textInput(row, "delegatedLen", "64", "number", check)
					];
				}
			});
		},

		renderOptions: function(rows, description) {
			return rowTable({
				name: "kea-options",
				title: _("Other Options"),
				description: description,
				titles: [ _("Name or code"), _("Value") ],
				rows: rows,
				empty: _("No other options."),
				add: _("Add Option"),
				create: function() {
					return model.newOption();
				},
				renderRow: function(row) {
					return [
						textInput(row, "name", "ntp-servers", null, function() {
							return model.optionError(row);
						}),
						textInput(row, "data", "192.168.1.1")
					];
				}
			});
		},

		renderReservations: function(tab) {
			var titles = [ _("Hostname"), _("Identifier") ];
			var check = function(row, name) {
				return function() {
					return model.reservationError(familyName, tab, row, name);
				};
			};

			if (isV4)
				titles.push(_("IPv4 Address"));
			else
				titles.push(_("IPv6 Addresses"), _("Prefixes"));

			titles.push(_("Enabled"));

			return rowTable({
				name: "kea-reservations",
				title: _("Static Reservations"),
				description: _("A reservation that is not enabled is kept in the configuration file but not used by Kea."),
				titles: titles,
				rows: tab.reservations,
				empty: _("No static reservations."),
				add: _("Add Reservation"),
				create: function() {
					return model.newReservation(familyName);
				},
				renderRow: function(row) {
					var identity = textInput(row, "identity", isV4 ? "00:11:22:33:44:55" : "00:03:00:01:...",
						null, check(row, "identity"));
					var cells = [
						textInput(row, "hostname"),
						[
							E("select", {
								"class": "cbi-input-select",
								"change": function(ev) {
									row.type = ev.target.value;

									if (row.identity !== "")
										mark(identity, model.reservationError(familyName, tab, row, "identity"));
								}
							}, family.idTypes.map(function(type) {
								return E("option", {
									"value": type,
									"selected": row.type === type ? "selected" : null
								}, ID_TYPE_LABELS[type]);
							})),
							" ",
							identity
						]
					];

					if (isV4)
						cells.push(textInput(row, "address", "192.168.1.10", null, check(row, "address")));
					else
						cells.push(
							textInput(row, "addresses", "fd00:1234:abcd:1::100", null, check(row, "addresses")),
							textInput(row, "prefixes", "fd00:1234:abcd:100::/64", null, check(row, "prefixes"))
						);

					cells.push(checkbox(row, "enabled"));

					return cells;
				}
			});
		},

		renderSubnet: function(tab) {
			var self = this;
			var nodes;

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

			nodes = [
				E("div", { "class": "cbi-section" }, [ E("h3", tab.label) ].concat(
					this.renderFields(tab),
					tab.source ? [ field("", E("button", {
						"class": "btn cbi-button cbi-button-remove",
						"click": function(ev) {
							ev.preventDefault();
							dialogs.confirm(_("Remove subnet"),
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
				this.renderPools(tab)
			];

			if (!isV4)
				nodes.push(this.renderPdPools(tab));

			nodes.push(
				this.renderOptions(tab.options,
					_("DHCP options of this subnet that have no field above. Use the option name or its numeric code.")),
				this.renderReservations(tab)
			);

			this.editorNode.replaceChildren.apply(this.editorNode, nodes);
		},

		/* ---- the global settings tab ---- */

		renderGlobal: function() {
			var global = this.global;
			var check = function(name) {
				return function() {
					return model.fieldError(familyName, global, name);
				};
			};
			var input = function(name, placeholder) {
				return field(model.label(name), textInput(global, name, placeholder, "number", check(name)));
			};
			var nodes = [
				E("h3", _("Global settings")),
				E("div", { "class": "cbi-section-descr" },
					_("Values for every subnet that does not set its own.")),
				input("renewTimer", "900"),
				input("rebindTimer", "1800")
			];

			if (!isV4)
				nodes.push(input("preferredLifetime", "3000"));

			nodes.push(
				input("validLifetime", "3600"),
				field(model.label("lfcInterval"),
					textInput(global, "lfcInterval", "3600", "number", check("lfcInterval")),
					_("How often, in seconds, the lease file is compacted; 0 turns it off. Needs the kea-lfc package.") +
						(global.leaseType && global.leaseType !== "memfile" ?
							" " + _("The lease database is not a memfile, so this setting has no effect.") : ""))
			);

			this.editorNode.replaceChildren(
				E("div", { "class": "cbi-section" }, nodes),
				this.renderOptions(global.options,
					_("DHCP options sent to the clients of every subnet. Use the option name or its numeric code."))
			);
		},

		renderHa: function() {
			var self = this;
			var nodes = hatab.render(familyName, this.ha, this.status.hooks || {}, function() {
				self.renderHa();
			});

			this.editorNode.replaceChildren.apply(this.editorNode, nodes);
		},

		renderTab: function() {
			if (this.parseError)
				this.editorNode.replaceChildren();
			else if (this.active === GLOBAL)
				this.renderGlobal();
			else if (this.active === HA)
				this.renderHa();
			else if (this.tabs[this.active])
				this.renderSubnet(this.tabs[this.active]);
			else
				this.editorNode.replaceChildren();
		},

		/* ---- saving ---- */

		/* Merge the form into the configuration; null if the form has errors. */
		buildConfig: function() {
			var result = model.applyTabs(familyName, this.config, this.tabs, this.global);
			var hooks = this.status.hooks || {};
			var withHa = haModel.apply(familyName, result.config || this.config, this.ha, hooks.dir);
			var errors = (result.errors || []).concat(withHa.errors || []);

			if (errors.length) {
				ui.addNotification(null, E("pre", {
					"style": "white-space: pre-wrap"
				}, errors.join("\n")), "danger");
				return null;
			}

			return withHa.config;
		},

		showChanges: function() {
			var config = this.buildConfig();

			if (config)
				dialogs.showChanges(
					model.lineDiff(model.serialize(this.config), model.serialize(config)),
					this.hasComments ?
						_("Compared without the comments of the file, which a save removes.") : null);
		},

		write: function(config, apply) {
			var self = this;

			return backend.saveConfig(familyName, model.serialize(config)).then(function(saved) {
				/* Kea refused the file: the form keeps what was typed. */
				if (!saved)
					return;

				if (!apply)
					backend.notify(backend.daemonName(familyName) + ": " +
						_("configuration saved. Reload or restart Kea to apply it."));

				return Promise.resolve(apply ? backend.applyConfig(familyName) : null).then(function() {
					return self.reload();
				});
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

			dialogs.confirm(_("Remove example entries"),
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
			this.status = data[2] || {};
			this.active = 0;
			this.noticesNode = E("div", {});
			this.tabBarNode = E("div", {});
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
