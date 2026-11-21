// SPDX-License-Identifier: Apache-2.0

"use strict";

/*
 * The backend runs inside rpcd. A ubus call made from there to an object
 * that rpcd serves itself is not answered before it times out, 30 seconds
 * later, and rpcd answers nobody else meanwhile: all of LuCI waits.
 *
 * It happened with "ha-cluster nodes", an object of the rpcd plugin of
 * luci-app-ha-cluster, and did not show in any test, because no test target
 * had that plugin. So the objects the backend calls are listed here. One
 * that is served by rpcd, by any package, must not be added: let the pages
 * call it instead, as backend.js does for the nodes of a cluster.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* procd serves "service". It is a process of its own. */
const SERVED_ELSEWHERE = [ "service" ];

const ROOT = path.join(__dirname, "..", "..", "luci-app-kea");
const SOURCES = [
	...fs.readdirSync(path.join(ROOT, "ucode", "kea")).map((name) => path.join(ROOT, "ucode", "kea", name)),
	path.join(ROOT, "root", "usr", "share", "rpcd", "ucode", "luci.kea")
];

test("the backend calls no ubus object that rpcd serves", () => {
	const called = [];

	for (const file of SOURCES) {
		const text = fs.readFileSync(file, "utf8");

		for (const match of text.matchAll(/\.call\(\s*(['"])([^'"]+)\1/g))
			called.push([ path.basename(file), match[2] ]);

		/* A call with a computed object name could not be checked here. */
		assert.doesNotMatch(text, /\.call\(\s*[^'"\s)]/, path.basename(file) + ": a ubus object that is not a literal");
	}

	assert.ok(called.length > 0, "the check found the calls it is meant to look at");

	for (const [ file, object ] of called)
		assert.ok(SERVED_ELSEWHERE.includes(object), file + " calls the ubus object " + object);
});
