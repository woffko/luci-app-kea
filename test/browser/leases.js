#!/usr/bin/env node
/*
 * Test of the Leases page and of the runtime part of the Overview page.
 *
 * The target needs the lease files written by test/make-lease-fixture.sh:
 * the test has only LuCI access and cannot create them. The fixture holds
 * leases in use next to leases that ran out, were given back or were
 * replaced by a later row; the page must show the first kind only.
 *
 * The test changes nothing on the target. See lib.js for the environment
 * variables.
 */
"use strict";

const assert = require("node:assert/strict");

const { openPage, screenshot, main } = require("./lib.js");

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

/* The rows of a table as lists of cell texts. */
async function rows(page, selector) {
	return page.locator(selector + " tbody tr").evaluateAll((nodes) => nodes.map((row) =>
		Array.from(row.querySelectorAll("td"), (cell) => cell.textContent.trim())));
}

main(async (page) => {
	await openPage(page, "leases", "Kea Leases");

	if (await page.locator("#view td", { hasText: /^nas$/ }).count() === 0)
		throw new Error("the lease fixture is missing: run test/make-lease-fixture.sh on the target");

	const v4 = await rows(page, "#view table.kea-leases-dhcp4");

	assert.deepEqual(v4.map((row) => row.slice(0, 5).concat(row[6])), [
		[ "192.168.1.100", "02:00:00:00:00:01", "nas", "01:02:00:00:00:00:01", "3", "Active" ],
		[ "192.168.1.101", "02:00:00:00:00:aa", "laptop", "-", "3", "Active" ],
		[ "192.168.1.120", "-", "-", "-", "3", "Declined" ],
		[ "10.20.0.15", "02:00:00:00:00:15", "printer", "-", "7", "Active" ]
	]);
	assert.match(await page.locator("#view h3", { hasText: "DHCPv4" }).innerText(), /^DHCPv4 \(4\)$/);
	ok("DHCPv4: the leases in use are listed by subnet and address, the last row of a lease counts");

	/* 3000 seconds are left of the first lease, a day of the declined address. */
	assert.match(v4[0][5], /^4\dm \d+s$/);
	assert.match(v4[2][5], /^22h \d+m$/);
	ok("DHCPv4: the remaining time is counted from the clock of the router");

	const v6 = await rows(page, "#view table.kea-leases-dhcp6");

	assert.deepEqual(v6.map((row) => row.slice(0, 7).concat(row[8])), [
		[ "fd00:1::100", "Address", "00:03:00:01:02:00:00:00:00:01", "1", "02:00:00:00:00:01", "nas", "2", "Active" ],
		[ "fd00:1:0:400::/60", "Delegated prefix", "00:03:00:01:02:00:00:00:00:01", "2", "02:00:00:00:00:01", "nas", "2", "Active" ]
	]);
	assert.match(await page.locator("#view h3", { hasText: "DHCPv6" }).innerText(), /^DHCPv6 \(2\)$/);
	ok("DHCPv6: an address and a delegated prefix are listed, a released address is not");

	await screenshot(page, "leases");

	await openPage(page, "overview", "Kea DHCP");

	const version = page.locator("#view tr", { has: page.locator("td", { hasText: /^Kea version$/ }) }).locator("td").nth(1);

	assert.match(await version.innerText(), /^\d+\.\d+\.\d+/);
	await page.locator("#view h3", { hasText: "Recent Log Messages" }).waitFor();
	await page.locator("#view button", { hasText: /^Refresh$/ }).click();
	await page.locator("#view h3", { hasText: "Recent Log Messages" }).waitFor();
	ok("Overview: the Kea version is shown and the log can be refreshed");

	console.log("all lease checks passed");
});
