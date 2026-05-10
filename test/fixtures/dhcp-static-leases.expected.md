# Expected dnsmasq Static Lease Import Result

- `valid_ipv4`: ready DHCPv4 reservation.
- `missing_mac`: disabled, missing MAC address.
- `dhcpv6_duid`: ready DHCPv6 reservation and full DUID must be preserved.
- `dhcpv6_truncated_duid`: disabled, truncated DHCPv6 identity.
- `tagged_dnsmasq_only`: disabled, dnsmasq-only `tag` and `dns` behavior needs manual review.
