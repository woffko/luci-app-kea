'use strict';

import * as fs from 'fs';
import { test, equal, ok, fixture, done } from './lib.uc';
import { strip_comments, parse, stringify, has_comments } from 'luci.kea.jsonc';

test('line comments are removed and their newline is kept', () => {
	equal(strip_comments("{ // one\n\"a\": 1 # two\n}"), "{ \n\"a\": 1 \n}");
});

test('block comments are removed', () => {
	equal(strip_comments('{ /* x\n y */ "a": 1 }'), '{  "a": 1 }');
	equal(strip_comments('{ "a": 1 } /* unterminated'), '{ "a": 1 } ');
});

test('comment markers inside strings are kept', () => {
	let text = '{ "a": "http://x/#y /* z */", "b": "q\\"//" }';

	equal(strip_comments(text), text);
});

test('text without comments is returned unchanged, including non-ASCII', () => {
	let text = "{ \"name\": \"кабинет\" }\n";

	equal(strip_comments(text), text);
	equal(strip_comments(''), '');
});

test('parse returns the configuration or the parser error', () => {
	equal(parse("// c\n{ \"Dhcp4\": { \"valid-lifetime\": 60 } }\n"),
		{ config: { Dhcp4: { 'valid-lifetime': 60 } }, error: null });

	let bad = parse('{ "Dhcp4": ');

	equal(bad.config, null);
	ok(bad.error, 'a parser error is reported');
});

test('the DHCPv4 fixture with all three comment styles parses', () => {
	let parsed = parse(fs.readfile(fixture('kea-dhcp4-rich.conf')));

	equal(parsed.error, null);
	equal(length(parsed.config.Dhcp4.subnet4), 2);
	equal(parsed.config.Dhcp4.subnet4[1].pools, [ { pool: '10.10.1.0/24' } ]);
});

test('stringify writes the layout of JSON.stringify(value, null, "\\t")', () => {
	equal(stringify({
		Dhcp4: {
			'valid-lifetime': 3600,
			'cache-threshold': 0.25,
			authoritative: true,
			nothing: null,
			empty: {},
			interfaces: [],
			subnet4: [ { id: 1, subnet: '192.168.1.0/24', note: 'a "quoted" path\\/' } ]
		}
	}),
		'{\n' +
		'\t"Dhcp4": {\n' +
		'\t\t"valid-lifetime": 3600,\n' +
		'\t\t"cache-threshold": 0.25,\n' +
		'\t\t"authoritative": true,\n' +
		'\t\t"nothing": null,\n' +
		'\t\t"empty": {},\n' +
		'\t\t"interfaces": [],\n' +
		'\t\t"subnet4": [\n' +
		'\t\t\t{\n' +
		'\t\t\t\t"id": 1,\n' +
		'\t\t\t\t"subnet": "192.168.1.0/24",\n' +
		'\t\t\t\t"note": "a \\"quoted\\" path\\\\/"\n' +
		'\t\t\t}\n' +
		'\t\t]\n' +
		'\t}\n' +
		'}\n');
	equal(stringify([]), '[]\n');
});

test('stringify and parse round-trip the fixtures', () => {
	for (let name in [ 'kea-dhcp4-rich.conf', 'kea-dhcp6-rich.conf' ]) {
		let conf = parse(fs.readfile(fixture(name))).config;

		equal(parse(stringify(conf)).config, conf, name);
	}
});

test('has_comments tells whether a rewrite would drop comments', () => {
	equal(has_comments('{ "a": 1 } // note'), true);
	equal(has_comments('{ "a": "# not a comment" }'), false);
	equal(has_comments(fs.readfile(fixture('kea-dhcp4-rich.conf'))), true);
	equal(has_comments(null), false);
});

done();
