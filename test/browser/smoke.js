#!/usr/bin/env node
/*
 * Browser smoke test: log in to LuCI and open every Kea page.
 *
 * A page fails when it raises a JavaScript error, logs a console error,
 * shows a LuCI error notification, or does not render its heading.
 *
 * Requires the "playwright" package and a Chromium build:
 *   npm install playwright && npx playwright install chromium-headless-shell
 *
 * See lib.js for the environment variables.
 */
"use strict";

const { openPage, screenshot, main } = require("./lib.js");

const PAGES = [
	{ route: "overview", heading: "Kea DHCP" },
	{ route: "services", heading: "Kea Services" },
	{ route: "dhcp4", heading: "Kea DHCPv4" },
	{ route: "dhcp6", heading: "Kea DHCPv6" },
	{ route: "leases", heading: "Kea Leases" },
	{ route: "configuration", heading: "Kea Configuration" },
	{ route: "import-dnsmasq", heading: "Import dnsmasq Static Leases" }
];

async function checkPage(page, entry) {
	const problems = [];
	const onPageError = (err) => problems.push("page error: " + err.message);
	const onConsole = (msg) => {
		if (msg.type() === "error")
			problems.push("console error: " + msg.text());
	};

	page.on("pageerror", onPageError);
	page.on("console", onConsole);

	try {
		await openPage(page, entry.route, entry.heading).catch(() => {
			problems.push('heading "' + entry.heading + '" did not render');
		});

		const alerts = await page.$$eval(".alert-message.error, .alert-message.danger",
			(nodes) => nodes.map((node) => node.textContent.trim().slice(0, 200)));

		alerts.forEach((text) => problems.push("error notification: " + text));

		await screenshot(page, entry.route);
	}
	finally {
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
	}

	return problems;
}

main(async (page) => {
	let failed = 0;

	for (const entry of PAGES) {
		const problems = await checkPage(page, entry);

		if (problems.length) {
			failed++;
			console.log("not ok - " + entry.route);
			problems.forEach((problem) => console.log("  " + problem));
		}
		else {
			console.log("ok - " + entry.route);
		}
	}

	if (failed)
		throw new Error(failed + " page(s) failed");

	console.log("all pages rendered without errors");
});
