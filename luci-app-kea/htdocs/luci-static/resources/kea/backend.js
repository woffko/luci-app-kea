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

var callDaemonState = rpc.declare({
	object: "luci.kea",
	method: "getDaemonState",
	expect: { daemons: {} }
});

var callHaNodes = rpc.declare({
	object: "luci.kea",
	method: "getHaNodes",
	expect: { cluster: {} }
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

/*
 * What an init action did besides Kea. With ha-cluster and Kea as its DHCP
 * server, the backend had ha-cluster bring its firewall rules up to date,
 * which the user did not ask for by name. Returns the sentence to add to
 * the report of the action, and warns when ha-cluster failed: Kea took its
 * configuration all the same.
 */
function clusterNote(result) {
	if (!result || result.cluster_firewall == null)
		return "";

	if (result.cluster_firewall)
		return " " + _("ha-cluster was told to bring its firewall rules up to date with the ports of the peer URLs.");

	notify(_("ha-cluster could not bring its firewall rules up to date. The ports of the peer URLs may be closed between the nodes: run /etc/init.d/ha-cluster firewall and look at the system log."), "warning");

	return "";
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
 * A setting that Kea accepts when it checks a file and that keeps it from
 * serving, as the backend reports it, in words. Its "effect" tells the
 * kinds apart: with "no-start" the daemon exits when it starts, with
 * "no-listen" it may run without listening, with "no-pair" the servers of
 * a high availability pair cannot reach each other.
 */
function warningText(warning) {
	if (warning.code === "socket-retries")
		return _("Kea is to listen on %s and does not try again when an interface is not ready. Started at boot before the interface is up, it opens no socket and stays that way. Set Socket Retries and Socket Retry Wait on the Global settings tab, for example 60 and 2000.")
			.format(warning.value);

	if (warning.code === "ha-url-port")
		return _("The URL %s of the peer %s has no port. Kea then listens on a port chosen at random and the partner cannot connect. Give every peer URL a port, as in http://192.168.1.2:8001/.")
			.format(warning.value, warning.peer);

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

function withEffect(warnings, effect) {
	return (warnings || []).filter(function(warning) {
		return warning.effect === effect;
	});
}

/* The states of high availability in which a server does not do its part. */
var HA_TROUBLE = { "terminated": true, "partner-down": true, "communication-recovery": true };

/*
 * What a running daemon says about itself, as the backend passes it on, in
 * words: { level, summary, details }. The level is "ok", "wait", "bad" or
 * "unknown". "bad" means that the process runs and does not serve where it
 * was told to: Kea reports its sockets as failed when it could not open
 * one of them, and names the interface in the message. That can be all it
 * was to listen on, or one interface of several.
 */
function describeDaemon(state) {
	var sockets, details = [], level, summary;

	if (!state || !state.reachable) {
		summary = !state ? _("state unknown") :
			state.reason === "no-control-socket" ? _("state unknown: its configuration names no control socket") :
			state.reason === "no-socket-module" ? _("state unknown: the package ucode-mod-socket is not installed") :
				_("state unknown: it does not answer on its control socket");

		return { level: "unknown", summary: summary, details: details };
	}

	sockets = state.sockets || {};

	if (sockets.status === "ready") {
		level = "ok";
		summary = _("listening");
	}
	else if (sockets.status === "retrying") {
		level = "wait";
		summary = _("still trying to open its sockets");
	}
	else if (sockets.status === "failed") {
		level = "bad";
		summary = _("could not open all of its sockets");
	}
	else {
		level = "unknown";
		summary = _("state of the sockets unknown");
	}

	(sockets.errors || []).forEach(function(error) {
		details.push(error);
	});

	/*
	 * High availability switches the DHCP service off while the servers
	 * start and synchronize, and on again when they are done. Without it,
	 * only a command does that, and it stays off.
	 */
	if (state.serving === false) {
		if ((state.ha || []).length) {
			level = level === "bad" ? level : "wait";
			details.push(_("It does not answer clients at the moment: high availability keeps the DHCP service switched off while the servers synchronize."));
		}
		else {
			level = "bad";
			details.push(_("It does not answer clients: its DHCP service was switched off by a command."));
		}
	}

	(state.ha || []).forEach(function(relation) {
		var local = relation.local || {};
		var remote = relation.remote || {};

		details.push(_("High availability (%s): this server, %s, is %s and in the state %s. Its partner %s is %s and was last seen in the state %s.")
			.format(relation.mode, local.name, local.role, local.state, remote.name, remote.role, remote.state) +
			(remote.interrupted ? " " + _("The connection to the partner is interrupted.") : ""));

		if (level === "ok" && (HA_TROUBLE[local.state] || remote.interrupted))
			level = "wait";
	});

	return { level: level, summary: summary, details: details };
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

	/* What each running DHCP daemon says about itself: { dhcp4, dhcp6 }. */
	getDaemonState: function() {
		return L.resolveDefault(callDaemonState(), {});
	},

	/* The nodes of a cluster, when ha-cluster is there to ask. */
	getHaNodes: function() {
		return L.resolveDefault(callHaNodes(), {});
	},

	describeDaemon: describeDaemon,

	clusterNote: clusterNote,

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
	 * Boxes that say what Kea will do with a file beyond accepting it, or
	 * null when there is nothing to say. "warnings" is what the backend
	 * returns with a file that passed the check of the Kea binary.
	 */
	renderWarnings: function(warnings) {
		var start = withEffect(warnings, "no-start");
		var listen = withEffect(warnings, "no-listen");
		var pair = withEffect(warnings, "no-pair");
		var boxes = [];

		if (start.length)
			boxes.push(E("div", { "class": "alert-message warning kea-start-warnings" }, [
				E("p", {}, _("Kea accepts this configuration when it checks it, but does not start with it:")),
				warningList(start)
			]));

		if (listen.length)
			boxes.push(E("div", { "class": "alert-message warning kea-listen-warnings" }, [
				E("p", {}, _("With this configuration Kea may run without listening after a boot:")),
				warningList(listen)
			]));

		if (pair.length)
			boxes.push(E("div", { "class": "alert-message warning kea-pair-warnings" }, [
				E("p", {}, _("With this configuration the servers of the high availability pair cannot reach each other, and each serves as if it were alone:")),
				warningList(pair)
			]));

		return boxes.length ? E("div", {}, boxes) : null;
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

			if (withEffect(result.warnings, "no-start").length)
				self.notifyWarnings(name, withEffect(result.warnings, "no-start"));

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

			/* What only matters at the next boot is shown on the page, not here. */
			warnings = withEffect(saved.warnings, "no-start");

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
						notify(daemon + ": " + _("configuration saved and applied.") + clusterNote(result));
						return true;
					}

					notify(daemon + ": " + _("the service is not running after the reload. Check the system log."), "danger");
					return false;
				});
			});
		});
	}
});
