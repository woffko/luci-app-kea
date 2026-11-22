// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import * as jsonc from 'luci.kea.jsonc';

// Reading, validating, writing, backing up and restoring the Kea
// configuration files.
//
// Every function takes a context made by context(). Tests pass a context
// with a temporary root and, where no Kea binary is available, their own
// validator.

// "root" is the name of the top-level object of the file. "hooks" marks the
// daemons whose binary has the stricter check "-T". "dhcp" marks the DHCP
// daemons, which have settings their check does not look at; see
// warnings().
export const CONFIGS = {
	dhcp4: {
		file: 'kea-dhcp4.conf',
		binary: 'kea-dhcp4',
		title: 'DHCPv4 server',
		instance: 'dhcp4',
		root: 'Dhcp4',
		hooks: true,
		dhcp: true
	},
	dhcp6: {
		file: 'kea-dhcp6.conf',
		binary: 'kea-dhcp6',
		title: 'DHCPv6 server',
		instance: 'dhcp6',
		root: 'Dhcp6',
		hooks: true,
		dhcp: true
	},
	dhcp_ddns: {
		file: 'kea-dhcp-ddns.conf',
		binary: 'kea-dhcp-ddns',
		title: 'DHCP DDNS',
		instance: 'dhcp-ddns',
		root: 'DhcpDdns'
	},
	ctrl_agent: {
		file: 'kea-ctrl-agent.conf',
		binary: 'kea-ctrl-agent',
		title: 'Control Agent',
		instance: 'ctrl-agent',
		root: 'Control-agent'
	}
};

// Kea 3 keeps its lease files and its log files in fixed directories of
// its build. These are the ones of the OpenWrt packages.
export const LEASE_DIR = '/var/lib/kea';
export const LOG_DIR = '/var/log/kea';

export const CONFIG_ORDER = [ 'dhcp4', 'dhcp6', 'dhcp_ddns', 'ctrl_agent' ];

// options.root       prefix for /etc and /var paths (tests)
// options.run_dir    Kea runtime directory, created before validation
// options.sbin_dir   where the Kea binaries are
// options.uci_dir    UCI configuration directory (tests)
// options.uci_savedir  UCI delta directory (tests)
// options.service_list  function(name) -> reply of "ubus call service list"
//                    (tests)
// options.validator  function(name, path) -> { valid, output } replacing the
//                    Kea binary (tests)
// options.clock      function() -> epoch seconds (tests)
// options.log_reader function() -> text of the system log (tests)
// options.control    function(name, command) -> reply of the daemon on its
//                    control socket (tests)
export function context(options) {
	let root = options?.root ?? '';

	return {
		root,
		conf_dir: root + '/etc/kea',
		backup_dir: root + '/etc/kea/backups',
		backup_keep: 10,
		api_password: root + '/etc/kea/kea-api-password',
		lease_dir: root + '/var/lib/kea',
		init_dir: root + '/etc/init.d',
		run_dir: options?.run_dir ?? '/var/run/kea',
		sbin_dir: options?.sbin_dir ?? '/usr/sbin',
		hooks_dir: options?.hooks_dir ?? '/usr/lib/kea/hooks',
		// The only directory Kea 3 runs a script of the run_script hook from
		scripts_dir: options?.scripts_dir ?? '/usr/share/kea/scripts',
		// The script of kea-dnsmasq-hosts that the run_script hook calls
		dns_hosts_script: options?.dns_hosts_script ?? root + '/usr/share/kea/scripts/kea-dnsmasq-hosts',
		uci_dir: options?.uci_dir,
		uci_savedir: options?.uci_savedir,
		service_list: options?.service_list,
		validator: options?.validator,
		clock: options?.clock,
		log_reader: options?.log_reader,
		control: options?.control,
		service_event: options?.service_event,
		// How long a command of ha-cluster may take, in milliseconds
		cluster_timeout: options?.cluster_timeout ?? 15000,
		// Held while a Kea configuration file is changed; see locked()
		lock_file: options?.lock_file ?? root + '/var/lock/luci-app-kea.lock',
		lock_wait: options?.lock_wait ?? 10000
	};
};

export function shellquote(s) {
	return "'" + replace(s, "'", "'\\''") + "'";
};

export function is_file(path) {
	return fs.stat(path)?.type == 'file';
};

export function is_dir(path) {
	return fs.stat(path)?.type == 'directory';
};

// Create a directory and its missing parents.
export function mkdir_p(path, mode) {
	let current = '';

	for (let part in split(path, '/')) {
		if (part == '')
			continue;

		current += '/' + part;

		if (!is_dir(current) && !fs.mkdir(current, mode) && !is_dir(current))
			return false;
	}

	return true;
};

// Write a file that only root can read. Kea configs can hold secrets.
export function write_private(path, content) {
	let file = fs.open(path, 'w', 0o600);

	if (!file)
		return false;

	let written = file.write(content);

	file.close();
	fs.chmod(path, 0o600);

	return written == length(content);
};

export function path(ctx, name) {
	return CONFIGS[name] ? ctx.conf_dir + '/' + CONFIGS[name].file : null;
};

export function binary(ctx, name) {
	return CONFIGS[name] ? ctx.sbin_dir + '/' + CONFIGS[name].binary : null;
};

// The Kea binaries need their runtime directory even to check a file.
export function ensure_run_dir(ctx) {
	if (!is_dir(ctx.run_dir))
		mkdir_p(ctx.run_dir, 0o750);

	fs.chmod(ctx.run_dir, 0o750);
};

// The messages of the error lines in the output of a Kea binary, without
// their log prefix.
export function error_lines(output) {
	let lines = [];

	for (let line in split(output ?? '', '\n')) {
		let m = match(line, /^[0-9-]+ [0-9:.]+ +(ERROR|FATAL) +\[[^\]]*\] +(.+)$/);

		if (m && index(lines, m[2]) < 0)
			push(lines, m[2]);
	}

	return lines;
};

function run_check(bin, flag, file) {
	let pipe = fs.popen(shellquote(bin) + ' ' + flag + ' ' + shellquote(file) + ' 2>&1', 'r');

	if (!pipe)
		return null;

	let output = pipe.read('all') ?? '';
	let rc = pipe.close();

	return { valid: rc == 0, output: rtrim(output, '\n') };
}

// Check a config file with the Kea binary. Returns { valid, output }.
//
// The DHCP daemons are asked with "-T", which also loads the hook libraries
// and lets them check their parameters; "-t" does not look at hook
// parameters at all. The other daemons only know "-t".
export function validate_file(ctx, name, file) {
	if (!CONFIGS[name])
		return { valid: false, output: 'unknown config name' };

	if (ctx.validator)
		return ctx.validator(name, file);

	let bin = binary(ctx, name);

	if (!fs.access(bin, 'x'))
		return { valid: false, output: 'binary is not installed: ' + bin };

	if (!is_file(file))
		return { valid: false, output: 'config file does not exist: ' + file };

	ensure_run_dir(ctx);

	let check = CONFIGS[name].hooks ? run_check(bin, '-T', file) : null;

	// A binary that does not know "-T" answers with its usage text.
	if (!check || (!check.valid && match(check.output, /Usage: /) && !match(check.output, /-T file/)))
		check = run_check(bin, '-t', file);

	if (!check)
		return { valid: false, output: 'failed to run ' + bin };

	// A hook reports its own error and Kea then only says that a hook
	// failed to load, so the reason is not the last line. Put it first.
	let errors = check.valid ? [] : error_lines(check.output);

	if (length(errors))
		check.output = join('\n', errors) + '\n\n' + check.output;

	return check;
};

// ---- what the check of the Kea binary does not see -------------------------

// The top-level object of a configuration text, or null.
function root_of(name, content) {
	let parsed = jsonc.parse(content ?? '');
	let root = type(parsed.config) == 'object' ? parsed.config[CONFIGS[name]?.root] : null;

	return type(root) == 'object' ? root : null;
}

// The directory of a path as Kea takes it: the text before the last slash,
// unchanged. null for a name without a slash.
function directory(path) {
	let at = rindex(path, '/');

	return at < 0 ? null : substr(path, 0, at);
}

// The outputs of the loggers: [ { logger, output } ]. Kea 3.0 still reads
// the older spelling "output_options".
function logger_outputs(root) {
	let outputs = [];

	for (let logger in (type(root.loggers) == 'array' ? root.loggers : [])) {
		if (type(logger) != 'object')
			continue;

		let options = logger['output-options'] ?? logger['output_options'];

		for (let option in (type(options) == 'array' ? options : []))
			if (type(option) == 'object' && type(option.output) == 'string')
				push(outputs, { logger: `${logger.name ?? ''}`, output: option.output });
	}

	return outputs;
}

// The peers of every high availability relationship of a configuration:
// [ { name, url } ], from the parameters of the hook library.
function ha_peers(root) {
	let peers = [];

	for (let hook in (type(root['hooks-libraries']) == 'array' ? root['hooks-libraries'] : [])) {
		if (type(hook) != 'object' || !match(`${hook.library ?? ''}`, /(^|\/)libdhcp_ha\.so$/))
			continue;

		let relations = hook.parameters?.['high-availability'];

		for (let relation in (type(relations) == 'array' ? relations : []))
			for (let peer in (type(relation?.peers) == 'array' ? relation.peers : []))
				if (type(peer) == 'object' && type(peer.url) == 'string')
					push(peers, { name: `${peer.name ?? ''}`, url: peer.url });
	}

	return peers;
}

function log_kind(output) {
	if (output == 'syslog' || index(output, 'syslog:') == 0)
		return 'syslog';

	return output in [ 'stdout', 'stderr' ] ? 'console' : 'file';
}

// Settings that the check of the Kea binary accepts, also with "-T", and
// that keep the daemon from serving. Measured with Kea 3.0.4.
//
// With the effect "no-start", the daemon exits when it starts:
//
// - "lease-path": a lease file whose directory is not LEASE_DIR. Kea
//   compares the text before the last slash, so "/var/lib/kea//x" and a
//   subdirectory are refused as well. A name without a slash is placed in
//   LEASE_DIR. The name is not looked at when the leases are not written
//   ("persist").
// - "log-path": a log file whose directory is not LOG_DIR, by the same
//   comparison. The entry also names its logger.
//
// With the effect "no-listen", the daemon may run without listening:
//
// - "socket-retries": interfaces to listen on, and no retries for opening
//   the sockets. Kea opens its sockets once, when it starts. At boot it is
//   started while an interface may not be ready, then opens nothing, and
//   stays that way.
//
// With the effect "no-pair", the servers of a high availability pair
// cannot reach each other:
//
// - "ha-url-port": the URL of a peer without a port, or with port 0. The
//   hook takes it; a server then listens on a port chosen at random and
//   connects to port 0 of its partner. Both end up in the state
//   partner-down, each serving as if alone. The entry names the peer.
//
// Only the DHCP daemons are affected: kea-dhcp-ddns and kea-ctrl-agent
// refuse such a log file in their check and listen on no interface.
//
// Returns a list of { code, effect, value, ... }.
export function warnings(ctx, name, content) {
	let found = [];
	let root = CONFIGS[name]?.dhcp ? root_of(name, content) : null;

	if (!root)
		return found;

	let database = root['lease-database'];

	if (type(database) == 'object' && (database.type ?? 'memfile') == 'memfile' &&
	    database.persist !== false && type(database.name) == 'string') {
		let dir = directory(database.name);

		if (dir != null && (dir != LEASE_DIR || substr(database.name, -1) == '/'))
			push(found, {
				code: 'lease-path',
				effect: 'no-start',
				value: database.name,
				directory: LEASE_DIR
			});
	}

	for (let item in logger_outputs(root)) {
		let dir = log_kind(item.output) == 'file' ? directory(item.output) : null;

		if (dir != null && dir != LOG_DIR)
			push(found, {
				code: 'log-path',
				effect: 'no-start',
				value: item.output,
				logger: item.logger,
				directory: LOG_DIR
			});
	}

	for (let peer in ha_peers(root)) {
		let m = match(peer.url, /^[a-z]+:\/\/(\[[^\]]*\]|[^\/:]*)(:([0-9]*))?(\/.*)?$/);

		if (m && !(+m[3] > 0))
			push(found, { code: 'ha-url-port', effect: 'no-pair', value: peer.url, peer: peer.name });
	}

	let listen = root['interfaces-config'];

	if (type(listen) == 'object' && type(listen.interfaces) == 'array' && length(listen.interfaces) &&
	    !(+listen['service-sockets-max-retries'] > 0))
		push(found, {
			code: 'socket-retries',
			effect: 'no-listen',
			value: join(', ', map(listen.interfaces, entry => `${entry}`))
		});

	return found;
};

// The path of the control socket a daemon is configured with, or null.
// Kea takes one "control-socket" or a list "control-sockets"; a name
// without a directory is in its runtime directory.
export function control_socket(ctx, name, content) {
	let root = root_of(name, content);

	if (!root)
		return null;

	let entries = type(root['control-sockets']) == 'array' ?
		root['control-sockets'] : [ root['control-socket'] ];

	for (let entry in entries) {
		if (type(entry) != 'object' || (entry['socket-type'] ?? 'unix') != 'unix')
			continue;

		let path = entry['socket-name'];

		if (type(path) == 'string' && path != '')
			return index(path, '/') == 0 ? path : ctx.run_dir + '/' + path;
	}

	return null;
};

// Where the loggers of a configuration write, each output once:
// [ { output, kind, path, lost } ]. "kind" is "syslog", "console" (standard
// output or error, which procd passes on to the system log) or "file". A
// file has its "path"; "lost" says that it belongs in LOG_DIR and that
// directory does not exist, in which case Kea writes no log at all.
// Without loggers Kea writes to its standard output.
export function log_outputs(ctx, name, content) {
	let root = root_of(name, content);
	let result = [];
	let seen = {};

	if (!root)
		return result;

	let outputs = logger_outputs(root);

	if (!length(outputs))
		outputs = [ { output: 'stdout' } ];

	for (let item in outputs) {
		if (seen[item.output])
			continue;

		seen[item.output] = true;

		let kind = log_kind(item.output);
		let entry = { output: item.output, kind };

		if (kind == 'file') {
			let dir = directory(item.output);

			entry.path = dir == null ? LOG_DIR + '/' + item.output : item.output;
			entry.lost = (dir == null || dir == LOG_DIR) && !is_dir(ctx.root + LOG_DIR);
		}

		push(result, entry);
	}

	return result;
};

export function validate_all(ctx) {
	let result = {};

	for (let name in CONFIG_ORDER) {
		let file = path(ctx, name);
		let bin = binary(ctx, name);
		let installed = !!fs.access(bin, 'x');
		let exists = is_file(file);
		let check = (installed && exists) ?
			validate_file(ctx, name, file) :
			{ valid: false, output: 'binary or config file is missing' };

		result[name] = {
			config: file,
			installed,
			exists,
			valid: check.valid,
			output: check.output,
			warnings: check.valid ? warnings(ctx, name, fs.readfile(file)) : []
		};
	}

	return result;
};

export function list(ctx) {
	return map(CONFIG_ORDER, name => {
		let file = path(ctx, name);
		let st = fs.stat(file);

		return {
			name,
			title: CONFIGS[name].title,
			path: file,
			exists: st?.type == 'file',
			size: st?.type == 'file' ? st.size : 0
		};
	});
};

export function read(ctx, name) {
	if (!CONFIGS[name])
		return { result: false, error: 'invalid config name' };

	let file = path(ctx, name);

	if (!is_file(file))
		return { result: false, error: 'config file does not exist', path: file };

	let content = fs.readfile(file);

	if (content == null)
		return { result: false, error: 'failed to read the config file', path: file };

	let check = validate_file(ctx, name, file);

	return {
		result: true,
		name,
		path: file,
		content,
		valid: check.valid,
		validation: check.output,
		warnings: check.valid ? warnings(ctx, name, content) : []
	};
};

// ---- what a reader sees, and what a writer may write ------------------------

// The value that stands for a secret in what a user with read access gets.
export const MASK = '********';

// Members whose value is a secret: "password", "secret" and any name that
// ends in "-password" or "-secret" (the TSIG keys of kea-dhcp-ddns, the
// clients of the control agent, the peers of high availability, database
// connections). A name ending in "-file" is a path and stays.
function secret_member(name) {
	return match(name, /(^|-)(password|secret)$/) != null;
}

// A member with a string value in the text of a JSON file: its name, the
// space around the colon, and the value as written.
const STRING_MEMBER = /"([A-Za-z0-9_-]+)"([ \t\r\n]*):([ \t\r\n]*)"((\\.|[^"\\])*)"/g;

// The text of a configuration file with the value of every secret member
// replaced by MASK: { content, masked }, "masked" counting the values. The
// text keeps its comments and layout; only string values are replaced.
export function mask_secrets(content) {
	let masked = 0;
	let text = replace(`${content ?? ''}`, STRING_MEMBER, (all, name, before, after, value) => {
		if (!secret_member(name))
			return all;

		masked++;

		return sprintf('"%s"%s:%s"%s"', name, before, after, MASK);
	});

	return { content: text, masked };
};

// Whether a secret member of the text has MASK as its value.
function holds_mask(content) {
	let found = false;

	replace(content, STRING_MEMBER, (all, name, before, after, value) => {
		if (secret_member(name) && value == MASK)
			found = true;

		return all;
	});

	return found;
}

// What read() returns to a user who may read the Kea pages but not change
// them: the same, with the secrets masked.
export function read_masked(ctx, name) {
	let reply = read(ctx, name);

	if (reply.result) {
		let masked = mask_secrets(reply.content);

		reply.content = masked.content;
		reply.masked = masked.masked;
	}

	return reply;
};

// Why a text must not be written, or null. Checked before Kea sees the
// text, because Kea's own check runs as root and reports what it found:
//
// - An include directive makes Kea read another file, and its errors give
//   away what that file holds. Only a file directly in the configuration
//   directory, named *.json or *.conf, may be included; Kea's own files
//   there are readable through the pages anyway, its API password is not.
//   A link is refused wherever it points, also one that points nowhere.
// - The run_script hook looks at the file it is given before it checks the
//   directory, so its error says whether a path exists. Only a script in
//   ctx.scripts_dir is passed on.
// - A secret that a reader got masked must not be written back as MASK.
export function forbidden(ctx, name, content) {
	let at = 0;

	for (let start = index(content, '<?include'); start >= 0; start = index(substr(content, at), '<?include')) {
		start += at;

		let directive = match(substr(content, start), /^<\?include[ \t]+"([^"]*)"[ \t]*\?>/);
		let file = directive?.[1];

		if (!file)
			return 'an include directive that the application cannot read';

		let base = match(file, /^\/(.*)\/([A-Za-z0-9_][A-Za-z0-9._-]*\.(json|conf))$/);

		let kind = fs.lstat(file)?.type;

		if (!base || '/' + base[1] != ctx.conf_dir || (kind != null && kind != 'file'))
			return sprintf('the include of %s: only a *.json or *.conf file directly in %s can be included', file, ctx.conf_dir);

		at = start + length(directive[0]);
	}

	let parsed = jsonc.parse(content);
	let root = type(parsed.config) == 'object' ? parsed.config[CONFIGS[name]?.root] : null;

	if (parsed.error && index(content, 'libdhcp_run_script') >= 0)
		return 'the run_script hook in a file the application cannot read';

	for (let hook in (type(root?.['hooks-libraries']) == 'array' ? root['hooks-libraries'] : [])) {
		if (type(hook) != 'object' || !match(`${hook.library ?? ''}`, /(^|\/)libdhcp_run_script\.so$/))
			continue;

		let script = hook.parameters?.name;

		if (type(script) != 'string' || index(script, ctx.scripts_dir + '/') != 0 ||
		    match(script, /(^|\/)\.\.?(\/|$)/) || index(substr(script, length(ctx.scripts_dir) + 1), '/') >= 0)
			return sprintf('the script of the run_script hook: Kea runs scripts from %s only', ctx.scripts_dir);
	}

	if (holds_mask(content))
		return 'a secret in this text is masked; open the page with write access to change the file';

	return null;
};

// ---- backups ---------------------------------------------------------------
//
// Backups are <backup_dir>/<config basename>.<id>.conf. The id is a UTC
// timestamp; "_N" is appended when several backups fall into one second.

const BACKUP_ID = /^([0-9]{8}T[0-9]{6}Z)(_([0-9]+))?$/;

export function valid_backup_id(id) {
	return type(id) == 'string' && match(id, BACKUP_ID) != null;
};

function backup_base(name) {
	return replace(CONFIGS[name].file, /\.conf$/, '');
}

function backup_path(ctx, name, id) {
	return ctx.backup_dir + '/' + backup_base(name) + '.' + id + '.conf';
}

function timestamp(ctx) {
	let t = gmtime(ctx.clock ? ctx.clock() : time());

	return sprintf('%04d%02d%02dT%02d%02d%02dZ', t.year, t.mon, t.mday, t.hour, t.min, t.sec);
}

// Newest first: by timestamp, then by the sequence number within a second.
function newest_first(a, b) {
	let ma = match(a, BACKUP_ID);
	let mb = match(b, BACKUP_ID);

	if (ma[1] != mb[1])
		return ma[1] < mb[1] ? 1 : -1;

	return +(mb[3] ?? 1) - +(ma[3] ?? 1);
}

function backup_ids(ctx, name) {
	let prefix = backup_base(name) + '.';
	let ids = [];

	for (let entry in (fs.lsdir(ctx.backup_dir) ?? [])) {
		if (index(entry, prefix) != 0 || substr(entry, -5) != '.conf')
			continue;

		let id = substr(entry, length(prefix), length(entry) - length(prefix) - 5);

		if (valid_backup_id(id))
			push(ids, id);
	}

	return sort(ids, newest_first);
}

// Copy the current config file into the backup directory and drop the
// oldest backups beyond ctx.backup_keep. Returns the backup id, '' when
// there is no file to back up, or null on failure.
export function backup(ctx, name) {
	let file = path(ctx, name);

	if (!is_file(file))
		return '';

	let content = fs.readfile(file);

	if (content == null || !mkdir_p(ctx.backup_dir, 0o700))
		return null;

	fs.chmod(ctx.backup_dir, 0o700);

	// Continue the sequence of this second instead of taking the first free
	// number: pruning removes the low numbers, and reusing them would make
	// the newest backup sort as the oldest.
	let stamp = timestamp(ctx);
	let last = 0;

	for (let existing in backup_ids(ctx, name)) {
		let m = match(existing, BACKUP_ID);

		if (m[1] == stamp)
			last = max(last, +(m[3] ?? 1));
	}

	let id = last ? stamp + '_' + (last + 1) : stamp;

	if (!write_private(backup_path(ctx, name, id), content))
		return null;

	let ids = backup_ids(ctx, name);

	for (let i = ctx.backup_keep; i < length(ids); i++)
		fs.unlink(backup_path(ctx, name, ids[i]));

	return id;
};

export function list_backups(ctx, name) {
	if (!CONFIGS[name])
		return { result: false, error: 'invalid config name' };

	return {
		result: true,
		name,
		items: map(backup_ids(ctx, name), id => ({
			id,
			size: fs.stat(backup_path(ctx, name, id))?.size ?? 0
		}))
	};
};

// Validate content without touching the config file. Returns
// { valid, output }.
export function check(ctx, name, content) {
	if (!CONFIGS[name] || type(content) != 'string')
		return { valid: false, output: 'invalid config name or content' };

	let tmp = path(ctx, name) + '.luci-check';

	mkdir_p(ctx.conf_dir, 0o755);

	if (!write_private(tmp, content)) {
		fs.unlink(tmp);
		return { valid: false, output: 'failed to write temporary config' };
	}

	let result = validate_file(ctx, name, tmp);

	fs.unlink(tmp);

	return result;
};

// The lock around every change of a Kea configuration file.
//
// The files have two writers since the import command: the backend inside
// rpcd, which handles one call at a time, and that command, run from a
// shell by another package. Both read a file, change it, check it with the
// Kea binary and put it in place under the same temporary name, which
// takes a second or two; two at once would lose a change.
//
// locked() runs fn while it holds an exclusive lock on ctx.lock_file and
// returns what fn returns. A call from inside fn runs at once: the lock
// belongs to the process. It waits for another holder up to ctx.lock_wait
// milliseconds and then gives up without running fn. The lock is the
// kernel's (flock): it goes with the process that held it, also when that
// process dies.
let lock_depth = 0;

function run_locked(fn) {
	let result = null;
	let failure = null;

	lock_depth++;

	try {
		result = fn();
	}
	catch (e) {
		failure = e;
	}

	lock_depth--;

	if (failure)
		die(failure?.message ?? failure);

	return result;
}

export function locked(ctx, fn) {
	if (lock_depth > 0)
		return run_locked(fn);

	mkdir_p(fs.dirname(ctx.lock_file), 0o755);

	let handle = fs.open(ctx.lock_file, 'a');

	if (!handle)
		return { result: false, error: 'cannot open the lock file ' + ctx.lock_file };

	for (let waited = 0; !handle.lock('xn'); waited += 100) {
		if (waited >= ctx.lock_wait) {
			handle.close();
			return { result: false, error: 'another change of the Kea configuration is in progress' };
		}

		sleep(100);
	}

	let result = null;
	let failure = null;

	try {
		result = run_locked(fn);
	}
	catch (e) {
		failure = e;
	}

	handle.lock('u');
	handle.close();

	if (failure)
		die(failure?.message ?? failure);

	return result;
};

function save_unlocked(ctx, name, content) {
	if (!CONFIGS[name])
		return { result: false, error: 'invalid config name' };

	if (type(content) != 'string')
		return { result: false, error: 'invalid config content' };

	let refused = forbidden(ctx, name, content);

	if (refused)
		return { result: false, error: 'refused: ' + refused };

	let file = path(ctx, name);
	let tmp = file + '.luci-tmp';

	mkdir_p(ctx.conf_dir, 0o755);

	if (!write_private(tmp, content)) {
		fs.unlink(tmp);
		return { result: false, error: 'failed to write temporary config' };
	}

	let check = validate_file(ctx, name, tmp);

	if (!check.valid) {
		fs.unlink(tmp);
		return { result: false, error: 'validation failed', validation: check.output };
	}

	let id = backup(ctx, name);

	if (id == null) {
		fs.unlink(tmp);
		return { result: false, error: 'failed to back up the current config' };
	}

	if (!fs.rename(tmp, file)) {
		fs.unlink(tmp);
		return { result: false, error: 'failed to replace config' };
	}

	return {
		result: true,
		path: file,
		backup: id,
		validation: check.output,
		warnings: warnings(ctx, name, content)
	};
}

// Validate new content, back up the current file and replace it. The file
// is never replaced by content the Kea binary rejects.
export function save(ctx, name, content) {
	return locked(ctx, () => save_unlocked(ctx, name, content));
};

function restore_unlocked(ctx, name, id) {
	if (!CONFIGS[name])
		return { result: false, error: 'invalid config name' };

	if (!valid_backup_id(id))
		return { result: false, error: 'invalid backup id' };

	let source = backup_path(ctx, name, id);

	if (!is_file(source))
		return { result: false, error: 'backup does not exist' };

	let content = fs.readfile(source);

	if (content == null)
		return { result: false, error: 'failed to read the backup' };

	// save() validates the content and backs up the current file first, so
	// a restore can itself be undone.
	let saved = save(ctx, name, content);

	if (!saved.result) {
		if (saved.error == 'validation failed')
			saved.error = 'backup failed validation';

		return saved;
	}

	return {
		result: true,
		path: saved.path,
		restored: id,
		backup: saved.backup,
		warnings: saved.warnings
	};
}

export function restore(ctx, name, id) {
	return locked(ctx, () => restore_unlocked(ctx, name, id));
};
