"use strict";
"require baseclass";
"require network";
"require kea.backend as backend";
"require kea.leasetable as leasetable";

/*
 * The leases of Kea on the status overview of LuCI, next to the section
 * "DHCP Leases", which shows those of dnsmasq and odhcpd only. Hidden when
 * Kea keeps no leases. The overview reloads its sections by itself.
 */
return baseclass.extend({
	title: _("Kea DHCP Leases"),

	load: function() {
		return Promise.all([
			backend.getLeases(),
			L.resolveDefault(network.getHostHints(), null)
		]);
	},

	render: function(data) {
		return leasetable.render(data[0], data[1], {});
	}
});
