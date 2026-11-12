// Minimal test helpers for the ucode tests. No dependencies beyond "fs".

'use strict';

import * as fs from 'fs';

let count = 0;
let failed = 0;

export function deep_equal(a, b) {
	if (type(a) != type(b))
		return false;

	if (type(a) == 'array') {
		if (length(a) != length(b))
			return false;

		for (let i = 0; i < length(a); i++)
			if (!deep_equal(a[i], b[i]))
				return false;

		return true;
	}

	if (type(a) == 'object') {
		if (length(a) != length(b))
			return false;

		for (let key in a)
			if (!(key in b) || !deep_equal(a[key], b[key]))
				return false;

		return true;
	}

	return a == b;
};

export function equal(actual, expected, label) {
	if (!deep_equal(actual, expected))
		die(sprintf('%s\n    expected: %J\n    actual:   %J', label ?? 'values differ', expected, actual));
};

export function ok(value, label) {
	if (!value)
		die(label ?? 'expected a true value');
};

export function test(name, fn) {
	count++;

	try {
		fn();
		print(`ok ${count} - ${name}\n`);
	}
	catch (e) {
		failed++;
		print(`not ok ${count} - ${name}\n    ${e.message}\n`);
	}
};

// Print the summary and exit non-zero if a test failed.
export function done() {
	print(`# ${count - failed} of ${count} passed\n`);
	exit(failed ? 1 : 0);
};

export function tmpdir() {
	return fs.mkdtemp('/tmp/kea-test-XXXXXX');
};

export function rm_rf(path) {
	if (fs.lstat(path)?.type == 'directory') {
		for (let entry in fs.lsdir(path))
			rm_rf(path + '/' + entry);

		fs.rmdir(path);
	}
	else {
		fs.unlink(path);
	}
};

export function fixture(name) {
	return sourcepath(0, true) + '/../fixtures/' + name;
};

// "-rw-------" style permission bits of a path, as an octal string.
export function mode(path) {
	let perm = fs.stat(path)?.perm;

	if (!perm)
		return null;

	let digit = (r, w, x) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0);

	return '' + digit(perm.user_read, perm.user_write, perm.user_exec) +
		digit(perm.group_read, perm.group_write, perm.group_exec) +
		digit(perm.other_read, perm.other_write, perm.other_exec);
};
