'use strict';

import * as fs from 'fs';
import { test, equal, ok, fixture, done } from './lib.uc';
import { strip_comments, parse } from 'luci.kea.jsonc';

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

done();
