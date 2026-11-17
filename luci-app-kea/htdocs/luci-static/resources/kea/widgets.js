"use strict";
"require baseclass";

/*
 * Form elements shared by the editor tabs. Each input is bound to a key of
 * a plain object of the model and writes what the user types straight into
 * it.
 */

function field(label, child, description) {
	return E("div", { "class": "cbi-value" }, [
		E("label", { "class": "cbi-value-title" }, label),
		E("div", { "class": "cbi-value-field" }, [
			child,
			description ? E("div", { "class": "cbi-value-description" }, description) : ""
		])
	]);
}

/* Mark an input as wrong, with the reason as its tooltip, or clear the mark. */
function mark(node, message) {
	node.classList.toggle("cbi-input-invalid", !!message);
	node.title = message || "";
}

/*
 * Text input bound to object[key]. "check" returns a message while the
 * value is wrong; it runs when the user types, not on values as loaded.
 */
function textInput(object, key, placeholder, type, check) {
	return E("input", {
		"class": "cbi-input-text",
		"type": type || "text",
		"min": type === "number" ? "0" : null,
		"value": object[key],
		"placeholder": placeholder || "",
		"input": function(ev) {
			object[key] = ev.target.value.trim();

			if (check)
				mark(ev.target, check());
		}
	});
}

function checkbox(object, key, onChange) {
	return E("input", {
		"type": "checkbox",
		"checked": object[key] ? "checked" : null,
		"change": function(ev) {
			object[key] = ev.target.checked;

			if (onChange)
				onChange();
		}
	});
}

function notice(kind, children) {
	return E("div", { "class": "alert-message " + kind }, children);
}

function deleteButton(onClick) {
	return E("button", {
		"class": "btn cbi-button cbi-button-remove",
		"click": function(ev) {
			ev.preventDefault();
			onClick();
		}
	}, _("Delete"));
}

/*
 * A table of editable rows with an "add" button. "renderRow" returns the
 * cells of one row; the delete cell is added here. "changed", if given, is
 * called after a row was added or deleted.
 */
function rowTable(options) {
	var body = E("tbody", {});
	var draw = function() {
		var rows = options.rows.map(function(row) {
			return E("tr", { "class": "tr" }, options.renderRow(row).map(function(cell) {
				return E("td", { "class": "td left" }, cell);
			}).concat([ E("td", { "class": "td right" }, deleteButton(function() {
				options.rows.splice(options.rows.indexOf(row), 1);
				draw();

				if (options.changed)
					options.changed();
			})) ]));
		});

		if (!rows.length)
			rows = [ E("tr", { "class": "tr" }, E("td", {
				"class": "td left",
				"colspan": String(options.titles.length + 1)
			}, options.empty)) ];

		body.replaceChildren.apply(body, rows);
	};

	draw();

	return E("div", { "class": "cbi-section" }, [
		E("h3", options.title),
		options.description ? E("div", { "class": "cbi-section-descr" }, options.description) : "",
		E("table", { "class": "table " + options.name }, [
			E("thead", {}, E("tr", { "class": "tr table-titles" }, options.titles.concat([ "" ]).map(function(title) {
				return E("th", { "class": "th left" }, title);
			}))),
			body
		]),
		E("div", { "class": "cbi-section-create" }, E("button", {
			"class": "btn cbi-button cbi-button-add",
			"click": function(ev) {
				ev.preventDefault();
				options.rows.push(options.create());
				draw();

				if (options.changed)
					options.changed();
			}
		}, options.add))
	]);
}

/* A drop-down bound to object[key]; "choices" is a list of [ value, label ]. */
function select(object, key, choices, onChange) {
	var known = choices.some(function(choice) {
		return choice[0] === object[key];
	});

	/* A value from the file that is not among the choices stays selectable. */
	if (!known && object[key] !== "")
		choices = choices.concat([ [ object[key], object[key] ] ]);

	return E("select", {
		"class": "cbi-input-select",
		"change": function(ev) {
			object[key] = ev.target.value;

			if (onChange)
				onChange();
		}
	}, choices.map(function(choice) {
		return E("option", {
			"value": choice[0],
			"selected": object[key] === choice[0] ? "selected" : null
		}, choice[1]);
	}));
}

/* A multi-line text bound to object[key], for JSON. */
function textArea(object, key, placeholder, check) {
	return E("textarea", {
		"class": "cbi-input-textarea",
		"style": "width: 100%; min-height: 9rem; font-family: monospace",
		"spellcheck": "false",
		"placeholder": placeholder || "",
		"input": function(ev) {
			object[key] = ev.target.value;

			if (check)
				mark(ev.target, check());
		}
	}, object[key]);
}

return baseclass.extend({
	field: field,
	mark: mark,
	textInput: textInput,
	checkbox: checkbox,
	select: select,
	textArea: textArea,
	notice: notice,
	rowTable: rowTable
});
