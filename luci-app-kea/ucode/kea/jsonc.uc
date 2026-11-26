// SPDX-License-Identifier: Apache-2.0

'use strict';

// Kea configuration files are JSON with "//", "#" and C-style comments.

const QUOTE = 34, HASH = 35, STAR = 42, SLASH = 47, BACKSLASH = 92, NEWLINE = 10;

// Return the text with all comments removed. Line comments leave their
// newline in place so that line numbers in parser errors stay correct.
export function strip_comments(text) {
	let out = [];
	let start = 0;
	let in_string = false;
	let escaped = false;
	let len = length(text);

	for (let i = 0; i < len; i++) {
		let ch = ord(text, i);

		if (in_string) {
			if (escaped)
				escaped = false;
			else if (ch == BACKSLASH)
				escaped = true;
			else if (ch == QUOTE)
				in_string = false;

			continue;
		}

		if (ch == QUOTE) {
			in_string = true;
		}
		else if (ch == HASH || (ch == SLASH && ord(text, i + 1) == SLASH)) {
			push(out, substr(text, start, i - start));

			while (i < len && ord(text, i) != NEWLINE)
				i++;

			start = i;
			i--;
		}
		else if (ch == SLASH && ord(text, i + 1) == STAR) {
			push(out, substr(text, start, i - start));
			i += 2;

			while (i < len && !(ord(text, i) == STAR && ord(text, i + 1) == SLASH))
				i++;

			i++;
			start = i + 1;
		}
	}

	if (start < len)
		push(out, substr(text, start));

	return join('', out);
};

const BLANKS = [ 32, 9, 13, NEWLINE ];

// The text of a configuration file as Kea's lexer splits it: a string as
// { string: true, start, end } ("end" is past its closing quote), a comment
// as { comment: true, start, end }, and every other character that is not
// a blank as { char, start }. Blanks are left out.
export function tokens(text) {
	let list = [];
	let len = length(text ?? '');

	for (let i = 0; i < len; i++) {
		let ch = ord(text, i);
		let start = i;

		if (ch == QUOTE) {
			i++;

			while (i < len && ord(text, i) != QUOTE)
				i += ord(text, i) == BACKSLASH ? 2 : 1;

			push(list, { string: true, start, end: min(i + 1, len) });
		}
		else if (ch == HASH || (ch == SLASH && ord(text, i + 1) == SLASH)) {
			while (i + 1 < len && ord(text, i + 1) != NEWLINE)
				i++;

			push(list, { comment: true, start, end: i + 1 });
		}
		else if (ch == SLASH && ord(text, i + 1) == STAR) {
			i += 2;

			while (i < len && !(ord(text, i) == STAR && ord(text, i + 1) == SLASH))
				i++;

			i = min(i + 1, len - 1);
			push(list, { comment: true, start, end: i + 1 });
		}
		else if (!(ch in BLANKS)) {
			push(list, { char: ch, start });
		}
	}

	return list;
};

// Parse a Kea configuration file. Returns { config, error }.
export function parse(text) {
	try {
		return { config: json(strip_comments(text ?? '')), error: null };
	}
	catch (e) {
		return { config: null, error: e.message };
	}
};

function stringify_value(value, indent) {
	let inner = indent + '\t';

	if (type(value) == 'array') {
		if (!length(value))
			return '[]';

		return '[\n' + join(',\n', map(value, item => inner + stringify_value(item, inner))) +
			'\n' + indent + ']';
	}

	if (type(value) == 'object') {
		if (!length(value))
			return '{}';

		return '{\n' + join(',\n', map(keys(value), key =>
			inner + sprintf('%J', key) + ': ' + stringify_value(value[key], inner))) +
			'\n' + indent + '}';
	}

	return sprintf('%J', value);
}

// Serialize a configuration the way the LuCI editors do
// (JSON.stringify(config, null, "\t") plus a final newline), so that a file
// keeps one layout whether the browser or the backend wrote it last.
export function stringify(value) {
	return stringify_value(value, '') + '\n';
};

// True when writing the parsed text back would drop comments.
export function has_comments(text) {
	return strip_comments(text ?? '') != (text ?? '');
};
