"use strict";
"require rpc";
"require view";
"require ui";

var callConfigList = rpc.declare({
	object: "luci.kea",
	method: "getConfigList",
	expect: { configs: {} }
});

var callGetConfig = rpc.declare({
	object: "luci.kea",
	method: "getConfig",
	params: [ "name" ],
	expect: { "": {} }
});

var callSaveConfig = rpc.declare({
	object: "luci.kea",
	method: "saveConfig",
	params: [ "name", "content" ],
	expect: { "": {} }
});

function configTitle(item) {
	return "%s (%s)".format(item.title || item.name, item.name);
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

		return callGetConfig(name).then(function(config) {
			if (!config || !config.result) {
				ui.addNotification(null, E("p", config && config.error ?
					config.error : _("Failed to load Kea config.")), "danger");
				return;
			}

			self.currentConfig = config;
			self.renderLoadedConfig();
		});
	},

	saveConfig: function() {
		var self = this;
		var textarea = document.querySelector("#kea-config-content");

		if (!self.currentName || !textarea)
			return Promise.resolve();

		return callSaveConfig(self.currentName, textarea.value).then(function(result) {
			if (!result || !result.result) {
				ui.addNotification(null, E("p", [
					result && result.error ? result.error : _("Failed to save Kea config."),
					result && result.validation ? E("pre", {
						"style": "white-space: pre-wrap; max-height: 18rem; overflow: auto"
					}, result.validation) : ""
				]), "danger");
				return;
			}

			ui.addNotification(null, E("p", _("Kea config saved.")), "info");
			return self.loadConfig(self.currentName);
		});
	},

	renderLoadedConfig: function() {
		var container = document.querySelector("#kea-config-editor");
		var config = this.currentConfig || {};
		var self = this;

		if (!container)
			return;

		container.replaceChildren(E("div", {}, [
			E("div", { "class": "cbi-section" }, [
				E("h3", config.path || this.currentName),
				E("textarea", {
					"id": "kea-config-content",
					"style": "width: 100%; min-height: 34rem; font-family: monospace"
				}, config.content || "")
			]),
			renderValidation(config),
			E("div", { "class": "cbi-page-actions" }, [
				E("button", {
					"class": "btn cbi-button cbi-button-apply",
					"click": function() { return self.saveConfig(); }
				}, _("Save")),
				" ",
				E("button", {
					"class": "btn cbi-button cbi-button-reload",
					"click": function() { return self.loadConfig(self.currentName); }
				}, _("Reload"))
			])
		]));
	},

	render: function(configs) {
		var self = this;
		var items = configs.items || [];
		var selector = E("select", {
			"class": "cbi-input-select",
			"change": function(ev) {
				self.currentName = ev.target.value;
				return self.loadConfig(self.currentName);
			}
		}, items.map(function(item) {
			return E("option", { "value": item.name }, configTitle(item));
		}));

		if (items.length)
			this.currentName = items[0].name;

		window.setTimeout(function() {
			if (self.currentName)
				self.loadConfig(self.currentName);
		}, 0);

		return E("div", {}, [
			E("h2", _("Kea Configuration")),
			E("div", { "class": "cbi-section" }, [
				E("div", { "class": "cbi-value" }, [
					E("label", { "class": "cbi-value-title" }, _("Config")),
					E("div", { "class": "cbi-value-field" }, selector)
				])
			]),
			E("div", { "id": "kea-config-editor" }, items.length ?
				E("div", { "class": "spinning" }, _("Loading...")) :
				E("div", { "class": "cbi-section" }, _("No Kea config files were found.")))
		]);
	}
});
