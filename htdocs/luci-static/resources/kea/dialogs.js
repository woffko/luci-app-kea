"use strict";
"require baseclass";
"require ui";

/*
 * Dialogs shared by the Kea pages: a confirmation, and a view of what a
 * save would change.
 */

var DIFF_STYLE = {
	"-": "background: #f8e8e8; color: #7a1f1f",
	"+": "background: #e8f6e8; color: #1f7a1f",
	"@": "color: #888",
	" ": ""
};

return baseclass.extend({
	/* Ask before doing something; "kind" styles the confirming button. */
	confirm: function(title, message, confirmLabel, action, kind) {
		ui.showModal(title, [
			E("p", message),
			E("div", { "class": "right" }, [
				E("button", { "class": "btn", "click": ui.hideModal }, _("Cancel")),
				" ",
				E("button", {
					"class": "btn " + (kind === "positive" ? "cbi-button-positive" : "cbi-button-negative") + " important",
					"click": function() {
						ui.hideModal();

						return action();
					}
				}, confirmLabel)
			])
		]);
	},

	/*
	 * Show the lines a save would change. "lines" is the result of
	 * model.lineDiff(); "note" is an optional remark shown above them.
	 */
	showChanges: function(lines, note) {
		var body = lines.length ?
			E("pre", {
				"class": "kea-changes",
				"style": "max-height: 28rem; overflow: auto; white-space: pre-wrap; tab-size: 2"
			}, lines.map(function(line) {
				return E("div", { "style": DIFF_STYLE[line.op] },
					line.op === "@" ? "…" : line.op + " " + line.text);
			})) :
			E("p", { "class": "kea-changes" }, _("There are no changes."));

		ui.showModal(_("Changes"), [
			note ? E("p", note) : "",
			body,
			E("div", { "class": "right" }, [
				E("button", { "class": "btn", "click": ui.hideModal }, _("Close"))
			])
		]);
	}
});
