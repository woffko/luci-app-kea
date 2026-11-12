#!/usr/bin/env node
/*
 * End-to-end test of the static lease import.
 *
 * Precondition: the host sections of test/fixtures/dhcp-static-leases.uci
 * are in /etc/config/dhcp of the target, for example with
 *
 *   cat dhcp-static-leases.uci >> /etc/config/dhcp
 *
 * The test cannot add them itself: it only has LuCI access. dnsmasq does
 * not have to be reloaded. Remove the sections again after the test.
 *
 * The test loads the two Kea fixtures through the Configuration page, checks
 * how the import page classifies each fixture static lease, imports the
 * ready ones plus one disabled lease, checks both files, checks that the
 * imported leases are then found in Kea, and puts the original files back.
 * Static leases of the target itself are left out of the import.
 *
 * It rewrites /etc/kea/kea-dhcp4.conf and kea-dhcp6.conf while it runs. Use
 * a test machine whose LAN is 192.168.1.1/24 on br-lan. See lib.js for the
 * environment variables.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	openPage, screenshot, main, expectNotification, readRawConfig, writeRawConfig
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const FIXTURES = { dhcp4: fixture("kea-dhcp4-rich.conf"), dhcp6: fixture("kea-dhcp6-rich.conf") };

/* What the import page must show for the fixture leases: [ section, protocol, status ]. */
const EXPECTED = [
	[ "dual", "DHCPv4", "Ready" ],
	[ "dual", "DHCPv6", "Ready" ],
	[ "printer", "DHCPv4", "Needs review" ],
	[ "known", "DHCPv4", "Already in Kea" ],
	[ "docked", "DHCPv4", "Cannot import" ],
	[ "elsewhere", "DHCPv4", "Cannot import" ],
	[ "off", "DHCPv4", "Needs review" ],
	[ "truncated", "DHCPv6", "Cannot import" ],
	[ "byname", "DHCPv4", "Cannot import" ]
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

function row(page, section, protocol) {
	return page.locator("#view table tbody tr", {
		has: page.locator("small", { hasText: new RegExp("^" + section + "$") })
	}).filter({ hasText: protocol });
}

async function openImport(page) {
	await openPage(page, "import-dnsmasq", "Import dnsmasq Static Leases");
	await page.locator("#view table tbody tr").first().waitFor();
}

async function statusOf(page, section, protocol) {
	const cells = row(page, section, protocol).locator("td");

	return (await cells.nth(6).innerText()).trim();
}

async function testImport(page) {
	const importButton = page.locator("#view button", { hasText: /^Import selected/ });

	await openImport(page);

	if (await row(page, "dual", "DHCPv4").count() === 0)
		throw new Error("the fixture static leases are missing: add test/fixtures/dhcp-static-leases.uci to /etc/config/dhcp of the target");

	for (const [ section, protocol, status ] of EXPECTED)
		assert.equal(await statusOf(page, section, protocol), status, section + " " + protocol);

	ok("every static lease of the fixture is classified as expected");

	assert.equal(await row(page, "dual", "DHCPv6").locator("td").nth(4).innerText(), "fd00:1::77");
	assert.match(await row(page, "docked", "DHCPv4").locator("td").nth(7).innerText(),
		/several MAC addresses share one address/);
	assert.equal(await row(page, "docked", "DHCPv4").locator('input[type="checkbox"]').isDisabled(), true);
	ok("the IPv6 token is resolved and blocked entries cannot be selected");

	const box = (section, protocol) => row(page, section, protocol).locator('input[type="checkbox"]');

	assert.equal(await box("dual", "DHCPv4").isChecked(), true);
	assert.equal(await box("dual", "DHCPv6").isChecked(), true);
	assert.equal(await box("printer", "DHCPv4").isChecked(), false);
	assert.equal(await box("off", "DHCPv4").isChecked(), false);
	ok("ready entries are selected, entries that need a review are not");

	/* The target may have static leases of its own. Leave them out. */
	for (const other of await page.locator('#view table tbody input[type="checkbox"]').all())
		if (await other.isChecked())
			await other.uncheck();

	for (const [ section, protocol ] of [ [ "dual", "DHCPv4" ], [ "dual", "DHCPv6" ], [ "off", "DHCPv4" ] ])
		await box(section, protocol).check();

	assert.equal((await importButton.innerText()).trim(), "Import selected (3)");
	await screenshot(page, "import-before");

	await importButton.click();
	await page.locator(".modal button", { hasText: /^Import$/ }).click();
	await expectNotification(page, "Imported: 3");
	ok("the two ready entries and one disabled lease were imported");

	/* The page reloads its list after the import; wait for the new state. */
	for (const [ section, protocol ] of [ [ "dual", "DHCPv4" ], [ "dual", "DHCPv6" ], [ "off", "DHCPv4" ] ])
		await row(page, section, protocol).filter({ hasText: "Already in Kea" })
			.waitFor({ timeout: 30000 });

	for (const [ section, protocol ] of [ [ "dual", "DHCPv4" ], [ "dual", "DHCPv6" ], [ "off", "DHCPv4" ] ])
		assert.equal(await box(section, protocol).isDisabled(), true, section + " " + protocol);

	await screenshot(page, "import-after");
	ok("a second look finds the imported leases in Kea; they cannot be imported again");

	const expected4 = parse(FIXTURES.dhcp4);
	const subnet4 = expected4.Dhcp4.subnet4[0];

	subnet4.reservations.push({ "hw-address": "02:00:00:00:00:aa", "ip-address": "192.168.1.77", hostname: "laptop" });
	subnet4["user-context"]["luci-app-kea"] = {
		"disabled-reservations": [
			{ "hw-address": "02:00:00:00:00:d1", "ip-address": "192.168.1.91", hostname: "spare" }
		]
	};
	assert.deepEqual(parse(await readRawConfig(page, "dhcp4")), expected4);

	const expected6 = parse(FIXTURES.dhcp6);

	expected6.Dhcp6.subnet6[0].reservations.push({
		duid: "00:03:00:01:02:00:00:00:0a:aa", "ip-addresses": [ "fd00:1::77" ], hostname: "laptop"
	});
	assert.deepEqual(parse(await readRawConfig(page, "dhcp6")), expected6);
	ok("both Kea files hold exactly the new reservations and nothing else changed");

	/* The disabled lease shows up in the DHCPv4 editor, switched off. */
	await openPage(page, "dhcp4", "Kea DHCPv4");
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();

	const rows = page.locator("#view table tbody tr");

	assert.equal(await rows.count(), 5);
	assert.equal(await rows.nth(4).locator("input").first().inputValue(), "spare");
	assert.equal(await rows.nth(4).locator('input[type="checkbox"]').isChecked(), false);
	ok("the disabled lease is shown switched off in the DHCPv4 editor");
}

main(async (page) => {
	const originals = {};

	for (const name of Object.keys(FIXTURES))
		originals[name] = await readRawConfig(page, name);

	try {
		for (const name of Object.keys(FIXTURES))
			await writeRawConfig(page, name, FIXTURES[name]);

		await testImport(page);
	}
	finally {
		for (const name of Object.keys(FIXTURES))
			if (await readRawConfig(page, name) !== originals[name])
				await writeRawConfig(page, name, originals[name]);
	}

	for (const name of Object.keys(FIXTURES))
		assert.equal(await readRawConfig(page, name), originals[name]);

	ok("the original configuration files are back in place");
	console.log("all import checks passed");
});
