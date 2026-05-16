# luci-app-kea State

Last updated: 2026-05-14

## Repository

Local repository:

```text
/home/w0w/luci-app-kea
```

GitHub repository:

```text
https://github.com/woffko/luci-app-kea
```

The repository contains the current early LuCI package skeleton for ISC Kea on
OpenWrt.

Current implemented pieces:

- OpenWrt package `Makefile`.
- LuCI menu file.
- rpcd ACL file.
- rpcd backend script `luci.kea`.
- LuCI pages:
  - overview;
  - services;
  - DHCPv4 structured editor;
  - DHCPv6 structured editor;
  - raw Kea JSON configuration editor;
  - dnsmasq static lease import preview.
- Initial import fixtures for dnsmasq static leases.
- OpenWrt-side import regression test:
  `test/run-import-fixture.sh`.

## 2026-05-16 Services Page Runtime Fixes

The Services page was changed so component checkboxes no longer write UCI
immediately. Checkbox changes are now staged in the browser and are committed
only by `Save` or `Save & Apply`.

Active Services route:

```text
/cgi-bin/luci/admin/services/kea/services
```

Active JS module:

```text
/www/luci-static/resources/view/kea/services-control.js
```

Backend changes in `root/usr/libexec/rpcd/luci.kea`:

- `setInitAction start|restart|reload` now prepares Kea runtime state before
  calling `/etc/init.d/kea`.
- Runtime state created by the backend:
  - `/var/run/kea`
  - `/var/lib/kea`
  - `/etc/kea/kea-api-password`
- This fixes startup failures like:
  - `Unable to open '/var/lib/kea/kea-leases4.csv'`
  - `Unable to open '/var/lib/kea/kea-leases6.csv'`
  - `Expected a file at path '/etc/kea/kea-api-password'`
- `getStatus` now reports runtime prerequisites and potential conflicting
  OpenWrt services.
- Added restricted `setConflictAction` RPC method for `dnsmasq` and `odhcpd`
  only, with init actions `start`, `stop`, `restart`, `reload`, `enable`, and
  `disable`.

Services UI changes:

- Kea component checkboxes are staged until Save.
- `Save` commits only the pending Kea component UCI changes.
- `Save & Apply` commits pending changes and restarts Kea only if a Kea
  component was already running.
- Added a `Potential Conflicts` table for `dnsmasq` and `odhcpd`, including
  installed/autostart/runtime status and explicit action buttons.
- The app does not silently stop `dnsmasq` or `odhcpd`; the user must do that
  explicitly from the conflict table when switching DHCP authority to Kea.

Test target state after this update:

- `luci.kea` exposes `setConflictAction`.
- `/var/lib/kea` exists.
- `/etc/kea/kea-api-password` exists.
- Kea was briefly reloaded and the previous missing lease/API-password errors
  no longer appeared.
- Kea was then stopped again to avoid running DHCPv4/DHCPv6 at the same time
  as the still-running `dnsmasq` and `odhcpd` services.

Planning files:

```text
/home/w0w/luci-app-kea/README.md
/home/w0w/luci-app-kea/docs/ROADMAP.md
/home/w0w/build/openwrt-mtk-25.12.2/clean-openwrt-25.12.3-x86_64/KEA-LUCI_APP_TODO.md
```

## Build Tree

OpenWrt 25.12.3 x86_64 build tree:

```text
/home/w0w/build/openwrt-mtk-25.12.2/clean-openwrt-25.12.3-x86_64
```

Built APKs used for testing:

```text
bin/packages/x86_64/base/luci-app-kea-0.1.0-r1.apk
bin/packages/x86_64/packages/kea-*.apk
bin/packages/x86_64/packages/boost-*.apk
bin/packages/x86_64/packages/log4cplus-*.apk
bin/packages/x86_64/packages/procps-ng-*.apk
```

## Test OpenWrt Target

Test LuCI URL:

```text
https://192.168.189.129/cgi-bin/luci/
```

Login:

```text
root
```

Password:

```text
empty
```

SSH command pattern:

```sh
ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/tmp/openwrt-test-known_hosts \
    root@192.168.189.129
```

The target is OpenWrt 25.12.3 x86_64.

## Installed On Test Target

Installed successfully on `192.168.189.129`:

- `luci-app-kea 0.1.0-r1`
- `kea 3.0.2-r1` packages:
  - `kea-admin`
  - `kea-ctrl`
  - `kea-dhcp-ddns`
  - `kea-dhcp4`
  - `kea-dhcp6`
  - `kea-hook-ha`
  - `kea-hook-lease-cmds`
  - `kea-lfc`
  - `kea-libs`
  - `kea-shell`
  - `kea-uci`
- dependencies:
  - `boost`
  - `log4cplus`
  - `procps-ng`
  - `procps-ng-ps`

Installed LuCI files on target:

```text
/usr/share/luci/menu.d/luci-app-kea.json
/usr/share/rpcd/acl.d/luci-app-kea.json
/usr/libexec/rpcd/luci.kea
/www/luci-static/resources/view/kea/overview.js
/www/luci-static/resources/view/kea/services.js
/www/luci-static/resources/view/kea/services-status.js
/www/luci-static/resources/view/kea/dhcp4.js
/www/luci-static/resources/view/kea/dhcp6.js
/www/luci-static/resources/view/kea/configuration.js
/www/luci-static/resources/view/kea/import-dnsmasq.js
```

LuCI route checked successfully:

```text
https://192.168.189.129/cgi-bin/luci/admin/services/kea
```

The route returned HTTP `200`.

Registered rpcd methods:

```text
luci.kea getStatus
luci.kea getServices
luci.kea getNetworkInterfaces
luci.kea validate
luci.kea getConfigList
luci.kea getConfig
luci.kea saveConfig
luci.kea importDnsmasqDryRun
luci.kea importDnsmasqCommit
luci.kea setService
luci.kea setInitAction
```

Important note from 2026-05-12:

- The local package now includes the new `Configuration` LuCI page and
  `getConfigList` / `getConfig` / `saveConfig` rpcd methods.
- The OpenWrt build tree has `CONFIG_PACKAGE_luci-app-kea=m` enabled.
- The test target at `192.168.189.129` was reachable again. Fresh
  `luci-app-kea` was installed and the `/admin/services/kea/configuration`
  route returned HTTP 200 after LuCI login.
- Kea validation was fixed to call `kea-* -t <config>` instead of
  `kea-* -t -c <config>`.
- The backend now creates `/var/run/kea` with mode `750` before validation so
  clean installs can validate default Kea configs before services are started.

Status at the time of install:

- Kea binaries are present.
- HA and lease command hooks are present.
- Kea config files exist under `/etc/kea/`.
- Kea services are installed but disabled and not running:
  - `ctrl_agent`
  - `dhcp4`
  - `dhcp6`
  - `dhcp_ddns`

This is intentional for testing so dnsmasq is not replaced until explicitly
enabled.

## 2026-05-13 DHCPv4 GUI Work

Added the first structured DHCPv4 editor:

```text
/cgi-bin/luci/admin/services/kea/dhcp4
```

Design direction:

- Follow the pfSense DHCP page model: one tab per interface.
- Keep the raw JSON editor as the advanced fallback.
- Read existing Kea JSON, including configs with `//` and `/* */` comments.
- Generate a validated `kea-dhcp4.conf` through the existing `saveConfig`
  backend path.

Current DHCPv4 page fields:

- enable DHCPv4 per interface;
- Kea interface binding;
- subnet;
- primary pool start/end;
- gateway/router option;
- DNS servers;
- domain name;
- domain search;
- renew/rebind/valid timers;
- basic static reservations:
  - hostname;
  - MAC address;
  - IPv4 address;
  - enabled flag.

Follow-up fixes:

- Kea subnets without an explicit `interface` field are now matched to an
  OpenWrt interface tab by IPv4 network. Example: `192.168.1.0/24` is shown
  under `lan (br-lan)` when OpenWrt has `192.168.1.1/24` on `br-lan`.
- This avoids ambiguous generated tabs such as `subnet1` for the default LAN
  subnet.
- Unmatched Kea subnets still get their own tab, labeled by subnet CIDR instead
  of a generic name where possible.
- Unbound Kea documentation subnets from the stock sample config are filtered
  out of the structured interface tabs:
  - `192.0.2.0/24`;
  - `198.51.100.0/24`;
  - `203.0.113.0/24`.
  They remain visible in the raw JSON editor until the DHCPv4 config is saved
  from the structured page.
- The DHCPv4 menu route now points at `kea/dhcp4-editor` to force browsers to
  load the filtered editor instead of an already loaded `kea/dhcp4` module.
- Disabled DHCPv4 tabs with filled subnet/pool/options/reservations are now
  saved into `Dhcp4.subnet4`. The `Enable` checkbox only controls whether the
  interface is listed in `Dhcp4.interfaces-config.interfaces`, so the Kea
  server will not listen on that interface until the checkbox is enabled.
- The active DHCPv4 route was moved again to `kea/dhcp4-config` to force the
  browser to load this corrected behavior.
- The standard LuCI footer buttons are now wired for the custom DHCP editors:
  `Save` and `Save & Apply` both call the editor `save()` method; `Reset` calls
  `reload()`. They do not restart Kea or call the generic UCI apply flow.
- Active module paths were moved again to `kea/dhcp4-config-save` and
  `kea/dhcp6-config-save` to force browsers to load the footer handler fix.
- Structured DHCPv4/DHCPv6 saves now remove known stock Kea sample artifacts
  from the generated config. For DHCPv4 this removes the example global
  `192.0.2.*` options and the example `voip`/`Aastra` client class once a real
  structured config is saved. For DHCPv6 this removes the known `2001:db8::*`
  top-level example options when the structured page is saved.
- Active module paths were moved to `kea/dhcp4-clean-save` and
  `kea/dhcp6-clean-save` for this cleanup behavior.
- The test VM DHCPv4 config was cleaned in place with backups:
  - `/etc/kea/kea-dhcp4.conf.bak.sample-clean`;
  - `/etc/kea/kea-dhcp4.conf.bak.pretty-clean`.
  The cleaned config validates with `kea-dhcp4 -t` and Kea services were not
  restarted.

Backend method added:

```text
luci.kea getNetworkInterfaces
```

It reads `/etc/config/network` and returns UCI interface name, device, proto,
IPv4 address, and IPv6 address where present.

Direct VM injection was used for GUI iteration:

```sh
scp -O root/usr/libexec/rpcd/luci.kea \
  root@192.168.189.129:/usr/libexec/rpcd/luci.kea

scp -O root/usr/share/luci/menu.d/luci-app-kea.json \
  root@192.168.189.129:/usr/share/luci/menu.d/luci-app-kea.json

scp -O root/usr/share/rpcd/acl.d/luci-app-kea.json \
  root@192.168.189.129:/usr/share/rpcd/acl.d/luci-app-kea.json

scp -O htdocs/luci-static/resources/view/kea/dhcp4.js \
  root@192.168.189.129:/www/luci-static/resources/view/kea/dhcp4.js

ssh root@192.168.189.129 \
  'chmod 755 /usr/libexec/rpcd/luci.kea; rm -rf /tmp/luci-indexcache /tmp/luci-modulecache; /etc/init.d/rpcd restart; /etc/init.d/uhttpd restart'
```

Use `scp -O` because this OpenWrt/dropbear target does not provide
`/usr/libexec/sftp-server`.

Verification performed:

```sh
node --check htdocs/luci-static/resources/view/kea/dhcp4.js
sh -n root/usr/libexec/rpcd/luci.kea
ubus -v list luci.kea
ubus call luci.kea getNetworkInterfaces
curl -k -L https://192.168.189.129/cgi-bin/luci/admin/services/kea/dhcp4
curl -k https://192.168.189.129/luci-static/resources/view/kea/dhcp4.js
```

Results:

- `dhcp4.js` syntax check passed.
- backend shell syntax check passed.
- menu JSON and ACL JSON parse locally.
- `getNetworkInterfaces` is registered on the target.
- LuCI route `/admin/services/kea/dhcp4` returns HTTP `200`.
- `dhcp4.js` asset returns HTTP `200`.
- A rebuilt APK also exists:

```text
/home/w0w/build/openwrt-mtk-25.12.2/clean-openwrt-25.12.3-x86_64/bin/packages/x86_64/base/luci-app-kea-0.1.0-r1.apk
```

## 2026-05-13 Services Page Follow-Up

Reworked the `Services` page from a rough diagnostic table into a startup-like
service view.

The page now has:

- an `Init Service` table for `/etc/init.d/kea`:
  - installed/missing;
  - autostart enabled/disabled;
  - aggregate runtime status;
  - start, stop, restart, reload, enable autostart, disable autostart actions;
- a `Kea Components` table for:
  - `kea-dhcp4`;
  - `kea-dhcp6`;
  - `kea-dhcp-ddns`;
  - `kea-ctrl-agent`;
- per-component status columns:
  - binary installed/missing;
  - config present/missing;
  - enabled/disabled in `/etc/config/kea`;
  - running/stopped;
  - UCI section name.

Important behavior:

- Component checkboxes edit `/etc/config/kea`.
- Starting/stopping still happens through the single Kea init script, because
  these components are not separate OpenWrt init services.
- After toggling a component, restart Kea to apply the config change.

## 2026-05-13 Pause State

Last pushed commit on GitHub:

```text
b0c64d2 Avoid String.format in Kea LuCI views
```

That commit removed `.format()` usage from LuCI views after the browser showed a
blank page risk.

Uncommitted local work after `b0c64d2`:

```text
M  htdocs/luci-static/resources/view/kea/import-dnsmasq.js
D  htdocs/luci-static/resources/view/kea/services.js
M  root/usr/share/luci/menu.d/luci-app-kea.json
?? htdocs/luci-static/resources/view/kea/services-status.js
```

What these local changes do:

- Rename the services view from `kea/services` to `kea/services-status` in the
  LuCI menu to force Firefox/LuCI to load a new JS URL instead of a cached old
  `services.js`.
- Keep the new services implementation in
  `htdocs/luci-static/resources/view/kea/services-status.js`.
- Fix nested array rendering in the services component table. The old nested
  array produced visible text like `[object HTMLTableRowElement]`.
- Fix the same nested-array pattern in `import-dnsmasq.js`.
- The Import dnsmasq route now points at `kea/import-dnsmasq-preview` to force
  browsers to load a new JS module instead of a cached old
  `kea/import-dnsmasq` module. Both JS files are kept identical as a fallback.
- Import commit support was added next:
  - backend method `importDnsmasqCommit` now stages all preview entries in
    `/etc/kea/luci-reservations.json`;
  - ready DHCPv4 entries are also merged into `kea-dhcp4.conf` when a matching
    Kea `subnet4` exists;
  - if no matching Kea subnet exists, the entry is staged and reported as
    skipped with a clear reason;
  - the active route now uses `kea/import-dnsmasq-commit` as another
    cache-busting module path.

Local validation before pausing:

```sh
node --check htdocs/luci-static/resources/view/kea/services-status.js
node --check htdocs/luci-static/resources/view/kea/dhcp4.js
node --check htdocs/luci-static/resources/view/kea/configuration.js
node --check htdocs/luci-static/resources/view/kea/import-dnsmasq.js
```

A small Node render harness also passed for:

- services status page;
- dnsmasq import page;
- DHCPv4 page.

Test VM state is uncertain because access disappeared during deployment.

Before the VM became unreachable:

- `services-status.js -> /www/luci-static/resources/view/kea/services-status.js`
  was started but did not confirm completion.
- `services-status.js -> /www/luci-static/resources/view/kea/services.js`
  completed, as a compatibility fallback for the old cached URL.
- `root/usr/share/luci/menu.d/luci-app-kea.json -> /usr/share/luci/menu.d/`
  completed.
- `import-dnsmasq.js -> /www/luci-static/resources/view/kea/import-dnsmasq.js`
  completed.

This means the VM may be in a partially updated state: the menu may point to
`kea/services-status`, but `/www/luci-static/resources/view/kea/services-status.js`
may not exist yet.

First steps when continuing:

1. Confirm VM is reachable.
2. Copy the missing/new files again:

```sh
scp -O htdocs/luci-static/resources/view/kea/services-status.js \
  root@192.168.189.129:/www/luci-static/resources/view/kea/services-status.js

scp -O htdocs/luci-static/resources/view/kea/services-status.js \
  root@192.168.189.129:/www/luci-static/resources/view/kea/services.js

scp -O root/usr/share/luci/menu.d/luci-app-kea.json \
  root@192.168.189.129:/usr/share/luci/menu.d/luci-app-kea.json

scp -O htdocs/luci-static/resources/view/kea/import-dnsmasq.js \
  root@192.168.189.129:/www/luci-static/resources/view/kea/import-dnsmasq.js
```

3. Clear LuCI caches and restart web services:

```sh
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/uhttpd restart
```

4. Check:

```sh
grep -n 'services-status' /usr/share/luci/menu.d/luci-app-kea.json
ls -l /www/luci-static/resources/view/kea/services-status.js
```

5. Open LuCI in Firefox and force reload the Kea Services page.

Do not push the uncommitted local changes until the services page is visually
verified in the browser.

Update after VM came back:

- Re-copied `services-status.js` to:
  - `/www/luci-static/resources/view/kea/services-status.js`
  - `/www/luci-static/resources/view/kea/services.js`
- Re-copied menu JSON to:
  - `/usr/share/luci/menu.d/luci-app-kea.json`
- Re-copied fixed import page to:
  - `/www/luci-static/resources/view/kea/import-dnsmasq.js`
- Cleared LuCI caches and restarted `uhttpd`.

Verification after redeploy:

```text
/usr/share/luci/menu.d/luci-app-kea.json -> path "kea/services-status"
/www/luci-static/resources/view/kea/services-status.js exists, 8117 bytes
/www/luci-static/resources/view/kea/services.js exists, 8117 bytes
both service JS files have the same md5
```

The Services route HTML now contains:

```text
ui.instantiateView('kea/services-status')
```

Fetching the new asset from inside the VM with `uclient-fetch` showed the new
page content:

```text
Init Service
Kea Components
```

Current caveat:

- Direct `curl` from the host to `192.168.189.129/luci-static/...` was
  intermittently failing while the authenticated LuCI route and SSH worked.
  This looks like a transient reachability issue on the host side, not a file
  deployment issue.
- The next useful check is visual verification in Firefox on the client-facing
  LuCI URL. Because the route now points to a new module path
  `kea/services-status`, Firefox should not reuse the old cached
  `kea/services.js` module.

## 2026-05-14 DHCPv6 GUI Work

Added the first structured DHCPv6 editor:

```text
/cgi-bin/luci/admin/services/kea/dhcp6
```

The page follows the same direction as the DHCPv4 editor:

- one tab per OpenWrt interface;
- enable/disable DHCPv6 per interface;
- Kea interface binding;
- subnet6;
- address pool;
- prefix delegation pool;
- DNS servers;
- domain search;
- renew/rebind/preferred/valid timers;
- static reservations.

DHCPv6 reservations currently support these identity fields:

- DUID;
- MAC address / `hw-address`;
- client ID;
- flex ID.

Reservation outputs supported by the UI:

- one or more IPv6 addresses through Kea `ip-addresses`;
- one or more delegated prefixes through Kea `prefixes`.

Important behavior:

- The structured editor preserves the existing top-level `Dhcp6` JSON object
  and replaces `interfaces-config.interfaces` plus `subnet6` from the UI state.
- Existing subnets with an explicit `interface` or `interface-id` are mapped
  onto matching OpenWrt interface tabs.
- If a subnet has no explicit interface and there is exactly one enabled Kea
  interface, it is mapped to that interface.
- Otherwise unmatched DHCPv6 subnets get their own disabled tab labeled by the
  subnet CIDR, so a default/example Kea subnet is visible but is not silently
  enabled for the wrong interface.
- Unbound Kea documentation subnets from the stock sample config
  (`2001:db8::/32`, including `2001:db8:1::/64`) are filtered out of the
  structured interface tabs. They remain visible in the raw JSON editor until
  the DHCPv6 config is saved from the structured page.
- Numeric timer and prefix length fields are checked before save.
- Disabled DHCPv6 tabs with filled subnet/pool/PD/options/reservations are now
  saved into `Dhcp6.subnet6`. The `Enable` checkbox only controls whether the
  interface is listed in `Dhcp6.interfaces-config.interfaces`.
- Existing saved DHCPv4/DHCPv6 subnets no longer force the UI checkbox on when
  reloaded; checkbox state is derived from `interfaces-config.interfaces`.

Files changed locally:

```text
htdocs/luci-static/resources/view/kea/dhcp6.js
root/usr/share/luci/menu.d/luci-app-kea.json
```

Direct VM injection performed:

```sh
scp -O -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/tmp/openwrt-test-known_hosts \
  htdocs/luci-static/resources/view/kea/dhcp6.js \
  root@192.168.189.129:/www/luci-static/resources/view/kea/dhcp6.js

scp -O -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/tmp/openwrt-test-known_hosts \
  root/usr/share/luci/menu.d/luci-app-kea.json \
  root@192.168.189.129:/usr/share/luci/menu.d/luci-app-kea.json
```

Validation performed:

```sh
node --check htdocs/luci-static/resources/view/kea/dhcp6.js
curl -k -b /tmp/kea-cookies.txt \
  https://192.168.189.129/cgi-bin/luci/admin/services/kea/dhcp6
curl -k https://192.168.189.129/luci-static/resources/view/kea/dhcp6.js
```

Results:

- `dhcp6.js` syntax check passed.
- authenticated LuCI route returned HTTP `200`;
- route HTML contains `ui.instantiateView('kea/dhcp6')`;
- static asset contains the expected DHCPv6 page text.

The page has not been visually verified in Firefox yet because there is no
browser available inside the agent environment. Use the client-facing LuCI URL
and force reload the Kea page if Firefox keeps older static JS:

```text
https://192.168.1.1/cgi-bin/luci/admin/services/kea/dhcp6
```

## Useful Verification Commands

List installed Kea packages:

```sh
apk list --installed | grep -E '^(kea|luci-app-kea|boost|log4cplus|procps-ng)-' | sort
```

List rpcd methods:

```sh
ubus -v list luci.kea
```

Check backend status:

```sh
ubus call luci.kea getStatus
ubus call luci.kea getServices
```

Check raw config editor backend:

```sh
ubus call luci.kea getConfigList
ubus call luci.kea getConfig '{"name":"dhcp4"}'
```

Refresh LuCI after reinstall:

```sh
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

## GitHub Credentials Note

GitHub credentials are not configured globally.

For repositories that need GitHub push access, configure the local helper inside
that repository:

```sh
git config credential.helper "store --file=/home/w0w/.git-credentials-github"
```

Do not print or paste the credential file contents into chat or logs.

## Next Work

- Verify the new raw JSON configuration page on the test VM once it is reachable.
- Continue iterating GUI directly on the test VM with `scp -O`, then rebuild
  the package when the feature is ready.
- Implement real `kea-uci` read/write integration.
- Harden DHCPv4 editor:
  - browser-side validation for IPv4/MAC/subnet/pool;
  - preserve unsupported subnet-level Kea keys;
  - add advanced options;
  - add conflict checks;
  - add restart/apply workflow.
- Add structured DHCPv6 editor.
- Add reservation editor.
- Add HA hook editor.
- Finish dnsmasq static lease import conversion and validation.
- Add backend import tests.
- Run `test/run-import-fixture.sh` on the test VM after it becomes reachable.
- Add LuCI/browser regression tests.
- Decide when it is safe to include `luci-app-kea` in full OpenWrt images by
  default.
