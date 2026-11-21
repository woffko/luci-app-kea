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

/* A picture of the whole page, or of the visible part only ("viewport"). */
async function screenshot(page, name, viewport) {
	if (OUT_DIR)
		await page.screenshot({ path: path.join(OUT_DIR, name + ".png"), fullPage: !viewport });
}

/* Wait until a LuCI dialog is open and has finished fading in. */
async function waitForModal(page) {
	await page.waitForFunction(() => {
		const overlay = document.querySelector("#modal_overlay");

		return overlay && document.body.classList.contains("modal-overlay-active") &&
			document.defaultView.getComputedStyle(overlay).opacity === "1";
	}, null, { timeout: 30000 });
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

/* ---- acting on services without acting on them ---- */

/* Calls that start, stop or reload a service on the target. */
const SERVICE_ACTIONS = [ "setInitAction", "setConflictAction" ];

function keaMethod(call) {
	return call && Array.isArray(call.params) && call.params[1] === "luci.kea" ? call.params[2] : null;
}

/*
 * The name a call goes by in state.replies: the method for a call to the
 * backend of this application, "object.method" for one to another object.
 */
function replyKey(call) {
	if (!call || !Array.isArray(call.params) || typeof call.params[1] !== "string")
		return null;

	return call.params[1] === "luci.kea" ? call.params[2] : call.params[1] + "." + call.params[2];
}

/*
 * Keep the page from acting on the services of the target: the calls that
 * would do so are answered here, as failed, and noted in state.blocked.
 * While state.running is set, the page is also told that kea-dhcp4 is
 * running, so that what it does with a running daemon can be seen without
 * one.
 *
 * state.replies may hold answers for read calls that the target cannot
 * give, by method: { getDaemonState: {...} }. Each is the whole reply of
 * the method. A call to another ubus object goes by "object.method":
 * { "ha-cluster.nodes": {...} } stands in for a package that is not
 * installed.
 *
 * state.actions may hold what a call that acts on a service is answered
 * with instead of a failure, by method: { setInitAction: {...} }. The
 * call still does not reach the target.
 */
async function interceptServiceCalls(page, state) {
	await page.route(/\/ubus\/?(\?.*)?$/, async (route) => {
		let sent = null;

		try {
			sent = JSON.parse(route.request().postData() || "null");
		}
		catch {
			/* not a call of the kind looked at here */
		}

		const calls = Array.isArray(sent) ? sent : sent ? [ sent ] : [];
		const reply = (list) => JSON.stringify(Array.isArray(sent) ? list : list[0]);

		if (calls.some((call) => SERVICE_ACTIONS.includes(keaMethod(call)))) {
			calls.forEach((call) => state.blocked.push(keaMethod(call)));

			const actions = state.actions || {};
			const answer = (call) => Object.prototype.hasOwnProperty.call(actions, keaMethod(call)) ?
				actions[keaMethod(call)] : { result: false };

			return route.fulfill({
				contentType: "application/json",
				body: reply(calls.map((call) => ({ jsonrpc: "2.0", id: call.id, result: [ 0, answer(call) ] })))
			});
		}

		const replies = state.replies || {};
		const patched = (call) => (state.running && keaMethod(call) === "getServices") ||
			Object.prototype.hasOwnProperty.call(replies, replyKey(call));

		if (calls.some(patched)) {
			const response = await route.fetch();
			const body = await response.json();
			const answers = Array.isArray(body) ? body : [ body ];

			calls.filter(patched).forEach((call) => {
				const answer = answers.find((candidate) => candidate && candidate.id === call.id);
				const method = replyKey(call);

				if (!answer)
					return;

				if (Object.prototype.hasOwnProperty.call(replies, method)) {
					delete answer.error;
					answer.result = [ 0, replies[method] ];
				}
				else if (answer.result && answer.result[1] && answer.result[1].services &&
				         answer.result[1].services.dhcp4) {
					answer.result[1].services.dhcp4.running = true;
				}
			});

			return route.fulfill({ response, body: reply(answers) });
		}

		return route.continue();
	});
}

/* ---- helpers for the structured editors ---- */

/* The form row with the given label. */
function fieldRow(page, label) {
	return page.locator("#view .cbi-value", {
		has: page.locator("label.cbi-value-title", { hasText: new RegExp("^" + label + "$") })
	});
}

function fieldInput(page, label) {
	return fieldRow(page, label).locator("input").first();
}

/* The rows of one of the editor tables, without the "nothing here" row. */
function tableRows(page, name) {
	return page.locator("#view table." + name + " tbody tr", { has: page.locator("input") });
}

/* The text inputs of the rows of a table, as a list of lists. */
async function tableValues(page, name) {
	return tableRows(page, name).evaluateAll((rows) => rows.map((row) =>
		Array.from(row.querySelectorAll('input:not([type="checkbox"])'), (input) => input.value)));
}

/* Add a row to a table and fill its text inputs. */
async function addRow(page, name, button, values) {
	await page.locator("#view button", { hasText: new RegExp("^" + button + "$") }).click();

	const inputs = tableRows(page, name).last().locator('input:not([type="checkbox"])');

	for (let i = 0; i < values.length; i++)
		await inputs.nth(i).fill(values[i]);

	return inputs;
}

async function openTab(page, label) {
	await page.locator("#view .cbi-tabmenu a", { hasText: label }).first().click();
	await page.locator("#view h3", { hasText: label }).first().waitFor();
}

module.exports = {
	BASE_URL, CONFIG_FILES, openPage, screenshot, waitForModal, main,
	footerButton, expectNotification, openRawEditor, readRawConfig, writeRawConfig,
	interceptServiceCalls,
	fieldRow, fieldInput, tableRows, tableValues, addRow, openTab
};
