/*
 * Shared helpers for the browser tests.
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

/* Open a Kea page and wait until its heading is rendered. */
async function openPage(page, route, heading) {
	await page.goto(BASE_URL + "/cgi-bin/luci/admin/services/kea/" + route,
		{ waitUntil: "domcontentloaded" });

	await page.waitForFunction((expected) => {
		const h2 = document.querySelector("#view h2");

		return h2 && h2.textContent.trim() === expected &&
			!document.querySelector("#view .spinning");
	}, heading, { timeout: 30000 });
}

async function screenshot(page, name) {
	if (OUT_DIR)
		await page.screenshot({ path: path.join(OUT_DIR, name + ".png"), fullPage: true });
}

/* Start a browser, log in, run the test body, and always close the browser. */
async function withSession(body) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: { width: 1280, height: 900 }
	});
	const page = await context.newPage();

	try {
		await login(page);
		await body(page);
	}
	catch (err) {
		/* Keep what the page looked like when the test failed. */
		await screenshot(page, "failure").catch(() => {});
		throw err;
	}
	finally {
		await browser.close();
	}
}

function main(body) {
	withSession(body).catch((err) => {
		console.error("not ok - " + err.message);
		process.exit(1);
	});
}

module.exports = { BASE_URL, openPage, screenshot, main };
