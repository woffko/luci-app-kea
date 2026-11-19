"use strict";
"require baseclass";
"require rpc";
"require ui";
"require kea.dialogs as dialogs";

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

/*
 * A setting that Kea accepts when it checks a file and refuses when it
 * starts, as the backend reports it, in words.
 */
function warningText(warning) {
	if (warning.code === "lease-path")
		return _("The lease file %s is not in %s. Kea takes its lease file from that directory only: name the file without a directory, or do not name it.")
			.format(warning.value, warning.directory);

	if (warning.code === "log-path")
		return _("The log file %s is not in %s. Kea writes log files to that directory only: use the output syslog instead.")
			.format(warning.value, warning.directory);

	return String(warning.value || warning.code);
}

/* One paragraph per warning; a list would take the colors of the theme. */
function warningList(warnings) {
	return E("div", {}, warnings.map(function(warning) {
		return E("p", { "style": "margin: .25rem 0 .25rem 1rem" }, warningText(warning));
	}));
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

	/*
	 * The last Kea messages of the system log, oldest first, as "lines",
	 * and where each daemon is configured to write its log, as "outputs".
	 */
	getLog: function(lines) {
		return L.resolveDefault(callLog(lines), {}).then(function(result) {
			return { lines: result.lines || [], outputs: result.outputs || {} };
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

	/*
	 * A box that says Kea will not start with a file, with the reasons, or
	 * null when there are none. "warnings" is what the backend returns with
	 * a file that passed the check of the Kea binary.
	 */
	renderWarnings: function(warnings) {
		if (!warnings || !warnings.length)
			return null;

		return E("div", { "class": "alert-message warning kea-start-warnings" }, [
			E("p", {}, _("Kea accepts this configuration when it checks it, but does not start with it:")),
			warningList(warnings)
		]);
	},

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
	 * Resolves to the reply of the backend when the file was written, and
	 * to false when it was refused.
	 */
	saveConfig: function(name, content) {
		var self = this;

		return callSaveConfig(name, content).then(function(result) {
			if (!result || !result.result) {
				self.notifyFailure(result, _("Failed to save the Kea configuration."));
				return false;
			}

			return result;
		});
	},

	/* Tell the user that a file was written that Kea will not start with. */
	notifyWarnings: function(name, warnings) {
		ui.addNotification(null, E("div", { "class": "kea-start-warnings" }, [
			E("p", {}, this.daemonName(name) + ": " +
				_("the file is written. Kea accepts it when it checks it, but does not start with it:")),
			warningList(warnings)
		]), "warning");
	},

	restoreBackup: function(name, id) {
		var self = this;

		return callRestoreBackup(name, id).then(function(result) {
			if (!result || !result.result) {
				self.notifyFailure(result, _("Failed to restore the backup."));
				return false;
			}

			if ((result.warnings || []).length)
				self.notifyWarnings(name, result.warnings);

			return true;
		});
	},

	/*
	 * Save a configuration file and, with "apply", make the running daemon
	 * read it. Resolves to true when the file was written, whether or not
	 * it was applied.
	 */
	write: function(name, content, apply) {
		var self = this;

		return this.saveConfig(name, content).then(function(saved) {
			var warnings;

			/* Kea refused the content: nothing was written. */
			if (!saved)
				return false;

			warnings = saved.warnings || [];

			if (warnings.length)
				self.notifyWarnings(name, warnings);

			if (!apply) {
				if (!warnings.length)
					notify(self.daemonName(name) + ": " +
						_("configuration saved. Reload or restart Kea to apply it."));

				return true;
			}

			return self.applyConfig(name, warnings).then(function() {
				return true;
			});
		});
	},

	/*
	 * Make a running daemon pick up its saved configuration and report
	 * whether it is still running afterwards. A stopped daemon is left
	 * stopped: starting DHCP service is a decision for the Services page.
	 *
	 * With "warnings" the daemon is expected not to come back, so the user
	 * is asked before it is reloaded.
	 */
	applyConfig: function(name, warnings) {
		var daemon = this.daemonName(name);

		return L.resolveDefault(callServices(), {}).then(function(services) {
			if (!isRunning(services, name)) {
				notify(daemon + ": " + _("configuration saved. The service is not running; start it from the Services page."));
				return false;
			}

			if (!warnings || !warnings.length)
				return true;

			return dialogs.ask(_("Reload Kea"), [
				E("p", {}, _("The file is saved. %s is running, and it is expected to stop when it reads this configuration:").format(daemon)),
				warningList(warnings),
				E("p", {}, _("Without a reload it keeps running with its previous configuration until it is restarted."))
			], _("Reload anyway")).then(function(confirmed) {
				if (!confirmed)
					notify(daemon + ": " + _("configuration saved, not applied. The daemon runs with its previous configuration."));

				return confirmed;
			});
		}).then(function(proceed) {
			if (!proceed)
				return false;

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
