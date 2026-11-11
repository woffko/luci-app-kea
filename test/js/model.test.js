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
	{ name: "lan", device: "br-lan", proto: "static", ipaddr: "192.168.1.1/24", ip6addr: "fd00:1::1/64" },
	{ name: "guest", device: "br-guest", proto: "static", ipaddr: "192.168.50.1/24", ip6addr: "" },
	{ name: "wan", device: "eth1", proto: "dhcp", ipaddr: "", ip6addr: "" }
];

function load(name) {
	const parsed = model.parseConfig(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

	assert.equal(parsed.error, null);

	return parsed.config;
}

function roundTrip(family, config, edit) {
	const tabs = model.buildTabs(family, config, INTERFACES);

	if (edit)
		edit(tabs);

	return model.applyTabs(family, config, tabs);
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

test("dhcp4: editing the pool keeps the second pool and per-pool options", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").poolEnd = "192.168.1.160";
	});
	const pools = result.config.Dhcp4.subnet4[0].pools;

	assert.deepEqual(diffPaths(config, result.config), [ "/Dhcp4/subnet4/0/pools/0/pool" ]);
	assert.equal(pools[0].pool, "192.168.1.100 - 192.168.1.160");
	assert.equal(pools[0]["option-data"][0].data, "192.168.1.2");
	assert.equal(pools[1].pool, "192.168.1.200 - 192.168.1.220");
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

test("dhcp4: a relayed subnet without an interface keeps its shape", () => {
	const config = load("kea-dhcp4-rich.conf");
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const relayed = tabs.find((tab) => tab.subnet === "10.10.0.0/16");

	assert.equal(relayed.device, "");
	assert.equal(relayed.enabled, false);
	assert.equal(relayed.poolStart, "10.10.1.0/24");
	assert.equal(relayed.poolEnd, "");

	relayed.router = "10.10.0.1";

	const result = model.applyTabs("dhcp4", config, tabs);
	const subnet = result.config.Dhcp4.subnet4[1];

	assert.equal(result.errors, undefined);
	assert.equal("interface" in subnet, false);
	assert.deepEqual(subnet.pools, [ { pool: "10.10.1.0/24" } ]);
	assert.deepEqual(subnet.relay, { "ip-addresses": [ "10.10.0.1" ] });
	assert.deepEqual(subnet["option-data"], [ { name: "routers", data: "10.10.0.1" } ]);
});

test("dhcp4: a subnet without an interface is matched to the interface network", () => {
	const config = { Dhcp4: { subnet4: [ { id: 1, subnet: "192.168.50.0/24" } ] } };
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const guest = tabFor(tabs, "br-guest");

	assert.equal(guest.subnet, "192.168.50.0/24");

	/* Showing the matched device must not write an "interface" key. */
	assert.deepEqual(model.applyTabs("dhcp4", config, tabs).config, config);
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
	const tabs = model.buildTabs("dhcp4", config, INTERFACES);
	const lan = tabFor(tabs, "br-lan");

	assert.equal(lan.poolStart, "192.168.1.100");
	assert.equal(lan.poolEnd, "192.168.1.150");

	lan.router = "192.168.1.1";

	const result = model.applyTabs("dhcp4", config, tabs);

	/* Only the new option is added: no interface key, no inherited timer,
	 * no reformatted pool. */
	assert.deepEqual(diffPaths(config, result.config), [ "/Dhcp4/subnet4/0/option-data/1" ]);
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

test("dhcp4: an incomplete reservation is accepted only while disabled", () => {
	const config = load("kea-dhcp4-rich.conf");
	const edit = (enabled) => (tabs) => {
		const row = model.newReservation("dhcp4");

		row.enabled = enabled;
		row.hostname = "later";
		tabFor(tabs, "br-lan").reservations.push(row);
	};

	assert.equal(roundTrip("dhcp4", config, edit(true)).errors.length, 2);

	const stored = roundTrip("dhcp4", config, edit(false)).config.Dhcp4.subnet4[0];

	assert.deepEqual(stored["user-context"]["luci-app-kea"]["disabled-reservations"],
		[ { hostname: "later" } ]);
	assert.equal(stored.reservations.length, 3);
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

/* ---- DHCPv6 pools ------------------------------------------------------ */

test("dhcp6: editing the first pd-pool keeps its extra keys and the second pool", () => {
	const config = load("kea-dhcp6-rich.conf");
	const result = roundTrip("dhcp6", config, (tabs) => {
		tabFor(tabs, "br-lan").pdDelegatedLen = "60";
	});

	assert.deepEqual(diffPaths(config, result.config),
		[ "/Dhcp6/subnet6/0/pd-pools/0/delegated-len" ]);
	assert.equal(result.config.Dhcp6.subnet6[0]["pd-pools"][0]["excluded-prefix-len"], 72);
});

test("dhcp6: partial or non-numeric prefix delegation input is rejected", () => {
	const config = load("kea-dhcp6-rich.conf");

	assert.ok(roundTrip("dhcp6", config, (tabs) => {
		tabFor(tabs, "br-lan").pdPrefix = "";
	}).errors);

	assert.ok(roundTrip("dhcp6", config, (tabs) => {
		tabFor(tabs, "br-lan").pdPrefixLen = "abc";
	}).errors);
});

/* ---- subnets ----------------------------------------------------------- */

test("a new subnet gets an ID that no subnet or shared network uses", () => {
	const config = load("kea-dhcp4-rich.conf");
	const result = roundTrip("dhcp4", config, (tabs) => {
		const guest = tabFor(tabs, "br-guest");

		guest.subnet = "192.168.50.0/24";
		guest.poolStart = "192.168.50.100";
		guest.poolEnd = "192.168.50.199";
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

test("required fields are reported per tab", () => {
	const config = load("kea-dhcp4-rich.conf");

	assert.match(roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").subnet = "";
	}).errors[0], /subnet is required/);

	assert.match(roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").poolEnd = "";
	}).errors[0], /pool start and end/);

	assert.match(roundTrip("dhcp4", config, (tabs) => {
		tabFor(tabs, "br-lan").renewTimer = "soon";
	}).errors[0], /whole numbers/);

	assert.match(roundTrip("dhcp4", config, (tabs) => {
		tabs.find((tab) => tab.subnet === "10.10.0.0/16").enabled = true;
	}).errors[0], /interface device is required/);
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
