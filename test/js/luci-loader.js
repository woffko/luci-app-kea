/*
 * Minimal loader for LuCI JavaScript modules, for unit tests under Node.
 *
 * A LuCI module is a script that names its dependencies in "require"
 * directives and returns a class. LuCI wraps the source in a function whose
 * parameters are the required modules and instantiates the returned class.
 * This loader does the same for modules that only need "baseclass".
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RESOURCES = path.join(__dirname, "..", "..", "htdocs", "luci-static", "resources");

const baseclass = {
	extend(properties) {
		function Module() {}
		Module.prototype = properties;
		return Module;
	}
};

function loadModule(name) {
	const file = path.join(RESOURCES, name.replace(/\./g, "/") + ".js");
	const source = fs.readFileSync(file, "utf8");
	const required = [];

	source.replace(/^\s*["']require ([^"' ]+)(?: as ([A-Za-z_]\w*))?["'];?\s*$/gm,
		(match, module, alias) => required.push(alias || module));

	const unsupported = required.filter((module) => module !== "baseclass");

	if (unsupported.length)
		throw new Error(name + " requires unsupported modules: " + unsupported.join(", "));

	/* "_" is the LuCI translation function; tests use the source strings. */
	const factory = new Function("baseclass", "_", source);
	const Module = factory(baseclass, (string) => string);

	return new Module();
}

module.exports = { loadModule };
