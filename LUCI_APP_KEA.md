# luci-app-kea State

Last updated: 2026-05-13

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
  - raw Kea JSON configuration editor;
  - dnsmasq static lease import preview.
- Initial import fixtures for dnsmasq static leases.
- OpenWrt-side import regression test:
  `test/run-import-fixture.sh`.

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
/www/luci-static/resources/view/kea/dhcp4.js
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
