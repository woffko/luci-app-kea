'use strict';

// The runtime view against the real system: the Kea binaries and the
// system log of OpenWrt.

import { test, equal, ok, done } from '../lib.uc';
import * as config from 'luci.kea.config';
import * as runtime from 'luci.kea.runtime';
import * as service from 'luci.kea.service';

const ctx = config.context();

test('the installed Kea tells its version', () => {
	let version = runtime.version(ctx);

	ok(match(version, /^[0-9]+\.[0-9]+\.[0-9]+/), `version: ${version}`);
	equal(service.status(ctx).version, version);
});

test('the system log is read and the Kea messages are found in it', () => {
	// Leave a message of our own, so that the test does not depend on a
	// daemon having run.
	system([ 'logger', '-t', 'kea-dhcp4', 'INFO  [kea-dhcp4.test.1] LUCI_APP_KEA_TEST message for the runtime test' ]);

	let reply = runtime.log(ctx, 5);
	let last = reply.lines[length(reply.lines) - 1];

	equal(last?.daemon, 'kea-dhcp4');
	equal(last?.severity, 'INFO');
	equal(last?.text, 'LUCI_APP_KEA_TEST message for the runtime test');

	equal(reply.result, true);
	equal(type(reply.lines), 'array');
	ok(length(reply.lines) <= 5);

	for (let line in reply.lines)
		ok(match(line.daemon, /^kea-/), `daemon: ${line.daemon}`);
});

test('the lease files of the system are found where Kea keeps them', () => {
	let reply = runtime.leases(ctx);

	equal(type(reply.time), 'int');

	for (let family in [ 'dhcp4', 'dhcp6' ]) {
		equal(type(reply[family].items), 'array', family);
		equal(type(reply[family].exists), 'bool', family);
		ok(match(reply[family].file, /^\/var\/lib\/kea\//), reply[family].file);
	}
});

done();
