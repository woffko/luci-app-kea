"use strict";
"require baseclass";

/*
 * Kea configuration model shared by the DHCPv4 and DHCPv6 editors.
 *
 * The editors show the common settings of each subnet. Everything else in
 * the Kea configuration must survive a save untouched, so this module never
 * rebuilds a subnet from the form. It keeps the original objects, remembers
 * the values the form started with, and on save writes back only what the
 * user changed.
 *
 * Input is checked the way Kea 3.0 checks it, so that a mistake is shown
 * next to the field instead of as a parser message after the round trip.
 * Only values the user changed are checked: a file that Kea already accepts
 * is never held back because of something the user did not touch.
 *
 * The module has no DOM or RPC dependencies and is unit-tested under Node.
 */

/* Key used inside Kea "user-context" objects for data owned by this app. */
var CONTEXT_KEY = "luci-app-kea";
var DISABLED_KEY = "disabled-reservations";

var FAMILIES = {
	dhcp4: {
		name: "dhcp4",
		version: 4,
		root: "Dhcp4",
		subnets: "subnet4",
		space: "dhcp4",
		idTypes: [ "hw-address", "client-id", "duid", "circuit-id", "flex-id" ],
		fields: [
			"router", "dnsServers", "domainName", "domainSearch",
			"renewTimer", "rebindTimer", "validLifetime"
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
		version: 6,
		root: "Dhcp6",
		subnets: "subnet6",
		space: "dhcp6",
		idTypes: [ "duid", "hw-address", "flex-id" ],
		fields: [
			"dnsServers", "domainSearch",
			"renewTimer", "rebindTimer", "preferredLifetime", "validLifetime"
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

var POOL_FIELDS = [ "pool" ];
var PD_FIELDS = [ "prefix", "prefixLen", "delegatedLen" ];
var OPTION_FIELDS = [ "name", "data" ];

/* Field names as shown in the form and in error messages. */
var LABELS = {
	device: _("Interface"),
	subnet: _("Subnet"),
	router: _("Gateway"),
	dnsServers: _("DNS Servers"),
	domainName: _("Domain Name"),
	domainSearch: _("Domain Search"),
	renewTimer: _("Renew Timer"),
	rebindTimer: _("Rebind Timer"),
	preferredLifetime: _("Preferred Lifetime"),
	validLifetime: _("Valid Lifetime"),
	lfcInterval: _("Lease File Cleanup")
};

function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value) {
	return Array.isArray(value) ? value : [];
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

/* ---- addresses -------------------------------------------------------- */

/*
 * Addresses are handled as BigInt for both protocols, so ranges and
 * prefixes compare the same way. BigInt(n) is used instead of literals to
 * stay friendly to the minifier LuCI runs over this file.
 */
var ZERO = BigInt(0);
var ONE = BigInt(1);

function parseIPv4(value) {
	var parts = text(value).split(".");
	var result = ZERO;
	var i;

	if (parts.length !== 4)
		return null;

	for (i = 0; i < 4; i++) {
		if (!/^\d{1,3}$/.test(parts[i]) || Number(parts[i]) > 255)
			return null;

		result = result * BigInt(256) + BigInt(Number(parts[i]));
	}

	return result;
}

function parseIPv6(value) {
	var halves = text(value).split("::");
	var head, tail, groups, result, i;

	if (text(value) === "" || halves.length > 2 || /[^0-9a-fA-F:]/.test(text(value)))
		return null;

	head = halves[0] === "" ? [] : halves[0].split(":");
	tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];

	if (halves.length === 1) {
		if (head.length !== 8)
			return null;

		groups = head;
	}
	else {
		if (head.length + tail.length > 7)
			return null;

		groups = head.slice();

		while (groups.length + tail.length < 8)
			groups.push("0");

		groups = groups.concat(tail);
	}

	result = ZERO;

	for (i = 0; i < 8; i++) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i]))
			return null;

		result = result * BigInt(65536) + BigInt(parseInt(groups[i], 16));
	}

	return result;
}

function parseAddress(version, value) {
	return version === 4 ? parseIPv4(value) : parseIPv6(value);
}

/* "192.168.1.0/24" -> { first, last, prefix }, or null. */
function parsePrefix(version, value) {
	var parts = text(value).trim().split("/");
	var bits = version === 4 ? 32 : 128;
	var address = parseAddress(version, parts[0]);
	var prefix, size, first;

	if (address === null || parts.length !== 2 || !/^\d{1,3}$/.test(parts[1]))
		return null;

	prefix = Number(parts[1]);

	if (prefix > bits)
		return null;

	size = ONE << BigInt(bits - prefix);
	first = address - (address % size);

	return { first: first, last: first + size - ONE, prefix: prefix };
}

/* A pool is "first - last" or a prefix. Returns { first, last } or null. */
function parsePool(version, value) {
	var match = text(value).trim().match(/^(\S+?)\s*-\s*(\S+)$/);
	var first, last;

	if (!match)
		return parsePrefix(version, value);

	first = parseAddress(version, match[1]);
	last = parseAddress(version, match[2]);

	return first === null || last === null ? null : { first: first, last: last };
}

function ipv4Network(value) {
	var cidr = parsePrefix(4, text(value).indexOf("/") < 0 ? text(value) + "/32" : value);

	return cidr ? { network: cidr.first, prefix: cidr.prefix } : null;
}

/* ---- checks ----------------------------------------------------------- */

/*
 * Each check returns a message for a wrong value and null for a good one.
 * They are stricter than "does it parse" only where Kea rejects the value.
 */

function checkSubnet(family, value) {
	if (value === "")
		return _("a subnet is required");

	return parsePrefix(family.version, value) ? null :
		(family.version === 4 ?
			_("not an IPv4 subnet such as 192.168.1.0/24") :
			_("not an IPv6 subnet such as fd00:1::/64"));
}

function checkDevice(value) {
	return value === "" || /^[A-Za-z0-9_.:@-]+$/.test(value) ? null :
		_("not a network device name");
}

function checkAddressList(version, value) {
	var bad = splitList(value).filter(function(item) {
		return parseAddress(version, item) === null;
	});

	if (!bad.length)
		return null;

	return (version === 4 ? _("not an IPv4 address") : _("not an IPv6 address")) + ": " + bad.join(", ");
}

function checkTimer(value) {
	return value === "" || /^\d+$/.test(value) ? null : _("not a whole number of seconds");
}

function checkPool(family, subnet, value) {
	var pool = parsePool(family.version, value);
	var cidr = parsePrefix(family.version, subnet);

	if (!pool)
		return family.version === 4 ?
			_("not an address range such as 192.168.1.100 - 192.168.1.199") :
			_("not an address range or prefix such as fd00:1::100 - fd00:1::1ff");

	if (pool.first > pool.last)
		return _("the range ends before it starts");

	if (cidr && (pool.first < cidr.first || pool.last > cidr.last))
		return _("the range is outside the subnet");

	return null;
}

function checkPdPool(row) {
	if (parseIPv6(row.prefix) === null)
		return _("the delegated prefix is not an IPv6 address such as fd00:1:0:100::");

	if (!/^\d+$/.test(row.prefixLen) || !/^\d+$/.test(row.delegatedLen))
		return _("the prefix length and the delegated length must be numbers");

	if (Number(row.prefixLen) < 1 || Number(row.delegatedLen) > 128)
		return _("the lengths must be between 1 and 128");

	if (Number(row.delegatedLen) < Number(row.prefixLen))
		return _("the delegated length must not be shorter than the prefix length");

	return null;
}

function isHexString(value) {
	return /^([0-9a-fA-F]{2}:)*[0-9a-fA-F]{2}$/.test(value) ||
		(/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0);
}

function checkIdentifier(type, value) {
	var quoted = /^'.+'$/.test(value);

	if (value === "")
		return _("an identifier is required");

	if (type === "hw-address")
		return /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value) ? null :
			_("not a MAC address such as 00:11:22:33:44:55");

	if (type === "duid") {
		if (!isHexString(value))
			return _("not a DUID: use hex octets such as 00:03:00:01:02:00:00:00:00:01");

		return value.replace(/:/g, "").length >= 6 ? null : _("a DUID has at least three octets");
	}

	if (type === "client-id")
		return isHexString(value) ? null : _("not a client ID: use hex octets such as 01:11:22:33:44:55:66");

	/* circuit-id and flex-id: hex octets or text in single quotes. */
	return isHexString(value) || quoted ? null :
		_("use hex octets, or text in single quotes such as 'port-7'");
}

function checkReservedAddress(family, subnet, value) {
	var address = parseAddress(family.version, value);
	var cidr = parsePrefix(family.version, subnet);

	if (address === null)
		return (family.version === 4 ? _("not an IPv4 address") : _("not an IPv6 address")) + ": " + value;

	if (cidr && (address < cidr.first || address > cidr.last))
		return _("the address is outside the subnet") + ": " + value;

	return null;
}

function checkOptionName(value) {
	return /^[A-Za-z0-9-]+$/.test(value) ? null : _("an option needs a name or a numeric code");
}

/* The message for one field of a subnet tab, or null. */
function fieldError(family, tab, field) {
	var value = tab[field];

	if (field === "subnet")
		return checkSubnet(family, value);

	if (field === "device")
		return checkDevice(value);

	if (field === "router")
		return checkAddressList(4, value);

	if (field === "dnsServers")
		return checkAddressList(family.version, value);

	if (hasOwn(family.timers, field) || field === "lfcInterval")
		return checkTimer(value);

	return null;
}

/* The message for one field of a reservation row, or null. */
function reservationError(family, tab, row, field) {
	var i, error, list;

	if (field === "identity")
		return row.identity === "" && !row.enabled ? null : checkIdentifier(row.type, row.identity);

	if (field === "address")
		return row.address === "" ? null : checkReservedAddress(family, tab.subnet, row.address);

	if (field === "addresses") {
		list = splitList(row.addresses);

		for (i = 0; i < list.length; i++) {
			error = checkReservedAddress(family, tab.subnet, list[i]);

			if (error)
				return error;
		}
	}

	if (field === "prefixes") {
		list = splitList(row.prefixes);

		for (i = 0; i < list.length; i++)
			if (!parsePrefix(6, list[i]))
				return _("not an IPv6 prefix such as fd00:1:0:200::/64") + ": " + list[i];
	}

	return null;
}

/* ---- subnets and their place in the configuration --------------------- */

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

	return array(isObject(config) ? config.interfaces : null).map(function(entry) {
		return text(entry).split("/")[0];
	});
}

function sharedNetworks(root) {
	return array(root["shared-networks"]).filter(isObject);
}

/*
 * The lists that hold subnets: the top-level one (container null) and one
 * per shared network (container = its index among the shared networks).
 */
function subnetLists(family, root) {
	var lists = [ { container: null, network: null, subnets: array(root[family.subnets]) } ];

	array(root["shared-networks"]).forEach(function(network, index) {
		if (isObject(network))
			lists.push({ container: index, network: network, subnets: array(network[family.subnets]) });
	});

	return lists;
}

/* ---- rows ------------------------------------------------------------- */

/*
 * Pools, options and reservations are edited as rows. A row remembers the
 * object it came from and the values it started with. An untouched row is
 * written back as a copy of its source, so keys the form does not show and
 * the formatting of its values survive.
 */

function snapshot(object, fields) {
	var result = {};

	fields.forEach(function(field) {
		result[field] = object[field];
	});

	return result;
}

function rowChanged(row, fields) {
	return !row.initial || fields.some(function(field) {
		return row[field] !== row.initial[field];
	});
}

function rowBlank(row, fields) {
	return !row.source && fields.every(function(field) {
		return row[field] === "";
	});
}

function makePoolRow(pool) {
	var row = { pool: "", source: null, initial: null };

	if (isObject(pool)) {
		row.source = clone(pool);
		row.pool = text(pool.pool);
		row.initial = snapshot(row, POOL_FIELDS);
	}

	return row;
}

function makePdRow(pool) {
	var row = { prefix: "", prefixLen: "", delegatedLen: "", source: null, initial: null };

	if (isObject(pool)) {
		row.source = clone(pool);
		row.prefix = text(pool.prefix);
		row.prefixLen = text(pool["prefix-len"]);
		row.delegatedLen = text(pool["delegated-len"]);
		row.initial = snapshot(row, PD_FIELDS);
	}

	return row;
}

/* An option is named by its name, or by its code when it has no name. */
function makeOptionRow(option, index) {
	var row = { name: "", data: "", source: null, sourceIndex: null, initial: null };

	if (isObject(option)) {
		row.source = clone(option);
		row.sourceIndex = index;
		row.name = hasOwn(option, "name") ? text(option.name) : text(option.code);
		row.data = text(option.data);
		row.initial = snapshot(row, OPTION_FIELDS);
	}

	return row;
}

/* ---- options ---------------------------------------------------------- */

function optionMatches(option, def, space) {
	if (!isObject(option) || (hasOwn(option, "space") && option.space !== space))
		return false;

	return option.name === def.name || (!hasOwn(option, "name") && option.code === def.code);
}

function findOption(options, def, space) {
	var i;

	for (i = 0; i < options.length; i++)
		if (optionMatches(options[i], def, space))
			return i;

	return -1;
}

/* True for an option that has a field of its own in the subnet form. */
function hasOwnField(family, option) {
	var field;

	for (field in family.options)
		if (optionMatches(option, family.options[field], family.space))
			return true;

	return false;
}

function optionValue(holder, def, space) {
	var options = array(holder["option-data"]);
	var index = findOption(options, def, space);

	return index < 0 ? "" : text(options[index].data);
}

function setOption(holder, def, space, value) {
	var options = array(holder["option-data"]);
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
		holder["option-data"] = options;
	else
		delete holder["option-data"];
}

/* The option rows of a subnet (family given) or of the global scope. */
function loadOptionRows(holder, family) {
	var rows = [];

	array(holder["option-data"]).forEach(function(option, index) {
		if (isObject(option) && !(family && hasOwnField(family, option)))
			rows.push(makeOptionRow(option, index));
	});

	return rows;
}

function optionFromRow(row) {
	var option = row.source ? clone(row.source) : {};

	if (rowChanged(row, [ "name" ])) {
		delete option.name;
		delete option.code;

		if (/^\d+$/.test(row.name))
			option.code = Number(row.name);
		else
			option.name = row.name;
	}

	if (rowChanged(row, [ "data" ]))
		option.data = row.data;

	return option;
}

/*
 * Write the option rows back. An option that was never offered as a row
 * (one with a field of its own in the subnet form, or anything that is not
 * an object) keeps its place; an option whose row is gone was deleted.
 * "family" is given for a subnet and null for the global scope.
 */
function applyOptionRows(holder, rows, family, label, errors) {
	var original = array(holder["option-data"]);
	var bySource = {};
	var result = [];

	rows.forEach(function(row) {
		if (row.sourceIndex !== null)
			bySource[row.sourceIndex] = row;
	});

	original.forEach(function(option, index) {
		var row = bySource[index];
		var offered = isObject(option) && !(family && hasOwnField(family, option));

		if (!offered)
			result.push(option);
		else if (row)
			result.push(rowChanged(row, OPTION_FIELDS) ? optionFromRow(row) : option);
	});

	rows.forEach(function(row) {
		var error;

		if (rowBlank(row, OPTION_FIELDS))
			return;

		if (row.sourceIndex === null)
			result.push(optionFromRow(row));

		if (!rowChanged(row, OPTION_FIELDS))
			return;

		error = checkOptionName(row.name);

		if (error)
			errors.push(label + ": " + _("Other Options") + ": " + error);
	});

	if (deepEqual(result, original))
		return;

	if (result.length)
		holder["option-data"] = result;
	else
		delete holder["option-data"];
}

/* ---- pools ------------------------------------------------------------ */

function applyPools(family, subnet, tab, errors, checkAll) {
	var result = [];
	var ranges = [];
	var changed = false;

	tab.pools.forEach(function(row) {
		var pool, error, range;

		if (rowBlank(row, POOL_FIELDS))
			return;

		if (row.source && !rowChanged(row, POOL_FIELDS)) {
			pool = clone(row.source);
		}
		else {
			pool = row.source ? clone(row.source) : {};
			pool.pool = row.pool;
			changed = true;
		}

		if (checkAll || rowChanged(row, POOL_FIELDS)) {
			error = checkPool(family, tab.subnet, row.pool);

			if (error)
				errors.push(tab.label + ": " + _("Address Pools") + ": " + row.pool + ": " + error);
		}

		range = parsePool(family.version, row.pool);

		if (range)
			ranges.push({ text: row.pool, first: range.first, last: range.last });

		result.push(pool);
	});

	if (changed || checkAll)
		ranges.forEach(function(a, i) {
			ranges.slice(i + 1).forEach(function(b) {
				if (a.first <= b.last && b.first <= a.last)
					errors.push(tab.label + ": " + _("Address Pools") + ": " +
						_("these ranges overlap") + ": " + a.text + ", " + b.text);
			});
		});

	if (deepEqual(result, array(subnet.pools)))
		return;

	if (result.length)
		subnet.pools = result;
	else
		delete subnet.pools;
}

function applyPdPools(subnet, tab, errors) {
	var result = [];

	tab.pdPools.forEach(function(row) {
		var pool, error;

		if (rowBlank(row, PD_FIELDS))
			return;

		if (row.source && !rowChanged(row, PD_FIELDS)) {
			result.push(clone(row.source));
			return;
		}

		error = checkPdPool(row);

		if (error) {
			errors.push(tab.label + ": " + _("Prefix Delegation") + ": " + error);
			return;
		}

		pool = row.source ? clone(row.source) : {};
		pool.prefix = row.prefix;
		pool["prefix-len"] = Number(row.prefixLen);
		pool["delegated-len"] = Number(row.delegatedLen);
		result.push(pool);
	});

	if (deepEqual(result, array(subnet["pd-pools"])))
		return;

	if (result.length)
		subnet["pd-pools"] = result;
	else
		delete subnet["pd-pools"];
}

/* ---- reservations ----------------------------------------------------- */

function disabledReservations(subnet) {
	var context = subnet["user-context"];
	var own = isObject(context) ? context[CONTEXT_KEY] : null;

	return array(isObject(own) ? own[DISABLED_KEY] : null);
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
		row.addresses = array(reservation["ip-addresses"]).join(", ");
		row.prefixes = array(reservation.prefixes).join(", ");
	}

	row.initial = snapshot(row, family.rowFields);
	row.initial.enabled = enabled;

	return row;
}

/* A new row the user never filled in. The identifier type has a default. */
function reservationBlank(family, row) {
	return rowBlank(row, family.rowFields.filter(function(field) {
		return field !== "type";
	}));
}

function setList(target, key, value) {
	var list = splitList(value);

	if (list.length)
		target[key] = list;
	else
		delete target[key];
}

function reservationFromRow(family, row) {
	var changed = function(field) {
		return rowChanged(row, [ field ]);
	};
	var reservation;

	if (row.source && !rowChanged(row, family.rowFields))
		return clone(row.source);

	reservation = row.source ? clone(row.source) : {};

	if (changed("type") || changed("identity")) {
		family.idTypes.forEach(function(type) {
			delete reservation[type];
		});

		if (row.identity !== "")
			reservation[row.type] = row.identity;
	}

	if (family.name === "dhcp4") {
		if (changed("address")) {
			if (row.address !== "")
				reservation["ip-address"] = row.address;
			else
				delete reservation["ip-address"];
		}
	}
	else {
		if (changed("addresses"))
			setList(reservation, "ip-addresses", row.addresses);

		if (changed("prefixes"))
			setList(reservation, "prefixes", row.prefixes);
	}

	if (changed("hostname")) {
		if (row.hostname !== "")
			reservation.hostname = row.hostname;
		else
			delete reservation.hostname;
	}

	return reservation;
}

/* Kea refuses two reservations of one subnet with one identifier or address. */
function checkDuplicateReservations(family, tab, errors) {
	var seen = {};

	tab.reservations.forEach(function(row) {
		var keys = [];

		if (!row.enabled || reservationBlank(family, row))
			return;

		if (row.identity !== "")
			keys.push(row.type + " " + row.identity.toLowerCase());

		splitList(family.name === "dhcp4" ? row.address : row.addresses).forEach(function(address) {
			keys.push("address " + address.toLowerCase());
		});

		keys.forEach(function(key) {
			if (seen[key])
				errors.push(tab.label + ": " + _("Static Reservations") + ": " +
					_("used by more than one reservation") + ": " + key.replace(/^\S+ /, ""));

			seen[key] = true;
		});
	});
}

function applyReservations(family, subnet, tab, errors, checkAll) {
	var enabled = [];
	var disabled = [];
	var changed = false;

	tab.reservations.forEach(function(row) {
		var touched;

		if (reservationBlank(family, row))
			return;

		touched = rowChanged(row, family.rowFields) || row.enabled !== (row.initial && row.initial.enabled);
		changed = changed || touched;

		/* Rows that are switched off are stored as inert data. */
		if (row.enabled && (touched || checkAll))
			family.rowFields.forEach(function(field) {
				var error = reservationError(family, tab, row, field);

				if (error)
					errors.push(tab.label + ": " + _("Static Reservations") + ": " + error);
			});

		(row.enabled ? enabled : disabled).push(reservationFromRow(family, row));
	});

	if (!deepEqual(enabled, array(subnet.reservations))) {
		changed = true;

		if (enabled.length || hasOwn(subnet, "reservations"))
			subnet.reservations = enabled;
	}

	if (changed)
		checkDuplicateReservations(family, tab, errors);

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
		served: !!item.served,
		enabled: false,
		removed: false,
		device: text(item.device),
		subnet: "",
		pools: [],
		pdPools: [],
		options: [],
		reservations: [],
		defaults: {},
		source: null,
		container: null,
		sourceIndex: null,
		initial: null
	};

	family.fields.forEach(function(field) {
		tab[field] = "";
	});

	return tab;
}

function loadSubnet(family, tab, subnet, container, index) {
	var field;

	tab.source = clone(subnet);
	tab.container = container;
	tab.sourceIndex = index;
	tab.subnet = text(subnet.subnet);

	if (subnetBinding(subnet))
		tab.device = subnetBinding(subnet);

	tab.pools = array(subnet.pools).filter(isObject).map(makePoolRow);

	if (family.version === 6)
		tab.pdPools = array(subnet["pd-pools"]).filter(isObject).map(makePdRow);

	for (field in family.options)
		tab[field] = optionValue(subnet, family.options[field], family.space);

	for (field in family.timers)
		tab[field] = text(subnet[family.timers[field]]);

	tab.options = loadOptionRows(subnet, family);

	tab.reservations = array(subnet.reservations).filter(isObject)
		.map(function(reservation) {
			return makeRow(family, reservation, true);
		})
		.concat(disabledReservations(subnet).filter(isObject).map(function(reservation) {
			return makeRow(family, reservation, false);
		}));
}

function tabSnapshot(family, tab) {
	return snapshot(tab, [ "enabled", "device", "subnet" ].concat(family.fields));
}

function findTabByNetwork(tabs, subnet) {
	var target = ipv4Network(subnet.subnet);
	var i, j, addresses, network;

	if (!target)
		return null;

	for (i = 0; i < tabs.length; i++) {
		if (tabs[i].source)
			continue;

		addresses = splitList(tabs[i].address);

		for (j = 0; j < addresses.length; j++) {
			network = ipv4Network(addresses[j]);

			if (network && network.prefix === target.prefix && network.network === target.network)
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
	var names = interfaceNames(root);
	var tabs = [];
	var byDevice = {};
	var defaults = {};
	var field;

	for (field in family.timers)
		defaults[field] = text(root[family.timers[field]]);

	array(interfaces).forEach(function(item) {
		var tab;

		if (!isObject(item) || item.name === "loopback" || item.device === "lo" || !item.device)
			return;

		tab = makeTab(family, {
			name: item.name,
			device: item.device,
			address: family.version === 4 ? item.ipaddr : item.ip6addr,
			served: family.version === 4 ? item.dhcp4_server : item.dhcp6_server
		});

		tabs.push(tab);

		if (!byDevice[tab.device])
			byDevice[tab.device] = tab;
	});

	subnetLists(family, root).forEach(function(list) {
		list.subnets.forEach(function(subnet, index) {
			var key, tab;

			if (!isObject(subnet) || isSampleSubnet(family, subnet))
				return;

			key = subnetBinding(subnet);

			/* A subnet of a shared network always gets a tab of its own. */
			if (list.network)
				tab = null;
			else if (key)
				tab = byDevice[key];
			else if (family.version === 4)
				tab = findTabByNetwork(tabs, subnet);
			else
				tab = findOnlyListeningTab(tabs, names);

			if (!tab || tab.source) {
				tab = makeTab(family, {
					name: key || text(subnet.subnet),
					device: key || (list.network ? text(list.network["interface"]) : ""),
					label: (list.network ? (text(list.network.name) || _("shared network")) + ": " :
						key ? key + ": " : "") + (text(subnet.subnet) || "#" + (index + 1)),
					served: key && byDevice[key] ? byDevice[key].served : false
				});

				tabs.push(tab);
			}

			loadSubnet(family, tab, subnet, list.container, index);
		});
	});

	tabs.forEach(function(tab) {
		tab.enabled = tab.device !== "" && names.indexOf(tab.device) >= 0;
		tab.defaults = defaults;
		tab.initial = tabSnapshot(family, tab);
	});

	return tabs;
}

/* ---- global settings -------------------------------------------------- */

function buildGlobal(family, config) {
	var root = isObject(config) && isObject(config[family.root]) ? config[family.root] : {};
	var database = isObject(root["lease-database"]) ? root["lease-database"] : {};
	var global = {
		lfcInterval: text(database["lfc-interval"]),
		leaseType: text(database.type),
		options: loadOptionRows(root, null)
	};
	var field;

	for (field in family.timers)
		global[field] = text(root[family.timers[field]]);

	global.initial = snapshot(global, Object.keys(family.timers).concat([ "lfcInterval" ]));

	return global;
}

function applyGlobal(family, root, global, errors) {
	var label = _("Global settings");
	var changed = function(field) {
		return global[field] !== global.initial[field];
	};
	var field, error;

	for (field in family.timers) {
		if (!changed(field))
			continue;

		error = checkTimer(global[field]);

		if (error)
			errors.push(label + ": " + LABELS[field] + ": " + error);
		else if (global[field] === "")
			delete root[family.timers[field]];
		else
			root[family.timers[field]] = Number(global[field]);
	}

	if (changed("lfcInterval")) {
		error = checkTimer(global.lfcInterval);

		if (error) {
			errors.push(label + ": " + LABELS.lfcInterval + ": " + error);
		}
		else if (global.lfcInterval === "") {
			if (isObject(root["lease-database"]))
				delete root["lease-database"]["lfc-interval"];
		}
		else {
			if (!isObject(root["lease-database"]))
				root["lease-database"] = { type: "memfile" };

			root["lease-database"]["lfc-interval"] = Number(global.lfcInterval);
		}
	}

	applyOptionRows(root, global.options, null, label, errors);
}

/* ---- saving ----------------------------------------------------------- */

function fieldChanged(tab, field) {
	return !tab.source || tab[field] !== tab.initial[field];
}

function collectSubnetIds(family, root) {
	var used = {};

	subnetLists(family, root).forEach(function(list) {
		list.subnets.forEach(function(subnet) {
			if (isObject(subnet) && typeof subnet.id === "number")
				used[subnet.id] = true;
		});
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

	return tab.pools.some(function(row) { return !rowBlank(row, POOL_FIELDS); }) ||
		tab.pdPools.some(function(row) { return !rowBlank(row, PD_FIELDS); }) ||
		tab.options.some(function(row) { return !rowBlank(row, OPTION_FIELDS); }) ||
		tab.reservations.some(function(row) { return !reservationBlank(family, row); });
}

function mergeSubnet(family, subnet, tab, used, errors) {
	var subnetChanged = fieldChanged(tab, "subnet");
	var field, error;

	[ "subnet", "device" ].concat(family.fields).forEach(function(name) {
		if (!fieldChanged(tab, name))
			return;

		error = fieldError(family, tab, name);

		if (error)
			errors.push(tab.label + ": " + LABELS[name] + ": " + error);
	});

	if (tab.device === "" && (tab.enabled || !tab.source))
		errors.push(tab.label + ": " + LABELS.device + ": " + _("an interface device is required"));

	if (typeof subnet.id !== "number")
		subnet.id = allocateSubnetId(used);

	if (subnetChanged)
		subnet.subnet = tab.subnet;

	if (fieldChanged(tab, "device")) {
		if (tab.device !== "")
			subnet["interface"] = tab.device;
		else
			delete subnet["interface"];
	}

	/* A new subnet prefix puts every pool and reservation to the test. */
	applyPools(family, subnet, tab, errors, subnetChanged);

	if (family.version === 6)
		applyPdPools(subnet, tab, errors);

	for (field in family.timers) {
		if (!fieldChanged(tab, field) || checkTimer(tab[field]))
			continue;

		if (tab[field] === "")
			delete subnet[family.timers[field]];
		else
			subnet[family.timers[field]] = Number(tab[field]);
	}

	/* Option rows first: they are addressed by their original position. */
	applyOptionRows(subnet, tab.options, family, tab.label, errors);

	for (field in family.options)
		if (fieldChanged(tab, field))
			setOption(subnet, family.options[field], family.space, tab[field]);

	applyReservations(family, subnet, tab, errors, subnetChanged);

	return subnet;
}

/*
 * Kea refuses a configuration that names the same subnet twice. Reported
 * only when one of the two was just entered or changed.
 */
function checkDuplicateSubnets(family, tabs, errors) {
	var seen = {};

	tabs.forEach(function(tab) {
		var cidr, key, other;

		if (tab.removed || !(tab.source || tabHasContent(family, tab)))
			return;

		cidr = parsePrefix(family.version, tab.subnet);

		if (!cidr)
			return;

		key = cidr.first + "/" + cidr.prefix;
		other = seen[key];

		if (!other)
			seen[key] = tab;
		else if (fieldChanged(tab, "subnet") || fieldChanged(other, "subnet"))
			errors.push((fieldChanged(tab, "subnet") ? tab : other).label + ": " + LABELS.subnet + ": " +
				_("another subnet of this configuration has the same prefix") + ": " + tab.subnet);
	});
}

/*
 * Rewrite interfaces-config.interfaces for the devices shown as tabs and
 * leave every other entry ("*", "eth0/192.0.2.1", unknown devices) alone.
 */
function applyInterfaces(root, tabs) {
	var config = root["interfaces-config"];
	var current = array(isObject(config) ? config.interfaces : null);
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

function applyTabs(family, config, tabs, global) {
	var out = isObject(config) ? clone(config) : {};
	var errors = [];
	var root, used, top;

	if (!isObject(out[family.root]))
		out[family.root] = {};

	root = out[family.root];
	used = collectSubnetIds(family, root);

	if (global)
		applyGlobal(family, root, global, errors);

	subnetLists(family, root).forEach(function(list) {
		var holder = list.network || root;
		var result = [];

		list.subnets.forEach(function(subnet, index) {
			var tab = tabs.filter(function(candidate) {
				return candidate.source && candidate.container === list.container &&
					candidate.sourceIndex === index;
			})[0];

			if (!tab)
				result.push(subnet);
			else if (!tab.removed)
				result.push(mergeSubnet(family, subnet, tab, used, errors));
		});

		if (list.container === null)
			top = result;
		else if (!deepEqual(result, list.subnets))
			holder[family.subnets] = result;
	});

	tabs.forEach(function(tab) {
		if (tab.source || tab.removed || !tabHasContent(family, tab))
			return;

		top.push(mergeSubnet(family, {}, tab, used, errors));
	});

	checkDuplicateSubnets(family, tabs, errors);

	if (errors.length)
		return { errors: errors };

	if (top.length || hasOwn(root, family.subnets))
		root[family.subnets] = top;

	applyInterfaces(root, tabs);

	return { config: out };
}

/* ---- stock sample entries --------------------------------------------- */

function countSamples(family, config) {
	var root = isObject(config) && isObject(config[family.root]) ? config[family.root] : {};
	var count = function(list, test) {
		return array(list).filter(function(item) {
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

/* ---- text comparison -------------------------------------------------- */

/*
 * Compare two texts line by line. Returns the lines that differ with a few
 * lines of context around them, as [ { op, text } ] where op is " " for
 * context, "-" for a removed line, "+" for an added line and "@" for a gap.
 */
function lineDiff(before, after, context) {
	var a = text(before).split("\n");
	var b = text(after).split("\n");
	var ops = [];
	var result = [];
	var table, i, j, keep, last;

	context = context === undefined ? 2 : context;

	/* The table grows with the product of the sizes; keep it bounded. */
	if (a.length * b.length > 4000000)
		return [ { op: "@", text: _("The texts are too large to compare line by line.") } ];

	table = [];

	for (i = a.length; i >= 0; i--) {
		table[i] = [];

		for (j = b.length; j >= 0; j--) {
			if (i === a.length || j === b.length)
				table[i][j] = 0;
			else if (a[i] === b[j])
				table[i][j] = table[i + 1][j + 1] + 1;
			else
				table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	i = 0;
	j = 0;

	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			ops.push({ op: " ", text: a[i] });
			i++;
			j++;
		}
		else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
			/* Removals first, as in a unified diff. */
			ops.push({ op: "-", text: a[i] });
			i++;
		}
		else {
			ops.push({ op: "+", text: b[j] });
			j++;
		}
	}

	keep = ops.map(function() {
		return false;
	});

	ops.forEach(function(entry, index) {
		var k;

		if (entry.op === " ")
			return;

		for (k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++)
			keep[k] = true;
	});

	last = -1;

	ops.forEach(function(entry, index) {
		if (!keep[index])
			return;

		if (last >= 0 && index > last + 1)
			result.push({ op: "@", text: "" });

		result.push(entry);
		last = index;
	});

	return result;
}

return baseclass.extend({
	family: function(name) {
		return FAMILIES[name];
	},

	label: function(field) {
		return LABELS[field];
	},

	stripJsonComments: stripJsonComments,
	deepEqual: deepEqual,
	clone: clone,
	lineDiff: lineDiff,

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

	/*
	 * Build the editor tabs: one per interface, plus one per subnet that is
	 * not bound to an interface or belongs to a shared network.
	 */
	buildTabs: function(familyName, config, interfaces) {
		return buildTabs(FAMILIES[familyName], config, interfaces);
	},

	/* The settings above the subnets: timers, lease file cleanup, options. */
	buildGlobal: function(familyName, config) {
		return buildGlobal(FAMILIES[familyName], config);
	},

	/*
	 * Merge the tabs, and the global settings if given, back into a copy of
	 * the configuration. Returns { config } or { errors: [ ... ] }.
	 */
	applyTabs: function(familyName, config, tabs, global) {
		return applyTabs(FAMILIES[familyName], config, tabs, global);
	},

	newReservation: function(familyName) {
		return makeRow(FAMILIES[familyName], null, true);
	},

	newPool: function() {
		return makePoolRow(null);
	},

	newPdPool: function() {
		return makePdRow(null);
	},

	newOption: function() {
		return makeOptionRow(null, null);
	},

	/* Messages for single inputs, for marking them while the user types. */
	fieldError: function(familyName, tab, field) {
		return fieldError(FAMILIES[familyName], tab, field);
	},

	reservationError: function(familyName, tab, row, field) {
		return reservationError(FAMILIES[familyName], tab, row, field);
	},

	poolError: function(familyName, tab, row) {
		return row.pool === "" ? null : checkPool(FAMILIES[familyName], tab.subnet, row.pool);
	},

	pdPoolError: function(row) {
		return rowBlank(row, PD_FIELDS) ? null : checkPdPool(row);
	},

	optionError: function(row) {
		return rowBlank(row, OPTION_FIELDS) ? null : checkOptionName(row.name);
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
