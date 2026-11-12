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

/* ---- helpers for tests that change configuration files ---- */

/* The Kea config files as the Configuration page names them. */
const CONFIG_FILES = {
	dhcp4: "kea-dhcp4.conf",
	dhcp6: "kea-dhcp6.conf",
	dhcp_ddns: "kea-dhcp-ddns.conf",
	ctrl_agent: "kea-ctrl-agent.conf"
};

/* LuCI renders "Save & Apply" as a dropdown and the others as buttons. */
function footerButton(page, label) {
	if (label === "Save & Apply")
		return page.locator(".cbi-page-actions .cbi-dropdown li[selected]");

	return page.locator(".cbi-page-actions button", { hasText: new RegExp("^" + label + "$") });
}

/* Wait for a LuCI notification containing the text, then dismiss them all. */
async function expectNotification(page, text) {
	await page.locator(".alert-message", { hasText: text }).first()
		.waitFor({ timeout: 30000 });

	await page.evaluate(() => {
		document.querySelectorAll("#maincontent > .alert-message, #view ~ .alert-message")
			.forEach((node) => node.remove());
	});
}

async function openRawEditor(page, name) {
	const selector = page.locator("#view select").first();

	await openPage(page, "configuration", "Kea Configuration");

	/* Selecting the file that is already shown would make the page load it
	 * again and replace the editor under the test's hands. */
	if (await selector.inputValue() !== name)
		await selector.selectOption(name);

	await page.locator("#view h3", { hasText: CONFIG_FILES[name] }).waitFor();
}

/* Read a config file through the Configuration page. */
async function readRawConfig(page, name) {
	await openRawEditor(page, name);

	return page.locator("#view textarea").inputValue();
}

/* Replace a config file through the Configuration page. */
async function writeRawConfig(page, name, content) {
	await openRawEditor(page, name);
	await page.locator("#view textarea").fill(content);
	await footerButton(page, "Save").click();
	await expectNotification(page, "configuration saved");
}

module.exports = {
	BASE_URL, CONFIG_FILES, openPage, screenshot, main,
	footerButton, expectNotification, openRawEditor, readRawConfig, writeRawConfig
};
