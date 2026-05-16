"use strict";
"require rpc";
"require view";
"require ui";

var callGetConfig = rpc.declare({
	object: "luci.kea",
	method: "getConfig",
	params: [ "name" ],
	expect: { "": {} }
});

var callSaveConfig = rpc.declare({
	object: "luci.kea",
	method: "saveConfig",
	params: [ "name", "content" ],
	expect: { "": {} }
});

var callNetworkInterfaces = rpc.declare({
	object: "luci.kea",
	method: "getNetworkInterfaces",
	expect: { interfaces: {} }
});

function stripJsonComments(text) {
	var out = "";
	var inString = false;
	var escaped = false;
	var i, ch, next;

	for (i = 0; i < text.length; i++) {
		ch = text.charAt(i);
		next = text.charAt(i + 1);

		if (inString) {
			out += ch;

			if (escaped) {
				escaped = false;
			}
			else if (ch === "\\") {
				escaped = true;
			}
			else if (ch === "\"") {
				inString = false;
			}

			continue;
		}

		if (ch === "\"") {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === "/" && next === "/") {
			while (i < text.length && text.charAt(i) !== "\n")
				i++;
			out += "\n";
			continue;
		}

		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text.charAt(i) === "*" && text.charAt(i + 1) === "/"))
				i++;
			i++;
			continue;
		}

		out += ch;
	}

	return out;
}

function parseKeaConfig(content) {
	try {
		return {
			config: JSON.parse(stripJsonComments(content || "{}")),
			error: null
		};
	}
	catch (e) {
		return {
			config: null,
			error: e.message
		};
	}
}

function cloneObject(value) {
	return JSON.parse(JSON.stringify(value || {}));
}

function arrayContains(list, value) {
	var i;

	for (i = 0; i < list.length; i++)
		if (list[i] === value)
			return true;

	return false;
}

function optionValue(options, name) {
	var i, opt;

	for (i = 0; i < (options || []).length; i++) {
		opt = options[i] || {};
		if (opt.name === name)
			return opt.data || "";
	}

	return "";
}

function addOption(options, name, value) {
	if (!value)
		return;

	options.push({
		name: name,
		data: value
	});
}

function poolParts(subnet) {
	var pool = subnet && subnet.pools && subnet.pools[0] && subnet.pools[0].pool || "";
	var parts = pool.split(/\s*-\s*/);

	return {
		start: parts[0] || "",
		end: parts[1] || ""
	};
}

function interfaceLabel(item) {
	if (!item)
		return _("Manual");

	if (item.device && item.device !== item.name)
		return item.name + " (" + item.device + ")";

	return item.name || item.device || _("Interface");
}

function ipv4ToInt(addr) {
	var parts = String(addr || "").split(".");
	var value = 0;
	var i, octet;

	if (parts.length !== 4)
		return null;

	for (i = 0; i < 4; i++) {
		if (!/^\d+$/.test(parts[i]))
			return null;

		octet = Number(parts[i]);
		if (octet < 0 || octet > 255)
			return null;

		value = ((value << 8) | octet) >>> 0;
	}

	return value >>> 0;
}

function maskFromPrefix(prefix) {
	prefix = Number(prefix);

	if (prefix < 0 || prefix > 32 || isNaN(prefix))
		return null;

	if (prefix === 0)
		return 0;

	return (0xffffffff << (32 - prefix)) >>> 0;
}

function parseCidr(value) {
	var parts = String(value || "").trim().split("/");
	var ip = ipv4ToInt(parts[0]);
	var prefix = parts.length > 1 ? Number(parts[1]) : 32;
	var mask = maskFromPrefix(prefix);

	if (ip === null || mask === null)
		return null;

	return {
		network: (ip & mask) >>> 0,
		prefix: prefix
	};
}

function interfaceNetworks(tab) {
	var values = String(tab.ipaddr || "").trim().split(/\s+/);
	var networks = [];
	var i, cidr;

	for (i = 0; i < values.length; i++) {
		if (!values[i])
			continue;

		cidr = parseCidr(values[i]);
		if (cidr)
			networks.push(cidr);
	}

	return networks;
}

function findTabBySubnet(tabs, subnet) {
	var target = parseCidr(subnet && subnet.subnet);
	var i, j, networks;

	if (!target)
		return null;

	for (i = 0; i < tabs.length; i++) {
		if (tabs[i].subnet)
			continue;

		networks = interfaceNetworks(tabs[i]);
		for (j = 0; j < networks.length; j++) {
			if (networks[j].prefix === target.prefix && networks[j].network === target.network)
				return tabs[i];
		}
	}

	return null;
}

function isDocumentationSubnet4(subnet) {
	var addr = String(subnet && subnet.subnet || "").trim().split("/")[0];

	return /^192\.0\.2\./.test(addr) ||
		/^198\.51\.100\./.test(addr) ||
		/^203\.0\.113\./.test(addr);
}

function makeBaseTab(item) {
	return {
		name: item && item.name || "",
		device: item && item.device || "",
		ipaddr: item && item.ipaddr || "",
		label: interfaceLabel(item),
		enabled: false,
		subnetId: null,
		subnet: "",
		poolStart: "",
		poolEnd: "",
		router: "",
		dnsServers: "",
		domainName: "",
		domainSearch: "",
		renewTimer: "",
		rebindTimer: "",
		validLifetime: "",
		reservations: []
	};
}

function applySubnet(tab, subnet, dhcp4) {
	var parts = poolParts(subnet);
	var reservations = subnet.reservations || [];

	tab.subnetId = subnet.id || null;
	tab.subnet = subnet.subnet || "";
	tab.poolStart = parts.start;
	tab.poolEnd = parts.end;
	tab.router = optionValue(subnet["option-data"], "routers");
	tab.dnsServers = optionValue(subnet["option-data"], "domain-name-servers");
	tab.domainName = optionValue(subnet["option-data"], "domain-name");
	tab.domainSearch = optionValue(subnet["option-data"], "domain-search");
	tab.renewTimer = subnet["renew-timer"] || dhcp4["renew-timer"] || "";
	tab.rebindTimer = subnet["rebind-timer"] || dhcp4["rebind-timer"] || "";
	tab.validLifetime = subnet["valid-lifetime"] || dhcp4["valid-lifetime"] || "";
	tab.reservations = reservations.map(function(reservation) {
		return {
			enabled: true,
			hostname: reservation.hostname || "",
			mac: reservation["hw-address"] || "",
			ip: reservation["ip-address"] || ""
		};
	});
}

function buildTabs(config, interfaces) {
	var dhcp4 = config.Dhcp4 || {};
	var subnets = dhcp4.subnet4 || [];
	var enabledIfaces = dhcp4["interfaces-config"] && dhcp4["interfaces-config"].interfaces || [];
	var tabs = [];
	var byDevice = {};
	var i, item, tab, subnet, key;

	for (i = 0; i < interfaces.length; i++) {
		item = interfaces[i] || {};

		if (item.name === "loopback" || item.device === "lo")
			continue;

		tab = makeBaseTab(item);
		tab.enabled = arrayContains(enabledIfaces, item.device) || arrayContains(enabledIfaces, item.name);
		tabs.push(tab);

		if (item.device)
			byDevice[item.device] = tab;
		if (item.name)
			byDevice[item.name] = tab;
	}

	for (i = 0; i < subnets.length; i++) {
		subnet = subnets[i] || {};
		key = subnet["interface"] || subnet["interface-id"] || "";

		if (!key && isDocumentationSubnet4(subnet))
			continue;

		tab = key ? byDevice[key] : findTabBySubnet(tabs, subnet);

		if (!tab) {
			tab = makeBaseTab({
				name: key || subnet.subnet || "subnet" + (i + 1),
				device: key || ""
			});
			tab.enabled = key ? arrayContains(enabledIfaces, key) : false;
			tab.label = key || subnet.subnet || "subnet" + (i + 1);
			tabs.push(tab);

			if (key)
				byDevice[key] = tab;
		}

		if (tab.subnet) {
			tab = makeBaseTab({
				name: (key || "subnet") + "-" + (i + 1),
				device: key || ""
			});
			tab.enabled = key ? arrayContains(enabledIfaces, key) : false;
			tabs.push(tab);
		}

		applySubnet(tab, subnet, dhcp4);
	}

	if (tabs.length === 0)
		tabs.push(makeBaseTab({ name: "manual", device: "" }));

	return tabs;
}

function field(label, child, description) {
	return E("div", { "class": "cbi-value" }, [
		E("label", { "class": "cbi-value-title" }, label),
		E("div", { "class": "cbi-value-field" }, [
			child,
			description ? E("div", { "class": "cbi-value-description" }, description) : ""
		])
	]);
}

function textInput(id, value, placeholder) {
	return E("input", {
		"id": id,
		"class": "cbi-input-text",
		"type": "text",
		"value": value || "",
		"placeholder": placeholder || ""
	});
}

function numberInput(id, value, placeholder) {
	return E("input", {
		"id": id,
		"class": "cbi-input-text",
		"type": "number",
		"min": "0",
		"value": value || "",
		"placeholder": placeholder || ""
	});
}

function checkboxInput(id, checked) {
	return E("input", {
		"id": id,
		"type": "checkbox",
		"checked": checked ? "checked" : null
	});
}

function reservationRow(reservation) {
	return E("tr", { "class": "tr kea-reservation-row" }, [
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-hostname",
			"type": "text",
			"value": reservation.hostname || ""
		})),
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-mac",
			"type": "text",
			"value": reservation.mac || "",
			"placeholder": "00:11:22:33:44:55"
		})),
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-ip",
			"type": "text",
			"value": reservation.ip || "",
			"placeholder": "192.168.1.10"
		})),
		E("td", { "class": "td left" }, E("input", {
			"class": "kea-res-enabled",
			"type": "checkbox",
			"checked": reservation.enabled === false ? null : "checked"
		})),
		E("td", { "class": "td right" }, E("button", {
			"class": "btn cbi-button cbi-button-remove",
			"click": function(ev) {
				ev.preventDefault();
				ev.target.closest("tr").remove();
			}
		}, _("Delete")))
	]);
}

function collectReservations() {
	var rows = document.querySelectorAll("#kea-reservation-table .kea-reservation-row");
	var reservations = [];
	var i, row;

	for (i = 0; i < rows.length; i++) {
		row = rows[i];
		reservations.push({
			enabled: row.querySelector(".kea-res-enabled").checked,
			hostname: row.querySelector(".kea-res-hostname").value.trim(),
			mac: row.querySelector(".kea-res-mac").value.trim(),
			ip: row.querySelector(".kea-res-ip").value.trim()
		});
	}

	return reservations;
}

function cleanNumber(value) {
	value = String(value || "").trim();
	return value ? Number(value) : null;
}

function tabHasReservationConfig(tab) {
	var i, reservation;

	for (i = 0; i < tab.reservations.length; i++) {
		reservation = tab.reservations[i] || {};
		if (reservation.enabled && (reservation.hostname || reservation.mac || reservation.ip))
			return true;
	}

	return false;
}

function tabHasSubnetConfig(tab) {
	return !!(tab.subnet || tab.poolStart || tab.poolEnd || tab.router ||
		tab.dnsServers || tab.domainName || tab.domainSearch ||
		tab.renewTimer || tab.rebindTimer || tab.validLifetime ||
		tabHasReservationConfig(tab));
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetConfig("dhcp4"), {}),
			L.resolveDefault(callNetworkInterfaces(), {})
		]);
	},

	collectActiveTab: function() {
		var tab = this.tabs && this.tabs[this.activeIndex];

		if (!tab)
			return;

		tab.enabled = document.querySelector("#kea-dhcp4-enabled").checked;
		tab.device = document.querySelector("#kea-dhcp4-interface").value.trim();
		tab.subnet = document.querySelector("#kea-dhcp4-subnet").value.trim();
		tab.poolStart = document.querySelector("#kea-dhcp4-pool-start").value.trim();
		tab.poolEnd = document.querySelector("#kea-dhcp4-pool-end").value.trim();
		tab.router = document.querySelector("#kea-dhcp4-router").value.trim();
		tab.dnsServers = document.querySelector("#kea-dhcp4-dns").value.trim();
		tab.domainName = document.querySelector("#kea-dhcp4-domain").value.trim();
		tab.domainSearch = document.querySelector("#kea-dhcp4-search").value.trim();
		tab.renewTimer = document.querySelector("#kea-dhcp4-renew").value.trim();
		tab.rebindTimer = document.querySelector("#kea-dhcp4-rebind").value.trim();
		tab.validLifetime = document.querySelector("#kea-dhcp4-valid").value.trim();
		tab.reservations = collectReservations();
	},

	switchTab: function(index) {
		this.collectActiveTab();
		this.activeIndex = index;
		this.renderTabs();
		this.renderActiveTab();
	},

	addReservation: function() {
		var body = document.querySelector("#kea-reservation-table tbody");
		var empty;

		if (!body)
			return;

		empty = body.querySelector(".kea-reservations-empty");
		if (empty)
			empty.remove();

		body.appendChild(reservationRow({
			enabled: true,
			hostname: "",
			mac: "",
			ip: ""
		}));
	},

	buildConfig: function() {
		var config = cloneObject(this.config);
		var dhcp4 = config.Dhcp4 || {};
		var enabledIfaces = [];
		var subnets = [];
		var errors = [];
		var i, tab, subnet, options, reservations, timer;

		dhcp4["valid-lifetime"] = dhcp4["valid-lifetime"] || 4000;

		for (i = 0; i < this.tabs.length; i++) {
			tab = this.tabs[i];

			if (!tab.enabled && !tabHasSubnetConfig(tab))
				continue;

			if (!tab.device)
				errors.push(tab.label + ": " + _("interface device is required"));
			if (!tab.subnet)
				errors.push(tab.label + ": " + _("subnet is required"));
			if ((tab.poolStart && !tab.poolEnd) || (!tab.poolStart && tab.poolEnd))
				errors.push(tab.label + ": " + _("pool start and end must be set together"));

			if (tab.enabled && tab.device && !arrayContains(enabledIfaces, tab.device))
				enabledIfaces.push(tab.device);

			subnet = {
				id: tab.subnetId || subnets.length + 1,
				subnet: tab.subnet,
				interface: tab.device
			};

			if (tab.poolStart && tab.poolEnd)
				subnet.pools = [ { pool: tab.poolStart + " - " + tab.poolEnd } ];

			timer = cleanNumber(tab.renewTimer);
			if (timer !== null)
				subnet["renew-timer"] = timer;
			timer = cleanNumber(tab.rebindTimer);
			if (timer !== null)
				subnet["rebind-timer"] = timer;
			timer = cleanNumber(tab.validLifetime);
			if (timer !== null)
				subnet["valid-lifetime"] = timer;

			options = [];
			addOption(options, "routers", tab.router);
			addOption(options, "domain-name-servers", tab.dnsServers);
			addOption(options, "domain-name", tab.domainName);
			addOption(options, "domain-search", tab.domainSearch);
			if (options.length)
				subnet["option-data"] = options;

			reservations = [];
			tab.reservations.forEach(function(reservation) {
				if (!reservation.enabled)
					return;

				if (!reservation.mac || !reservation.ip) {
					errors.push(tab.label + ": " + _("reservation MAC and address are required"));
					return;
				}

				reservations.push({
					hostname: reservation.hostname || undefined,
					"hw-address": reservation.mac,
					"ip-address": reservation.ip
				});
			});

			if (reservations.length)
				subnet.reservations = reservations;

			subnets.push(subnet);
		}

		if (errors.length)
			return { errors: errors };

		dhcp4["interfaces-config"] = dhcp4["interfaces-config"] || {};
		dhcp4["interfaces-config"].interfaces = enabledIfaces;
		dhcp4.subnet4 = subnets;
		config.Dhcp4 = dhcp4;

		return {
			content: JSON.stringify(config, function(key, value) {
				return value === undefined ? undefined : value;
			}, "\t") + "\n"
		};
	},

	save: function() {
		var self = this;
		var built;

		this.collectActiveTab();
		built = this.buildConfig();

		if (built.errors) {
			ui.addNotification(null, E("pre", {
				"style": "white-space: pre-wrap"
			}, built.errors.join("\n")), "danger");
			return Promise.resolve();
		}

		return callSaveConfig("dhcp4", built.content).then(function(result) {
			if (!result || !result.result) {
				ui.addNotification(null, E("p", [
					result && result.error ? result.error : _("Failed to save DHCPv4 configuration."),
					result && result.validation ? E("pre", {
						"style": "white-space: pre-wrap; max-height: 18rem; overflow: auto"
					}, result.validation) : ""
				]), "danger");
				return;
			}

			ui.addNotification(null, E("p", _("DHCPv4 configuration saved.")), "info");
			return self.reload();
		});
	},

	handleSave: function(ev) {
		if (ev)
			ev.preventDefault();

		return this.save();
	},

	handleSaveApply: function(ev, mode) {
		if (ev)
			ev.preventDefault();

		return this.save();
	},

	handleReset: function(ev) {
		if (ev)
			ev.preventDefault();

		return this.reload();
	},

	reload: function() {
		var self = this;

		return callGetConfig("dhcp4").then(function(config) {
			var parsed = parseKeaConfig(config.content || "{}");

			if (parsed.error) {
				ui.addNotification(null, E("p", parsed.error), "danger");
				return;
			}

			self.rawConfig = config;
			self.config = parsed.config;
			self.tabs = buildTabs(self.config, self.interfaceItems);
			self.activeIndex = 0;
			self.renderTabs();
			self.renderActiveTab();
		});
	},

	renderTabs: function() {
		var self = this;
		var container = document.querySelector("#kea-dhcp4-tabs");

		if (!container)
			return;

		container.replaceChildren.apply(container, this.tabs.map(function(tab, index) {
			return E("button", {
				"class": "btn cbi-button " + (index === self.activeIndex ? "cbi-button-apply" : ""),
				"style": "margin-right: .35rem; margin-bottom: .35rem",
				"click": function(ev) {
					ev.preventDefault();
					self.switchTab(index);
				}
			}, tab.label);
		}));
	},

	renderActiveTab: function() {
		var self = this;
		var container = document.querySelector("#kea-dhcp4-editor");
		var tab = this.tabs[this.activeIndex];
		var rows;

		if (!container || !tab)
			return;

		rows = tab.reservations.map(function(reservation) {
			return reservationRow(reservation);
		});

		container.replaceChildren(E("div", {}, [
			E("div", { "class": "cbi-section" }, [
				E("h3", tab.label),
				field(_("Enable"), E("label", {}, [
					checkboxInput("kea-dhcp4-enabled", tab.enabled),
					" ",
					_("Enable DHCPv4 server on this interface")
				])),
				field(_("Interface"), textInput("kea-dhcp4-interface", tab.device, "br-lan")),
				field(_("Subnet"), textInput("kea-dhcp4-subnet", tab.subnet, "192.168.1.0/24")),
				field(_("Address Pool"), E("span", {}, [
					textInput("kea-dhcp4-pool-start", tab.poolStart, "192.168.1.100"),
					" ",
					_("to"),
					" ",
					textInput("kea-dhcp4-pool-end", tab.poolEnd, "192.168.1.199")
				])),
				field(_("Gateway"), textInput("kea-dhcp4-router", tab.router, "192.168.1.1")),
				field(_("DNS Servers"), textInput("kea-dhcp4-dns", tab.dnsServers, "192.168.1.1, 1.1.1.1")),
				field(_("Domain Name"), textInput("kea-dhcp4-domain", tab.domainName, "lan")),
				field(_("Domain Search"), textInput("kea-dhcp4-search", tab.domainSearch, "lan, example.org")),
				field(_("Renew Timer"), numberInput("kea-dhcp4-renew", tab.renewTimer, "1000")),
				field(_("Rebind Timer"), numberInput("kea-dhcp4-rebind", tab.rebindTimer, "2000")),
				field(_("Valid Lifetime"), numberInput("kea-dhcp4-valid", tab.validLifetime, "4000"))
			]),
			E("div", { "class": "cbi-section" }, [
				E("h3", _("Static Reservations")),
				E("table", { "id": "kea-reservation-table", "class": "table" }, [
					E("thead", {}, [
						E("tr", { "class": "tr table-titles" }, [
							E("th", { "class": "th left" }, _("Hostname")),
							E("th", { "class": "th left" }, _("MAC Address")),
							E("th", { "class": "th left" }, _("IPv4 Address")),
							E("th", { "class": "th left" }, _("Enabled")),
							E("th", { "class": "th right" }, "")
						])
					]),
					E("tbody", {}, rows.length ? rows : [
						E("tr", { "class": "tr kea-reservations-empty" }, [
							E("td", { "class": "td left", "colspan": "5" }, _("No static reservations."))
						])
					])
				]),
				E("div", { "class": "cbi-page-actions" }, [
					E("button", {
						"class": "btn cbi-button cbi-button-add",
						"click": function(ev) {
							ev.preventDefault();
							self.addReservation();
						}
					}, _("Add Reservation"))
				])
			])
		]));
	},

	render: function(data) {
		var config = data[0] || {};
		var interfaces = data[1] || {};
		var parsed = parseKeaConfig(config.content || "{}");

		this.rawConfig = config;
		this.interfaceItems = interfaces.items || [];
		this.activeIndex = 0;

		if (parsed.error) {
			return E("div", {}, [
				E("h2", _("Kea DHCPv4")),
				E("div", { "class": "alert-message warning" }, [
					_("The DHCPv4 config cannot be parsed by the structured editor."),
					E("pre", { "style": "white-space: pre-wrap" }, parsed.error)
				])
			]);
		}

		this.config = parsed.config;
		this.tabs = buildTabs(this.config, this.interfaceItems);

		window.setTimeout(function(self) {
			self.renderTabs();
			self.renderActiveTab();
		}, 0, this);

		return E("div", {}, [
			E("h2", _("Kea DHCPv4")),
			E("div", { "id": "kea-dhcp4-tabs", "class": "cbi-section" }, _("Loading...")),
			E("div", { "id": "kea-dhcp4-editor" }, E("div", { "class": "spinning" }, _("Loading..."))),
			E("div", { "class": "cbi-page-actions" }, [
				E("button", {
					"class": "btn cbi-button cbi-button-apply",
					"click": function(ev) {
						ev.preventDefault();
						return this.save();
					}.bind(this)
				}, _("Save")),
				" ",
				E("button", {
					"class": "btn cbi-button cbi-button-reload",
					"click": function(ev) {
						ev.preventDefault();
						return this.reload();
					}.bind(this)
				}, _("Reload"))
			])
		]);
	}
});
