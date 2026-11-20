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
 * The Leases picture also needs the lease fixture
 * (test/make-lease-fixture.sh), and the high availability pictures the
 * kea-hook-ha package. No daemon is started, stopped or reloaded: the
 * calls that would do so are answered by the script itself.
 *
 * Without arguments every picture is taken. Picture names as arguments
 * limit the run to those, and to their preconditions:
 *
 *   node test/browser/screenshots.js ha ha-checks
 *
 * The pictures are written to docs/images/ unless OUT_DIR says otherwise.
 * See lib.js for the other environment variables.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

process.env.OUT_DIR = process.env.OUT_DIR || path.join(__dirname, "..", "..", "docs", "images");

const {
	openPage, screenshot, waitForModal, main, footerButton, expectNotification,
	openRawEditor, readRawConfig, writeRawConfig, interceptServiceCalls,
	fieldRow, fieldInput, tableRows, addRow, openTab
} = require("./lib.js");
const { loadModule } = require("../js/luci-loader.js");

const model = loadModule("kea.model");

const PICTURES = [
	"overview", "services", "dhcp4", "changes", "global",
	"ha", "ha-load-balancing", "ha-checks", "ha-changes",
	"warnings", "reload",
	"dhcp6", "leases", "configuration", "import"
];
const ONLY = process.argv.slice(2);

for (const name of ONLY) {
	if (!PICTURES.includes(name)) {
		console.error("unknown picture: " + name + "\nknown pictures: " + PICTURES.join(", "));
		process.exit(2);
	}
}

/* Whether one of these pictures is to be taken in this run. */
function wanted(...names) {
	return ONLY.length === 0 || names.some((name) => ONLY.includes(name));
}

function fixture(name) {
	return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

const FIXTURES = { dhcp4: fixture("kea-dhcp4-rich.conf"), dhcp6: fixture("kea-dhcp6-rich.conf") };

/*
 * A fresh test machine has no root password, and LuCI says so on every
 * page. The banner has nothing to do with this application; leave it out.
 *
 * "top" is a locator of what the picture starts with, for a picture of the
 * visible part of a long page; without it the page is shown from its top.
 */
async function capture(page, name, viewport, top) {
	if (!wanted(name))
		return;

	await page.evaluate(() => {
		document.querySelectorAll(".alert-message").forEach((node) => {
			if (/No password set/.test(node.textContent))
				node.remove();
		});
		document.scrollingElement.scrollTop = 0;
	});

	/* The menu bar of LuCI stays at the top of the window; keep clear of it. */
	if (top)
		await top.evaluate((node) => {
			document.scrollingElement.scrollTop = node.getBoundingClientRect().top - 60;
		});

	await screenshot(page, name, viewport);
	console.log("wrote " + name + ".png");
}

async function showChanges(page) {
	await page.locator("#view button", { hasText: /^Show changes$/ }).click();
	await waitForModal(page);
}

/*
 * The high availability tab of the DHCPv4 page, switched on, with the form
 * as it is before anything was typed. Every picture starts from a page
 * loaded anew, so that none shows what the one before it typed.
 */
async function openHaTab(page) {
	await openPage(page, "dhcp4", "Kea DHCPv4");
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
	await openTab(page, "High availability");
	await fieldInput(page, "Enable").check();
	await fieldRow(page, "Mode").locator("select").waitFor();
}

/* Add a peer; a role is chosen only where the form's own choice is not wanted. */
async function addPeer(page, name, url, role) {
	await addRow(page, "kea-ha-peers", "Add Peer", [ name, url ]);

	if (role)
		await tableRows(page, "kea-ha-peers").last().locator("select").selectOption(role);
}

/* Leave the field that was typed in last, so that no input has the focus. */
async function leaveFields(page) {
	await page.locator("#view h3", { hasText: "High availability" }).click();
}

/* Typed in but never saved, except for what the browser itself refuses. */
async function highAvailability(page) {
	await openPage(page, "dhcp4", "Kea DHCPv4");
	await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();

	if (await page.locator("#view .cbi-tabmenu a", { hasText: "High availability" }).count() === 0) {
		console.log("skipped the high availability pictures: kea-hook-ha is not installed on the target");
		return;
	}

	/* A hot standby pair. */
	if (wanted("ha", "ha-changes")) {
		await openHaTab(page);
		await fieldInput(page, "This server").fill("router1");
		await addPeer(page, "router1", "http://192.168.1.1:8000/");
		await addPeer(page, "router2", "http://192.168.1.2:8000/");
		await leaveFields(page);
		await capture(page, "ha");

		/* What switching it on would write to the file. */
		await showChanges(page);
		await capture(page, "ha-changes", true);
		await page.locator(".modal button", { hasText: /^Close$/ }).click();
	}

	/* Two servers that share the clients, and a third that only keeps a copy. */
	if (wanted("ha-load-balancing")) {
		await openHaTab(page);
		await fieldRow(page, "Mode").locator("select").selectOption("load-balancing");
		await fieldInput(page, "This server").fill("router1");
		await addPeer(page, "router1", "http://192.168.1.1:8000/");
		await addPeer(page, "router2", "http://192.168.1.2:8000/");
		await addPeer(page, "archive", "http://192.168.1.3:8000/", "backup");
		await fieldInput(page, "Heartbeat delay").fill("5000");
		await fieldInput(page, "Maximum response delay").fill("20000");
		await fieldRow(page, "Additional parameters").locator("textarea")
			.fill('{\n\t"sync-page-limit": 2000\n}');
		await leaveFields(page);
		await capture(page, "ha-load-balancing");
	}

	/*
	 * Input the form refuses: a name for this server that no peer has, a
	 * host name in a URL, and two primary servers. Save reports it and
	 * writes nothing.
	 */
	if (wanted("ha-checks")) {
		await openHaTab(page);
		await fieldInput(page, "This server").fill("router3");
		await addPeer(page, "router1", "http://192.168.1.1:8000/");
		await addPeer(page, "router2", "http://router2.lan:8000/", "primary");
		await leaveFields(page);
		await footerButton(page, "Save").click();

		/* The message fades in; wait until it is fully there. */
		await page.waitForFunction(() => {
			const message = Array.from(document.querySelectorAll(".alert-message"))
				.find((node) => /High availability: Peers/.test(node.textContent));

			return message && document.defaultView.getComputedStyle(message).opacity === "1";
		}, null, { timeout: 30000 });
		await capture(page, "ha-checks");
	}
}

/*
 * A lease file in /tmp: Kea accepts the configuration when it checks it and
 * does not start with it. The file is saved for the pictures, and the
 * fixture is put back afterwards.
 */
async function startWarnings(page, fixture) {
	const state = { blocked: [], running: false };
	const config = model.parseConfig(fixture).config;

	config.Dhcp4["lease-database"].name = "/tmp/kea-leases4.csv";

	await interceptServiceCalls(page, state);
	await openRawEditor(page, "dhcp4");
	await page.locator("#view textarea").fill(model.serialize(config));
	await footerButton(page, "Save").click();
	await expectNotification(page, "does not start with it");

	/* The result of the check with the warning, and where the logs go. */
	await openPage(page, "overview", "Kea DHCP");
	await page.locator("#view .kea-start-warnings").waitFor();
	await capture(page, "warnings", true, page.locator("#view h3", { hasText: /^Validation$/ }));

	/* What Save & Apply asks when the daemon is running. */
	if (wanted("reload")) {
		state.running = true;
		await openPage(page, "dhcp4", "Kea DHCPv4");
		await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
		await openTab(page, "Global settings");
		await fieldInput(page, "Renew Timer").fill("600");
		await footerButton(page, "Save & Apply").click();
		await waitForModal(page);
		await capture(page, "reload", true);
		await page.locator(".modal button", { hasText: /^Cancel$/ }).click();
		await expectNotification(page, "configuration saved, not applied");
		state.running = false;
	}

	await writeRawConfig(page, "dhcp4", fixture);
}

main(async (page) => {
	const originals = {};

	fs.mkdirSync(process.env.OUT_DIR, { recursive: true });

	for (const name of Object.keys(FIXTURES))
		originals[name] = await readRawConfig(page, name);

	try {
		for (const name of Object.keys(FIXTURES))
			await writeRawConfig(page, name, FIXTURES[name]);

		if (wanted("overview")) {
			await openPage(page, "overview", "Kea DHCP");
			await capture(page, "overview");
		}

		if (wanted("services")) {
			await openPage(page, "services", "Kea Services");
			await capture(page, "services");
		}

		if (wanted("dhcp4", "changes", "global")) {
			/* Show one reservation switched off; nothing is saved. */
			await openPage(page, "dhcp4", "Kea DHCPv4");
			await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
			await page.locator("#view table.kea-reservations tbody tr").nth(1).locator('input[type="checkbox"]').uncheck();
			await capture(page, "dhcp4");

			/* The view of what a save would change; nothing is saved. */
			await page.locator("#view .cbi-value", {
				has: page.locator("label.cbi-value-title", { hasText: /^Gateway$/ })
			}).locator("input").fill("192.168.1.254");
			await showChanges(page);
			await capture(page, "changes", true);
			await page.locator(".modal button", { hasText: /^Close$/ }).click();

			await openTab(page, "Global settings");
			await capture(page, "global");
		}

		if (wanted("ha", "ha-load-balancing", "ha-checks", "ha-changes"))
			await highAvailability(page);

		if (wanted("warnings", "reload"))
			await startWarnings(page, FIXTURES.dhcp4);

		if (wanted("dhcp6")) {
			await openPage(page, "dhcp6", "Kea DHCPv6");
			await page.locator("#view h3", { hasText: "br-lan" }).first().waitFor();
			await capture(page, "dhcp6");
		}

		if (wanted("leases")) {
			await openPage(page, "leases", "Kea Leases");

			if (await page.locator("#view td", { hasText: /^nas$/ }).count() === 0)
				throw new Error("the lease fixture is missing: run test/make-lease-fixture.sh on the target");

			await capture(page, "leases");
		}

		if (wanted("configuration")) {
			await openPage(page, "configuration", "Kea Configuration");
			await page.locator("#view textarea").waitFor();
			await capture(page, "configuration");
		}

		if (wanted("import")) {
			await openPage(page, "import-dnsmasq", "Import dnsmasq Static Leases");
			await page.locator("#view table tbody tr").first().waitFor();

			if (await page.locator("#view small", { hasText: /^dual$/ }).count() === 0)
				throw new Error("the fixture static leases are missing: add test/fixtures/dhcp-static-leases.uci to /etc/config/dhcp of the target");

			await capture(page, "import");
		}
	}
	finally {
		for (const name of Object.keys(FIXTURES))
			if (await readRawConfig(page, name) !== originals[name])
				await writeRawConfig(page, name, originals[name]);
	}

	console.log("all screenshots written to " + process.env.OUT_DIR);
});
