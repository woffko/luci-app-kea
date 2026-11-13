#!/usr/bin/env node
/*
 * Take the screenshots shown in the documentation.
 *
 * The pages are captured with the two Kea fixtures loaded, so the pictures
 * show a realistic configuration and no data of the target. The original
 * configuration files are put back at the end.
 *
 * Preconditions, as for import.js: a test target whose LAN is
 * 192.168.1.1/24 on br-lan, with the static leases of
 * test/fixtures/dhcp-static-leases.uci in its /etc/config/dhcp.
 *
 * The pictures are written to docs/images/ unless OUT_DIR says otherwise.
 * See lib.js for the other environment variables.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

process.env.OUT_DIR = process.env.OUT_DIR || path.join(__dirname, "..", "..", "docs", "images");

const {
	openPage, screenshot, waitForModal, main, readRawConfig, writeRawConfig,
	fieldRow, fieldInput, addRow, openTab
} = require("./lib.js");

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const FIXTURES = { dhcp4: fixture("kea-dhcp4-rich.conf"), dhcp6: fixture("kea-dhcp6-rich.conf") };

/*
 * A fresh test machine has no root password, and LuCI says so on every
 * page. The banner has nothing to do with this application; leave it out.
 */
async function capture(page, name, viewport) {
	await page.evaluate(() => {
		document.querySelectorAll(".alert-message").forEach((node) => {
			if (/No password set/.test(node.textContent))
				node.remove();
		});
		document.scrollingElement.scrollTop = 0;
	});

	await screenshot(page, name, viewport);
	console.log("wrote " + name + ".png");
}

main(async (page) => {
	const originals = {};

	fs.mkdirSync(process.env.OUT_DIR, { recursive: true });

	for (const name of Object.keys(FIXTURES))
		originals[name] = await readRawConfig(page, name);

	try {
		for (const name of Object.keys(FIXTURES))
			await writeRawConfig(page, name, FIXTURES[name]);

		await openPage(page, "overview", "Kea DHCP");
		await capture(page, "overview");

		await openPage(page, "services", "Kea Services");
		await capture(page, "services");

		/* Show one reservation switched off; nothing is saved. */
		await openPage(page, "dhcp4", "Kea DHCPv4");
		await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
		await page.locator("#view table.kea-reservations tbody tr").nth(1).locator('input[type="checkbox"]').uncheck();
		await capture(page, "dhcp4");

		/* The view of what a save would change; nothing is saved. */
		await page.locator("#view .cbi-value", {
			has: page.locator("label.cbi-value-title", { hasText: /^Gateway$/ })
		}).locator("input").fill("192.168.1.254");
		await page.locator("#view button", { hasText: /^Show changes$/ }).click();
		await waitForModal(page);
		await capture(page, "changes", true);
		await page.locator(".modal button", { hasText: /^Close$/ }).click();

		await openTab(page, "Global settings");
		await capture(page, "global");

		/* A hot standby pair, typed in but not saved. Needs kea-hook-ha. */
		if (await page.locator("#view .cbi-tabmenu a", { hasText: "High availability" }).count()) {
			await openTab(page, "High availability");
			await fieldInput(page, "Enable").check();
			await fieldRow(page, "Mode").locator("select").waitFor();
			await fieldInput(page, "This server").fill("router1");
			await addRow(page, "kea-ha-peers", "Add Peer", [ "router1", "http://192.168.1.1:8000/" ]);
			await addRow(page, "kea-ha-peers", "Add Peer", [ "router2", "http://192.168.1.2:8000/" ]);
			await page.locator("#view h3", { hasText: "High availability" }).click();
			await capture(page, "ha");
		}
		else {
			console.log("skipped ha.png: kea-hook-ha is not installed on the target");
		}

		await openPage(page, "dhcp6", "Kea DHCPv6");
		await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
		await capture(page, "dhcp6");

		await openPage(page, "leases", "Kea Leases");

		if (await page.locator("#view td", { hasText: /^nas$/ }).count() === 0)
			throw new Error("the lease fixture is missing: run test/make-lease-fixture.sh on the target");

		await capture(page, "leases");

		await openPage(page, "configuration", "Kea Configuration");
		await page.locator("#view textarea").waitFor();
		await capture(page, "configuration");

		await openPage(page, "import-dnsmasq", "Import dnsmasq Static Leases");
		await page.locator("#view table tbody tr").first().waitFor();

		if (await page.locator("#view small", { hasText: /^dual$/ }).count() === 0)
			throw new Error("the fixture static leases are missing: add test/fixtures/dhcp-static-leases.uci to /etc/config/dhcp of the target");

		await capture(page, "import");
	}
	finally {
		for (const name of Object.keys(FIXTURES))
			if (await readRawConfig(page, name) !== originals[name])
				await writeRawConfig(page, name, originals[name]);
	}

	console.log("all screenshots written to " + process.env.OUT_DIR);
});
