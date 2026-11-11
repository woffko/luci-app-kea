# Development

## Repository layout

```text
Makefile                                      OpenWrt package definition (includes luci.mk)
htdocs/luci-static/resources/view/kea/        LuCI JavaScript views
root/usr/libexec/rpcd/luci.kea                rpcd backend (POSIX shell, jshn)
root/usr/share/luci/kea/importer.uc           ucode helper for the import commit
root/usr/share/luci/menu.d/luci-app-kea.json  menu entries
root/usr/share/rpcd/acl.d/luci-app-kea.json   rpcd ACL
po/templates/kea.pot                          translation template
tools/update-pot.sh                           regenerates the template
test/                                         fixtures, import fixture test, browser smoke test
docs/                                         project documentation
```

`luci.mk` installs `htdocs/` to `/www/` and `root/` to `/`, and builds
translation packages from `po/`. Nothing else in the repository is packaged.

View names are part of the page URL. Keep them stable.

## Building

The Makefile includes `$(TOPDIR)/feeds/luci/luci.mk`, so the `luci` feed must
be installed in the build tree.

```sh
cd /path/to/openwrt
git clone https://github.com/woffko/luci-app-kea.git package/luci-app-kea
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig
make package/luci-app-kea/compile V=s
```

In menuconfig, select at least one Kea daemon first (**Network > IP Addresses
and Names**: `kea-dhcp4`, `kea-dhcp6`, `kea-dhcp-ddns` or `kea-ctrl`).
`luci-app-kea` (**LuCI > 3. Applications**) is hidden until then, because it
depends on `kea-uci`, which requires one of them.

A package placed under `package/` is written to
`bin/packages/<arch>/base/luci-app-kea-<version>.apk`.

### Building with the SDK

The SDK avoids building the toolchain. Use a `PATH` without spaces (on WSL,
drop the Windows directories).

```sh
cd /path/to/openwrt-sdk
./scripts/feeds update base packages luci
./scripts/feeds install luci-base kea
ln -s /path/to/luci-app-kea package/luci-app-kea
make defconfig
make package/feeds/luci/luci-base/host/compile
make -C package/luci-app-kea TOPDIR="$PWD" compile
```

The last command builds only this package. The usual
`make package/luci-app-kea/compile` also compiles every dependency, including
Kea and Boost, which takes much longer and is not needed when Kea is installed
on the target from the official package repository.

To inspect the metadata without building:

```sh
make -r DUMP=1 TOPDIR=/path/to/openwrt INCLUDE_DIR=/path/to/openwrt/include \
    -C /path/to/luci-app-kea
```

## Installing on a test target

```sh
scp -O bin/packages/<arch>/base/luci-app-kea-*.apk root@<target>:/tmp/
ssh root@<target> 'apk add --allow-untrusted /tmp/luci-app-kea-*.apk'
```

Use `scp -O`: a default OpenWrt target has no SFTP server.

The package post-install step clears the LuCI caches and reloads `rpcd`.

## Iterating without rebuilding

Files can be copied straight to a test target:

```sh
T=root@<target>
scp -O root/usr/libexec/rpcd/luci.kea               $T:/usr/libexec/rpcd/luci.kea
scp -O root/usr/share/luci/kea/importer.uc          $T:/usr/share/luci/kea/importer.uc
scp -O root/usr/share/luci/menu.d/luci-app-kea.json $T:/usr/share/luci/menu.d/
scp -O root/usr/share/rpcd/acl.d/luci-app-kea.json  $T:/usr/share/rpcd/acl.d/
scp -O htdocs/luci-static/resources/view/kea/*.js   $T:/www/luci-static/resources/view/kea/

ssh $T 'chmod 755 /usr/libexec/rpcd/luci.kea
        rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
        /etc/init.d/rpcd restart'
```

Restart `rpcd` after changing the backend or the ACL. Clear the LuCI caches
after changing the menu.

### Browser caching

Do not rename a view to force the browser to reload it. LuCI loads every
resource as `<name>.js?v=<luci-base version>-<mtime of /lib/apk/db/installed>`
(`ucode/runtime.uc` and `ucode/template/header.ut` in `luci-base`). A package
install changes that value; a file copied with `scp` does not, so the browser
may keep the old module.

For hand-copied files, either:

- keep the browser developer tools open with the cache disabled, or
- change the version value on the target:

  ```sh
  ssh root@<target> 'touch /lib/apk/db/installed'
  ```

## Checks

Run before every commit:

```sh
for f in htdocs/luci-static/resources/view/kea/*.js; do node --check "$f"; done
sh -n root/usr/libexec/rpcd/luci.kea
sh -n test/run-import-fixture.sh
jq -e . root/usr/share/luci/menu.d/luci-app-kea.json >/dev/null
jq -e . root/usr/share/rpcd/acl.d/luci-app-kea.json >/dev/null
```

After changing a user-visible string, regenerate the translation template:

```sh
tools/update-pot.sh /path/to/luci-checkout
```

The import fixture test needs `uci`, `jshn`, `jsonfilter` and
`/lib/functions.sh`, so run it on OpenWrt or in an OpenWrt root filesystem:

```sh
./test/run-import-fixture.sh
```

The browser smoke test opens every page on a target and fails on JavaScript
errors. It needs Node.js with the `playwright` package:

```sh
npm install playwright
npx playwright install chromium-headless-shell
BASE_URL=http://<target> LUCI_PASSWORD=<password> node test/browser/smoke.js
```

Set `OUT_DIR` to keep a screenshot of each page.

There is no CI yet.

## A disposable test target

The official x86-64 image runs under QEMU without KVM. With two network
cards, the first is the LAN (`192.168.1.1`) and the second can serve as WAN:

```sh
gunzip -k openwrt-<version>-x86-64-generic-ext4-combined.img.gz
qemu-system-x86_64 -m 512 -display none \
    -drive file=openwrt-<version>-x86-64-generic-ext4-combined.img,format=raw,if=ide \
    -netdev user,id=lan,net=192.168.1.0/24,host=192.168.1.2,restrict=on,hostfwd=tcp:127.0.0.1:2222-192.168.1.1:22,hostfwd=tcp:127.0.0.1:8080-192.168.1.1:80 \
    -device e1000,netdev=lan \
    -netdev user,id=wan -device e1000,netdev=wan
```

The image has no WAN interface configured. Add one on the guest, then install
Kea:

```sh
uci set network.wan=interface
uci set network.wan.device=eth1
uci set network.wan.proto=dhcp
uci commit network
/etc/init.d/network reload
apk update
apk add kea-dhcp4 kea-dhcp6 kea-dhcp-ddns kea-ctrl kea-uci
```

LuCI is then at `http://127.0.0.1:8080` and SSH at port 2222 on the host.

## Debugging the backend on a target

```sh
ubus -v list luci.kea
ubus call luci.kea getStatus
ubus call luci.kea getServices
ubus call luci.kea getNetworkInterfaces
ubus call luci.kea validate
ubus call luci.kea getConfigList
ubus call luci.kea getConfig '{"name":"dhcp4"}'
ubus call luci.kea importDnsmasqDryRun
```

The plugin can also be run directly:

```sh
/usr/libexec/rpcd/luci.kea list
echo '{"name":"dhcp4"}' | /usr/libexec/rpcd/luci.kea call getConfig
```

Installed Kea packages:

```sh
apk list --installed | grep -E '^(kea|luci-app-kea)-'
```

## Working safely with a DHCP server

- Back up `/etc/config/dhcp`, `/etc/config/kea` and `/etc/kea/*.conf` on the
  target before testing saves or imports.
- Keep the Kea components disabled unless a test needs them, so Kea does not
  answer on an interface that dnsmasq or odhcpd still serves.
- Config writes leave `<file>.bak.luci`; import commits leave
  `kea-dhcp4.conf.bak.import`. Each is a single generation.

## Conventions

- Everything published to GitHub is written in English: code comments,
  documentation, commit messages, issues and pull requests.
- The package is standalone for now and is meant to be submitted to
  `openwrt/luci` later. Write new code to LuCI conventions (see the decisions
  in [ROADMAP.md](ROADMAP.md#decisions)) so the move stays cheap.
- Commit subjects are short and imperative. At submission time the rules in
  [PACKAGING.md](PACKAGING.md) apply (`luci-app-kea:` prefix,
  `Signed-off-by`).
- LuCI strings go through `_()`.
- Do not use `String.format()` in views. It was removed in May 2026 while
  fixing a blank page.
- Machine-specific notes (test target address, local build tree paths) belong
  in an untracked `LOCAL.md`, which is listed in `.gitignore`.
