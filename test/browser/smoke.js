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
 * Environment:
 *   BASE_URL       LuCI base URL            (default http://192.168.1.1)
 *   LUCI_USER      login name               (default root)
 *   LUCI_PASSWORD  password                 (default empty)
 *   OUT_DIR        screenshot directory     (default: no screenshots)
 */
"use strict";

const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL || "http://192.168.1.1").replace(/\/+$/, "");
const LUCI_USER = process.env.LUCI_USER || "root";
const LUCI_PASSWORD = process.env.LUCI_PASSWORD || "";
const OUT_DIR = process.env.OUT_DIR || "";

const PAGES = [
	{ route: "overview", heading: "Kea DHCP" },
	{ route: "services", heading: "Kea Services" },
	{ route: "dhcp4", heading: "Kea DHCPv4" },
	{ route: "dhcp6", heading: "Kea DHCPv6" },
	{ route: "configuration", heading: "Kea Configuration" },
	{ route: "import-dnsmasq", heading: "Import dnsmasq Static Leases" }
];

async function login(page) {
	await page.goto(BASE_URL + "/cgi-bin/luci/", { waitUntil: "domcontentloaded" });
	await page.fill('input[name="luci_username"]', LUCI_USER);
	await page.fill('input[name="luci_password"]', LUCI_PASSWORD);
	await Promise.all([
		page.waitForNavigation({ waitUntil: "domcontentloaded" }),
		page.press('input[name="luci_password"]', "Enter")
	]);

	if (await page.$('input[name="luci_password"]'))
		throw new Error("LuCI login failed");
}

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
		await page.goto(BASE_URL + "/cgi-bin/luci/admin/services/kea/" + entry.route,
			{ waitUntil: "domcontentloaded" });

		await page.waitForFunction((heading) => {
			const h2 = document.querySelector("#view h2");
			return h2 && h2.textContent.trim() === heading &&
				!document.querySelector("#view .spinning");
		}, entry.heading, { timeout: 30000 }).catch(() => {
			problems.push('heading "' + entry.heading + '" did not render');
		});

		const alerts = await page.$$eval(".alert-message.error, .alert-message.danger",
			(nodes) => nodes.map((node) => node.textContent.trim().slice(0, 200)));

		alerts.forEach((text) => problems.push("error notification: " + text));

		if (OUT_DIR)
			await page.screenshot({
				path: path.join(OUT_DIR, entry.route + ".png"),
				fullPage: true
			});
	}
	finally {
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
	}

	return problems;
}

(async () => {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: { width: 1280, height: 900 }
	});
	const page = await context.newPage();
	let failed = 0;

	try {
		await login(page);

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
	}
	finally {
		await browser.close();
	}

	if (failed) {
		console.log(failed + " page(s) failed");
		process.exit(1);
	}

	console.log("all pages rendered without errors");
})().catch((err) => {
	console.error("not ok - " + err.message);
	process.exit(1);
});
