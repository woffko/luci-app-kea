"use strict";

let fs = require("fs");

function stripJsonComments(text) {
	let out = "";
	let inString = false;
	let escaped = false;

	for (let i = 0; i < length(text); i++) {
		let ch = substr(text, i, 1);
		let next = substr(text, i + 1, 1);

		if (inString) {
			out += ch;

			if (escaped)
				escaped = false;
			else if (ch == "\\")
				escaped = true;
			else if (ch == "\"")
				inString = false;

			continue;
		}

		if (ch == "\"") {
			inString = true;
			out += ch;
			continue;
		}

		if (ch == "/" && next == "/") {
			while (i < length(text) && substr(text, i, 1) != "\n")
				i++;
			out += "\n";
			continue;
		}

		if (ch == "/" && next == "*") {
			i += 2;
			while (i < length(text) && !(substr(text, i, 1) == "*" && substr(text, i + 1, 1) == "/"))
				i++;
			i++;
			continue;
		}

		out += ch;
	}

	return out;
}

function ipv4ToInt(addr) {
	let parts = split(addr || "", ".");
	let value = 0;

	if (length(parts) != 4)
		return null;

	for (let part in parts) {
		if (!match(part, /^[0-9]+$/))
			return null;

		let octet = +part;
		if (octet < 0 || octet > 255)
			return null;

		value = value * 256 + octet;
	}

	return value;
}

function pow2(exp) {
	let value = 1;

	for (let i = 0; i < exp; i++)
		value *= 2;

	return value;
}

function parseCidr(value) {
	let parts = split(value || "", "/");
	let ip = ipv4ToInt(parts[0]);
	let prefix = length(parts) > 1 ? +parts[1] : 32;
	let size;

	if (ip == null || prefix < 0 || prefix > 32)
		return null;

	size = pow2(32 - prefix);

	return {
		first: ip - (ip % size),
		last: ip - (ip % size) + size - 1
	};
}

function ipInSubnet(addr, subnet) {
	let ip = ipv4ToInt(addr);
	let cidr = parseCidr(subnet);

	if (ip == null || cidr == null)
		return false;

	return ip >= cidr.first && ip <= cidr.last;
}

function findSubnet4(subnets, addr) {
	for (let subnet in (subnets || []))
		if (ipInSubnet(addr, subnet.subnet))
			return subnet;

	return null;
}

function sameReservation(reservation, entry) {
	return reservation["hw-address"] == entry.mac ||
		reservation["ip-address"] == entry.ip;
}

function applyReservation(subnet, entry) {
	let reservations = subnet.reservations || [];
	let incoming = {
		"hw-address": entry.mac,
		"ip-address": entry.ip
	};

	if (entry.name)
		incoming.hostname = entry.name;

	for (let reservation in reservations) {
		if (!sameReservation(reservation, entry))
			continue;

		reservation["hw-address"] = incoming["hw-address"];
		reservation["ip-address"] = incoming["ip-address"];

		if (incoming.hostname)
			reservation.hostname = incoming.hostname;
		else
			delete reservation.hostname;

		subnet.reservations = reservations;
		return "updated";
	}

	push(reservations, incoming);
	subnet.reservations = reservations;
	return "imported";
}

function main() {
	let configPath = ARGV[0];
	let entriesPath = ARGV[1];
	let outPath = ARGV[2];
	let stagingPath = ARGV[3];
	let config = json(stripJsonComments(fs.readfile(configPath)));
	let payload = json(fs.readfile(entriesPath));
	let entries = payload.entries || [];
	let dhcp4 = config.Dhcp4 || {};
	let imported = 0;
	let updated = 0;
	let skippedEntries = [];
	let changed = false;

	if (!dhcp4.subnet4)
		dhcp4.subnet4 = [];

	config.Dhcp4 = dhcp4;

	for (let entry in entries) {
		if (entry.status != "ready") {
			push(skippedEntries, {
				source: entry.source,
				reason: "entry is disabled or has warnings"
			});
			continue;
		}

		if (entry.family != "dhcp4") {
			push(skippedEntries, {
				source: entry.source,
				reason: "only DHCPv4 direct Kea import is implemented"
			});
			continue;
		}

		let subnet = findSubnet4(dhcp4.subnet4, entry.ip);
		if (!subnet) {
			push(skippedEntries, {
				source: entry.source,
				reason: "no matching Kea DHCPv4 subnet for " + entry.ip
			});
			continue;
		}

		let action = applyReservation(subnet, entry);
		if (action == "updated")
			updated++;
		else
			imported++;

		changed = true;
	}

	let result = {
		result: true,
		changed: changed,
		imported: imported,
		updated: updated,
		skipped: length(skippedEntries),
		staged: length(entries),
		skipped_entries: skippedEntries
	};

	fs.writefile(stagingPath, sprintf("%J\n", {
		version: 1,
		entries: entries,
		last_result: result
	}));

	if (changed)
		fs.writefile(outPath, sprintf("%J\n", config));

	print(sprintf("%J\n", result));
}

main();
