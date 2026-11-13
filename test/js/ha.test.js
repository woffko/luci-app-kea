/*
 * Unit tests for the High Availability model (kea/ha.js).
 *
 * The rules checked here were measured against the hook of Kea 3.0.4
 * ("kea-dhcp4 -T"); test/ucode/target/config.uc repeats some of them with
 * the real binary.
 *
 * Run: node --test "test/js/*.test.js"
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadModule } = require("./luci-loader.js");

const ha = loadModule("kea.ha");

const HOOKS = "/usr/lib/kea/hooks";

function relationship(extra) {
	return Object.assign({
		"this-server-name": "router1",
		mode: "hot-standby",
		"heartbeat-delay": 5000,
		"sync-page-limit": 5000,
		peers: [
			{ name: "router1", url: "http://192.168.1.1:8000/", role: "primary" },
			{ name: "router2", url: "http://192.168.1.2:8000/", role: "standby", "auto-failover": false,
				"basic-auth-user": "kea" }
		],
		"multi-threading": { "enable-multi-threading": true }
	}, extra);
}

function withHa(list) {
	return {
		Dhcp4: {
			"valid-lifetime": 3600,
			"hooks-libraries": [
				{ library: HOOKS + "/libdhcp_lease_cmds.so" },
				{ library: HOOKS + "/libdhcp_ha.so", parameters: { "high-availability": list } }
			],
			subnet4: []
		}
	};
}

const PLAIN = { Dhcp4: { "valid-lifetime": 3600, subnet4: [] } };

/* Fill the form of a configuration that has no HA yet. */
function enable(state) {
	state.enabled = true;
	state.thisServer = "a";

	for (const [ name, url ] of [ [ "a", "http://192.168.1.1:8000/" ], [ "b", "http://192.168.1.2:8000/" ] ]) {
		const row = ha.newPeer(state);

		row.name = name;
		row.url = url;
		state.peers.push(row);
	}

	return state;
}

function errorsOf(config, edit) {
	const state = ha.build("dhcp4", config);

	edit(state);

	const result = ha.apply("dhcp4", config, state, HOOKS);

	assert.ok(result.errors, "the save is refused");

	return result.errors;
}

/* ---- loading ----------------------------------------------------------- */

test("a configuration without the hook loads as switched off", () => {
	const state = ha.build("dhcp4", PLAIN);

	assert.equal(state.present, false);
	assert.equal(state.enabled, false);
	assert.equal(state.editable, true);
	assert.equal(state.mode, "hot-standby");
	assert.deepEqual(state.peers, []);
});

test("an existing relationship fills the form; the rest is JSON text", () => {
	const state = ha.build("dhcp4", withHa([ relationship() ]));

	assert.equal(state.enabled, true);
	assert.equal(state.thisServer, "router1");
	assert.equal(state.mode, "hot-standby");
	assert.equal(state.heartbeatDelay, "5000");
	assert.equal(state.maxResponseDelay, "");
	assert.equal(state.sendLeaseUpdates, true);
	assert.deepEqual(state.peers.map((row) => [ row.name, row.url, row.role, row.autoFailover ]), [
		[ "router1", "http://192.168.1.1:8000/", "primary", true ],
		[ "router2", "http://192.168.1.2:8000/", "standby", false ]
	]);
	assert.deepEqual(JSON.parse(state.advanced), {
		"sync-page-limit": 5000,
		"multi-threading": { "enable-multi-threading": true }
	});
});

test("the hook is found by its file name, whatever the directory", () => {
	const config = withHa([ relationship() ]);

	config.Dhcp4["hooks-libraries"][1].library = "libdhcp_ha.so";
	assert.equal(ha.build("dhcp4", config).present, true);
	assert.equal(ha.build("dhcp6", config).present, false);
});

test("several relationships are left to the raw editor", () => {
	const config = withHa([ relationship(), relationship({ "this-server-name": "other" }) ]);
	const state = ha.build("dhcp4", config);

	assert.equal(state.editable, false);
	assert.equal(state.relationships, 2);

	state.enabled = false;
	assert.equal(ha.apply("dhcp4", config, state, HOOKS).config, config);
});

/* ---- saving ------------------------------------------------------------ */

test("an untouched tab changes nothing, not even the object", () => {
	const config = withHa([ relationship() ]);

	assert.equal(ha.apply("dhcp4", config, ha.build("dhcp4", config), HOOKS).config, config);
	assert.equal(ha.apply("dhcp4", PLAIN, ha.build("dhcp4", PLAIN), HOOKS).config, PLAIN);
});

test("switching HA on adds both hooks and writes no defaults", () => {
	const state = enable(ha.build("dhcp4", PLAIN));
	const result = ha.apply("dhcp4", PLAIN, state, HOOKS);

	assert.deepEqual(result.config.Dhcp4["hooks-libraries"], [
		{ library: HOOKS + "/libdhcp_lease_cmds.so" },
		{
			library: HOOKS + "/libdhcp_ha.so",
			parameters: {
				"high-availability": [ {
					"this-server-name": "a",
					mode: "hot-standby",
					peers: [
						{ name: "a", url: "http://192.168.1.1:8000/", role: "primary" },
						{ name: "b", url: "http://192.168.1.2:8000/", role: "standby" }
					]
				} ]
			}
		}
	]);
	assert.equal(result.config.Dhcp4["valid-lifetime"], 3600);
	assert.deepEqual(PLAIN.Dhcp4["hooks-libraries"], undefined, "the input is not modified");
});

test("an existing lease commands hook is not added twice, other hooks stay", () => {
	const config = {
		Dhcp6: {
			"hooks-libraries": [
				{ library: HOOKS + "/libdhcp_flex_id.so", parameters: { "identifier-expression": "relay6[0].option[37].hex" } },
				{ library: "/usr/lib/kea/hooks/libdhcp_lease_cmds.so", parameters: {} }
			]
		}
	};
	const result = ha.apply("dhcp6", config, enable(ha.build("dhcp6", config)), HOOKS);
	const hooks = result.config.Dhcp6["hooks-libraries"];

	assert.equal(hooks.length, 3);
	assert.deepEqual(hooks.slice(0, 2), config.Dhcp6["hooks-libraries"]);
	assert.equal(hooks[2].library, HOOKS + "/libdhcp_ha.so");
});

test("a new peer row gets the role the mode still lacks", () => {
	const state = ha.build("dhcp4", PLAIN);
	const roles = () => {
		const row = ha.newPeer(state);

		row.name = "x" + state.peers.length;
		row.url = "http://192.168.1.9:8000/";
		state.peers.push(row);

		return row.role;
	};

	state.mode = "load-balancing";
	assert.deepEqual([ roles(), roles(), roles() ], [ "primary", "secondary", "backup" ]);
});

test("changing one value keeps every other key and its place", () => {
	const config = withHa([ relationship() ]);
	const state = ha.build("dhcp4", config);

	state.maxResponseDelay = "30000";
	state.peers[1].url = "http://192.168.1.3:8000/";

	const result = ha.apply("dhcp4", config, state, HOOKS);
	const expected = relationship({ "max-response-delay": 30000 });

	expected.peers[1].url = "http://192.168.1.3:8000/";
	assert.deepEqual(result.config.Dhcp4["hooks-libraries"][1].parameters["high-availability"], [ expected ]);
	assert.deepEqual(Object.keys(result.config.Dhcp4["hooks-libraries"][1].parameters["high-availability"][0]),
		Object.keys(relationship()).concat([ "max-response-delay" ]));
	assert.deepEqual(result.config.Dhcp4["hooks-libraries"][0], config.Dhcp4["hooks-libraries"][0]);
});

test("numbers are removed when cleared; switches are written only when moved", () => {
	const config = withHa([ relationship() ]);
	const state = ha.build("dhcp4", config);

	state.heartbeatDelay = "";
	state.syncLeases = false;
	state.peers[0].autoFailover = false;
	state.peers[1].autoFailover = true;

	const saved = ha.apply("dhcp4", config, state, HOOKS).config
		.Dhcp4["hooks-libraries"][1].parameters["high-availability"][0];

	assert.equal("heartbeat-delay" in saved, false);
	assert.equal(saved["sync-leases"], false);
	assert.equal("send-lease-updates" in saved, false);
	assert.equal(saved.peers[0]["auto-failover"], false);
	assert.equal(saved.peers[1]["auto-failover"], true);
	assert.equal(saved.peers[1]["basic-auth-user"], "kea");
});

test("the additional parameters are edited as JSON", () => {
	const config = withHa([ relationship() ]);
	const state = ha.build("dhcp4", config);

	state.advanced = "{ \"multi-threading\": { \"enable-multi-threading\": false }, \"wait-backup-ack\": false }";

	const saved = ha.apply("dhcp4", config, state, HOOKS).config
		.Dhcp4["hooks-libraries"][1].parameters["high-availability"][0];

	assert.equal("sync-page-limit" in saved, false, "a key deleted from the text is removed");
	assert.deepEqual(saved["multi-threading"], { "enable-multi-threading": false });
	assert.equal(saved["wait-backup-ack"], false);
	assert.equal(saved["heartbeat-delay"], 5000);

	assert.match(errorsOf(config, (edit) => {
		edit.advanced = "{ \"mode\": \"load-balancing\" }";
	})[0], /Additional parameters: this parameter has a field of its own above: mode/);

	assert.match(errorsOf(config, (edit) => {
		edit.advanced = "[ 1 ]";
	})[0], /Additional parameters: must be a JSON object/);

	assert.match(errorsOf(config, (edit) => {
		edit.advanced = "{ oops";
	})[0], /Additional parameters: not valid JSON/);
});

test("switching HA off removes its hook and nothing else", () => {
	const config = withHa([ relationship() ]);
	const state = ha.build("dhcp4", config);

	state.enabled = false;

	const result = ha.apply("dhcp4", config, state, HOOKS);

	assert.deepEqual(result.config.Dhcp4["hooks-libraries"], [ config.Dhcp4["hooks-libraries"][0] ]);

	const only = { Dhcp4: { "hooks-libraries": [ config.Dhcp4["hooks-libraries"][1] ] } };
	const off = ha.build("dhcp4", only);

	off.enabled = false;
	assert.deepEqual(ha.apply("dhcp4", only, off, HOOKS).config, { Dhcp4: {} });
});

test("switched on and off again without saving changes nothing", () => {
	const state = enable(ha.build("dhcp4", PLAIN));

	state.enabled = false;
	assert.equal(ha.apply("dhcp4", PLAIN, state, HOOKS).config, PLAIN);
});

/* ---- checks ------------------------------------------------------------ */

test("this server must be one of the peers", () => {
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).thisServer = "c";
	}), [ "High availability: This server: no peer has this name" ]);

	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).thisServer = "";
	}), [ "High availability: This server: the name of this server is required" ]);
});

test("each mode needs its roles, as the hook does", () => {
	/* hot standby: one primary, one standby */
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).peers[1].role = "backup";
	}), [ "High availability: Peers: hot standby needs exactly one standby server" ]);

	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).peers[1].role = "primary";
	}), [
		"High availability: Peers: exactly one peer must be the primary server",
		"High availability: Peers: hot standby needs exactly one standby server"
	]);

	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).peers[1].role = "secondary";
	}), [
		"High availability: Peers: this role is not allowed in this mode: secondary",
		"High availability: Peers: hot standby needs exactly one standby server"
	]);

	/* load balancing: one primary, one secondary, no standby */
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).mode = "load-balancing";
	}), [
		"High availability: Peers: this role is not allowed in this mode: standby",
		"High availability: Peers: load balancing needs exactly one secondary server"
	]);

	/* passive backup: a primary and backups only */
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).mode = "passive-backup";
	}), [ "High availability: Peers: this role is not allowed in this mode: standby" ]);

	const state = enable(ha.build("dhcp4", PLAIN));

	state.mode = "passive-backup";
	state.peers[1].role = "backup";
	assert.ok(ha.apply("dhcp4", PLAIN, state, HOOKS).config);
});

test("peer names are required and unique", () => {
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).peers[1].name = "a";
	}), [
		"High availability: Peers: another peer has the same name: a",
		"High availability: Peers: another peer has the same name: a"
	]);

	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).peers[1].name = "";
	}), [ "High availability: Peers: a peer needs a name: http://192.168.1.2:8000/" ]);
});

test("a peer URL needs an IP address; https needs TLS", () => {
	const urlError = (url, advanced) => {
		const state = enable(ha.build("dhcp4", PLAIN));

		state.peers[1].url = url;
		state.advanced = advanced || "";

		return ha.peerError(state, state.peers[1], "url");
	};

	for (const good of [ "http://192.168.1.2:8000/", "http://192.168.1.2:8000", "http://192.168.1.2/",
		"http://[fd00:1::2]:8000/", "http://[::1]:8000/", "http://192.168.1.2:8000/kea" ])
		assert.equal(urlError(good), null, good);

	assert.match(urlError("http://router2.lan:8000/"), /IP address in the URL, not a host name/);
	assert.match(urlError("http://[fd00::zz]:8000/"), /IP address/);
	assert.match(urlError("http://300.1.1.1:8000/"), /IP address/);
	assert.match(urlError("192.168.1.2:8000"), /not a URL/);
	assert.match(urlError(""), /not a URL/);
	assert.match(urlError("https://192.168.1.2:8000/"), /https needs the TLS parameters/);
	assert.equal(urlError("https://192.168.1.2:8000/",
		"{ \"trust-anchor\": \"/etc/kea/ca.pem\", \"cert-file\": \"/etc/kea/cert.pem\", \"key-file\": \"/etc/kea/key.pem\" }"), null);
});

test("timers are whole numbers", () => {
	assert.deepEqual(errorsOf(PLAIN, (state) => {
		enable(state).heartbeatDelay = "-1";
	}), [ "High availability: Heartbeat delay: not a whole number" ]);

	const state = enable(ha.build("dhcp4", PLAIN));

	state.maxUnackedClients = "0";

	assert.equal(ha.apply("dhcp4", PLAIN, state, HOOKS).config
		.Dhcp4["hooks-libraries"][1].parameters["high-availability"][0]["max-unacked-clients"], 0);
});

test("a blank new peer row is ignored", () => {
	const config = withHa([ relationship() ]);
	const state = ha.build("dhcp4", config);

	state.peers.push(ha.newPeer(state));
	assert.equal(ha.changed(state), false);
	assert.equal(ha.apply("dhcp4", config, state, HOOKS).config, config);
});

test("fallback values shown as placeholders are those of Kea 3.0.4", () => {
	assert.deepEqual(ha.numberFields().map((field) => [ field, ha.fallback(field) ]), [
		[ "heartbeatDelay", "10000" ],
		[ "maxResponseDelay", "60000" ],
		[ "maxAckDelay", "10000" ],
		[ "maxUnackedClients", "10" ],
		[ "syncTimeout", "60000" ]
	]);
});
