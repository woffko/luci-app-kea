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

const { openPage, screenshot, main, readRawConfig, writeRawConfig } = require("./lib.js");

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const FIXTURES = { dhcp4: fixture("kea-dhcp4-rich.conf"), dhcp6: fixture("kea-dhcp6-rich.conf") };

/*
 * A fresh test machine has no root password, and LuCI says so on every
 * page. The banner has nothing to do with this application; leave it out.
 */
async function capture(page, name) {
	await page.evaluate(() => {
		document.querySelectorAll(".alert-message").forEach((node) => {
			if (/No password set/.test(node.textContent))
				node.remove();
		});
		document.scrollingElement.scrollTop = 0;
	});

	await screenshot(page, name);
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
		await page.locator("#view table tbody tr").nth(1).locator('input[type="checkbox"]').uncheck();
		await capture(page, "dhcp4");

		await openPage(page, "dhcp6", "Kea DHCPv6");
		await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
		await capture(page, "dhcp6");

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
