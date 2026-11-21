#!/usr/bin/env node
/*
 * End-to-end test of what the pages say beyond the check of the Kea binary.
 *
 * - Overview names a log file that a daemon writes, which the list of
 *   messages cannot show; the Log Output field of the Global settings tab
 *   moves the loggers to syslog and changes nothing else.
 * - A configuration that Kea accepts and will not start with is saved, and
 *   the Configuration page, the DHCPv4 page and Overview say so. That the
 *   save succeeds also shows that the Kea binary of the target accepts the
 *   file.
 * - Save & Apply asks before it reloads a running daemon with such a file.
 * - A file that listens on an interface without retries for the sockets is
 *   warned about, and the two fields of the Global settings tab end that.
 * - Overview and Services say when a running daemon could not open a
 *   socket, and show the state of high availability.
 * - The Services page shows what dnsmasq serves and asks before stopping it.
 *
 * No daemon is started, stopped or reloaded: the test answers the calls
 * that would do so itself, and where a running daemon is needed it tells
 * the page that kea-dhcp4 is running and what that daemon says about
 * itself. It rewrites /etc/kea/kea-dhcp4.conf while it
 * runs and puts the original back. See lib.js for the environment
 * variables.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	openPage, screenshot, waitForModal, main, footerButton, expectNotification,
	openRawEditor, readRawConfig, writeRawConfig, interceptServiceCalls, fieldRow, fieldInput, openTab
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

const FIXTURE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "kea-dhcp4-rich.conf"), "utf8");
const LEASE_FILE = "/tmp/kea-leases4.csv";

let step = 0;

function ok(message) {
	console.log("ok " + (++step) + " - " + message);
}

function parse(content) {
	const parsed = model.parseConfig(content);

	assert.equal(parsed.error, null);

	return parsed.config;
}

/* The fixture with one thing changed. */
function variant(edit) {
	const config = parse(FIXTURE);

	edit(config.Dhcp4);

	return model.serialize(config);
}

/* As in the files shipped with Kea: the logger writes to a file. */
const FILE_LOGGER = variant((root) => {
	root.loggers[0]["output-options"][0].output = "kea-dhcp4.log";
});

/* A file that listens on an interface and does not retry: what the form wrote before 0.9.0. */
const NO_RETRIES = variant((root) => {
	delete root["interfaces-config"]["service-sockets-max-retries"];
	delete root["interfaces-config"]["service-sockets-retry-wait-time"];
});

/* Kea 3 accepts this in its check and refuses to start with it. */
const LEASES_IN_TMP = variant((root) => {
	root["lease-database"].name = LEASE_FILE;
});

function startWarnings(page) {
	return page.locator("#view .kea-start-warnings", { hasText: LEASE_FILE });
}

async function openGlobal(page) {
	await openPage(page, "dhcp4", "Kea DHCPv4");
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
	await openTab(page, "Global settings");
}

main(async (page) => {
	const state = { blocked: [], running: false };
	const original = await readRawConfig(page, "dhcp4");

	await interceptServiceCalls(page, state);

	try {
		/* ---- a log file, and the field that moves the loggers to syslog ---- */

		await writeRawConfig(page, "dhcp4", FILE_LOGGER);
		await openPage(page, "overview", "Kea DHCP");

		const fileNote = page.locator("#view .kea-log-outputs li",
			{ hasText: "kea-dhcp4 writes its log to the file /var/log/kea/kea-dhcp4.log" });

		await fileNote.waitFor();
		await screenshot(page, "warnings-log-file");
		ok("Overview names the log file that kea-dhcp4 writes");

		await openGlobal(page);

		const output = fieldRow(page, "Log Output").locator("select");

		assert.equal(await output.inputValue(), "kea-dhcp4.log");
		assert.equal(await output.locator("option:checked").textContent(), "File: kea-dhcp4.log");
		await output.selectOption("syslog");
		await footerButton(page, "Save").click();
		await expectNotification(page, "configuration saved");
		assert.ok(model.deepEqual(parse(await readRawConfig(page, "dhcp4")), parse(FIXTURE)),
			"only the output of the logger changed");
		ok("the Log Output field moves the logger to syslog and changes nothing else");

		await openPage(page, "overview", "Kea DHCP");
		await page.locator("#view h3", { hasText: "Recent Log Messages" }).waitFor();
		assert.equal(await page.locator("#view .kea-log-outputs li", { hasText: "kea-dhcp4 writes" }).count(), 0);
		ok("Overview no longer lists a log file for kea-dhcp4");

		/* ---- a file Kea accepts and will not start with ---- */

		await openRawEditor(page, "dhcp4");
		await page.locator("#view textarea").fill(LEASES_IN_TMP);
		await footerButton(page, "Save").click();
		await expectNotification(page, "does not start with it");
		assert.ok(model.deepEqual(parse(await readRawConfig(page, "dhcp4")), parse(LEASES_IN_TMP)));
		ok("the file is saved, with a warning: Kea accepts a lease file outside /var/lib/kea in its check");

		await startWarnings(page).waitFor();
		assert.match(await startWarnings(page).textContent(), /is not in \/var\/lib\/kea/);
		await screenshot(page, "warnings-configuration");
		ok("the Configuration page shows the warning with the validation result");

		await openPage(page, "dhcp4", "Kea DHCPv4");
		await startWarnings(page).waitFor();
		await screenshot(page, "warnings-dhcp4");
		ok("the DHCPv4 page shows it above the tabs");

		await openPage(page, "overview", "Kea DHCP");
		await startWarnings(page).waitFor();
		await screenshot(page, "warnings-overview");
		ok("Overview shows it next to the result of the check");

		/* ---- Save & Apply asks before it reloads a running daemon ---- */

		state.running = true;

		await openGlobal(page);
		await fieldInput(page, "Renew Timer").fill("601");
		await footerButton(page, "Save & Apply").click();
		await waitForModal(page);
		assert.match(await page.locator(".modal").textContent(), /kea-dhcp4 is running, and it is expected to stop/);
		assert.ok((await page.locator(".modal").textContent()).includes(LEASE_FILE));
		await screenshot(page, "warnings-reload", true);
		await page.locator(".modal button", { hasText: /^Cancel$/ }).click();
		await expectNotification(page, "configuration saved, not applied");
		assert.deepEqual(state.blocked, [], "nothing was reloaded");
		assert.equal(parse(await readRawConfig(page, "dhcp4")).Dhcp4["renew-timer"], 601);
		ok("Save & Apply saves, asks before the reload, and does not reload when the answer is no");

		await openGlobal(page);
		await fieldInput(page, "Renew Timer").fill("602");
		await footerButton(page, "Save & Apply").click();
		await waitForModal(page);
		await page.locator(".modal button", { hasText: /^Reload anyway$/ }).click();
		await expectNotification(page, "the reload failed");
		assert.deepEqual(state.blocked, [ "setInitAction" ], "the reload was asked for once");
		ok("with the answer yes it goes on to the reload");

		state.running = false;
		state.blocked = [];

		/* ---- sockets at boot ---- */

		await writeRawConfig(page, "dhcp4", NO_RETRIES);
		await openPage(page, "dhcp4", "Kea DHCPv4");

		const listenWarning = page.locator("#view .kea-listen-warnings");

		await listenWarning.waitFor();
		assert.match(await listenWarning.textContent(), /Kea is to listen on br-lan/);
		ok("a file that listens on an interface without retries for the sockets is warned about");

		await openTab(page, "Global settings");
		await fieldInput(page, "Socket Retries").fill("60");
		await fieldInput(page, "Socket Retry Wait").fill("2000");
		await screenshot(page, "warnings-socket-retries");
		await footerButton(page, "Save").click();
		await expectNotification(page, "configuration saved");

		assert.ok(model.deepEqual(parse(await readRawConfig(page, "dhcp4")), parse(FIXTURE)),
			"only the two parameters were added");
		await openPage(page, "dhcp4", "Kea DHCPv4");
		await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
		assert.equal(await listenWarning.count(), 0);
		ok("the two fields of the Global settings tab set the retries, and the warning is gone");

		/* ---- what a running daemon says ---- */

		state.running = true;
		state.replies = { getDaemonState: { daemons: { dhcp4: {
			reachable: true, uptime: 30, serving: true,
			sockets: { status: "failed", errors: [ "the interface br-lan is not running" ] },
			ha: []
		} } } };

		await openPage(page, "overview", "Kea DHCP");

		const deaf = page.locator("#view .kea-not-listening");

		await deaf.waitFor();
		assert.match(await deaf.textContent(), /kea-dhcp4: the interface br-lan is not running/);
		assert.equal(await page.locator("#view .kea-daemon-bad").count(), 1);
		await screenshot(page, "warnings-not-listening");
		ok("Overview names a running daemon that could not open a socket, with Kea's reason");

		await openPage(page, "services", "Kea Services");

		const dhcp4Row = page.locator("#view tr", { has: page.locator("small", { hasText: /^kea-dhcp4$/ }) });

		await dhcp4Row.waitFor();
		assert.match(await dhcp4Row.textContent(), /Running.*Socket error.*the interface br-lan is not running/);
		ok("the Services page shows it next to Running");

		state.replies = { getDaemonState: { daemons: { dhcp4: {
			reachable: true, uptime: 30, serving: true,
			sockets: { status: "ready", errors: [] },
			ha: [ {
				mode: "hot-standby",
				local: { name: "a", role: "primary", state: "hot-standby" },
				remote: { name: "b", role: "standby", state: "hot-standby", in_touch: true, interrupted: false, age: 0 }
			} ]
		} } } };

		await openPage(page, "overview", "Kea DHCP");

		const healthy = page.locator("#view .kea-daemon-ok");

		await healthy.waitFor();
		assert.match(await healthy.textContent(), /Running, listening/);
		assert.match(await healthy.textContent(),
			/High availability \(hot-standby\): this server, a, is primary and in the state hot-standby\. Its partner b is standby/);
		assert.equal(await deaf.count(), 0);
		await screenshot(page, "warnings-ha-state");
		ok("a daemon that listens is shown as such, with the state of high availability");

		/* A pair that is still synchronizing: not a failure, and not serving yet. */
		state.replies = { getDaemonState: { daemons: { dhcp4: {
			reachable: true, uptime: 5, serving: false,
			sockets: { status: "ready", errors: [] },
			ha: [ {
				mode: "hot-standby",
				local: { name: "a", role: "primary", state: "ready" },
				remote: { name: "b", role: "standby", state: "waiting", in_touch: true, interrupted: false, age: 2 }
			} ]
		} } } };

		await openPage(page, "overview", "Kea DHCP");

		const waiting = page.locator("#view .kea-daemon-wait");

		await waiting.waitFor();
		assert.match(await waiting.textContent(), /does not answer clients at the moment/);
		assert.equal(await deaf.count(), 0, "no alarm while high availability synchronizes");
		ok("a pair that is still synchronizing is shown as not serving yet, without an alarm");

		state.running = false;
		state.replies = {};

		/* ---- the Services page ---- */

		await openPage(page, "services", "Kea Services");

		const dnsmasq = page.locator("#view table.kea-conflicts tr", {
			has: page.locator("strong", { hasText: /^dnsmasq$/ })
		});

		await dnsmasq.waitFor();
		assert.match(await dnsmasq.locator(".kea-serves").textContent(), /DNS/);
		await screenshot(page, "warnings-services");
		ok("the Services page says that dnsmasq serves DNS");

		const stop = dnsmasq.locator("button", { hasText: /^Stop$/ });

		if (await stop.count()) {
			await stop.click();
			await waitForModal(page);
			assert.match(await page.locator(".modal").textContent(), /dnsmasq is the DNS server of this router/);
			await page.locator(".modal button", { hasText: /^Cancel$/ }).click();
			assert.deepEqual(state.blocked, [], "dnsmasq was not asked to stop");
			ok("stopping dnsmasq is asked about first, and not done when the answer is no");
		}
		else {
			console.log("skipped - dnsmasq is not running on the target, so there is no Stop button to try");
		}
	}
	finally {
		state.running = false;
		state.replies = {};

		if (await readRawConfig(page, "dhcp4") !== original)
			await writeRawConfig(page, "dhcp4", original);
	}

	console.log("all warning checks passed");
});
