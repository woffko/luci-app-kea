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

function splitList(value) {
	var raw = String(value || "").split(/\s*,\s*|\s+/);
	var values = [];
	var i;

	for (i = 0; i < raw.length; i++)
		if (raw[i])
			values.push(raw[i]);

	return values;
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

function firstPool(subnet) {
	return subnet && subnet.pools && subnet.pools[0] && subnet.pools[0].pool || "";
}

function firstPdPool(subnet) {
	var pool = subnet && subnet["pd-pools"] && subnet["pd-pools"][0] || {};

	return {
		prefix: pool.prefix || "",
		prefixLen: pool["prefix-len"] || "",
		delegatedLen: pool["delegated-len"] || ""
	};
}

function isDocumentationSubnet6(subnet) {
	var value = String(subnet && subnet.subnet || "").toLowerCase();

	return value === "2001:db8::/32" ||
		value.indexOf("2001:db8:") === 0 ||
		value.indexOf("2001:0db8:") === 0;
}

function isSampleOption6(option) {
	var name = option && option.name || "";
	var code = option && option.code;
	var data = option && option.data || "";

	return (name === "dns-servers" && data === "2001:db8:2::45, 2001:db8:2::100") ||
		(code === 12 && data === "2001:db8::1") ||
		(name === "new-posix-timezone" && data === "EST5EDT4\\,M3.2.0/02:00\\,M11.1.0/02:00") ||
		(name === "preference" && data === "0xf0") ||
		(name === "bootfile-param" && data === "root=/dev/sda2, quiet, splash");
}

function removeStockSampleDhcp6(dhcp6) {
	if (dhcp6["option-data"]) {
		dhcp6["option-data"] = dhcp6["option-data"].filter(function(option) {
			return !isSampleOption6(option || {});
		});

		if (dhcp6["option-data"].length === 0)
			delete dhcp6["option-data"];
	}
}

function interfaceLabel(item) {
	if (!item)
		return _("Manual");

	if (item.device && item.device !== item.name)
		return item.name + " (" + item.device + ")";

	return item.name || item.device || _("Interface");
}

function makeBaseTab(item) {
	return {
		name: item && item.name || "",
		device: item && item.device || "",
		ip6addr: item && item.ip6addr || "",
		label: interfaceLabel(item),
		enabled: false,
		subnetId: null,
		subnet: "",
		pool: "",
		pdPrefix: "",
		pdPrefixLen: "",
		pdDelegatedLen: "",
		dnsServers: "",
		domainSearch: "",
		renewTimer: "",
		rebindTimer: "",
		preferredLifetime: "",
		validLifetime: "",
		reservations: []
	};
}

function reservationIdentity(reservation) {
	if (reservation.duid)
		return { type: "duid", value: reservation.duid };
	if (reservation["hw-address"])
		return { type: "hw-address", value: reservation["hw-address"] };
	if (reservation["client-id"])
		return { type: "client-id", value: reservation["client-id"] };
	if (reservation["flex-id"])
		return { type: "flex-id", value: reservation["flex-id"] };

	return { type: "duid", value: "" };
}

function applySubnet(tab, subnet, dhcp6) {
	var pdPool = firstPdPool(subnet);
	var reservations = subnet.reservations || [];

	tab.subnetId = subnet.id || null;
	tab.subnet = subnet.subnet || "";
	tab.pool = firstPool(subnet);
	tab.pdPrefix = pdPool.prefix;
	tab.pdPrefixLen = pdPool.prefixLen;
	tab.pdDelegatedLen = pdPool.delegatedLen;
	tab.dnsServers = optionValue(subnet["option-data"], "dns-servers");
	tab.domainSearch = optionValue(subnet["option-data"], "domain-search");
	tab.renewTimer = subnet["renew-timer"] || dhcp6["renew-timer"] || "";
	tab.rebindTimer = subnet["rebind-timer"] || dhcp6["rebind-timer"] || "";
	tab.preferredLifetime = subnet["preferred-lifetime"] || dhcp6["preferred-lifetime"] || "";
	tab.validLifetime = subnet["valid-lifetime"] || dhcp6["valid-lifetime"] || "";
	tab.reservations = reservations.map(function(reservation) {
		var identity = reservationIdentity(reservation || {});

		return {
			enabled: true,
			hostname: reservation.hostname || "",
			type: identity.type,
			identity: identity.value,
			addresses: (reservation["ip-addresses"] || []).join(", "),
			prefixes: (reservation.prefixes || []).join(", ")
		};
	});
}

function findOnlyEnabledTab(tabs, enabledIfaces) {
	var i, tab, found = null;

	if (enabledIfaces.length !== 1)
		return null;

	for (i = 0; i < tabs.length; i++) {
		tab = tabs[i];
		if (tab.subnet)
			continue;
		if (tab.device === enabledIfaces[0] || tab.name === enabledIfaces[0])
			found = tab;
	}

	return found;
}

function buildTabs(config, interfaces) {
	var dhcp6 = config.Dhcp6 || {};
	var subnets = dhcp6.subnet6 || [];
	var enabledIfaces = dhcp6["interfaces-config"] && dhcp6["interfaces-config"].interfaces || [];
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

		if (!key && isDocumentationSubnet6(subnet))
			continue;

		tab = key ? byDevice[key] : findOnlyEnabledTab(tabs, enabledIfaces);

		if (!tab) {
			tab = makeBaseTab({
				name: key || subnet.subnet || "subnet6-" + (i + 1),
				device: key || ""
			});
			tab.enabled = key ? arrayContains(enabledIfaces, key) : false;
			tab.label = key || subnet.subnet || "subnet6-" + (i + 1);
			tabs.push(tab);

			if (key)
				byDevice[key] = tab;
		}

		if (tab.subnet) {
			tab = makeBaseTab({
				name: (key || "subnet6") + "-" + (i + 1),
				device: key || ""
			});
			tab.enabled = key ? arrayContains(enabledIfaces, key) : false;
			tab.label = key || subnet.subnet || "subnet6-" + (i + 1);
			tabs.push(tab);
		}

		applySubnet(tab, subnet, dhcp6);
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

function selectOption(value, title, selected) {
	return E("option", {
		"value": value,
		"selected": selected ? "selected" : null
	}, title);
}

function reservationRow(reservation) {
	return E("tr", { "class": "tr kea-reservation-row" }, [
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-hostname",
			"type": "text",
			"value": reservation.hostname || ""
		})),
		E("td", { "class": "td left" }, [
			E("select", { "class": "cbi-input-select kea-res-type" }, [
				selectOption("duid", "DUID", reservation.type === "duid"),
				selectOption("hw-address", _("MAC Address"), reservation.type === "hw-address"),
				selectOption("client-id", _("Client ID"), reservation.type === "client-id"),
				selectOption("flex-id", _("Flex ID"), reservation.type === "flex-id")
			]),
			" ",
			E("input", {
				"class": "cbi-input-text kea-res-id",
				"type": "text",
				"value": reservation.identity || "",
				"placeholder": "00:04:..."
			})
		]),
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-addresses",
			"type": "text",
			"value": reservation.addresses || "",
			"placeholder": "fd00:1234:abcd:1::100"
		})),
		E("td", { "class": "td left" }, E("input", {
			"class": "cbi-input-text kea-res-prefixes",
			"type": "text",
			"value": reservation.prefixes || "",
			"placeholder": "fd00:1234:abcd:100::/64"
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
	var rows = document.querySelectorAll("#kea-dhcp6-reservation-table .kea-reservation-row");
	var reservations = [];
	var i, row;

	for (i = 0; i < rows.length; i++) {
		row = rows[i];
		reservations.push({
			enabled: row.querySelector(".kea-res-enabled").checked,
			hostname: row.querySelector(".kea-res-hostname").value.trim(),
			type: row.querySelector(".kea-res-type").value,
			identity: row.querySelector(".kea-res-id").value.trim(),
			addresses: row.querySelector(".kea-res-addresses").value.trim(),
			prefixes: row.querySelector(".kea-res-prefixes").value.trim()
		});
	}

	return reservations;
}

function cleanNumber(value) {
	var number;

	value = String(value || "").trim();
	if (!value)
		return null;

	number = Number(value);
	return isNaN(number) ? undefined : number;
}

function addReservationIdentity(target, reservation) {
	if (reservation.type === "hw-address")
		target["hw-address"] = reservation.identity;
	else if (reservation.type === "client-id")
		target["client-id"] = reservation.identity;
	else if (reservation.type === "flex-id")
		target["flex-id"] = reservation.identity;
	else
		target.duid = reservation.identity;
}

function tabHasReservationConfig(tab) {
	var i, reservation;

	for (i = 0; i < tab.reservations.length; i++) {
		reservation = tab.reservations[i] || {};
		if (reservation.enabled && (reservation.hostname || reservation.identity || reservation.addresses || reservation.prefixes))
			return true;
	}

	return false;
}

function tabHasSubnetConfig(tab) {
	return !!(tab.subnet || tab.pool || tab.pdPrefix || tab.pdPrefixLen ||
		tab.pdDelegatedLen || tab.dnsServers || tab.domainSearch ||
		tab.renewTimer || tab.rebindTimer || tab.preferredLifetime ||
		tab.validLifetime || tabHasReservationConfig(tab));
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetConfig("dhcp6"), {}),
			L.resolveDefault(callNetworkInterfaces(), {})
		]);
	},

	collectActiveTab: function() {
		var tab = this.tabs && this.tabs[this.activeIndex];

		if (!tab)
			return;

		tab.enabled = document.querySelector("#kea-dhcp6-enabled").checked;
		tab.device = document.querySelector("#kea-dhcp6-interface").value.trim();
		tab.subnet = document.querySelector("#kea-dhcp6-subnet").value.trim();
		tab.pool = document.querySelector("#kea-dhcp6-pool").value.trim();
		tab.pdPrefix = document.querySelector("#kea-dhcp6-pd-prefix").value.trim();
		tab.pdPrefixLen = document.querySelector("#kea-dhcp6-pd-prefix-len").value.trim();
		tab.pdDelegatedLen = document.querySelector("#kea-dhcp6-pd-delegated-len").value.trim();
		tab.dnsServers = document.querySelector("#kea-dhcp6-dns").value.trim();
		tab.domainSearch = document.querySelector("#kea-dhcp6-search").value.trim();
		tab.renewTimer = document.querySelector("#kea-dhcp6-renew").value.trim();
		tab.rebindTimer = document.querySelector("#kea-dhcp6-rebind").value.trim();
		tab.preferredLifetime = document.querySelector("#kea-dhcp6-preferred").value.trim();
		tab.validLifetime = document.querySelector("#kea-dhcp6-valid").value.trim();
		tab.reservations = collectReservations();
	},

	switchTab: function(index) {
		this.collectActiveTab();
		this.activeIndex = index;
		this.renderTabs();
		this.renderActiveTab();
	},

	addReservation: function() {
		var body = document.querySelector("#kea-dhcp6-reservation-table tbody");
		var empty;

		if (!body)
			return;

		empty = body.querySelector(".kea-reservations-empty");
		if (empty)
			empty.remove();

		body.appendChild(reservationRow({
			enabled: true,
			hostname: "",
			type: "duid",
			identity: "",
			addresses: "",
			prefixes: ""
		}));
	},

	buildConfig: function() {
		var config = cloneObject(this.config);
		var dhcp6 = config.Dhcp6 || {};
		var enabledIfaces = [];
		var subnets = [];
		var errors = [];
		var i, tab, subnet, options, reservations, timer, pdPrefixLen, pdDelegatedLen;

		for (i = 0; i < this.tabs.length; i++) {
			tab = this.tabs[i];

			if (!tab.enabled && !tabHasSubnetConfig(tab))
				continue;

			if (!tab.device)
				errors.push(tab.label + ": " + _("interface device is required"));
			if (!tab.subnet)
				errors.push(tab.label + ": " + _("subnet is required"));
			if ((tab.pdPrefix || tab.pdPrefixLen || tab.pdDelegatedLen) &&
			    (!tab.pdPrefix || !tab.pdPrefixLen || !tab.pdDelegatedLen))
				errors.push(tab.label + ": " + _("prefix delegation prefix, prefix length, and delegated length must be set together"));

			if (tab.enabled && tab.device && !arrayContains(enabledIfaces, tab.device))
				enabledIfaces.push(tab.device);

			subnet = {
				id: tab.subnetId || subnets.length + 1,
				subnet: tab.subnet,
				interface: tab.device
			};

			if (tab.pool)
				subnet.pools = [ { pool: tab.pool } ];

			if (tab.pdPrefix && tab.pdPrefixLen && tab.pdDelegatedLen) {
				pdPrefixLen = cleanNumber(tab.pdPrefixLen);
				pdDelegatedLen = cleanNumber(tab.pdDelegatedLen);

				if (pdPrefixLen === undefined || pdDelegatedLen === undefined) {
					errors.push(tab.label + ": " + _("prefix delegation lengths must be numeric"));
				}
				else {
					subnet["pd-pools"] = [ {
						prefix: tab.pdPrefix,
						"prefix-len": pdPrefixLen,
						"delegated-len": pdDelegatedLen
					} ];
				}
			}

			timer = cleanNumber(tab.renewTimer);
			if (timer === undefined)
				errors.push(tab.label + ": " + _("renew timer must be numeric"));
			else if (timer !== null)
				subnet["renew-timer"] = timer;
			timer = cleanNumber(tab.rebindTimer);
			if (timer === undefined)
				errors.push(tab.label + ": " + _("rebind timer must be numeric"));
			else if (timer !== null)
				subnet["rebind-timer"] = timer;
			timer = cleanNumber(tab.preferredLifetime);
			if (timer === undefined)
				errors.push(tab.label + ": " + _("preferred lifetime must be numeric"));
			else if (timer !== null)
				subnet["preferred-lifetime"] = timer;
			timer = cleanNumber(tab.validLifetime);
			if (timer === undefined)
				errors.push(tab.label + ": " + _("valid lifetime must be numeric"));
			else if (timer !== null)
				subnet["valid-lifetime"] = timer;

			options = [];
			addOption(options, "dns-servers", tab.dnsServers);
			addOption(options, "domain-search", tab.domainSearch);
			if (options.length)
				subnet["option-data"] = options;

			reservations = [];
			tab.reservations.forEach(function(reservation) {
				var entry, addresses, prefixes;

				if (!reservation.enabled)
					return;

				addresses = splitList(reservation.addresses);
				prefixes = splitList(reservation.prefixes);

				if (!reservation.identity || (addresses.length === 0 && prefixes.length === 0)) {
					errors.push(tab.label + ": " + _("reservation identity and an address or prefix are required"));
					return;
				}

				entry = {
					hostname: reservation.hostname || undefined
				};
				addReservationIdentity(entry, reservation);

				if (addresses.length)
					entry["ip-addresses"] = addresses;
				if (prefixes.length)
					entry.prefixes = prefixes;

				reservations.push(entry);
			});

			if (reservations.length)
				subnet.reservations = reservations;

			subnets.push(subnet);
		}

		if (errors.length)
			return { errors: errors };

		dhcp6["interfaces-config"] = dhcp6["interfaces-config"] || {};
		dhcp6["interfaces-config"].interfaces = enabledIfaces;
		dhcp6.subnet6 = subnets;
		removeStockSampleDhcp6(dhcp6);
		config.Dhcp6 = dhcp6;

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

		return callSaveConfig("dhcp6", built.content).then(function(result) {
			if (!result || !result.result) {
				ui.addNotification(null, E("p", [
					result && result.error ? result.error : _("Failed to save DHCPv6 configuration."),
					result && result.validation ? E("pre", {
						"style": "white-space: pre-wrap; max-height: 18rem; overflow: auto"
					}, result.validation) : ""
				]), "danger");
				return;
			}

			ui.addNotification(null, E("p", _("DHCPv6 configuration saved.")), "info");
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

		return callGetConfig("dhcp6").then(function(config) {
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
		var container = document.querySelector("#kea-dhcp6-tabs");

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
		var container = document.querySelector("#kea-dhcp6-editor");
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
					checkboxInput("kea-dhcp6-enabled", tab.enabled),
					" ",
					_("Enable DHCPv6 server on this interface")
				])),
				field(_("Interface"), textInput("kea-dhcp6-interface", tab.device, "br-lan")),
				field(_("Subnet"), textInput("kea-dhcp6-subnet", tab.subnet, "fd00:1234:abcd:1::/64")),
				field(_("Address Pool"), textInput("kea-dhcp6-pool", tab.pool, "fd00:1234:abcd:1::100 - fd00:1234:abcd:1::ffff")),
				field(_("Prefix Delegation"), E("span", {}, [
					textInput("kea-dhcp6-pd-prefix", tab.pdPrefix, "fd00:1234:abcd:100::"),
					" ",
					numberInput("kea-dhcp6-pd-prefix-len", tab.pdPrefixLen, "56"),
					" ",
					numberInput("kea-dhcp6-pd-delegated-len", tab.pdDelegatedLen, "64")
				]), _("Prefix, prefix length, and delegated prefix length.")),
				field(_("DNS Servers"), textInput("kea-dhcp6-dns", tab.dnsServers, "fd00:1234:abcd:1::1, 2001:4860:4860::8888")),
				field(_("Domain Search"), textInput("kea-dhcp6-search", tab.domainSearch, "lan, example.org")),
				field(_("Renew Timer"), numberInput("kea-dhcp6-renew", tab.renewTimer, "1000")),
				field(_("Rebind Timer"), numberInput("kea-dhcp6-rebind", tab.rebindTimer, "2000")),
				field(_("Preferred Lifetime"), numberInput("kea-dhcp6-preferred", tab.preferredLifetime, "3000")),
				field(_("Valid Lifetime"), numberInput("kea-dhcp6-valid", tab.validLifetime, "4000"))
			]),
			E("div", { "class": "cbi-section" }, [
				E("h3", _("Static Reservations")),
				E("table", { "id": "kea-dhcp6-reservation-table", "class": "table" }, [
					E("thead", {}, [
						E("tr", { "class": "tr table-titles" }, [
							E("th", { "class": "th left" }, _("Hostname")),
							E("th", { "class": "th left" }, _("Identifier")),
							E("th", { "class": "th left" }, _("IPv6 Addresses")),
							E("th", { "class": "th left" }, _("Prefixes")),
							E("th", { "class": "th left" }, _("Enabled")),
							E("th", { "class": "th right" }, "")
						])
					]),
					E("tbody", {}, rows.length ? rows : [
						E("tr", { "class": "tr kea-reservations-empty" }, [
							E("td", { "class": "td left", "colspan": "6" }, _("No static reservations."))
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
				E("h2", _("Kea DHCPv6")),
				E("div", { "class": "alert-message warning" }, [
					_("The DHCPv6 config cannot be parsed by the structured editor."),
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
			E("h2", _("Kea DHCPv6")),
			E("div", { "id": "kea-dhcp6-tabs", "class": "cbi-section" }, _("Loading...")),
			E("div", { "id": "kea-dhcp6-editor" }, E("div", { "class": "spinning" }, _("Loading..."))),
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
