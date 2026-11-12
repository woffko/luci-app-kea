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
 *   5. puts the original file back.
 *
 * For DHCPv4 it also removes the example entries of a stock-like config
 * through the explicit action.
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
	openPage, screenshot, main, footerButton, expectNotification, openRawEditor,
	readRawConfig, writeRawConfig
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
		edit: { label: "Gateway", value: "192.168.1.254" },
		disabledType: "client-id",
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
		edit: { label: "DNS Servers", value: "fd00:1::53" },
		disabledType: "hw-address",
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

function fieldInput(page, label) {
	return page.locator(".cbi-value", {
		has: page.locator("label.cbi-value-title", { hasText: new RegExp("^" + label + "$") })
	}).locator("input").first();
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
	const rows = page.locator("#view table tbody tr");

	await writeRawConfig(page, scenario.family, scenario.fixture);
	assert.equal(await readRawConfig(page, scenario.family), scenario.fixture);
	ok(name + ": raw editor saved the fixture and Kea accepted it");

	await openEditor(page, scenario);

	for (const label of Object.keys(scenario.shown))
		assert.equal(await fieldInput(page, label).inputValue(), scenario.shown[label], label);

	assert.equal(await rows.count(), 3);
	assert.equal(await rows.nth(1).locator("select").inputValue(), scenario.disabledType);
	ok(name + ": editor shows the subnet, its options and all three reservations");

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

async function testExampleRemoval(page, scenario) {
	const removeButton = page.locator("#view button", { hasText: /^Remove example entries$/ });

	await writeRawConfig(page, scenario.family, JSON.stringify(WITH_EXAMPLES, null, "\t") + "\n");
	await openEditor(page, scenario);
	await removeButton.waitFor();
	assert.equal(await page.locator("#view button", { hasText: "192.0.2.0/24" }).count(), 0);
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

			if (scenario.family === "dhcp4")
				await testExampleRemoval(page, scenario);
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
