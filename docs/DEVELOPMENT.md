# Development

## Repository layout

```text
Makefile                                      OpenWrt package definition (includes luci.mk)
htdocs/luci-static/resources/view/kea/        LuCI JavaScript views
root/usr/libexec/rpcd/luci.kea                rpcd backend (POSIX shell, jshn)
root/usr/share/luci/kea/importer.uc           ucode helper for the import commit
root/usr/share/luci/menu.d/luci-app-kea.json  menu entries
root/usr/share/rpcd/acl.d/luci-app-kea.json   rpcd ACL
test/                                         fixtures and the import fixture test
docs/                                         project documentation
```

`luci.mk` installs `htdocs/` to `/www/` and `root/` to `/`. Nothing else in the
repository is packaged.

The views that are actually loaded are the ones named in the menu file. The
view directory still holds unused copies; see
[PACKAGING.md](PACKAGING.md#unused-view-files).

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

  This follows from the LuCI code above but has not been confirmed on a target
  yet.

## Checks

Run before every commit:

```sh
for f in htdocs/luci-static/resources/view/kea/*.js; do node --check "$f"; done
sh -n root/usr/libexec/rpcd/luci.kea
sh -n test/run-import-fixture.sh
jq -e . root/usr/share/luci/menu.d/luci-app-kea.json >/dev/null
jq -e . root/usr/share/rpcd/acl.d/luci-app-kea.json >/dev/null
```

The import fixture test needs `uci`, `jshn` and `/lib/functions.sh`, so run it
on OpenWrt or in an OpenWrt root filesystem:

```sh
./test/run-import-fixture.sh
```

There is no CI yet.

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
