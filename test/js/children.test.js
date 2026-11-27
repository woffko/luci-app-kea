// SPDX-License-Identifier: Apache-2.0

"use strict";

/*
 * LuCI's E(tag, attributes, children) sets a string child as the HTML of
 * the element; only the strings inside an array become text. A line of a
 * Kea configuration or a host name taken from a lease, given as a bare
 * string, would therefore run as markup in the page of an administrator.
 *
 * So no child may be an expression that builds or picks a string: a
 * concatenation ("a" + b), a choice (a || b), a member (lease.hostname) or
 * a template. Such a child goes into an array: E("p", {}, [ text ]). Plain
 * names and calls stay allowed, because they mostly hold elements; and a
 * translation _("...") is the translators' own markup, as in LuCI.
 *
 * A text area takes its text as its value, never as a child: as a child,
 * "&amp;" in the text would be read as "&".
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const espree = require("espree");

const ROOT = path.join(__dirname, "..", "..", "luci-app-kea", "htdocs");

function sources(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);

		return entry.isDirectory() ? sources(file) : entry.name.endsWith(".js") ? [ file ] : [];
	});
}

function picksString(node) {
	switch (node.type) {
	case "BinaryExpression":
	case "LogicalExpression":
	case "MemberExpression":
		return true;
	case "TemplateLiteral":
		return node.expressions.length > 0;
	case "ConditionalExpression":
		return picksString(node.consequent) || picksString(node.alternate);
	default:
		return false;
	}
}

function calls(node, found) {
	if (!node || typeof node.type !== "string")
		return found;

	if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "E")
		found.push(node);

	for (const key of Object.keys(node)) {
		const value = node[key];

		if (Array.isArray(value))
			value.forEach((item) => calls(item, found));
		else if (value && typeof value === "object" && key !== "loc")
			calls(value, found);
	}

	return found;
}

function problems(file) {
	const source = fs.readFileSync(file, "utf8");
	const ast = espree.parse(source, { ecmaVersion: 2022, loc: true, ecmaFeatures: { globalReturn: true } });
	const where = (node) => path.relative(ROOT, file) + ":" + node.loc.start.line;
	const found = [];

	for (const call of calls(ast, [])) {
		const [ tag, second, third ] = call.arguments;
		const child = call.arguments.length > 2 ? third :
			(second && second.type !== "ObjectExpression" ? second : null);

		if (!child)
			continue;

		if (tag && tag.type === "Literal" && tag.value === "textarea")
			found.push(where(child) + ": a text area with a child; set its value");
		else if (picksString(child))
			found.push(where(child) + ": " + source.slice(child.start, child.end).replace(/\s+/g, " ").slice(0, 80));
	}

	return found;
}

test("no element gets a string that is not in an array", () => {
	const found = sources(ROOT).flatMap(problems);

	assert.deepEqual(found, [], "wrap these children in [ ]:\n" + found.join("\n"));
});

test("the check finds a bare string child", () => {
	const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "kea-children-"));
	const file = path.join(dir, "sample.js");

	fs.writeFileSync(file, [
		"E(\"div\", {}, line.op + \" \" + line.text);",
		"E(\"td\", {}, lease.hostname || \"-\");",
		"E(\"h3\", page.title);",
		"E(\"textarea\", {}, content);",
		"E(\"div\", {}, [ line.text ]);",
		"E(\"p\", {}, _(\"Saved.\"));"
	].join("\n"));

	try {
		assert.deepEqual(problems(file).map((line) => line.replace(/^.*sample\.js:/, "")), [
			"1: line.op + \" \" + line.text",
			"2: lease.hostname || \"-\"",
			"3: page.title",
			"4: a text area with a child; set its value"
		]);
	}
	finally {
		fs.rmSync(dir, { recursive: true });
	}
});
