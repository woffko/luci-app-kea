// ESLint configuration for the JavaScript in this repository.
//
// The block for htdocs/ repeats the JavaScript rules of eslint.config.mjs in
// openwrt/luci, so that the views pass the same checks there. Keep the two
// in step when LuCI changes its configuration.

import js from '@eslint/js';
import globals from 'globals';

export default [
	{
		ignores: [ 'node_modules/' ]
	},
	{
		files: [ 'htdocs/**/*.js' ],
		linterOptions: {
			reportUnusedDisableDirectives: 'off'
		},
		languageOptions: {
			sourceType: 'script',
			ecmaVersion: 2026,
			globals: {
				...globals.browser,
				/* LuCI runtime */
				_: 'readonly',
				N_: 'readonly',
				L: 'readonly',
				E: 'readonly',
				/* LuCI modules named in "require" directives */
				baseclass: 'readonly',
				rpc: 'readonly',
				ui: 'readonly',
				view: 'readonly',
				/* modules of this application */
				backend: 'readonly',
				editor: 'readonly',
				model: 'readonly'
			},
			parserOptions: {
				ecmaFeatures: {
					globalReturn: true
				}
			}
		},
		rules: {
			...js.configs.recommended.rules,
			'strict': 0,
			'no-prototype-builtins': 0,
			'no-empty': 0,
			'no-undef': 'warn',
			'no-unused-vars': [ 'off', { caughtErrors: 'none' } ],
			'no-regex-spaces': 0,
			'no-control-regex': 0
		}
	},
	{
		/* Tests and tooling run under Node.js. */
		files: [ 'test/**/*.js' ],
		languageOptions: {
			sourceType: 'commonjs',
			ecmaVersion: 2026,
			globals: {
				...globals.node,
				/* evaluated inside the page by Playwright */
				document: 'readonly'
			}
		},
		rules: {
			...js.configs.recommended.rules
		}
	}
];
