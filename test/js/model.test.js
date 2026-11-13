/*
 * Unit tests for htdocs/luci-static/resources/kea/model.js.
 *
 * Run with: node --test "test/js/*.test.js"
 *
 * Set KEA_STOCK_DIR to a directory holding the stock kea-dhcp4.conf and
 * kea-dhcp6.conf of a Kea package to run the round-trip checks on them too.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadModule } = require("./luci-loader.js");

const model = loadModule("kea.model");
const FIXTURES = path.join(__dirname, "..", "fixtures");

const INTERFACES = [
	{ name: "loopback", device: "lo", proto: "static", ipaddr: "127.0.0.1/8", ip6addr: "" },
	{ name: "lan", device: "br-lan", proto: "static", ipaddr: "192.168.1.1/24", ip6addr: "fd00:1::1/64", dhcp4_server: true },
	{ name: "guest", device: "br-guest", proto: "static", ipaddr: "192.168.50.1/24", ip6addr: "" },
	{ name: "wan", device: "eth1", proto: "dhcp", ipaddr: "", ip6addr: "" }
];

function load(name) {
	const parsed = model.parseConfig(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

	assert.equal(parsed.error, null);

	return parsed.config;
}

/* Build the tabs and the global settings, let the test edit them, save. */
function roundTrip(family, config, edit) {
	const tabs = model.buildTabs(family, config, INTERFACES);
	const global = model.buildGlobal(family, config);

	if (edit)
		edit(tabs, global);

	return model.applyTabs(family, config, tabs, global);
}

function tabFor(tabs, device) {
	const tab = tabs.find((candidate) => candidate.device === device);

	assert.ok(tab, "tab for " + device);

	return tab;
}

/* Paths of every leaf that differs between two JSON values. */
function diffPaths(a, b, prefix = "") {
	if (model.deepEqual(a, b))
		return [];

	const bothObjects = a !== null && b !== null &&
		typeof a === "object" && typeof b === "object" &&
		Array.isArray(a) === Array.isArray(b);

	if (!bothObjects)
		return [ prefix || "/" ];

	const keys = new Set([ ...Object.keys(a), ...Object.keys(b) ]);
	let paths = [];

	for (const key of keys)
		paths = paths.concat(diffPaths(a[key], b[key], prefix + "/" + key));

	return paths;
}

function errorsOf(family, config, edit) {
	const result = roundTrip(family, config, edit);

	assert.ok(result.errors, "the save is refused");

	return result.errors;
}

/* ---- parsing ----------------------------------------------------------- */

test("parseConfig accepts //, # and /* */ comments and reports them", () => {
	const parsed = model.parseConfig(
		"// line\n{ # hash\n\"Dhcp4\": { /* block */ \"valid-lifetime\": 60 } }\n");

	assert.equal(parsed.error, null);
	assert.equal(parsed.hasComments, true);
	assert.deepEqual(parsed.config, { Dhcp4: { "valid-lifetime": 60 } });
});

test("parseConfig keeps comment markers inside strings", () => {
	const parsed = model.parseConfig("{ \"a\": \"http://x/#y /* z */\" }");

	assert.equal(parsed.hasComments, false);
	assert.equal(parsed.config.a, "http://x/#y /* z */");
});

test("parseConfig reports a syntax error instead of throwing", () => {
	const parsed = model.parseConfig("{ \"Dhcp4\": ");

	assert.equal(parsed.config, null);
	assert.ok(parsed.error);
});

/* ---- round trips ------------------------------------------------------- */

for (const [ family, fixture ] of [ [ "dhcp4", "kea-dhcp4-rich.conf" ], [ "dhcp6", "kea-dhcp6-rich.conf" ] ]) {
	test(family + ": saving without edits changes nothing", () => {
		const config = load(fixture);
		const result = roundTrip(family, config);

		assert.equal(result.errors, undefined);
		assert.deepEqual(result.config, config);
		assert.equal(model.serialize(result.config), model.serialize(config));
	});
}

test("dhcp4: changing one field changes only that field", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").router = "192.168.1.254";
	});

	assert.deepEqual(diffPaths(config, result.config),
		[ "/Dhcp4/subnet4/0/option-data/0/data" ]);
	assert.equal(result.config.Dhcp4.subnet4[0]["option-data"][0].data, "192.168.1.254");
});

test("dhcp4: untouched values keep their original formatting", () => {
	const config = {
		Dhcp4: {
			"valid-lifetime": 3600,
			subnet4: [
				{
					id: 1,
					subnet: "192.168.1.0/24",
					pools: [ { pool: "192.168.1.100-192.168.1.150" } ],
					"option-data": [ { name: "domain-name-servers", data: "1.1.1.1,8.8.8.8" } ],
					reservations: []
				}
			]
		}
	};
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").router = "192.168.1.1";
	});

	/* Only the new option is added: no interface key, no inherited timer,
	 * no reformatted pool. */
	assert.deepEqual(diffPaths(config, result.config), [ "/Dhcp4/subnet4/0/option-data/1" ]);
});

test("dhcp4: an option given by code is found and extra option fields survive", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	assert.equal(lan.domainName, "lan");
	assert.equal(lan.dnsServers, "192.168.1.1, 1.1.1.1");

	lan.domainName = "home.arpa";
	lan.dnsServers = "192.168.1.1";

	const options = model.applyTabs("dhcp4", config, tabs).config.Dhcp4.subnet4[0]["option-data"];

	assert.deepEqual(options[3], { code: 15, data: "home.arpa" });
	assert.deepEqual(options[1],
		{ name: "domain-name-servers", data: "192.168.1.1", "always-send": true });
	assert.deepEqual(options[2], { name: "ntp-servers", data: "192.168.1.1" });
});

test("dhcp4: clearing an option removes only that option", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").router = "";
	});
	const names = result.config.Dhcp4.subnet4[0]["option-data"].map((option) => option.name || option.code);

	assert.deepEqual(names, [ "domain-name-servers", "ntp-servers", 15 ]);
});

test("dhcp4: timers are written only when set and removed when cleared", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	/* The subnet has its own valid-lifetime but inherits the other timers. */
	assert.equal(lan.validLifetime, "7200");
	assert.equal(lan.renewTimer, "");
	assert.equal(lan.defaults.renewTimer, "900");

	lan.validLifetime = "";
	lan.renewTimer = "0";

	const subnet = model.applyTabs("dhcp4", config, tabs).config.Dhcp4.subnet4[0];

	assert.equal("valid-lifetime" in subnet, false);
	assert.equal(subnet["renew-timer"], 0);
	assert.equal("rebind-timer" in subnet, false);
});

test("dhcp4: a subnet without an interface is matched to the interface network", () => {
	const config = { Dhcp4: { subnet4: [ { id: 1, subnet: "192.168.50.0/24" } ] } };
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const guest = tabFor(tabs, "br-guest");

	assert.equal(guest.subnet, "192.168.50.0/24");

	/* Showing the matched device must not write an "interface" key. */
	assert.deepEqual(model.applyTabs("dhcp4", config, tabs).config, config);
});

/* ---- pools ------------------------------------------------------------- */

test("every pool is a row; editing one keeps the others and their extra keys", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	assert.deepEqual(lan.pools.map((row) => row.pool),
		[ "192.168.1.100 - 192.168.1.150", "192.168.1.200 - 192.168.1.220" ]);

	lan.pools[0].pool = "192.168.1.100 - 192.168.1.160";

	const result = model.applyTabs("dhcp4", config, tabs);
	const pools = result.config.Dhcp4.subnet4[0].pools;

	assert.deepEqual(diffPaths(config, result.config), [ "/Dhcp4/subnet4/0/pools/0/pool" ]);
	assert.equal(pools[0]["option-data"][0].data, "192.168.1.2");
	assert.equal(pools[1].pool, "192.168.1.200 - 192.168.1.220");
});

test("pools can be added and removed", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		const lan = tabFor(tabs, "br-lan");
		const added = model.newPool();

		lan.pools.splice(1, 1);
		added.pool = "192.168.1.230 - 192.168.1.240";
		lan.pools.push(added, model.newPool());
	});

	assert.deepEqual(result.config.Dhcp4.subnet4[0].pools, [
		config.Dhcp4.subnet4[0].pools[0],
		{ pool: "192.168.1.230 - 192.168.1.240" }
	]);

	const cleared = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").pools = [];
	});

	assert.equal("pools" in cleared.config.Dhcp4.subnet4[0], false);
});

test("a relayed subnet with a pool in prefix notation keeps its shape", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const relayed = tabs.find((tab) => tab.subnet === "10.10.0.0/16");

	assert.equal(relayed.device, "");
	assert.equal(relayed.enabled, false);
	assert.deepEqual(relayed.pools.map((row) => row.pool), [ "10.10.1.0/24" ]);

	relayed.router = "10.10.0.1";

	const result = model.applyTabs("dhcp4", config, tabs);
	const subnet = result.config.Dhcp4.subnet4[1];

	assert.equal(result.errors, undefined);
	assert.equal("interface" in subnet, false);
	assert.deepEqual(subnet.pools, [ { pool: "10.10.1.0/24" } ]);
	assert.deepEqual(subnet.relay, { "ip-addresses": [ "10.10.0.1" ] });
	assert.deepEqual(subnet["option-data"], [ { name: "routers", data: "10.10.0.1" } ]);
});

test("pool mistakes that Kea rejects are caught before saving", () => {
	const config = load("kea-dhcp4-rich.conf");
	const withPool = (value) => (tabs) => {
		tabFor(tabs, "br-lan").pools[1].pool = value;
	};

	assert.match(errorsOf("dhcp4", config, withPool("192.168.1.250"))[0], /not an address range/);
	assert.match(errorsOf("dhcp4", config, withPool("192.168.1.220 - 192.168.1.200"))[0], /ends before it starts/);
	assert.match(errorsOf("dhcp4", config, withPool("10.0.0.1 - 10.0.0.9"))[0], /outside the subnet/);
	assert.match(errorsOf("dhcp4", config, withPool("192.168.1.140 - 192.168.1.210"))[0], /overlap/);
	assert.equal(roundTrip("dhcp4", config, withPool("192.168.1.192/28")).errors, undefined);
});

test("dhcp6: prefix delegation pools are rows that keep their extra keys", () => {
	const config = load("kea-dhcp6-rich.conf");
	const tabs = model.buildTabs("dhcp6", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	assert.equal(lan.pdPools.length, 2);
	assert.deepEqual([ lan.pdPools[0].prefix, lan.pdPools[0].prefixLen, lan.pdPools[0].delegatedLen ],
		[ "fd00:1:0:100::", "56", "64" ]);

	lan.pdPools[0].delegatedLen = "60";

	const result = model.applyTabs("dhcp6", config, tabs);

	assert.deepEqual(diffPaths(config, result.config), [ "/Dhcp6/subnet6/0/pd-pools/0/delegated-len" ]);
	assert.equal(result.config.Dhcp6.subnet6[0]["pd-pools"][0]["excluded-prefix-len"], 72);
});

test("dhcp6: prefix delegation mistakes are caught", () => {
	const config = load("kea-dhcp6-rich.conf");
	const withPd = (changes) => (tabs) => {
		Object.assign(tabFor(tabs, "br-lan").pdPools[0], changes);
	};

	assert.match(errorsOf("dhcp6", config, withPd({ prefix: "" }))[0], /not an IPv6 address/);
	assert.match(errorsOf("dhcp6", config, withPd({ prefixLen: "abc" }))[0], /must be numbers/);
	assert.match(errorsOf("dhcp6", config, withPd({ delegatedLen: "48" }))[0], /must not be shorter/);
});

/* ---- options ----------------------------------------------------------- */

test("options without a field of their own are rows", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	/* routers, domain-name-servers and option 15 have fields; ntp-servers has not. */
	assert.deepEqual(lan.options.map((row) => [ row.name, row.data ]), [ [ "ntp-servers", "192.168.1.1" ] ]);

	lan.options[0].data = "192.168.1.2";

	const added = model.newOption();
	const byCode = model.newOption();

	added.name = "log-servers";
	added.data = "192.168.1.3";
	byCode.name = "42";
	byCode.data = "192.168.1.4";
	lan.options.push(added, byCode, model.newOption());

	const result = model.applyTabs("dhcp4", config, tabs);
	const options = result.config.Dhcp4.subnet4[0]["option-data"];

	assert.deepEqual(diffPaths(config, result.config), [
		"/Dhcp4/subnet4/0/option-data/2/data",
		"/Dhcp4/subnet4/0/option-data/4",
		"/Dhcp4/subnet4/0/option-data/5"
	]);
	assert.deepEqual(options[4], { name: "log-servers", data: "192.168.1.3" });
	assert.deepEqual(options[5], { code: 42, data: "192.168.1.4" });
});

test("deleting an option row removes that option only", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").options = [];
	});
	const names = result.config.Dhcp4.subnet4[0]["option-data"].map((option) => option.name || option.code);

	assert.deepEqual(names, [ "routers", "domain-name-servers", 15 ]);
});

test("an option row needs a name or a code", () => {
	const config = load("kea-dhcp4-rich.conf");
	const errors = errorsOf("dhcp4", config, (tabs) => {
		const row = model.newOption();

		row.data = "1";
		tabFor(tabs, "br-lan").options.push(row);
	});

	assert.match(errors[0], /Other Options: an option needs a name or a numeric code/);
});

/* ---- global settings --------------------------------------------------- */

test("global timers, lease file cleanup and options are edited in place", () => {
	const config = load("kea-dhcp4-rich.conf");
	const global = model.buildGlobal("dhcp4", config);

	assert.equal(global.renewTimer, "900");
	assert.equal(global.validLifetime, "3600");
	assert.equal(global.lfcInterval, "3600");
	assert.equal(global.leaseType, "memfile");
	assert.deepEqual(global.options.map((row) => [ row.name, row.data ]),
		[ [ "domain-name-servers", "192.168.1.1" ] ]);

	const result = roundTrip("dhcp4", config, (tabs, settings) => {
		settings.renewTimer = "600";
		settings.rebindTimer = "";
		settings.lfcInterval = "7200";
		settings.options[0].data = "192.168.1.1, 9.9.9.9";
	});

	assert.deepEqual(diffPaths(config, result.config).sort(), [
		"/Dhcp4/lease-database/lfc-interval",
		"/Dhcp4/option-data/0/data",
		"/Dhcp4/rebind-timer",
		"/Dhcp4/renew-timer"
	]);
	assert.equal(result.config.Dhcp4["renew-timer"], 600);
	assert.equal("rebind-timer" in result.config.Dhcp4, false);
});

test("a lease file cleanup interval creates the lease database entry if needed", () => {
	const result = roundTrip("dhcp4", { Dhcp4: {} }, (tabs, settings) => {
		settings.lfcInterval = "3600";
	});

	assert.deepEqual(result.config, { Dhcp4: { "lease-database": { type: "memfile", "lfc-interval": 3600 } } });
	assert.match(errorsOf("dhcp4", { Dhcp4: {} }, (tabs, settings) => {
		settings.validLifetime = "soon";
	})[0], /Global settings: Valid Lifetime: not a whole number/);
});

/* ---- reservations ------------------------------------------------------ */

test("dhcp4: reservations keyed by client-id and flex-id load and save intact", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const rows = tabFor(tabs, "br-lan").reservations;

	assert.deepEqual(rows.map((row) => row.type), [ "hw-address", "client-id", "flex-id" ]);
	assert.equal(rows[1].identity, "01:02:00:00:00:00:02");

	rows[1].hostname = "tablet";

	const result = model.applyTabs("dhcp4", config, tabs);

	assert.deepEqual(diffPaths(config, result.config),
		[ "/Dhcp4/subnet4/0/reservations/1/hostname" ]);
	assert.deepEqual(result.config.Dhcp4.subnet4[0].reservations[1]["option-data"],
		[ { name: "domain-name-servers", data: "9.9.9.9" } ]);
});

test("an untouched reservation is written back exactly as it was", () => {
	const odd = {
		hostname: "",
		"circuit-id": "'port-7'",
		"ip-address": "192.168.1.20",
		"client-classes": [ "printers" ]
	};
	const odd6 = { duid: "00:01:02:03", "ip-addresses": [], prefixes: [ "fd00:9::/64" ], hostname: "" };
	const config4 = { Dhcp4: { subnet4: [ { id: 1, subnet: "192.168.1.0/24", reservations: [ odd, { "ip-address": "192.168.1.21" } ] } ] } };
	const config6 = { Dhcp6: { subnet6: [ { id: 1, subnet: "fd00:1::/64", "interface": "br-lan", reservations: [ odd6 ] } ] } };

	/* Edit a different row so the reservation list is rewritten. */
	const result4 = roundTrip("dhcp4", config4, (tabs) => {
		const row = model.newReservation("dhcp4");

		row.identity = "02:00:00:00:00:09";
		row.address = "192.168.1.22";
		tabFor(tabs, "br-lan").reservations.push(row);
	});
	const result6 = roundTrip("dhcp6", config6, (tabs) => {
		const row = model.newReservation("dhcp6");

		row.identity = "00:01:02:04";
		row.addresses = "fd00:1::22";
		tabFor(tabs, "br-lan").reservations.push(row);
	});

	assert.deepEqual(result4.config.Dhcp4.subnet4[0].reservations.slice(0, 2),
		config4.Dhcp4.subnet4[0].reservations);
	assert.deepEqual(result4.config.Dhcp4.subnet4[0].reservations[2],
		{ "hw-address": "02:00:00:00:00:09", "ip-address": "192.168.1.22" });
	assert.deepEqual(result6.config.Dhcp6.subnet6[0].reservations[0], odd6);
	assert.deepEqual(result6.config.Dhcp6.subnet6[0].reservations[1],
		{ duid: "00:01:02:04", "ip-addresses": [ "fd00:1::22" ] });
});

test("dhcp4: changing the identifier type replaces the old identifier key", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		const row = tabFor(tabs, "br-lan").reservations[2];

		row.type = "hw-address";
		row.identity = "02:00:00:00:00:03";
	});
	const reservation = result.config.Dhcp4.subnet4[0].reservations[2];

	assert.equal("flex-id" in reservation, false);
	assert.equal(reservation["hw-address"], "02:00:00:00:00:03");
	assert.equal(reservation["next-server"], "192.168.1.5");
	assert.equal(reservation["boot-file-name"], "pxe.bin");
});

test("dhcp4: a disabled reservation moves to user-context and back unchanged", () => {
	const config = load("kea-dhcp4-rich.conf");
	const disabled = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").reservations[1].enabled = false;
	}).config;
	const subnet = disabled.Dhcp4.subnet4[0];

	assert.equal(subnet.reservations.length, 2);
	assert.deepEqual(subnet["user-context"], {
		site: "home",
		"luci-app-kea": {
			"disabled-reservations": [ config.Dhcp4.subnet4[0].reservations[1] ]
		}
	});

	/* Reloading shows the row as disabled, with every field still there. */
	const tabs = model.buildTabs("dhcp4", disabled, INTERFACES);
	const row = tabFor(tabs, "br-lan").reservations.find((candidate) => !candidate.enabled);

	assert.equal(row.type, "client-id");
	assert.equal(row.address, "192.168.1.11");

	row.enabled = true;

	const restored = model.applyTabs("dhcp4", disabled, tabs).config.Dhcp4.subnet4[0];

	assert.deepEqual(restored["user-context"], { site: "home" });
	assert.deepEqual(new Set(restored.reservations), new Set(config.Dhcp4.subnet4[0].reservations));
});

test("a reservation needs an identifier; an address is optional, as in Kea", () => {
	const config = load("kea-dhcp4-rich.conf");
	const add = (changes) => (tabs) => {
		tabFor(tabs, "br-lan").reservations.push(Object.assign(model.newReservation("dhcp4"), changes));
	};

	assert.match(errorsOf("dhcp4", config, add({ hostname: "later" }))[0], /an identifier is required/);

	const nameOnly = roundTrip("dhcp4", config, add({ identity: "02:00:00:00:00:77", hostname: "pc" }));

	assert.deepEqual(nameOnly.config.Dhcp4.subnet4[0].reservations[3],
		{ "hw-address": "02:00:00:00:00:77", hostname: "pc" });

	/* Switched off, an incomplete reservation is stored as it is. */
	const stored = roundTrip("dhcp4", config, add({ enabled: false, hostname: "later" })).config.Dhcp4.subnet4[0];

	assert.deepEqual(stored["user-context"]["luci-app-kea"]["disabled-reservations"], [ { hostname: "later" } ]);
});

test("reservation mistakes that Kea rejects are caught before saving", () => {
	const config = load("kea-dhcp4-rich.conf");
	const add = (changes) => (tabs) => {
		tabFor(tabs, "br-lan").reservations.push(Object.assign(model.newReservation("dhcp4"), changes));
	};
	const first = (changes) => errorsOf("dhcp4", config, add(changes))[0];

	assert.match(first({ identity: "02-00-00-00-00-77", address: "192.168.1.77" }), /not a MAC address/);
	assert.match(first({ identity: "02:00:00:00:00:77", address: "192.168.1.300" }), /not an IPv4 address/);
	assert.match(first({ identity: "02:00:00:00:00:77", address: "10.9.9.9" }), /outside the subnet/);
	assert.match(first({ type: "client-id", identity: "laptop", address: "192.168.1.77" }), /not a client ID/);
	assert.match(first({ type: "circuit-id", identity: "port7", address: "192.168.1.77" }), /single quotes/);
	assert.match(first({ type: "duid", identity: "00", address: "192.168.1.77" }), /at least three octets/);
	assert.match(first({ identity: "02:00:00:00:00:01", address: "192.168.1.77" }), /more than one reservation: 02:00:00:00:00:01/);
	assert.match(first({ identity: "02:00:00:00:00:77", address: "192.168.1.10" }), /more than one reservation: 192\.168\.1\.10/);

	for (const good of [
		{ type: "client-id", identity: "0102030405", address: "192.168.1.77" },
		{ type: "circuit-id", identity: "'port 7'", address: "192.168.1.77" },
		{ type: "flex-id", identity: "01:02", address: "192.168.1.77" }
	])
		assert.equal(roundTrip("dhcp4", config, add(good)).errors, undefined, JSON.stringify(good));
});

test("values the user did not touch are not checked", () => {
	/* Kea would reject this file, but that is not for the editor to say
	 * while the user edits something else. */
	const config = {
		Dhcp4: {
			subnet4: [ {
				id: 1,
				subnet: "192.168.1.0/24",
				"interface": "br-lan",
				pools: [ { pool: "10.0.0.1 - 10.0.0.9" } ],
				reservations: [ { "hw-address": "bogus", "ip-address": "10.9.9.9" } ]
			} ]
		}
	};
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").router = "192.168.1.1";
	});

	assert.equal(result.errors, undefined);

	/* Changing the subnet puts every pool and reservation to the test. */
	const errors = errorsOf("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").subnet = "192.168.2.0/24";
	});

	assert.equal(errors.some((message) => /Address Pools: .*outside the subnet/.test(message)), true);
	assert.equal(errors.some((message) => /not a MAC address/.test(message)), true);
});

test("dhcp4: deleting a reservation row removes it; a blank new row is ignored", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		const rows = tabFor(tabs, "br-lan").reservations;

		rows.splice(0, 1);
		rows.push(model.newReservation("dhcp4"));
	});

	assert.deepEqual(result.config.Dhcp4.subnet4[0].reservations,
		config.Dhcp4.subnet4[0].reservations.slice(1));
});

test("dhcp6: address and prefix lists are edited without touching other fields", () => {
	const config = load("kea-dhcp6-rich.conf");
	const tabs = model.buildTabs("dhcp6", config, INTERFACES);
	const rows = tabFor(tabs, "br-lan").reservations;

	assert.deepEqual(rows.map((row) => row.type), [ "duid", "hw-address", "flex-id" ]);
	assert.equal(rows[1].addresses, "fd00:1::11, fd00:1::12");
	assert.equal(rows[1].prefixes, "fd00:1:0:300::/64");

	rows[1].addresses = "fd00:1::11";
	rows[1].prefixes = "";

	const result = model.applyTabs("dhcp6", config, tabs);
	const reservation = result.config.Dhcp6.subnet6[0].reservations[1];

	assert.deepEqual(reservation, {
		"hw-address": "02:00:00:00:00:02",
		"ip-addresses": [ "fd00:1::11" ],
		"option-data": [ { name: "dns-servers", data: "fd00:1::53" } ]
	});
});

test("dhcp6: addresses and prefixes of a reservation are checked", () => {
	const config = load("kea-dhcp6-rich.conf");
	const edit = (changes) => (tabs) => {
		Object.assign(tabFor(tabs, "br-lan").reservations[0], changes);
	};

	assert.match(errorsOf("dhcp6", config, edit({ addresses: "fd00:9::1" }))[0], /outside the subnet/);
	assert.match(errorsOf("dhcp6", config, edit({ addresses: "nope" }))[0], /not an IPv6 address/);
	assert.match(errorsOf("dhcp6", config, edit({ prefixes: "fd00:1:0:200::" }))[0], /not an IPv6 prefix/);
	assert.equal(roundTrip("dhcp6", config, edit({ addresses: "FD00:1::AB, fd00:1:0:0:1::2" })).errors, undefined);
});

/* ---- single-field checks ----------------------------------------------- */

test("field checks used for marking inputs", () => {
	const tab = { subnet: "192.168.1.0/24", device: "br-lan", router: "", dnsServers: "", renewTimer: "" };
	const check = (field, value) => model.fieldError("dhcp4", Object.assign({}, tab, { [field]: value }), field);

	assert.equal(check("subnet", "192.168.1.0/24"), null);
	assert.match(check("subnet", "192.168.1.0"), /not an IPv4 subnet/);
	assert.match(check("subnet", "192.168.1.0/33"), /not an IPv4 subnet/);
	assert.match(check("subnet", ""), /required/);
	assert.equal(check("device", "br-lan.10"), null);
	assert.match(check("device", "br lan"), /not a network device name/);
	assert.equal(check("router", "192.168.1.1, 192.168.1.2"), null);
	assert.match(check("router", "192.168.1.1, gateway"), /not an IPv4 address: gateway/);
	assert.match(check("renewTimer", "1h"), /whole number/);
	assert.equal(model.fieldError("dhcp6", { dnsServers: "fd00::1, 2001:db8::53" }, "dnsServers"), null);
	assert.match(model.fieldError("dhcp6", { dnsServers: "192.168.1.1" }, "dnsServers"), /not an IPv6 address/);
	assert.match(model.fieldError("dhcp6", { subnet: "fd00:1::/129" }, "subnet"), /not an IPv6 subnet/);
	assert.equal(model.poolError("dhcp6", { subnet: "fd00:1::/64" }, { pool: "fd00:1::1000/116" }), null);
	assert.match(model.poolError("dhcp6", { subnet: "fd00:1::/64" }, { pool: "fd00:2::1 - fd00:2::9" }), /outside the subnet/);
	assert.equal(model.poolError("dhcp4", tab, { pool: "" }), null);
	assert.equal(model.label("router"), "Gateway");
});

/* ---- subnets ----------------------------------------------------------- */

test("a new subnet gets an ID that no subnet or shared network uses", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		const guest = tabFor(tabs, "br-guest");
		const pool = model.newPool();

		pool.pool = "192.168.50.100 - 192.168.50.199";
		guest.subnet = "192.168.50.0/24";
		guest.pools.push(pool);
		guest.router = "192.168.50.1";
		guest.enabled = true;
	});
	const subnets = result.config.Dhcp4.subnet4;

	/* 3 and 5 are top-level subnets, 7 is inside a shared network. */
	assert.deepEqual(subnets[2], {
		id: 1,
		subnet: "192.168.50.0/24",
		"interface": "br-guest",
		pools: [ { pool: "192.168.50.100 - 192.168.50.199" } ],
		"option-data": [ { name: "routers", data: "192.168.50.1" } ]
	});
	assert.deepEqual(subnets.slice(0, 2), config.Dhcp4.subnet4);
	assert.deepEqual(result.config.Dhcp4["interfaces-config"].interfaces, [ "br-lan", "br-guest" ]);
});

test("new subnet IDs skip the IDs already taken", () => {
	const config = {
		Dhcp4: {
			subnet4: [ { id: 1, subnet: "10.0.0.0/24", "interface": "eth9" } ],
			"shared-networks": [ { name: "n", subnet4: [ { id: 2, subnet: "10.0.1.0/24" } ] } ]
		}
	};
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").subnet = "192.168.1.0/24";
		tabFor(tabs, "br-guest").subnet = "192.168.50.0/24";
	});

	assert.deepEqual(result.config.Dhcp4.subnet4.map((subnet) => subnet.id), [ 1, 3, 4 ]);
});

test("an untouched interface tab does not create a subnet", () => {
	const config = { Dhcp4: {} };

	assert.deepEqual(roundTrip("dhcp4", config).config, config);
});

test("a removed tab drops its subnet and stops listening on its device", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").removed = true;
	});

	assert.deepEqual(result.config.Dhcp4.subnet4, [ config.Dhcp4.subnet4[1] ]);
	assert.deepEqual(result.config.Dhcp4["interfaces-config"].interfaces, []);
	assert.deepEqual(result.config.Dhcp4["shared-networks"], config.Dhcp4["shared-networks"]);
});

test("required fields are reported per tab, with the field name", () => {
	const config = load("kea-dhcp4-rich.conf");

	assert.equal(errorsOf("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").subnet = "";
	})[0], "lan (br-lan): Subnet: a subnet is required");

	assert.equal(errorsOf("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").renewTimer = "soon";
	})[0], "lan (br-lan): Renew Timer: not a whole number of seconds");

	assert.equal(errorsOf("dhcp4", config, (tabs) => {
		tabs.find((tab) => tab.subnet === "10.10.0.0/16").enabled = true;
	})[0], "10.10.0.0/16: Interface: an interface device is required");
});

test("the same subnet twice is refused, as Kea would", () => {
	const config = load("kea-dhcp4-rich.conf");

	assert.deepEqual(errorsOf("dhcp4", config, (tabs) => {
		tabs.find((tab) => tab.subnet === "10.10.0.0/16").subnet = "192.168.1.7/24";
	}).filter((message) => /Subnet:/.test(message)),
		[ "10.10.0.0/16: Subnet: another subnet of this configuration has the same prefix: 192.168.1.7/24" ]);

	/* Also across a shared network, and for a subnet that is new. */
	assert.match(errorsOf("dhcp4", config, (tabs) => {
		const wan = tabFor(tabs, "eth1");

		wan.subnet = "10.20.0.0/24";
		wan.pools.push(Object.assign(model.newPool(), { pool: "10.20.0.60 - 10.20.0.70" }));
	}).join("\n"), /wan \(eth1\): Subnet: another subnet of this configuration has the same prefix/);

	/* Subnets that overlap without being the same are fine for Kea. */
	assert.ok(roundTrip("dhcp4", config, (tabs) => {
		tabs.find((tab) => tab.subnet === "10.10.0.0/16").subnet = "10.10.0.0/15";
	}).config);
});

/* ---- shared networks --------------------------------------------------- */

test("a subnet of a shared network has a tab and is edited in place", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const shared = tabs.find((tab) => tab.subnet === "10.20.0.0/24");

	assert.equal(shared.label, "floor2: 10.20.0.0/24");
	assert.equal(shared.container, 0);
	assert.deepEqual(shared.pools.map((row) => row.pool), [ "10.20.0.10 - 10.20.0.50" ]);

	shared.router = "10.20.0.1";

	const result = model.applyTabs("dhcp4", config, tabs);

	assert.deepEqual(diffPaths(config, result.config),
		[ "/Dhcp4/shared-networks/0/subnet4/0/option-data" ]);
	assert.deepEqual(result.config.Dhcp4["shared-networks"][0].subnet4[0]["option-data"],
		[ { name: "routers", data: "10.20.0.1" } ]);
	assert.deepEqual(result.config.Dhcp4.subnet4, config.Dhcp4.subnet4);
});

test("removing a subnet of a shared network leaves the network in place", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabs.find((tab) => tab.subnet === "10.20.0.0/24").removed = true;
	});

	assert.deepEqual(result.config.Dhcp4["shared-networks"],
		[ { name: "floor2", relay: { "ip-addresses": [ "10.20.0.1" ] }, subnet4: [] } ]);
	assert.deepEqual(result.config.Dhcp4.subnet4, config.Dhcp4.subnet4);
});

/* ---- listening interfaces ---------------------------------------------- */

test("interface entries the editor does not manage are preserved", () => {
	const config = {
		Dhcp4: {
			"interfaces-config": { interfaces: [ "*", "br-lan/192.168.1.1", "tun0" ], "re-detect": false },
			subnet4: [ { id: 1, subnet: "192.168.1.0/24", "interface": "br-lan" } ]
		}
	};

	assert.equal(model.listensOnAll("dhcp4", config), true);
	assert.equal(tabFor(model.buildTabs("dhcp4", config, INTERFACES), "br-lan").enabled, true);
	assert.deepEqual(roundTrip("dhcp4", config).config, config);

	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").enabled = false;
		tabFor(tabs, "br-guest").enabled = true;
		tabFor(tabs, "br-guest").subnet = "192.168.50.0/24";
	});

	assert.deepEqual(result.config.Dhcp4["interfaces-config"],
		{ interfaces: [ "*", "tun0", "br-guest" ], "re-detect": false });
});

test("a tab knows whether OpenWrt serves DHCP on its interface", () => {
	const tabs = model.buildTabs("dhcp4", { Dhcp4: {} }, INTERFACES);

	assert.equal(tabFor(tabs, "br-lan").served, true);
	assert.equal(tabFor(tabs, "br-guest").served, false);
	assert.equal(tabFor(model.buildTabs("dhcp6", { Dhcp6: {} }, INTERFACES), "br-lan").served, false);
});

/* ---- stock sample entries ---------------------------------------------- */

const SAMPLE4 = {
	Dhcp4: {
		"interfaces-config": { interfaces: [] },
		"option-data": [
			{ name: "domain-name-servers", data: "192.0.2.1, 192.0.2.2" },
			{ code: 15, data: "example.org" },
			{ name: "ntp-servers", data: "192.168.1.1" }
		],
		"client-classes": [
			{ name: "voip", test: "substring(option[60].hex,0,6) == 'Aastra'", "next-server": "192.0.2.254" },
			{ name: "voip-phones", test: "member('voip')" }
		],
		subnet4: [
			{
				id: 1,
				subnet: "192.0.2.0/24",
				pools: [ { pool: "192.0.2.1 - 192.0.2.200" } ],
				reservations: [ { duid: "01:02:03:04:05", "ip-address": "192.0.2.203" } ]
			}
		]
	}
};

test("stock sample entries get no tab, survive a save and are removed only on request", () => {
	const tabs = model.buildTabs("dhcp4", SAMPLE4, INTERFACES);

	assert.equal(tabs.some((tab) => tab.subnet === "192.0.2.0/24"), false);
	assert.deepEqual(model.countSamples("dhcp4", SAMPLE4), { subnets: 1, options: 2, classes: 1 });

	const saved = roundTrip("dhcp4", SAMPLE4, (edited) => {
		tabFor(edited, "br-lan").subnet = "192.168.1.0/24";
	}).config;

	assert.deepEqual(saved.Dhcp4.subnet4[0], SAMPLE4.Dhcp4.subnet4[0]);
	assert.equal(saved.Dhcp4.subnet4[1].id, 2);
	assert.deepEqual(saved.Dhcp4["option-data"], SAMPLE4.Dhcp4["option-data"]);

	const cleaned = model.removeSamples("dhcp4", saved);

	assert.deepEqual(cleaned.Dhcp4.subnet4.map((subnet) => subnet.subnet), [ "192.168.1.0/24" ]);
	assert.deepEqual(cleaned.Dhcp4["option-data"], [ { name: "ntp-servers", data: "192.168.1.1" } ]);
	assert.deepEqual(cleaned.Dhcp4["client-classes"], [ { name: "voip-phones", test: "member('voip')" } ]);
	assert.deepEqual(model.countSamples("dhcp4", cleaned), { subnets: 0, options: 0, classes: 0 });
});

test("a documentation-range subnet bound to an interface is not a sample", () => {
	const config = { Dhcp4: { subnet4: [ { id: 1, subnet: "192.0.2.0/24", "interface": "br-lan" } ] } };

	assert.equal(model.countSamples("dhcp4", config).subnets, 0);
	assert.equal(tabFor(model.buildTabs("dhcp4", config, INTERFACES), "br-lan").subnet, "192.0.2.0/24");
});

/* ---- text comparison --------------------------------------------------- */

test("lineDiff shows changed lines with context and marks gaps", () => {
	const before = [ "a", "b", "c", "d", "e", "f", "g", "h", "i", "j" ].join("\n");
	const after = [ "a", "b", "C", "d", "e", "f", "g", "h", "i", "j", "k" ].join("\n");

	assert.deepEqual(model.lineDiff(before, after, 1), [
		{ op: " ", text: "b" },
		{ op: "-", text: "c" },
		{ op: "+", text: "C" },
		{ op: " ", text: "d" },
		{ op: "@", text: "" },
		{ op: " ", text: "j" },
		{ op: "+", text: "k" }
	]);
	assert.deepEqual(model.lineDiff("same\ntext", "same\ntext"), []);
	assert.deepEqual(model.lineDiff("", "x"), [ { op: "-", text: "" }, { op: "+", text: "x" } ]);
});

test("lineDiff of an editor save lists exactly the edited line", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").router = "192.168.1.254";
	});
	const changed = model.lineDiff(model.serialize(config), model.serialize(result.config))
		.filter((line) => line.op === "-" || line.op === "+");

	assert.deepEqual(changed.map((line) => line.op + line.text.trim()), [
		"-\"data\": \"192.168.1.1\"",
		"+\"data\": \"192.168.1.254\""
	]);
});

/* ---- stock configs of an installed Kea package (optional) -------------- */

const stockDir = process.env.KEA_STOCK_DIR;

for (const [ family, file ] of [ [ "dhcp4", "kea-dhcp4.conf" ], [ "dhcp6", "kea-dhcp6.conf" ] ]) {
	test(family + ": stock " + file + " survives a save without edits",
		{ skip: !stockDir && "KEA_STOCK_DIR is not set" }, () => {
			const parsed = model.parseConfig(fs.readFileSync(path.join(stockDir, file), "utf8"));

			assert.equal(parsed.error, null);
			assert.equal(parsed.hasComments, true);
			assert.deepEqual(roundTrip(family, parsed.config).config, parsed.config);
		});
}
