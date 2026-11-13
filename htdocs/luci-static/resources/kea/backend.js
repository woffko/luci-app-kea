"use strict";
"require baseclass";
"require rpc";
"require ui";

/*
 * Calls to the luci.kea rpcd backend shared by the configuration pages,
 * and the save / apply sequence built on them.
 */

var callGetConfig = rpc.declare({
	object: "luci.kea",
	method: "getConfig",
	params: [ "name" ],
	expect: { "": {} }
});

var callSaveConfig = rpc.declare({
	object: "luci.kea",
	method: "saveConfig",
	params: [ "name", "content" ],
	expect: { "": {} }
});

var callNetworkInterfaces = rpc.declare({
	object: "luci.kea",
	method: "getNetworkInterfaces",
	expect: { interfaces: {} }
});

var callStatus = rpc.declare({
	object: "luci.kea",
	method: "getStatus",
	expect: { status: {} }
});

var callLeases = rpc.declare({
	object: "luci.kea",
	method: "getLeases",
	expect: { leases: {} }
});

var callLog = rpc.declare({
	object: "luci.kea",
	method: "getLog",
	params: [ "lines" ],
	expect: { "": {} }
});

var callServices = rpc.declare({
	object: "luci.kea",
	method: "getServices",
	expect: { services: {} }
});

var callInitAction = rpc.declare({
	object: "luci.kea",
	method: "setInitAction",
	params: [ "action" ],
	expect: { "": {} }
});

var callListBackups = rpc.declare({
	object: "luci.kea",
	method: "listBackups",
	params: [ "name" ],
	expect: { "": {} }
});

var callRestoreBackup = rpc.declare({
	object: "luci.kea",
	method: "restoreBackup",
	params: [ "name", "id" ],
	expect: { "": {} }
});

/* Daemon names as shown to the user, by backend config name. */
var DAEMONS = {
	dhcp4: "kea-dhcp4",
	dhcp6: "kea-dhcp6",
	dhcp_ddns: "kea-dhcp-ddns",
	ctrl_agent: "kea-ctrl-agent"
};

/* How long a daemon gets to come back after a reload before it is checked. */
var RELOAD_SETTLE_MS = 2500;

function notify(message, kind) {
	ui.addNotification(null, E("p", message), kind || "info");
}

function wait(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function isRunning(services, name) {
	var service = services && services[name];

	return !!(service && (service.running === true || service.running === 1));
}

return baseclass.extend({
	getConfig: function(name) {
		return L.resolveDefault(callGetConfig(name), {});
	},

	getStatus: function() {
		return L.resolveDefault(callStatus(), {});
	},

	getLeases: function() {
		return L.resolveDefault(callLeases(), {});
	},

	/* The last Kea messages of the system log, oldest first. */
	getLog: function(lines) {
		return L.resolveDefault(callLog(lines), {}).then(function(result) {
			return result.lines || [];
		});
	},

	getInterfaces: function() {
		return L.resolveDefault(callNetworkInterfaces(), {}).then(function(result) {
			return result.items || [];
		});
	},

	listBackups: function(name) {
		return L.resolveDefault(callListBackups(name), {}).then(function(result) {
			return result.items || [];
		});
	},

	daemonName: function(name) {
		return DAEMONS[name] || name;
	},

	notify: notify,

	/* Show why a save or restore was refused, with the Kea output if any. */
	notifyFailure: function(result, fallback) {
		var output = result && (result.validation || result.detail);

		ui.addNotification(null, E("div", {}, [
			E("p", result && result.error ? result.error : fallback),
			output ? E("pre", {
				"style": "white-space: pre-wrap; max-height: 18rem; overflow: auto"
			}, output) : ""
		]), "danger");
	},

	/*
	 * Write a configuration file. The backend validates the content with
	 * the Kea binary and keeps a backup before replacing the file.
	 * Resolves to true when the file was written.
	 */
	saveConfig: function(name, content) {
		var self = this;

		return callSaveConfig(name, content).then(function(result) {
			if (!result || !result.result) {
				self.notifyFailure(result, _("Failed to save the Kea configuration."));
				return false;
			}

			return true;
		});
	},

	restoreBackup: function(name, id) {
		var self = this;

		return callRestoreBackup(name, id).then(function(result) {
			if (!result || !result.result) {
				self.notifyFailure(result, _("Failed to restore the backup."));
				return false;
			}

			return true;
		});
	},

	/*
	 * Make a running daemon pick up its saved configuration and report
	 * whether it is still running afterwards. A stopped daemon is left
	 * stopped: starting DHCP service is a decision for the Services page.
	 */
	applyConfig: function(name) {
		var daemon = this.daemonName(name);

		return L.resolveDefault(callServices(), {}).then(function(services) {
			if (!isRunning(services, name)) {
				notify(daemon + ": " + _("configuration saved. The service is not running; start it from the Services page."));
				return false;
			}

			return callInitAction("reload").then(function(result) {
				if (!result || !result.result) {
					notify(daemon + ": " + _("configuration saved, but the reload failed."), "danger");
					return false;
				}

				return wait(RELOAD_SETTLE_MS).then(function() {
					return L.resolveDefault(callServices(), {});
				}).then(function(after) {
					if (isRunning(after, name)) {
						notify(daemon + ": " + _("configuration saved and applied."));
						return true;
					}

					notify(daemon + ": " + _("the service is not running after the reload. Check the system log."), "danger");
					return false;
				});
			});
		});
	}
});
