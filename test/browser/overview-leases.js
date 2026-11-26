#!/usr/bin/env node
/*
 * Test of the lease tables on the status overview of LuCI and on the
 * Overview page of the application, and of the button that reserves the
 * address of a lease in Kea.
 *
 * The target needs the lease files written by test/make-lease-fixture.sh.
 * The test writes the DHCPv4 and DHCPv6 fixtures of this repository as the
 * Kea configuration, so that the leases fall into Kea subnets, makes one
 * reservation, and puts the original files back. It starts nothing: the
 * calls that would reload Kea are answered by the test.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	BASE_URL, openPage, screenshot, waitForModal, main, expectNotification,
	readRawConfig, writeRawConfig, interceptServiceCalls
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
const FIXTURES = { dhcp4: fixture("kea-dhcp4-rich.conf"), dhcp6: fixture("kea-dhcp6-rich.conf") };

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

/* The rows of a lease table: cell texts, and whether its button can be used. */
async function rows(page, scope, family) {
	return page.locator(scope + " table.kea-active-leases-" + family + " tr:not(.table-titles)").evaluateAll((nodes) =>
		nodes.map((row) => {
			const cells = Array.from(row.querySelectorAll("td"), (cell) => cell.textContent.trim());
			const button = row.querySelector("button.kea-reserve");

			return cells.slice(0, -1).concat(button ? (button.disabled ? "reserved" : "can reserve") : "-");
		}));
}

/* Drop the remaining time, which runs. */
function withoutTime(list, column) {
	return list.map((row) => row.slice(0, column).concat(row.slice(column + 1)));
}

/*
 * Open the status overview of LuCI. An image with luci-app-attendedsysupgrade
 * asks there, in a dialog, whether to look for upgrades online, until that
 * is answered. The dialog is closed without an answer: the test changes no
 * setting of the target.
 */
async function openStatus(page) {
	await page.goto(BASE_URL + "/cgi-bin/luci/admin/status/overview", { waitUntil: "domcontentloaded" });
	await page.locator("table.kea-active-leases-dhcp4 tr:not(.table-titles)").first().waitFor({ timeout: 30000 });
	await page.waitForTimeout(1500);

	if (await page.evaluate(() => document.body.classList.contains("modal-overlay-active"))) {
		assert.match(await page.locator("#modal_overlay .modal").textContent(), /firmware upgrades/,
			"the only dialog expected on this page");
		await page.evaluate(() => L.ui.hideModal());
	}
}

main(async (page) => {
	const state = { blocked: [], running: false };
	const original = { dhcp4: await readRawConfig(page, "dhcp4"), dhcp6: await readRawConfig(page, "dhcp6") };

	await interceptServiceCalls(page, state);

	try {
		await writeRawConfig(page, "dhcp4", FIXTURES.dhcp4);
		await writeRawConfig(page, "dhcp6", FIXTURES.dhcp6);

		/* ---- the status overview of LuCI ---- */

		await openStatus(page);

		const section = page.locator(".cbi-section", { has: page.locator("h3", { hasText: /^Kea DHCP Leases/ }) });

		await section.waitFor();

		const v4 = await rows(page, "", "dhcp4");

		assert.deepEqual(withoutTime(v4, 4), [
			[ "br-lan", "nas", "192.168.1.100", "02:00:00:00:00:01", "reserved" ],
			[ "br-lan", "laptop", "192.168.1.101", "02:00:00:00:00:aa", "can reserve" ],
			[ "-", "<i>printer</i>", "10.20.0.15", "02:00:00:00:00:15", "can reserve" ]
		]);
		assert.match(v4[0][4], /^0h 4\dm \d+s$/, "the remaining time of the first lease, as LuCI writes it");
		ok("status overview: the DHCPv4 leases in use, without the declined address; a client Kea reserves cannot be reserved again");

		assert.deepEqual(withoutTime(await rows(page, "", "dhcp6"), 5), [
			[ "br-lan", "nas", "fd00:1::100", "00:03:00:01:02:00:00:00:00:01", "1", "reserved" ],
			[ "br-lan", "nas", "fd00:1:0:400::/60", "00:03:00:01:02:00:00:00:00:01", "2", "reserved" ]
		]);
		ok("status overview: the DHCPv6 address and delegated prefix");
		await screenshot(page, "status-leases");

		/* ---- reserving an address ---- */

		await page.locator("table.kea-active-leases-dhcp4 tr", { hasText: "laptop" }).locator("button.kea-reserve").click();
		await waitForModal(page);
		assert.match(await page.locator(".modal").textContent(), /Kea is to give 192\.168\.1\.101 to 02:00:00:00:00:aa every time/);
		assert.equal(await page.locator(".modal input.kea-reserve-name").inputValue(), "laptop");
		await page.locator(".modal input.kea-reserve-name").fill("laptop-office");
		await screenshot(page, "status-reserve", true);
		await page.locator(".modal button", { hasText: /^Reserve$/ }).click();
		await expectNotification(page, "The service is not running");

		const saved = model.parseConfig(await readRawConfig(page, "dhcp4")).config;

		assert.deepEqual(saved.Dhcp4.subnet4[0].reservations.pop(),
			{ "hw-address": "02:00:00:00:00:aa", "ip-address": "192.168.1.101", hostname: "laptop-office" });
		assert.deepEqual(state.blocked, [], "Kea does not run, so nothing was reloaded");
		ok("Reserve IP writes the reservation into the Kea configuration, with the name typed in");

		/* Reading the file opened the Configuration page. */
		await openStatus(page);
		await page.waitForFunction(() => {
			const row = Array.from(document.querySelectorAll("table.kea-active-leases-dhcp4 tr"))
				.find((node) => node.textContent.includes("192.168.1.101"));

			return row && row.querySelector("button.kea-reserve").disabled;
		}, null, { timeout: 30000 });
		ok("the status overview then shows the lease as reserved");

		/* A lease that falls outside every subnet is refused with the reason. */
		await writeRawConfig(page, "dhcp4", FIXTURES.dhcp4.replace(/"10\.20\.0\.0\/24"/, "\"10.30.0.0/24\"")
			.replace(/10\.20\.0\.10 - 10\.20\.0\.50/, "10.30.0.10 - 10.30.0.50"));
		await openStatus(page);

		/* Its name is markup, which Kea would hand to the clients and to DNS as it is. */
		await page.locator("table.kea-active-leases-dhcp4 tr", { hasText: "printer" }).locator("button.kea-reserve").click();
		await waitForModal(page);
		assert.equal(await page.locator(".modal input.kea-reserve-name").inputValue(), "<i>printer</i>");
		await page.locator(".modal button", { hasText: /^Reserve$/ }).click();
		await expectNotification(page, "the address was not reserved: the hostname is not a valid host name");
		ok("a lease whose name is not a host name is not reserved with it");

		await page.locator("table.kea-active-leases-dhcp4 tr", { hasText: "printer" }).locator("button.kea-reserve").click();
		await waitForModal(page);
		await page.locator(".modal input.kea-reserve-name").fill("printer");
		await page.locator(".modal button", { hasText: /^Reserve$/ }).click();
		await expectNotification(page, "the address was not reserved: the address is outside every Kea DHCPv4 subnet");
		ok("a lease Kea cannot reserve is refused with the reason, and nothing is written");

		/* ---- the Overview page of the application ---- */

		await writeRawConfig(page, "dhcp4", FIXTURES.dhcp4);
		await openPage(page, "overview", "Kea DHCP");

		const block = page.locator("#view .kea-overview-leases");

		await block.locator("table.kea-active-leases-dhcp4").waitFor();
		assert.match(await block.locator(".cbi-section-descr").innerText(), /^In use: 3 DHCPv4 and 2 DHCPv6 leases\. All leases$/);
		assert.equal(await block.locator("a", { hasText: "All leases" }).getAttribute("href"), "/cgi-bin/luci/admin/services/kea/leases");
		assert.equal((await rows(page, "#view .kea-overview-leases", "dhcp4")).length, 3);
		await screenshot(page, "overview-leases");
		ok("Overview: the number of leases, their tables and a link to the Leases page");
	}
	finally {
		await writeRawConfig(page, "dhcp4", original.dhcp4);
		await writeRawConfig(page, "dhcp6", original.dhcp6);
	}

	console.log("all overview lease checks passed");
});
