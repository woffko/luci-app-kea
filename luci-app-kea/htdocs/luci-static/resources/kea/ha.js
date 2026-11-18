"use strict";
"require baseclass";

/*
 * Model of the Kea High Availability hook settings, shared by the DHCPv4
 * and DHCPv6 editors.
 *
 * The settings live in the "hooks-libraries" entry of libdhcp_ha.so. The
 * form edits one relationship: mode, this server, peers, timers. Every
 * other key of the relationship is offered as JSON text. Nothing is written
 * unless the user changed something on the tab.
 *
 * "kea-dhcp4 -t" does not look at hook parameters at all, so the checks
 * here follow what the hook itself refuses when Kea 3.0.4 loads it
 * ("kea-dhcp4 -T"). The fallback values are those of its parser.
 *
 * The module has no DOM or RPC dependencies and is unit-tested under Node.
 */

var HA_LIBRARY = "libdhcp_ha.so";
var LEASE_CMDS_LIBRARY = "libdhcp_lease_cmds.so";
var DEFAULT_HOOKS_DIR = "/usr/lib/kea/hooks";

var ROOTS = { dhcp4: "Dhcp4", dhcp6: "Dhcp6" };

var MODES = [ "hot-standby", "load-balancing", "passive-backup" ];
var ROLES = [ "primary", "secondary", "standby", "backup" ];

/* The roles a mode allows, and the partner of the primary it requires. */
var MODE_ROLES = {
	"hot-standby": { allowed: [ "primary", "standby", "backup" ], partner: "standby" },
	"load-balancing": { allowed: [ "primary", "secondary", "backup" ], partner: "secondary" },
	"passive-backup": { allowed: [ "primary", "backup" ], partner: null }
};

/* Form field -> Kea key and the value Kea uses when the key is absent. */
var NUMBERS = {
	heartbeatDelay: { key: "heartbeat-delay", fallback: "10000" },
	maxResponseDelay: { key: "max-response-delay", fallback: "60000" },
	maxAckDelay: { key: "max-ack-delay", fallback: "10000" },
	maxUnackedClients: { key: "max-unacked-clients", fallback: "10" },
	syncTimeout: { key: "sync-timeout", fallback: "60000" }
};

var FLAGS = {
	sendLeaseUpdates: { key: "send-lease-updates", fallback: true },
	syncLeases: { key: "sync-leases", fallback: true }
};

var PEER_FIELDS = [ "name", "url", "role", "autoFailover" ];

var LABELS = {
	mode: _("Mode"),
	thisServer: _("This server"),
	peers: _("Peers"),
	name: _("Name"),
	url: _("URL"),
	role: _("Role"),
	heartbeatDelay: _("Heartbeat delay"),
	maxResponseDelay: _("Maximum response delay"),
	maxAckDelay: _("Maximum ACK delay"),
	maxUnackedClients: _("Maximum unacked clients"),
	syncTimeout: _("Synchronization timeout"),
	sendLeaseUpdates: _("Send lease updates"),
	syncLeases: _("Synchronize leases"),
	advanced: _("Additional parameters")
};

function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value) {
	return Array.isArray(value) ? value : [];
}

function clone(value) {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
	return value === undefined || value === null ? "" : String(value);
}

/* The Kea keys that have a form field; the rest is "additional". */
function managedKeys() {
	var keys = [ "this-server-name", "mode", "peers" ];
	var field;

	for (field in NUMBERS)
		keys.push(NUMBERS[field].key);

	for (field in FLAGS)
		keys.push(FLAGS[field].key);

	return keys;
}

/* Index of the hook entry that loads the given library, or -1. */
function findHook(hooks, library) {
	var i;

	for (i = 0; i < hooks.length; i++)
		if (isObject(hooks[i]) && text(hooks[i].library).replace(/^.*\//, "") === library)
			return i;

	return -1;
}

/* ---- addresses -------------------------------------------------------- */

function isIPv4(value) {
	var parts = value.split(".");

	return parts.length === 4 && parts.every(function(part) {
		return /^\d{1,3}$/.test(part) && Number(part) <= 255;
	});
}

function isIPv6(value) {
	var halves = value.split("::");
	var groups = [];
	var count, ok;

	if (halves.length > 2)
		return false;

	halves.forEach(function(half) {
		if (half !== "")
			groups = groups.concat(half.split(":"));
	});

	count = groups.length;

	ok = groups.every(function(group, index) {
		/* An IPv4 tail stands for two groups. */
		if (index === groups.length - 1 && group.indexOf(".") >= 0) {
			count++;
			return isIPv4(group);
		}

		return /^[0-9A-Fa-f]{1,4}$/.test(group);
	});

	return ok && (halves.length === 2 ? count <= 7 : count === 8);
}

/*
 * The hook takes "http://<IP address>[:port][/path]". It resolves no host
 * names, and takes https only when TLS is configured.
 */
function checkUrl(value, tls) {
	var match = value.match(/^(https?):\/\/(\[([^\]]*)\]|[^/:[\]]+)(:\d+)?(\/.*)?$/);

	if (!match)
		return _("not a URL such as http://192.168.1.2:8000/");

	if (match[3] !== undefined ? !isIPv6(match[3]) : !isIPv4(match[2]))
		return _("Kea needs an IP address in the URL, not a host name");

	if (match[1] === "https" && !tls)
		return _("https needs the TLS parameters trust-anchor, cert-file and key-file");

	return null;
}

/* ---- the form state --------------------------------------------------- */

function peerBlank(row) {
	return !row.source && row.name === "" && row.url === "";
}

function activePeers(state) {
	return state.peers.filter(function(row) {
		return !peerBlank(row);
	});
}

function makePeer(peer) {
	var row = { name: "", url: "", role: "backup", autoFailover: true, source: null, initial: null };

	if (isObject(peer)) {
		row.source = clone(peer);
		row.name = text(peer.name);
		row.url = text(peer.url);
		row.role = text(peer.role);
		row.autoFailover = hasOwn(peer, "auto-failover") ? peer["auto-failover"] === true : true;
		row.initial = {};

		PEER_FIELDS.forEach(function(field) {
			row.initial[field] = row[field];
		});
	}

	return row;
}

/* Everything the form shows, as one comparable text. */
function view(state) {
	var result = {
		enabled: state.enabled,
		mode: state.mode,
		thisServer: state.thisServer,
		advanced: state.advanced,
		peers: activePeers(state).map(function(row) {
			return PEER_FIELDS.map(function(field) {
				return row[field];
			});
		})
	};
	var field;

	for (field in NUMBERS)
		result[field] = state[field];

	for (field in FLAGS)
		result[field] = state[field];

	return JSON.stringify(result);
}

function changed(state) {
	return view(state) !== state.initial;
}

function build(familyName, config) {
	var root = isObject(config) && isObject(config[ROOTS[familyName]]) ? config[ROOTS[familyName]] : {};
	var hooks = array(root["hooks-libraries"]);
	var index = findHook(hooks, HA_LIBRARY);
	var parameters = index >= 0 && isObject(hooks[index].parameters) ? hooks[index].parameters : {};
	var list = array(parameters["high-availability"]);
	var relationship = isObject(list[0]) ? list[0] : null;
	var managed = managedKeys();
	var rest = {};
	var state = {
		/* An entry for the hook exists in the file. */
		present: index >= 0,
		enabled: index >= 0,
		relationships: list.length,
		/* The form handles one relationship; more are left to the raw editor. */
		editable: list.length === 0 || (list.length === 1 && relationship !== null),
		mode: MODES[0],
		thisServer: "",
		peers: [],
		advanced: "",
		source: null,
		initial: null
	};
	var field, key;

	for (field in NUMBERS)
		state[field] = "";

	for (field in FLAGS)
		state[field] = FLAGS[field].fallback;

	if (state.editable && relationship) {
		state.source = clone(relationship);
		state.mode = text(relationship.mode);
		state.thisServer = text(relationship["this-server-name"]);
		state.peers = array(relationship.peers).filter(isObject).map(makePeer);

		for (field in NUMBERS)
			state[field] = text(relationship[NUMBERS[field].key]);

		for (field in FLAGS)
			if (hasOwn(relationship, FLAGS[field].key))
				state[field] = relationship[FLAGS[field].key] === true;

		for (key in relationship)
			if (managed.indexOf(key) < 0)
				rest[key] = relationship[key];

		if (Object.keys(rest).length)
			state.advanced = JSON.stringify(rest, null, "\t");
	}

	state.initial = view(state);

	return state;
}

/* A new peer row gets the role the mode still lacks. */
function newPeer(state) {
	var row = makePeer(null);
	var rules = MODE_ROLES[state.mode];
	var has = function(role) {
		return activePeers(state).some(function(peer) {
			return peer.role === role;
		});
	};

	if (!has("primary"))
		row.role = "primary";
	else if (rules && rules.partner && !has(rules.partner))
		row.role = rules.partner;

	return row;
}

/* ---- checks ----------------------------------------------------------- */

/* The additional parameters as an object, or the reason they are not one. */
function parseAdvanced(value) {
	var managed = managedKeys();
	var parsed, i;

	if (value.trim() === "")
		return { value: {}, error: null };

	try {
		parsed = JSON.parse(value);
	}
	catch (err) {
		return { value: null, error: _("not valid JSON") + ": " + err.message };
	}

	if (!isObject(parsed))
		return { value: null, error: _("must be a JSON object such as { \"sync-page-limit\": 5000 }") };

	for (i = 0; i < managed.length; i++)
		if (hasOwn(parsed, managed[i]))
			return { value: null, error: _("this parameter has a field of its own above") + ": " + managed[i] };

	return { value: parsed, error: null };
}

/* TLS is configured for all peers, or for this one. */
function hasTls(state, row) {
	var advanced = parseAdvanced(state.advanced).value || {};

	return hasOwn(advanced, "trust-anchor") || !!(row.source && hasOwn(row.source, "trust-anchor"));
}

/* The message for one field of the form, or null. */
function fieldError(state, field) {
	if (field === "mode")
		return MODES.indexOf(state.mode) >= 0 ? null : _("not a mode Kea knows");

	if (field === "thisServer") {
		if (state.thisServer === "")
			return _("the name of this server is required");

		return activePeers(state).some(function(row) {
			return row.name === state.thisServer;
		}) ? null : _("no peer has this name");
	}

	if (hasOwn(NUMBERS, field))
		return /^\d*$/.test(state[field]) ? null : _("not a whole number");

	if (field === "advanced")
		return parseAdvanced(state.advanced).error;

	return null;
}

/* The message for one field of a peer row, or null. */
function peerError(state, row, field) {
	var rules = MODE_ROLES[state.mode];

	if (field === "name") {
		if (row.name === "")
			return _("a peer needs a name");

		return activePeers(state).filter(function(other) {
			return other.name === row.name;
		}).length > 1 ? _("another peer has the same name") : null;
	}

	if (field === "url")
		return checkUrl(row.url, hasTls(state, row));

	if (field === "role") {
		if (ROLES.indexOf(row.role) < 0)
			return _("not a role Kea knows");

		if (rules && rules.allowed.indexOf(row.role) < 0)
			return _("this role is not allowed in this mode");
	}

	return null;
}

/* What the mode requires of the list of peers as a whole. */
function roleErrors(state) {
	var rules = MODE_ROLES[state.mode];
	var errors = [];
	var count = function(role) {
		return activePeers(state).filter(function(row) {
			return row.role === role;
		}).length;
	};

	if (!rules)
		return errors;

	if (count("primary") !== 1)
		errors.push(_("exactly one peer must be the primary server"));

	if (rules.partner && count(rules.partner) !== 1)
		errors.push(rules.partner === "standby" ?
			_("hot standby needs exactly one standby server") :
			_("load balancing needs exactly one secondary server"));

	return errors;
}

function check(state) {
	var errors = [];
	var prefix = _("High availability") + ": ";
	var add = function(field, message, detail) {
		if (message)
			errors.push(prefix + LABELS[field] + ": " + message + (detail ? ": " + detail : ""));
	};
	var field;

	add("mode", fieldError(state, "mode"));
	add("thisServer", fieldError(state, "thisServer"));

	activePeers(state).forEach(function(row) {
		[ "name", "url", "role" ].forEach(function(name) {
			add("peers", peerError(state, row, name), row[name] || row.name || row.url);
		});
	});

	roleErrors(state).forEach(function(message) {
		add("peers", message);
	});

	for (field in NUMBERS)
		add(field, fieldError(state, field));

	add("advanced", fieldError(state, "advanced"));

	return errors;
}

/* ---- saving ----------------------------------------------------------- */

function buildRelationship(state) {
	var source = state.source || {};
	var initial = JSON.parse(state.initial);
	var advanced = parseAdvanced(state.advanced).value;
	var managed = managedKeys();
	var relationship = {};
	var key, field;

	/* Known keys keep their place; a key deleted from the JSON text goes. */
	for (key in source) {
		if (managed.indexOf(key) >= 0)
			relationship[key] = source[key];
		else if (hasOwn(advanced, key))
			relationship[key] = advanced[key];
	}

	relationship["this-server-name"] = state.thisServer;
	relationship.mode = state.mode;

	for (field in NUMBERS) {
		if (state.source && state[field] === initial[field])
			continue;

		if (state[field] === "")
			delete relationship[NUMBERS[field].key];
		else
			relationship[NUMBERS[field].key] = Number(state[field]);
	}

	/* A switch is written when it was moved, never to spell out a default. */
	for (field in FLAGS)
		if (state[field] !== initial[field])
			relationship[FLAGS[field].key] = state[field];

	for (key in advanced)
		if (!hasOwn(relationship, key))
			relationship[key] = advanced[key];

	relationship.peers = activePeers(state).map(function(row) {
		var peer = row.source ? clone(row.source) : {};

		peer.name = row.name;
		peer.url = row.url;
		peer.role = row.role;

		if (row.source ? row.autoFailover !== row.initial.autoFailover : !row.autoFailover)
			peer["auto-failover"] = row.autoFailover;

		return peer;
	});

	return relationship;
}

/*
 * Merge the form into the configuration. Returns { config }, the same
 * object when the tab was not touched, or { errors }.
 */
function apply(familyName, config, state, hooksDir) {
	var out, root, hooks, index, errors, entry;

	if (!state || !state.editable || !changed(state))
		return { config: config };

	out = isObject(config) ? clone(config) : {};

	if (!isObject(out[ROOTS[familyName]]))
		out[ROOTS[familyName]] = {};

	root = out[ROOTS[familyName]];
	hooks = array(root["hooks-libraries"]);
	index = findHook(hooks, HA_LIBRARY);

	if (!state.enabled) {
		if (index < 0)
			return { config: config };

		hooks.splice(index, 1);
	}
	else {
		errors = check(state);

		if (errors.length)
			return { errors: errors };

		if (index >= 0) {
			entry = hooks[index];

			if (!isObject(entry.parameters))
				entry.parameters = {};

			entry.parameters["high-availability"] = [ buildRelationship(state) ];
		}
		else {
			hooksDir = hooksDir || DEFAULT_HOOKS_DIR;

			/* The servers exchange leases with the commands of this hook. */
			if (findHook(hooks, LEASE_CMDS_LIBRARY) < 0)
				hooks.push({ library: hooksDir + "/" + LEASE_CMDS_LIBRARY });

			hooks.push({
				library: hooksDir + "/" + HA_LIBRARY,
				parameters: { "high-availability": [ buildRelationship(state) ] }
			});
		}
	}

	if (hooks.length)
		root["hooks-libraries"] = hooks;
	else
		delete root["hooks-libraries"];

	return { config: out };
}

return baseclass.extend({
	modes: MODES,
	roles: ROLES,

	label: function(field) {
		return LABELS[field];
	},

	/* The value Kea uses for a number field that is left empty. */
	fallback: function(field) {
		return NUMBERS[field].fallback;
	},

	numberFields: function() {
		return Object.keys(NUMBERS);
	},

	flagFields: function() {
		return Object.keys(FLAGS);
	},

	build: build,
	changed: changed,

	/* True once the list of peers has an entry that is not blank. */
	hasPeers: function(state) {
		return activePeers(state).length > 0;
	},

	newPeer: newPeer,
	fieldError: fieldError,
	peerError: peerError,
	roleErrors: roleErrors,
	apply: apply
});
