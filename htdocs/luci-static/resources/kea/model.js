"use strict";
"require baseclass";

/*
 * Kea configuration model shared by the DHCPv4 and DHCPv6 editors.
 *
 * The editors show a few common settings of each subnet. Everything else in
 * the Kea configuration must survive a save untouched, so this module never
 * rebuilds a subnet from the form. It keeps the original subnet object,
 * remembers the values the form started with, and on save writes back only
 * the settings the user changed.
 *
 * The module has no DOM or RPC dependencies and is unit-tested under Node.
 */

/* Key used inside Kea "user-context" objects for data owned by this app. */
var CONTEXT_KEY = "luci-app-kea";
var DISABLED_KEY = "disabled-reservations";

var FAMILIES = {
	dhcp4: {
		name: "dhcp4",
		root: "Dhcp4",
		subnets: "subnet4",
		space: "dhcp4",
		idTypes: [ "hw-address", "client-id", "duid", "circuit-id", "flex-id" ],
		fields: [
			"poolStart", "poolEnd", "router", "dnsServers", "domainName",
			"domainSearch", "renewTimer", "rebindTimer", "validLifetime"
		],
		options: {
			router: { name: "routers", code: 3 },
			dnsServers: { name: "domain-name-servers", code: 6 },
			domainName: { name: "domain-name", code: 15 },
			domainSearch: { name: "domain-search", code: 119 }
		},
		timers: {
			renewTimer: "renew-timer",
			rebindTimer: "rebind-timer",
			validLifetime: "valid-lifetime"
		},
		rowFields: [ "hostname", "type", "identity", "address" ]
	},
	dhcp6: {
		name: "dhcp6",
		root: "Dhcp6",
		subnets: "subnet6",
		space: "dhcp6",
		idTypes: [ "duid", "hw-address", "flex-id" ],
		fields: [
			"pool", "pdPrefix", "pdPrefixLen", "pdDelegatedLen", "dnsServers",
			"domainSearch", "renewTimer", "rebindTimer", "preferredLifetime",
			"validLifetime"
		],
		options: {
			dnsServers: { name: "dns-servers", code: 23 },
			domainSearch: { name: "domain-search", code: 24 }
		},
		timers: {
			renewTimer: "renew-timer",
			rebindTimer: "rebind-timer",
			preferredLifetime: "preferred-lifetime",
			validLifetime: "valid-lifetime"
		},
		rowFields: [ "hostname", "type", "identity", "addresses", "prefixes" ]
	}
};

function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
	return value === undefined || value === null ? "" : String(value);
}

function deepEqual(a, b) {
	var i, keys;

	if (a === b)
		return true;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;

		for (i = 0; i < a.length; i++)
			if (!deepEqual(a[i], b[i]))
				return false;

		return true;
	}

	if (isObject(a) && isObject(b)) {
		keys = Object.keys(a);

		if (keys.length !== Object.keys(b).length)
			return false;

		for (i = 0; i < keys.length; i++)
			if (!hasOwn(b, keys[i]) || !deepEqual(a[keys[i]], b[keys[i]]))
				return false;

		return true;
	}

	return false;
}

/*
 * Kea accepts "//", "#" and C-style comments in its JSON files. Replace
 * them so the text can be handed to JSON.parse().
 */
function stripJsonComments(source) {
	var out = "";
	var inString = false;
	var escaped = false;
	var i, ch, next;

	source = text(source);

	for (i = 0; i < source.length; i++) {
		ch = source.charAt(i);
		next = source.charAt(i + 1);

		if (inString) {
			out += ch;

			if (escaped)
				escaped = false;
			else if (ch === "\\")
				escaped = true;
			else if (ch === "\"")
				inString = false;

			continue;
		}

		if (ch === "\"") {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === "#" || (ch === "/" && next === "/")) {
			while (i < source.length && source.charAt(i) !== "\n")
				i++;

			out += "\n";
			continue;
		}

		if (ch === "/" && next === "*") {
			i += 2;

			while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/"))
				i++;

			i++;
			continue;
		}

		out += ch;
	}

	return out;
}

function splitList(value) {
	return text(value).split(/\s*,\s*|\s+/).filter(function(item) {
		return item !== "";
	});
}

function ipv4ToInt(addr) {
	var parts = text(addr).split(".");
	var value = 0;
	var i, octet;

	if (parts.length !== 4)
		return null;

	for (i = 0; i < 4; i++) {
		if (!/^\d+$/.test(parts[i]))
			return null;

		octet = Number(parts[i]);

		if (octet > 255)
			return null;

		value = ((value << 8) | octet) >>> 0;
	}

	return value >>> 0;
}

function parseCidr4(value) {
	var parts = text(value).trim().split("/");
	var ip = ipv4ToInt(parts[0]);
	var prefix = parts.length > 1 ? Number(parts[1]) : 32;
	var mask;

	if (ip === null || isNaN(prefix) || prefix < 0 || prefix > 32)
		return null;

	mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

	return {
		network: (ip & mask) >>> 0,
		prefix: prefix
	};
}

function subnetBinding(subnet) {
	return text(subnet["interface"] || subnet["interface-id"]);
}

function isDocumentationSubnet(family, subnet) {
	var value = text(subnet && subnet.subnet).trim().toLowerCase();

	if (family.name === "dhcp4")
		return /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(value);

	return /^2001:0?db8(:|\/)/.test(value);
}

/*
 * The stock Kea configuration ships an example subnet from a documentation
 * address range that is not bound to any interface. It gets no editor tab.
 */
function isSampleSubnet(family, subnet) {
	return isObject(subnet) && !subnetBinding(subnet) && isDocumentationSubnet(family, subnet);
}

function isSampleOption(family, option) {
	var name, code, data;

	if (!isObject(option))
		return false;

	name = option.name;
	code = option.code;
	data = option.data;

	if (family.name === "dhcp4")
		return (name === "domain-name-servers" && data === "192.0.2.1, 192.0.2.2") ||
			(code === 15 && data === "example.org") ||
			(name === "domain-search" && data === "mydomain.example.com, example.com") ||
			(name === "boot-file-name" && data === "EST5EDT4\\,M3.2.0/02:00\\,M11.1.0/02:00") ||
			(name === "default-ip-ttl" && data === "0xf0");

	return (name === "dns-servers" && data === "2001:db8:2::45, 2001:db8:2::100") ||
		(code === 12 && data === "2001:db8::1") ||
		(name === "new-posix-timezone" && data === "EST5EDT4\\,M3.2.0/02:00\\,M11.1.0/02:00") ||
		(name === "preference" && data === "0xf0") ||
		(name === "bootfile-param" && data === "root=/dev/sda2, quiet, splash");
}

function isSampleClass(family, clientClass) {
	if (family.name !== "dhcp4" || !isObject(clientClass))
		return false;

	return clientClass.name === "voip" &&
		clientClass.test === "substring(option[60].hex,0,6) == 'Aastra'";
}

function interfaceNames(root) {
	var config = root["interfaces-config"];
	var list = isObject(config) && Array.isArray(config.interfaces) ? config.interfaces : [];

	return list.map(function(entry) {
		return text(entry).split("/")[0];
	});
}

/* ---- options ---------------------------------------------------------- */

function findOption(options, def, space) {
	var i, option;

	for (i = 0; i < options.length; i++) {
		option = options[i];

		if (!isObject(option))
			continue;

		if (hasOwn(option, "space") && option.space !== space)
			continue;

		if (option.name === def.name || (!hasOwn(option, "name") && option.code === def.code))
			return i;
	}

	return -1;
}

function optionValue(subnet, def, space) {
	var options = Array.isArray(subnet["option-data"]) ? subnet["option-data"] : [];
	var index = findOption(options, def, space);

	return index < 0 ? "" : text(options[index].data);
}

function setOption(subnet, def, space, value) {
	var options = Array.isArray(subnet["option-data"]) ? subnet["option-data"] : [];
	var index = findOption(options, def, space);

	if (value === "") {
		if (index >= 0)
			options.splice(index, 1);
	}
	else if (index >= 0) {
		options[index].data = value;
	}
	else {
		options.push({ name: def.name, data: value });
	}

	if (options.length)
		subnet["option-data"] = options;
	else
		delete subnet["option-data"];
}

/* ---- pools ------------------------------------------------------------ */

function firstPool(subnet) {
	var pools = subnet.pools;

	return Array.isArray(pools) && isObject(pools[0]) ? text(pools[0].pool) : "";
}

function setFirstPool(subnet, value) {
	var pools = Array.isArray(subnet.pools) ? subnet.pools : [];

	if (value === "") {
		if (pools.length)
			pools.shift();
	}
	else if (isObject(pools[0])) {
		pools[0].pool = value;
	}
	else {
		pools.unshift({ pool: value });
	}

	if (pools.length)
		subnet.pools = pools;
	else
		delete subnet.pools;
}

/* "a - b" ranges are split into two fields; prefix notation stays whole. */
function poolRange(value) {
	var match = text(value).trim().match(/^(\S+?)\s*-\s*(\S+)$/);

	return match ?
		{ start: match[1], end: match[2] } :
		{ start: text(value).trim(), end: "" };
}

function firstPdPool(subnet) {
	var pools = subnet["pd-pools"];
	var pool = Array.isArray(pools) && isObject(pools[0]) ? pools[0] : {};

	return {
		prefix: text(pool.prefix),
		prefixLen: text(pool["prefix-len"]),
		delegatedLen: text(pool["delegated-len"])
	};
}

function setFirstPdPool(subnet, prefix, prefixLen, delegatedLen) {
	var pools = Array.isArray(subnet["pd-pools"]) ? subnet["pd-pools"] : [];

	if (prefix === null) {
		if (pools.length)
			pools.shift();
	}
	else {
		if (!isObject(pools[0]))
			pools.unshift({});

		pools[0].prefix = prefix;
		pools[0]["prefix-len"] = prefixLen;
		pools[0]["delegated-len"] = delegatedLen;
	}

	if (pools.length)
		subnet["pd-pools"] = pools;
	else
		delete subnet["pd-pools"];
}

/* ---- reservations ----------------------------------------------------- */

function disabledReservations(subnet) {
	var context = subnet["user-context"];
	var own = isObject(context) ? context[CONTEXT_KEY] : null;
	var list = isObject(own) ? own[DISABLED_KEY] : null;

	return Array.isArray(list) ? list : [];
}

function setDisabledReservations(subnet, list) {
	var context = subnet["user-context"];

	if (list.length) {
		if (!isObject(context))
			context = subnet["user-context"] = {};

		if (!isObject(context[CONTEXT_KEY]))
			context[CONTEXT_KEY] = {};

		context[CONTEXT_KEY][DISABLED_KEY] = list;
		return;
	}

	if (!isObject(context) || !isObject(context[CONTEXT_KEY]))
		return;

	delete context[CONTEXT_KEY][DISABLED_KEY];

	if (!Object.keys(context[CONTEXT_KEY]).length)
		delete context[CONTEXT_KEY];

	if (!Object.keys(context).length)
		delete subnet["user-context"];
}

function rowSnapshot(family, row) {
	var snapshot = { enabled: row.enabled };

	family.rowFields.forEach(function(field) {
		snapshot[field] = row[field];
	});

	return snapshot;
}

function makeRow(family, reservation, enabled) {
	var row = {
		enabled: enabled,
		hostname: "",
		type: family.idTypes[0],
		identity: "",
		source: null,
		initial: null
	};
	var i;

	if (family.name === "dhcp4") {
		row.address = "";
	}
	else {
		row.addresses = "";
		row.prefixes = "";
	}

	if (!isObject(reservation))
		return row;

	row.source = clone(reservation);
	row.hostname = text(reservation.hostname);

	for (i = 0; i < family.idTypes.length; i++) {
		if (hasOwn(reservation, family.idTypes[i])) {
			row.type = family.idTypes[i];
			row.identity = text(reservation[row.type]);
			break;
		}
	}

	if (family.name === "dhcp4") {
		row.address = text(reservation["ip-address"]);
	}
	else {
		row.addresses = (Array.isArray(reservation["ip-addresses"]) ? reservation["ip-addresses"] : []).join(", ");
		row.prefixes = (Array.isArray(reservation.prefixes) ? reservation.prefixes : []).join(", ");
	}

	row.initial = rowSnapshot(family, row);

	return row;
}

function rowFieldChanged(row, field) {
	return !row.initial || row[field] !== row.initial[field];
}

function rowIsBlank(family, row) {
	if (row.source)
		return false;

	return family.rowFields.every(function(field) {
		return field === "type" || row[field] === "";
	});
}

function setList(target, key, value) {
	var list = splitList(value);

	if (list.length)
		target[key] = list;
	else
		delete target[key];
}

function rowToReservation(family, row, label, errors) {
	var unchanged = row.source && !family.rowFields.some(function(field) {
		return rowFieldChanged(row, field);
	});
	var reservation;

	if (unchanged)
		return clone(row.source);

	reservation = row.source ? clone(row.source) : {};

	if (rowFieldChanged(row, "type") || rowFieldChanged(row, "identity")) {
		family.idTypes.forEach(function(type) {
			delete reservation[type];
		});

		if (row.identity !== "")
			reservation[row.type] = row.identity;
	}

	if (family.name === "dhcp4") {
		if (rowFieldChanged(row, "address")) {
			if (row.address !== "")
				reservation["ip-address"] = row.address;
			else
				delete reservation["ip-address"];
		}
	}
	else {
		if (rowFieldChanged(row, "addresses"))
			setList(reservation, "ip-addresses", row.addresses);

		if (rowFieldChanged(row, "prefixes"))
			setList(reservation, "prefixes", row.prefixes);
	}

	if (rowFieldChanged(row, "hostname")) {
		if (row.hostname !== "")
			reservation.hostname = row.hostname;
		else
			delete reservation.hostname;
	}

	/* Disabled rows are stored as inert data and may be incomplete. */
	if (row.enabled) {
		if (row.identity === "")
			errors.push(label + ": " + _("an enabled reservation needs an identifier"));

		if (family.name === "dhcp4" && row.address === "")
			errors.push(label + ": " + _("an enabled reservation needs an address"));

		if (family.name === "dhcp6" && row.addresses === "" && row.prefixes === "")
			errors.push(label + ": " + _("an enabled reservation needs an address or a prefix"));
	}

	return reservation;
}

function applyReservations(family, subnet, tab, errors) {
	var enabled = [];
	var disabled = [];

	tab.reservations.forEach(function(row) {
		if (rowIsBlank(family, row))
			return;

		(row.enabled ? enabled : disabled).push(rowToReservation(family, row, tab.label, errors));
	});

	if (!deepEqual(enabled, Array.isArray(subnet.reservations) ? subnet.reservations : [])) {
		if (enabled.length || hasOwn(subnet, "reservations"))
			subnet.reservations = enabled;
	}

	if (!deepEqual(disabled, disabledReservations(subnet)))
		setDisabledReservations(subnet, disabled);
}

/* ---- tabs ------------------------------------------------------------- */

function interfaceLabel(item) {
	if (item.device && item.device !== item.name)
		return item.name + " (" + item.device + ")";

	return item.name || item.device;
}

function makeTab(family, item) {
	var tab = {
		name: text(item.name),
		label: text(item.label) || interfaceLabel(item),
		address: text(item.address),
		enabled: false,
		removed: false,
		device: text(item.device),
		subnet: "",
		reservations: [],
		defaults: {},
		source: null,
		sourceIndex: null,
		initial: null
	};

	family.fields.forEach(function(field) {
		tab[field] = "";
	});

	return tab;
}

function loadSubnet(family, tab, subnet, index) {
	var range, pd, field;

	tab.source = clone(subnet);
	tab.sourceIndex = index;
	tab.subnet = text(subnet.subnet);

	if (subnetBinding(subnet))
		tab.device = subnetBinding(subnet);

	if (family.name === "dhcp4") {
		range = poolRange(firstPool(subnet));
		tab.poolStart = range.start;
		tab.poolEnd = range.end;
	}
	else {
		pd = firstPdPool(subnet);
		tab.pool = firstPool(subnet);
		tab.pdPrefix = pd.prefix;
		tab.pdPrefixLen = pd.prefixLen;
		tab.pdDelegatedLen = pd.delegatedLen;
	}

	for (field in family.options)
		tab[field] = optionValue(subnet, family.options[field], family.space);

	for (field in family.timers)
		tab[field] = text(subnet[family.timers[field]]);

	tab.reservations = (Array.isArray(subnet.reservations) ? subnet.reservations : [])
		.map(function(reservation) {
			return makeRow(family, reservation, true);
		})
		.concat(disabledReservations(subnet).map(function(reservation) {
			return makeRow(family, reservation, false);
		}));
}

function tabSnapshot(family, tab) {
	var snapshot = {
		enabled: tab.enabled,
		device: tab.device,
		subnet: tab.subnet
	};

	family.fields.forEach(function(field) {
		snapshot[field] = tab[field];
	});

	return snapshot;
}

function findTabByNetwork(tabs, subnet) {
	var target = parseCidr4(subnet.subnet);
	var i, j, addresses, cidr;

	if (!target)
		return null;

	for (i = 0; i < tabs.length; i++) {
		if (tabs[i].source)
			continue;

		addresses = splitList(tabs[i].address);

		for (j = 0; j < addresses.length; j++) {
			cidr = parseCidr4(addresses[j]);

			if (cidr && cidr.prefix === target.prefix && cidr.network === target.network)
				return tabs[i];
		}
	}

	return null;
}

function findOnlyListeningTab(tabs, names) {
	var i;

	if (names.length !== 1)
		return null;

	for (i = 0; i < tabs.length; i++)
		if (!tabs[i].source && tabs[i].device === names[0])
			return tabs[i];

	return null;
}

function buildTabs(family, config, interfaces) {
	var root = isObject(config) && isObject(config[family.root]) ? config[family.root] : {};
	var subnets = Array.isArray(root[family.subnets]) ? root[family.subnets] : [];
	var names = interfaceNames(root);
	var tabs = [];
	var byDevice = {};
	var defaults = {};
	var field, i, item, subnet, key, tab;

	for (field in family.timers)
		defaults[field] = text(root[family.timers[field]]);

	(interfaces || []).forEach(function(item) {
		if (!isObject(item) || item.name === "loopback" || item.device === "lo" || !item.device)
			return;

		tab = makeTab(family, {
			name: item.name,
			device: item.device,
			address: family.name === "dhcp4" ? item.ipaddr : item.ip6addr
		});

		tabs.push(tab);

		if (!byDevice[tab.device])
			byDevice[tab.device] = tab;
	});

	for (i = 0; i < subnets.length; i++) {
		subnet = subnets[i];

		if (!isObject(subnet) || isSampleSubnet(family, subnet))
			continue;

		key = subnetBinding(subnet);

		if (key)
			tab = byDevice[key];
		else if (family.name === "dhcp4")
			tab = findTabByNetwork(tabs, subnet);
		else
			tab = findOnlyListeningTab(tabs, names);

		/* No free interface tab: the subnet gets a tab of its own. */
		if (!tab || tab.source) {
			tab = makeTab(family, {
				name: key || text(subnet.subnet),
				device: key,
				label: (key ? key + ": " : "") + (text(subnet.subnet) || "#" + (i + 1))
			});

			tabs.push(tab);
		}

		loadSubnet(family, tab, subnet, i);
	}

	tabs.forEach(function(tab) {
		tab.enabled = tab.device !== "" && names.indexOf(tab.device) >= 0;
		tab.defaults = defaults;
		tab.initial = tabSnapshot(family, tab);
	});

	return tabs;
}

/* ---- saving ----------------------------------------------------------- */

function fieldChanged(tab, field) {
	return !tab.source || tab[field] !== tab.initial[field];
}

function anyChanged(tab, fields) {
	return fields.some(function(field) {
		return fieldChanged(tab, field);
	});
}

function collectSubnetIds(family, root) {
	var used = {};

	function add(list) {
		(Array.isArray(list) ? list : []).forEach(function(subnet) {
			if (isObject(subnet) && typeof subnet.id === "number")
				used[subnet.id] = true;
		});
	}

	add(root[family.subnets]);

	(Array.isArray(root["shared-networks"]) ? root["shared-networks"] : []).forEach(function(network) {
		if (isObject(network))
			add(network[family.subnets]);
	});

	return used;
}

function allocateSubnetId(used) {
	var id = 1;

	while (used[id])
		id++;

	used[id] = true;

	return id;
}

function tabHasContent(family, tab) {
	if (tab.enabled || tab.subnet !== "")
		return true;

	if (family.fields.some(function(field) { return tab[field] !== ""; }))
		return true;

	return tab.reservations.some(function(row) {
		return !rowIsBlank(family, row);
	});
}

function applyTimers(family, subnet, tab, errors) {
	var field, value;

	for (field in family.timers) {
		if (!fieldChanged(tab, field))
			continue;

		value = tab[field];

		if (value === "") {
			delete subnet[family.timers[field]];
		}
		else if (/^\d+$/.test(value)) {
			subnet[family.timers[field]] = Number(value);
		}
		else {
			errors.push(tab.label + ": " + _("timers and lifetimes must be whole numbers of seconds"));
			return;
		}
	}
}

function applyPools4(subnet, tab, errors) {
	if (!anyChanged(tab, [ "poolStart", "poolEnd" ]))
		return;

	if (tab.poolStart === "" && tab.poolEnd === "") {
		setFirstPool(subnet, "");
	}
	else if (tab.poolStart === "" || (tab.poolEnd === "" && tab.poolStart.indexOf("/") < 0)) {
		errors.push(tab.label + ": " + _("pool start and end must be set together"));
	}
	else {
		setFirstPool(subnet, tab.poolEnd === "" ?
			tab.poolStart : tab.poolStart + " - " + tab.poolEnd);
	}
}

function applyPools6(subnet, tab, errors) {
	var fields = [ "pdPrefix", "pdPrefixLen", "pdDelegatedLen" ];

	if (fieldChanged(tab, "pool"))
		setFirstPool(subnet, tab.pool);

	if (!anyChanged(tab, fields))
		return;

	if (fields.every(function(field) { return tab[field] === ""; })) {
		setFirstPdPool(subnet, null);
	}
	else if (fields.some(function(field) { return tab[field] === ""; })) {
		errors.push(tab.label + ": " + _("prefix delegation prefix, prefix length and delegated length must be set together"));
	}
	else if (!/^\d+$/.test(tab.pdPrefixLen) || !/^\d+$/.test(tab.pdDelegatedLen)) {
		errors.push(tab.label + ": " + _("prefix delegation lengths must be numeric"));
	}
	else {
		setFirstPdPool(subnet, tab.pdPrefix, Number(tab.pdPrefixLen), Number(tab.pdDelegatedLen));
	}
}

function mergeSubnet(family, subnet, tab, used, errors) {
	var field;

	if (tab.subnet === "")
		errors.push(tab.label + ": " + _("subnet is required"));

	if (tab.device === "" && (tab.enabled || !tab.source))
		errors.push(tab.label + ": " + _("interface device is required"));

	if (typeof subnet.id !== "number")
		subnet.id = allocateSubnetId(used);

	if (fieldChanged(tab, "subnet"))
		subnet.subnet = tab.subnet;

	if (fieldChanged(tab, "device")) {
		if (tab.device !== "")
			subnet["interface"] = tab.device;
		else
			delete subnet["interface"];
	}

	if (family.name === "dhcp4")
		applyPools4(subnet, tab, errors);
	else
		applyPools6(subnet, tab, errors);

	applyTimers(family, subnet, tab, errors);

	for (field in family.options)
		if (fieldChanged(tab, field))
			setOption(subnet, family.options[field], family.space, tab[field]);

	applyReservations(family, subnet, tab, errors);

	return subnet;
}

/*
 * Rewrite interfaces-config.interfaces for the devices shown as tabs and
 * leave every other entry ("*", "eth0/192.0.2.1", unknown devices) alone.
 */
function applyInterfaces(root, tabs) {
	var config = root["interfaces-config"];
	var current = isObject(config) && Array.isArray(config.interfaces) ? config.interfaces : [];
	var managed = {};
	var wanted = {};
	var result;

	tabs.forEach(function(tab) {
		if (tab.initial && tab.initial.device !== "")
			managed[tab.initial.device] = true;

		if (tab.device !== "")
			managed[tab.device] = true;

		if (!tab.removed && tab.enabled && tab.device !== "")
			wanted[tab.device] = true;
	});

	result = current.filter(function(entry) {
		var name = text(entry).split("/")[0];

		if (!managed[name])
			return true;

		if (!wanted[name])
			return false;

		delete wanted[name];
		return true;
	});

	tabs.forEach(function(tab) {
		if (wanted[tab.device]) {
			result.push(tab.device);
			delete wanted[tab.device];
		}
	});

	if (deepEqual(result, current))
		return;

	if (!isObject(config))
		config = root["interfaces-config"] = {};

	config.interfaces = result;
}

function applyTabs(family, config, tabs) {
	var out = isObject(config) ? clone(config) : {};
	var root, original, used, result, bySource, errors, i, tab;

	if (!isObject(out[family.root]))
		out[family.root] = {};

	root = out[family.root];
	original = Array.isArray(root[family.subnets]) ? root[family.subnets] : [];
	used = collectSubnetIds(family, root);
	result = [];
	bySource = {};
	errors = [];

	tabs.forEach(function(tab) {
		if (tab.sourceIndex !== null)
			bySource[tab.sourceIndex] = tab;
	});

	for (i = 0; i < original.length; i++) {
		tab = bySource[i];

		if (!tab)
			result.push(original[i]);
		else if (!tab.removed)
			result.push(mergeSubnet(family, original[i], tab, used, errors));
	}

	tabs.forEach(function(tab) {
		if (tab.sourceIndex !== null || tab.removed || !tabHasContent(family, tab))
			return;

		result.push(mergeSubnet(family, {}, tab, used, errors));
	});

	if (errors.length)
		return { errors: errors };

	if (result.length || hasOwn(root, family.subnets))
		root[family.subnets] = result;

	applyInterfaces(root, tabs);

	return { config: out };
}

/* ---- stock sample entries --------------------------------------------- */

function countSamples(family, config) {
	var root = isObject(config) && isObject(config[family.root]) ? config[family.root] : {};
	var count = function(list, test) {
		return (Array.isArray(list) ? list : []).filter(function(item) {
			return test(family, item);
		}).length;
	};

	return {
		subnets: count(root[family.subnets], isSampleSubnet),
		options: count(root["option-data"], isSampleOption),
		classes: count(root["client-classes"], isSampleClass)
	};
}

function removeSamples(family, config) {
	var out = isObject(config) ? clone(config) : {};
	var root = isObject(out[family.root]) ? out[family.root] : {};
	var prune = function(key, test, keepEmpty) {
		if (!Array.isArray(root[key]))
			return;

		root[key] = root[key].filter(function(item) {
			return !test(family, item);
		});

		if (!root[key].length && !keepEmpty)
			delete root[key];
	};

	prune(family.subnets, isSampleSubnet, true);
	prune("option-data", isSampleOption, false);
	prune("client-classes", isSampleClass, false);

	return out;
}

return baseclass.extend({
	family: function(name) {
		return FAMILIES[name];
	},

	stripJsonComments: stripJsonComments,
	deepEqual: deepEqual,
	clone: clone,

	/*
	 * Parse a Kea configuration file. "hasComments" tells the caller that
	 * writing the parsed configuration back will drop comments.
	 */
	parseConfig: function(content) {
		var source = text(content);
		var stripped = stripJsonComments(source);

		try {
			return {
				config: JSON.parse(stripped.trim() === "" ? "{}" : stripped),
				error: null,
				hasComments: stripped !== source
			};
		}
		catch (err) {
			return { config: null, error: err.message, hasComments: false };
		}
	},

	serialize: function(config) {
		return JSON.stringify(config, null, "\t") + "\n";
	},

	/* Build the editor tabs: one per interface, plus one per unbound subnet. */
	buildTabs: function(familyName, config, interfaces) {
		return buildTabs(FAMILIES[familyName], config, interfaces);
	},

	/*
	 * Merge the tabs back into a copy of the configuration.
	 * Returns { config } on success or { errors: [ ... ] }.
	 */
	applyTabs: function(familyName, config, tabs) {
		return applyTabs(FAMILIES[familyName], config, tabs);
	},

	newReservation: function(familyName) {
		return makeRow(FAMILIES[familyName], null, true);
	},

	/* True when Kea is configured to listen on every interface ("*"). */
	listensOnAll: function(familyName, config) {
		var family = FAMILIES[familyName];
		var root = isObject(config) && isObject(config[family.root]) ? config[family.root] : {};

		return interfaceNames(root).indexOf("*") >= 0;
	},

	countSamples: function(familyName, config) {
		return countSamples(FAMILIES[familyName], config);
	},

	removeSamples: function(familyName, config) {
		return removeSamples(FAMILIES[familyName], config);
	}
});
