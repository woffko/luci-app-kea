#!/usr/bin/env node
/*
 * Test of the Setup page: the DHCPv4 configuration made from what dnsmasq
 * serves, written over the example of the Kea package, and the note on
 * Overview while Kea is not set up.
 *
 * The target needs the example configuration of the Kea package, unchanged,
 * as on a fresh machine. The test writes the configuration and puts the
 * example back, byte for byte, through the Configuration page. Kea is not
 * started.
 */
"use strict";

const assert = require("node:assert/strict");

const {
	openPage, screenshot, main, expectNotification, readRawConfig, writeRawConfig
} = require("./lib.js");

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

main(async (page) => {
	const original = await readRawConfig(page, "dhcp4");

	try {
		await openPage(page, "overview", "Kea DHCP");

		const note = page.locator("#view .kea-not-set-up");

		if (await note.count() === 0) {
			console.log("skipped - the DHCPv4 file of the target is not the example of the package");
			return;
		}

		assert.match(await note.textContent(), /still the example the Kea package installed/);
		assert.equal(await note.locator("a").getAttribute("href"), "/cgi-bin/luci/admin/services/kea/setup");
		ok("Overview says that Kea is not set up, and leads to the Setup page");

		await openPage(page, "setup", "Kea Setup");

		const rows = await page.locator("#view table.kea-setup-subnets tr:not(.table-titles)").evaluateAll((nodes) =>
			nodes.map((row) => Array.from(row.querySelectorAll("td"), (cell) => cell.textContent.trim())));

		assert.deepEqual(rows[0], [ "lan", "br-lan", "192.168.1.0/24", "192.168.1.100 - 192.168.1.249" ]);
		assert.match(await page.locator("#view").textContent(), /Kea accepts this configuration/);
		assert.equal(await page.locator("#view button.kea-setup-leases").isDisabled(), true, "Kea does not run");
		await screenshot(page, "setup");
		ok("the Setup page shows the subnet dnsmasq serves, checked by Kea");

		await page.locator("#view button.kea-setup-write").click();
		await expectNotification(page, "The DHCPv4 configuration is written");

		const written = JSON.parse(await readRawConfig(page, "dhcp4"));

		assert.deepEqual(written.Dhcp4["interfaces-config"].interfaces, [ "br-lan/192.168.1.1" ]);
		assert.equal(written.Dhcp4.subnet4[0].subnet, "192.168.1.0/24");
		ok("Write puts the configuration in place of the example");

		await openPage(page, "setup", "Kea Setup");
		assert.match(await page.locator("#view .alert-message").first().textContent(), /has been changed/);
		assert.equal(await page.locator("#view button.kea-setup-write").count(), 0, "no plain Write for a changed file");

		/* Replacing a changed file needs a confirmation; Cancel changes nothing. */
		const changed = await readRawConfig(page, "dhcp4");

		await openPage(page, "setup", "Kea Setup");
		await page.locator("#view button.kea-setup-replace").click();
		await page.locator(".modal button", { hasText: /^Cancel$/ }).click();
		assert.equal(await readRawConfig(page, "dhcp4"), changed);

		await openPage(page, "setup", "Kea Setup");
		await page.locator("#view button.kea-setup-replace").click();
		await page.locator(".modal button", { hasText: /^Replace$/ }).click();
		await expectNotification(page, "The DHCPv4 configuration is written");
		ok("a changed file is replaced only after a confirmation");
	}
	finally {
		if (await readRawConfig(page, "dhcp4") !== original)
			await writeRawConfig(page, "dhcp4", original);
	}

	console.log("all setup checks passed");
});
