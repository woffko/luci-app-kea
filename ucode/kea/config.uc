// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';

// Reading, validating, writing, backing up and restoring the Kea
// configuration files.
//
// Every function takes a context made by context(). Tests pass a context
// with a temporary root and, where no Kea binary is available, their own
// validator.

// "hooks" marks the daemons whose binary has the stricter check "-T".
export const CONFIGS = {
	dhcp4: {
		file: 'kea-dhcp4.conf',
		binary: 'kea-dhcp4',
		title: 'DHCPv4 server',
		instance: 'dhcp4',
		hooks: true
	},
	dhcp6: {
		file: 'kea-dhcp6.conf',
		binary: 'kea-dhcp6',
		title: 'DHCPv6 server',
		instance: 'dhcp6',
		hooks: true
	},
	dhcp_ddns: {
		file: 'kea-dhcp-ddns.conf',
		binary: 'kea-dhcp-ddns',
		title: 'DHCP DDNS',
		instance: 'dhcp-ddns'
	},
	ctrl_agent: {
		file: 'kea-ctrl-agent.conf',
		binary: 'kea-ctrl-agent',
		title: 'Control Agent',
		instance: 'ctrl-agent'
	}
};

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
		uci_dir: options?.uci_dir,
		uci_savedir: options?.uci_savedir,
		service_list: options?.service_list,
		validator: options?.validator,
		clock: options?.clock
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
			output: check.output
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
		validation: check.output
	};
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

// Validate new content, back up the current file and replace it. The file
// is never replaced by content the Kea binary rejects.
export function save(ctx, name, content) {
	if (!CONFIGS[name])
		return { result: false, error: 'invalid config name' };

	if (type(content) != 'string')
		return { result: false, error: 'invalid config content' };

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

	return { result: true, path: file, backup: id, validation: check.output };
};

export function restore(ctx, name, id) {
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

	return { result: true, path: saved.path, restored: id, backup: saved.backup };
};
