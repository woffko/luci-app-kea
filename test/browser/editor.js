#!/usr/bin/env node
/*
 * End-to-end test of the DHCPv4 and DHCPv6 editors, the raw editor and the
 * backups.
 *
 * The test drives the pages like a user and reads the result back through
 * the Configuration page, so it needs nothing but LuCI access. For each
 * address family it:
 *
 *   1. loads a fixture with many settings through the raw editor;
 *   2. changes one option and disables one reservation in the editor;
 *   3. checks that nothing else in the file changed;
 *   4. restores the newest backup and checks that the fixture is back,
 *      byte for byte;
 *   5. checks that a wrong value is marked and refused, then adds a pool, an
 *      option and global settings, looks at the changes before saving, and
 *      checks the file again;
 *   6. puts the original file back.
 *
 * For DHCPv4 it also edits a subnet of a shared network, removes the example
 * entries of a stock-like config through the explicit action, and checks the
 * syntax check and the change view of the raw editor.
 *
 * Every save is validated by the Kea binary on the target, so the test also
 * proves that the editor output is accepted by Kea.
 *
 * It rewrites /etc/kea/kea-dhcp4.conf and kea-dhcp6.conf on the target while
 * it runs. Use a test machine whose LAN device is br-lan. See lib.js for the
 * environment variables.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	openPage, screenshot, waitForModal, main, footerButton, expectNotification, openRawEditor,
	readRawConfig, writeRawConfig, fieldInput, tableRows, tableValues, addRow, openTab
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const SCENARIOS = [
	{
		family: "dhcp4",
		heading: "Kea DHCPv4",
		fixture: fixture("kea-dhcp4-rich.conf"),
		shown: { "Subnet": "192.168.1.0/24", "Gateway": "192.168.1.1", "Domain Name": "lan" },
		pools: [ "192.168.1.100 - 192.168.1.150", "192.168.1.200 - 192.168.1.220" ],
		options: [ [ "ntp-servers", "192.168.1.1" ] ],
		edit: { label: "Gateway", value: "192.168.1.254" },
		disabledType: "client-id",
		wrongPool: "192.168.2.10 - 192.168.2.20",
		newPool: "192.168.1.230 - 192.168.1.240",
		newOption: [ "time-servers", "192.168.1.1" ],
		globalLifetime: "5000",
		extended(config) {
			const subnet = config.Dhcp4.subnet4[0];

			subnet.pools.push({ pool: "192.168.1.230 - 192.168.1.240" });
			subnet["option-data"].push({ name: "time-servers", data: "192.168.1.1" });
			config.Dhcp4["valid-lifetime"] = 5000;
			config.Dhcp4["lease-database"]["lfc-interval"] = 1800;
			config.Dhcp4["option-data"].push({ code: 42, data: "192.168.1.1" });
			config.Dhcp4["shared-networks"][0].subnet4[0].pools[0].pool = "10.20.0.10 - 10.20.0.60";
		},
		expected(config) {
			const subnet = config.Dhcp4.subnet4[0];
			const moved = subnet.reservations.splice(1, 1);

			subnet["option-data"][0].data = "192.168.1.254";
			subnet["user-context"]["luci-app-kea"] = { "disabled-reservations": moved };
		}
	},
	{
		family: "dhcp6",
		heading: "Kea DHCPv6",
		fixture: fixture("kea-dhcp6-rich.conf"),
		shown: { "Subnet": "fd00:1::/64", "DNS Servers": "fd00:1::1, fd00:1::2", "Preferred Lifetime": "1800" },
		pools: [ "fd00:1::100 - fd00:1::1ff", "fd00:1::1000/116" ],
		pdPools: [ [ "fd00:1:0:100::", "56", "64" ], [ "fd00:1:0:200::", "56", "60" ] ],
		options: [ [ "sntp-servers", "fd00:1::1" ] ],
		edit: { label: "DNS Servers", value: "fd00:1::53" },
		disabledType: "hw-address",
		wrongPool: "fd00:2::1 - fd00:2::ff",
		newPool: "fd00:1::2000 - fd00:1::2fff",
		newOption: [ "nis-servers", "fd00:1::5" ],
		newPdPool: [ "fd00:1:0:400::", "56", "64" ],
		globalLifetime: "5000",
		extended(config) {
			const subnet = config.Dhcp6.subnet6[0];

			subnet.pools.push({ pool: "fd00:1::2000 - fd00:1::2fff" });
			subnet["pd-pools"].push({ prefix: "fd00:1:0:400::", "prefix-len": 56, "delegated-len": 64 });
			subnet["option-data"].push({ name: "nis-servers", data: "fd00:1::5" });
			config.Dhcp6["valid-lifetime"] = 5000;
			config.Dhcp6["lease-database"]["lfc-interval"] = 1800;
			config.Dhcp6["option-data"].push({ code: 31, data: "fd00:1::1" });
		},
		expected(config) {
			const subnet = config.Dhcp6.subnet6[0];
			const moved = subnet.reservations.splice(1, 1);

			subnet["option-data"][0].data = "fd00:1::53";
			subnet["user-context"] = { "luci-app-kea": { "disabled-reservations": moved } };
		}
	}
];

/* A config shaped like the stock one: example entries plus a real subnet. */
const WITH_EXAMPLES = {
	Dhcp4: {
		"interfaces-config": { interfaces: [] },
		"option-data": [
			{ name: "domain-name-servers", data: "192.0.2.1, 192.0.2.2" },
			{ code: 15, data: "example.org" },
			{ name: "ntp-servers", data: "192.168.1.1" }
		],
		"client-classes": [
			{ name: "voip", test: "substring(option[60].hex,0,6) == 'Aastra'", "next-server": "192.0.2.254" }
		],
		subnet4: [
			{ id: 1, subnet: "192.0.2.0/24", pools: [ { pool: "192.0.2.1 - 192.0.2.200" } ] },
			{ id: 2, subnet: "192.168.1.0/24", "interface": "br-lan", pools: [ { pool: "192.168.1.100 - 192.168.1.150" } ] }
		]
	}
};

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

async function openEditor(page, scenario) {
	await openPage(page, scenario.family, scenario.heading);
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
}

function parse(content) {
	const parsed = model.parseConfig(content);

	assert.equal(parsed.error, null);

	return parsed.config;
}

async function testEditor(page, scenario) {
	const name = scenario.family;
	const rows = tableRows(page, "kea-reservations");

	await writeRawConfig(page, scenario.family, scenario.fixture);
	assert.equal(await readRawConfig(page, scenario.family), scenario.fixture);
	ok(name + ": raw editor saved the fixture and Kea accepted it");

	await openEditor(page, scenario);

	for (const label of Object.keys(scenario.shown))
		assert.equal(await fieldInput(page, label).inputValue(), scenario.shown[label], label);

	assert.deepEqual(await tableValues(page, "kea-pools"), scenario.pools.map((pool) => [ pool ]));
	assert.deepEqual(await tableValues(page, "kea-options"), scenario.options);

	if (scenario.pdPools)
		assert.deepEqual(await tableValues(page, "kea-pd-pools"), scenario.pdPools);

	assert.equal(await rows.count(), 3);
	assert.equal(await rows.nth(1).locator("select").inputValue(), scenario.disabledType);
	ok(name + ": editor shows the subnet, all its pools and options and all three reservations");

	await fieldInput(page, scenario.edit.label).fill(scenario.edit.value);
	await rows.nth(1).locator('input[type="checkbox"]').uncheck();
	await screenshot(page, name + "-editor-before-save");
	await footerButton(page, "Save").click();
	await expectNotification(page, "configuration saved");
	ok(name + ": editor saved and Kea accepted the result");

	const expected = parse(scenario.fixture);

	scenario.expected(expected);
	assert.deepEqual(parse(await readRawConfig(page, scenario.family)), expected);
	ok(name + ": only the edited option and the disabled reservation changed in the file");

	await openEditor(page, scenario);
	assert.equal(await rows.count(), 3);
	assert.equal(await rows.nth(2).locator('input[type="checkbox"]').isChecked(), false);
	assert.equal(await rows.nth(2).locator("select").inputValue(), scenario.disabledType);
	ok(name + ": the disabled reservation is still shown after a reload");

	await footerButton(page, "Save & Apply").click();
	await expectNotification(page, "no changes to save");
	ok(name + ": saving without changes writes nothing");

	await openRawEditor(page, scenario.family);

	const backups = page.locator("#view .cbi-section", { hasText: "Backups" });

	assert.ok(await backups.locator("select option").count() >= 2);
	await backups.locator("button", { hasText: /^Restore$/ }).click();
	await page.locator(".modal button", { hasText: /^Restore$/ }).click();
	await expectNotification(page, "backup restored");
	assert.equal(await readRawConfig(page, scenario.family), scenario.fixture);
	ok(name + ": restoring the newest backup brought the fixture back byte for byte");
}

/*
 * The warning about a second DHCP server must be there exactly when OpenWrt
 * serves the interface, Kea is enabled on it and dnsmasq or odhcpd runs.
 */
async function testConflictWarning(page, scenario) {
	const name = scenario.family;
	const warning = page.locator("#view .alert-message", { hasText: "OpenWrt also serves DHCP on this interface" });
	const state = await page.evaluate(() => L.require("kea.backend").then((backend) =>
		Promise.all([ backend.getStatus(), backend.getInterfaces() ])));
	const conflicts = state[0].conflicts || {};
	const lan = state[1].filter((item) => item.device === "br-lan")[0] || {};
	const running = !!((conflicts.dnsmasq && conflicts.dnsmasq.running) || (conflicts.odhcpd && conflicts.odhcpd.running));
	const served = !!(name === "dhcp4" ? lan.dhcp4_server : lan.dhcp6_server);
	const enable = fieldInput(page, "Enable");

	assert.equal(await enable.isChecked(), true);
	assert.equal(await warning.count(), running && served ? 1 : 0);
	await enable.uncheck();
	assert.equal(await warning.count(), 0);
	await enable.check();
	assert.equal(await warning.count(), running && served ? 1 : 0);
	ok(name + ": the warning about a second DHCP server is " +
		(running && served ? "shown while Kea is enabled on the interface" : "not shown, as OpenWrt does not serve the interface"));
}

/* Runs on the fixture: wrong input, then pools, options and global settings. */
async function testCompleteness(page, scenario) {
	const name = scenario.family;
	const changes = page.locator(".modal .kea-changes");
	let inputs;

	await openEditor(page, scenario);
	await testConflictWarning(page, scenario);

	inputs = await addRow(page, "kea-pools", "Add Pool", [ scenario.wrongPool ]);
	assert.match(await inputs.first().getAttribute("class"), /cbi-input-invalid/);
	assert.match(await inputs.first().getAttribute("title"), /subnet/);
	await footerButton(page, "Save").click();
	await expectNotification(page, "Address Pools: " + scenario.wrongPool);
	assert.equal(await readRawConfig(page, scenario.family), scenario.fixture);
	ok(name + ": a pool outside the subnet is marked in the form and not saved");

	await openEditor(page, scenario);
	inputs = await addRow(page, "kea-pools", "Add Pool", [ scenario.newPool ]);
	assert.doesNotMatch(await inputs.first().getAttribute("class"), /cbi-input-invalid/);
	await addRow(page, "kea-options", "Add Option", scenario.newOption);

	if (scenario.newPdPool)
		await addRow(page, "kea-pd-pools", "Add Prefix Pool", scenario.newPdPool);

	if (name === "dhcp4") {
		await openTab(page, "floor2: 10.20.0.0/24");
		assert.equal(await fieldInput(page, "Subnet").inputValue(), "10.20.0.0/24");
		assert.deepEqual(await tableValues(page, "kea-pools"), [ [ "10.20.0.10 - 10.20.0.50" ] ]);
		await tableRows(page, "kea-pools").first().locator("input").first().fill("10.20.0.10 - 10.20.0.60");
	}

	await openTab(page, "Global settings");
	assert.deepEqual(await tableValues(page, "kea-options"),
		[ [ name === "dhcp4" ? "domain-name-servers" : "dns-servers", name === "dhcp4" ? "192.168.1.1" : "fd00:1::1" ] ]);
	await fieldInput(page, "Valid Lifetime").fill(scenario.globalLifetime);
	await fieldInput(page, "Lease File Cleanup").fill("1800");
	await addRow(page, "kea-options", "Add Option",
		name === "dhcp4" ? [ "42", "192.168.1.1" ] : [ "31", "fd00:1::1" ]);

	/* The first tab keeps what was typed into it while another tab was open. */
	await openTab(page, "br-lan");
	assert.equal((await tableValues(page, "kea-pools")).pop()[0], scenario.newPool);

	await page.locator("#view button", { hasText: /^Show changes$/ }).click();
	await changes.waitFor();

	const shown = await changes.innerText();

	assert.match(shown, /\+\s+"valid-lifetime": 5000/);
	assert.match(shown, /-\s+"lfc-interval": 3600/);
	assert.ok(shown.includes(scenario.newPool), "the new pool is among the changes");
	await waitForModal(page);
	await screenshot(page, name + "-changes", true);
	await page.locator(".modal button", { hasText: /^Close$/ }).click();
	ok(name + ": the changes are shown before saving");

	await footerButton(page, "Save").click();
	await expectNotification(page, "configuration saved");

	const expected = parse(scenario.fixture);

	scenario.extended(expected);
	assert.deepEqual(parse(await readRawConfig(page, scenario.family)), expected);
	ok(name + ": new pools, options and global settings are saved and nothing else changed");

	await openEditor(page, scenario);
	await page.locator("#view button", { hasText: /^Show changes$/ }).click();
	await changes.waitFor();
	assert.match(await changes.innerText(), /There are no changes/);
	await page.locator(".modal button", { hasText: /^Close$/ }).click();
	ok(name + ": a freshly loaded configuration has no changes");
}

/* The raw editor refuses text that is not JSON before it reaches the router. */
async function testRawEditor(page, scenario) {
	const before = await readRawConfig(page, scenario.family);
	const textarea = page.locator("#view textarea");
	const changes = page.locator(".modal .kea-changes");

	await textarea.fill(before.replace(/\}\s*$/, ""));
	await page.locator("#view .kea-syntax .alert-message", { hasText: "JSON syntax error" }).waitFor();
	await footerButton(page, "Save").click();
	await expectNotification(page, "not valid JSON");
	assert.equal(await readRawConfig(page, scenario.family), before);
	ok("raw editor: text that is not JSON is reported and not saved");

	const refused = before.replace("\"renew-timer\": 900", "\"renew-timer\": \"soon\"");

	await textarea.fill(refused);
	await footerButton(page, "Save").click();
	await expectNotification(page, "validation failed");
	assert.equal(await textarea.inputValue(), refused);
	assert.equal(await readRawConfig(page, scenario.family), before);
	await openRawEditor(page, scenario.family);
	ok("raw editor: a text Kea refuses stays in the editor to be corrected, and is not saved");

	await textarea.fill(before.replace("\"renew-timer\": 900", "\"renew-timer\": 901"));
	assert.equal(await page.locator("#view .kea-syntax .alert-message").count(), 0);
	await page.locator("#view button", { hasText: /^Show changes$/ }).click();
	await changes.waitFor();
	assert.match(await changes.innerText(), /-\s+"renew-timer": 900,\n\+\s+"renew-timer": 901,/);
	await page.locator(".modal button", { hasText: /^Close$/ }).click();
	ok("raw editor: the changes are shown before saving");
}

async function testExampleRemoval(page, scenario) {
	const removeButton = page.locator("#view button", { hasText: /^Remove example entries$/ });

	await writeRawConfig(page, scenario.family, JSON.stringify(WITH_EXAMPLES, null, "\t") + "\n");
	await openEditor(page, scenario);
	await removeButton.waitFor();
	assert.ok(await page.locator("#view .cbi-tabmenu a", { hasText: "br-lan" }).count() > 0);
	assert.equal(await page.locator("#view .cbi-tabmenu a", { hasText: "192.0.2.0/24" }).count(), 0);
	ok("dhcp4: example entries are announced and the example subnet has no tab");

	await fieldInput(page, "Gateway").fill("192.168.1.1");
	await footerButton(page, "Save").click();
	await expectNotification(page, "configuration saved");

	const kept = model.clone(WITH_EXAMPLES);

	kept.Dhcp4.subnet4[1]["option-data"] = [ { name: "routers", data: "192.168.1.1" } ];
	assert.deepEqual(parse(await readRawConfig(page, scenario.family)), kept);
	ok("dhcp4: an ordinary save keeps the example entries");

	await openEditor(page, scenario);
	await fieldInput(page, "Domain Name").fill("lan");
	await removeButton.click();
	await page.locator(".modal button", { hasText: /^Remove and save$/ }).click();
	await expectNotification(page, "configuration saved");

	const cleaned = parse(await readRawConfig(page, scenario.family));

	assert.deepEqual(cleaned, {
		Dhcp4: {
			"interfaces-config": { interfaces: [] },
			"option-data": [ { name: "ntp-servers", data: "192.168.1.1" } ],
			subnet4: [
				{
					id: 2,
					subnet: "192.168.1.0/24",
					"interface": "br-lan",
					pools: [ { pool: "192.168.1.100 - 192.168.1.150" } ],
					"option-data": [
						{ name: "routers", data: "192.168.1.1" },
						{ name: "domain-name", data: "lan" }
					]
				}
			]
		}
	});
	ok("dhcp4: the explicit action removes the example entries and keeps the pending edit");

	await openEditor(page, scenario);
	assert.equal(await removeButton.count(), 0);
	ok("dhcp4: the notice is gone once the example entries are removed");
}

main(async (page) => {
	for (const scenario of SCENARIOS) {
		const original = await readRawConfig(page, scenario.family);

		assert.ok(original.length > 0, "the target has a " + scenario.family + " config");

		try {
			await testEditor(page, scenario);
			await testCompleteness(page, scenario);

			if (scenario.family === "dhcp4") {
				await writeRawConfig(page, scenario.family, scenario.fixture);
				await testRawEditor(page, scenario);
				await testExampleRemoval(page, scenario);
			}
		}
		finally {
			if (await readRawConfig(page, scenario.family) !== original)
				await writeRawConfig(page, scenario.family, original);
		}

		assert.equal(await readRawConfig(page, scenario.family), original);
		ok(scenario.family + ": the original configuration is back in place");
	}

	console.log("all editor checks passed");
});
