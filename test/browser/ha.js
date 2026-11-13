#!/usr/bin/env node
/*
 * End-to-end test of the "High availability" tab of the DHCPv4 and DHCPv6
 * editors.
 *
 * For each address family it switches high availability on, corrects a peer
 * URL the form refuses, saves, changes the mode, lets Kea itself refuse a
 * parameter the form does not know, and switches high availability off
 * again. After every save the file is read back through the Configuration
 * page.
 *
 * Every save is checked by the Kea binary with the hook loaded, so the test
 * also proves that Kea accepts what the tab writes.
 *
 * The target needs the kea-hook-ha and kea-hook-lease-cmds packages. The
 * test rewrites /etc/kea/kea-dhcp4.conf and kea-dhcp6.conf while it runs and
 * puts the originals back. It reloads no daemon. See lib.js for the
 * environment variables.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	openPage, screenshot, main, footerButton, expectNotification, readRawConfig, writeRawConfig,
	fieldRow, fieldInput, tableRows, tableValues, addRow, openTab
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

const HOOKS = "/usr/lib/kea/hooks";

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const SCENARIOS = [
	{
		family: "dhcp4",
		root: "Dhcp4",
		heading: "Kea DHCPv4",
		fixture: fixture("kea-dhcp4-rich.conf"),
		urls: [ "http://192.168.1.1:8000/", "http://192.168.1.2:8000/" ]
	},
	{
		family: "dhcp6",
		root: "Dhcp6",
		heading: "Kea DHCPv6",
		fixture: fixture("kea-dhcp6-rich.conf"),
		urls: [ "http://[fd00:1::1]:8000/", "http://[fd00:1::2]:8000/" ]
	}
];

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

function parse(content) {
	const parsed = model.parseConfig(content);

	assert.equal(parsed.error, null);

	return parsed.config;
}

/* The fixture with the given hook entries appended. */
function expected(scenario, relationship) {
	const config = parse(scenario.fixture);
	const hooks = [ { library: HOOKS + "/libdhcp_lease_cmds.so" } ];

	if (relationship)
		hooks.push({ library: HOOKS + "/libdhcp_ha.so", parameters: { "high-availability": [ relationship ] } });

	config[scenario.root]["hooks-libraries"] = hooks;

	return config;
}

async function openHaTab(page, scenario) {
	const tab = page.locator("#view .cbi-tabmenu a", { hasText: "High availability" });

	await openPage(page, scenario.family, scenario.heading);
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();

	if (await tab.count() === 0)
		throw new Error("no High availability tab: install kea-hook-ha on the target");

	await openTab(page, "High availability");
}

async function save(page) {
	await footerButton(page, "Save").click();
	await expectNotification(page, "configuration saved");
}

async function testHa(page, scenario) {
	const name = scenario.family;
	const peers = () => tableRows(page, "kea-ha-peers");
	const roles = () => peers().locator("select").evaluateAll((nodes) => nodes.map((node) => node.value));
	const mode = fieldRow(page, "Mode").locator("select");
	let inputs;

	await writeRawConfig(page, name, scenario.fixture);
	await openHaTab(page, scenario);
	assert.equal(await fieldInput(page, "Enable").isChecked(), false);
	assert.equal(await fieldRow(page, "Mode").count(), 0);
	ok(name + ": the tab is offered and high availability is off");

	await fieldInput(page, "Enable").check();
	await mode.waitFor();
	assert.equal(await mode.inputValue(), "hot-standby");
	await fieldInput(page, "This server").fill("router1");
	await addRow(page, "kea-ha-peers", "Add Peer", [ "router1", scenario.urls[0] ]);
	inputs = await addRow(page, "kea-ha-peers", "Add Peer", [ "router2", "http://router2.lan:8000/" ]);
	assert.deepEqual(await roles(), [ "primary", "standby" ]);
	assert.equal(await page.locator("#view .alert-message", { hasText: "needs exactly one" }).count(), 0,
		"no complaint about roles once both peers are named");
	assert.doesNotMatch(await fieldInput(page, "This server").getAttribute("class") || "", /cbi-input-invalid/);
	assert.match(await inputs.nth(1).getAttribute("class"), /cbi-input-invalid/);
	assert.match(await inputs.nth(1).getAttribute("title"), /IP address/);
	await footerButton(page, "Save").click();
	await expectNotification(page, "High availability: Peers: Kea needs an IP address in the URL");
	ok(name + ": a peer URL with a host name is marked and not saved");

	/* Nothing was sent, and the form still holds what was typed. */
	assert.deepEqual(await tableValues(page, "kea-ha-peers"),
		[ [ "router1", scenario.urls[0] ], [ "router2", "http://router2.lan:8000/" ] ]);
	await inputs.nth(1).fill(scenario.urls[1]);
	await screenshot(page, name + "-ha");
	await save(page);

	const relationship = {
		"this-server-name": "router1",
		mode: "hot-standby",
		peers: [
			{ name: "router1", url: scenario.urls[0], role: "primary" },
			{ name: "router2", url: scenario.urls[1], role: "standby" }
		]
	};

	assert.deepEqual(parse(await readRawConfig(page, name)), expected(scenario, relationship));
	ok(name + ": Kea accepts the hot standby setup with the hook loaded; nothing else changed");

	await openHaTab(page, scenario);
	assert.equal(await fieldInput(page, "Enable").isChecked(), true);
	assert.equal(await fieldInput(page, "This server").inputValue(), "router1");
	assert.deepEqual(await tableValues(page, "kea-ha-peers"),
		[ [ "router1", scenario.urls[0] ], [ "router2", scenario.urls[1] ] ]);
	await footerButton(page, "Save").click();
	await expectNotification(page, "no changes to save");
	ok(name + ": the saved setup is shown again and saving it unchanged writes nothing");

	/* A parameter the form does not know is checked by the hook itself. */
	await fieldRow(page, "Additional parameters").locator("textarea").fill("{ \"delayed-updates-limit\": 100 }");
	await footerButton(page, "Save").click();
	await expectNotification(page, "'delayed-updates-limit' must be set to 0 in the hot standby configuration");
	assert.equal(await fieldRow(page, "Additional parameters").locator("textarea").inputValue(),
		"{ \"delayed-updates-limit\": 100 }");
	assert.deepEqual(parse(await readRawConfig(page, name)), expected(scenario, relationship));
	ok(name + ": Kea's own refusal is shown with its reason, the form keeps the input, the file is unchanged");

	await openHaTab(page, scenario);
	await mode.selectOption("load-balancing");
	await page.locator("#view .alert-message", { hasText: "load balancing needs exactly one secondary server" }).waitFor();
	assert.match(await peers().nth(1).locator("select").getAttribute("class"), /cbi-input-invalid/);
	await footerButton(page, "Save").click();
	await expectNotification(page, "High availability: Peers: this role is not allowed in this mode: standby");
	await peers().nth(1).locator("select").selectOption("secondary");
	assert.equal(await page.locator("#view .alert-message", { hasText: "exactly one secondary" }).count(), 0);
	await fieldInput(page, "Heartbeat delay").fill("5000");
	await fieldInput(page, "Send lease updates").uncheck();
	await fieldRow(page, "Additional parameters").locator("textarea").fill("{ \"delayed-updates-limit\": 50 }");
	await save(page);

	const balanced = {
		"this-server-name": "router1",
		mode: "load-balancing",
		peers: [
			{ name: "router1", url: scenario.urls[0], role: "primary" },
			{ name: "router2", url: scenario.urls[1], role: "secondary" }
		],
		"heartbeat-delay": 5000,
		"send-lease-updates": false,
		"delayed-updates-limit": 50
	};

	assert.deepEqual(parse(await readRawConfig(page, name)), expected(scenario, balanced));
	ok(name + ": the mode, a role, a timer, a switch and an additional parameter are changed in place");

	await openHaTab(page, scenario);
	assert.equal(await fieldInput(page, "Heartbeat delay").inputValue(), "5000");
	assert.equal(await fieldInput(page, "Send lease updates").isChecked(), false);
	await fieldInput(page, "Enable").uncheck();
	assert.equal(await fieldRow(page, "Mode").count(), 0);
	await save(page);
	assert.deepEqual(parse(await readRawConfig(page, name)), expected(scenario, null));
	ok(name + ": switching high availability off removes its hook entry only");
}

main(async (page) => {
	for (const scenario of SCENARIOS) {
		const original = await readRawConfig(page, scenario.family);

		assert.ok(original.length > 0, "the target has a " + scenario.family + " config");

		try {
			await testHa(page, scenario);
		}
		finally {
			if (await readRawConfig(page, scenario.family) !== original)
				await writeRawConfig(page, scenario.family, original);
		}

		assert.equal(await readRawConfig(page, scenario.family), original);
		ok(scenario.family + ": the original configuration is back in place");
	}

	console.log("all high availability checks passed");
});
