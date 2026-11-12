"use strict";
"require rpc";
"require view";
"require ui";
"require kea.backend as backend";
"require kea.model as model";
"require kea.dialogs as dialogs";

var callConfigList = rpc.declare({
	object: "luci.kea",
	method: "getConfigList",
	expect: { configs: {} }
});

function configTitle(item) {
	return (item.title || item.name) + " (" + item.name + ")";
}

/* "20261111T184300Z_2" -> "2026-11-11 18:43:00 UTC (2)" */
function backupLabel(backup) {
	var match = String(backup.id).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:_(\d+))?$/);
	var label = match ?
		match[1] + "-" + match[2] + "-" + match[3] + " " + match[4] + ":" + match[5] + ":" + match[6] + " UTC" +
			(match[7] ? " (" + match[7] + ")" : "") :
		String(backup.id);

	return label + ", " + backup.size + " " + _("bytes");
}

/*
 * The message of a JSON syntax error in the text, or null. Kea reads more
 * than JSON: a file that uses its include directive is left to Kea itself.
 */
function syntaxError(content) {
	if (/<\?include\b/.test(content))
		return null;

	return model.parseConfig(content).error;
}

function renderValidation(config) {
	var valid = config.valid === true;

	return E("div", { "class": "cbi-section" }, [
		E("h3", _("Validation")),
		E("div", {
			"class": valid ? "alert-message success" : "alert-message warning"
		}, valid ? _("Valid") : _("Invalid")),
		config.validation ? E("pre", {
			"style": "white-space: pre-wrap; max-height: 18rem; overflow: auto"
		}, config.validation) : ""
	]);
}

return view.extend({
	load: function() {
		return L.resolveDefault(callConfigList(), {});
	},

	loadConfig: function(name) {
		var self = this;
		var request = this.request = (this.request || 0) + 1;

		return Promise.all([
			backend.getConfig(name),
			backend.listBackups(name)
		]).then(function(data) {
			var config = data[0];

			/* A newer request was started while this one was in flight. */
			if (request !== self.request)
				return;

			if (!config || !config.result) {
				backend.notifyFailure(config, _("Failed to load Kea config."));
				return;
			}

			self.currentName = name;
			self.currentConfig = config;
			self.backups = data[1];
			self.renderEditor();
		});
	},

	save: function(apply) {
		var self = this;
		var name = this.currentName;
		var error;

		if (!name || !this.textarea)
			return Promise.resolve();

		if (this.textarea.value === this.currentConfig.content) {
			backend.notify(_("There are no changes to save."));
			return Promise.resolve();
		}

		/* Catch a typo here, before the file goes to the router to be checked by Kea. */
		error = syntaxError(this.textarea.value);

		if (error) {
			ui.addNotification(null, E("p", _("The text is not valid JSON, nothing was saved") + ": " + error), "danger");
			return Promise.resolve();
		}

		return backend.saveConfig(name, this.textarea.value).then(function(saved) {
			if (!saved)
				return;

			if (apply)
				return backend.applyConfig(name);

			backend.notify(backend.daemonName(name) + ": " +
				_("configuration saved. Reload or restart Kea to apply it."));
		}).then(function() {
			return self.loadConfig(name);
		});
	},

	restore: function(id) {
		var self = this;
		var name = this.currentName;

		dialogs.confirm(_("Restore backup"),
			_("Replace the current file with the selected backup? The current file is backed up first, and unsaved changes in the editor are discarded."),
			_("Restore"),
			function() {
				return backend.restoreBackup(name, id).then(function(restored) {
					if (restored)
						backend.notify(backend.daemonName(name) + ": " +
							_("backup restored. Reload or restart Kea to apply it."));

					return self.loadConfig(name);
				});
			});
	},

	renderBackups: function() {
		var self = this;
		var backups = this.backups || [];
		var select;

		if (!backups.length)
			return E("div", { "class": "cbi-section" }, [
				E("h3", _("Backups")),
				E("p", _("No backups yet. A backup is made each time this file is changed from LuCI."))
			]);

		select = E("select", {
			"class": "cbi-input-select",
			"style": "min-width: 24em"
		}, backups.map(function(backup) {
			return E("option", { "value": backup.id }, backupLabel(backup));
		}));

		return E("div", { "class": "cbi-section" }, [
			E("h3", _("Backups")),
			E("div", { "class": "cbi-section-descr" },
				_("A backup is made each time this file is changed from LuCI. The newest ten are kept.")),
			E("div", { "class": "cbi-value" }, [
				E("label", { "class": "cbi-value-title" }, _("Backup")),
				E("div", { "class": "cbi-value-field" }, [
					select,
					" ",
					E("button", {
						"class": "btn cbi-button cbi-button-action",
						"click": function(ev) {
							ev.preventDefault();
							self.restore(select.value);
						}
					}, _("Restore"))
				])
			])
		]);
	},

	/* Tell the user about a JSON syntax error while they type. */
	renderSyntax: function() {
		var error = syntaxError(this.textarea.value);

		this.textarea.classList.toggle("cbi-input-invalid", !!error);
		this.syntaxNode.replaceChildren(error ?
			E("div", { "class": "alert-message warning" }, _("JSON syntax error") + ": " + error) : "");
	},

	renderEditor: function() {
		var self = this;
		var config = this.currentConfig || {};

		this.syntaxNode = E("div", { "class": "kea-syntax" });
		this.textarea = E("textarea", {
			"style": "width: 100%; min-height: 34rem; font-family: monospace",
			"spellcheck": "false",
			"input": function() {
				self.renderSyntax();
			}
		}, config.content || "");

		this.editorNode.replaceChildren(
			E("div", { "class": "cbi-section" }, [
				E("h3", config.path || this.currentName),
				this.textarea,
				this.syntaxNode,
				E("div", { "class": "right", "style": "margin-top: .5rem" }, E("button", {
					"class": "btn cbi-button",
					"click": function(ev) {
						ev.preventDefault();
						dialogs.showChanges(model.lineDiff(self.currentConfig.content, self.textarea.value));
					}
				}, _("Show changes")))
			]),
			renderValidation(config),
			this.renderBackups()
		);
	},

	handleSave: function(ev) {
		return this.save(false);
	},

	handleSaveApply: function(ev, mode) {
		return this.save(true);
	},

	handleReset: function(ev) {
		return this.currentName ? this.loadConfig(this.currentName) : Promise.resolve();
	},

	render: function(configs) {
		var self = this;
		var items = configs.items || [];
		var selector = E("select", {
			"class": "cbi-input-select",
			"change": function(ev) {
				return self.loadConfig(ev.target.value);
			}
		}, items.map(function(item) {
			return E("option", { "value": item.name }, configTitle(item));
		}));

		this.editorNode = E("div", {}, items.length ?
			E("div", { "class": "spinning" }, _("Loading...")) :
			E("div", { "class": "cbi-section" }, _("No Kea config files were found.")));

		if (items.length)
			this.loadConfig(items[0].name);

		return E("div", {}, [
			E("h2", _("Kea Configuration")),
			E("div", { "class": "cbi-section" }, [
				E("div", { "class": "cbi-value" }, [
					E("label", { "class": "cbi-value-title" }, _("Config")),
					E("div", { "class": "cbi-value-field" }, selector)
				])
			]),
			this.editorNode
		]);
	}
});
