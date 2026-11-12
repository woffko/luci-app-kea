# Development

## Repository layout

```text
Makefile                                      OpenWrt package definition (includes luci.mk)
htdocs/luci-static/resources/view/kea/        LuCI JavaScript views (one per page)
htdocs/luci-static/resources/kea/             shared modules: model, backend, editor
root/usr/share/rpcd/ucode/luci.kea            rpcd plugin: maps ubus methods to the library
ucode/kea/                                    backend library, installed as the luci.kea.* modules
root/usr/share/luci/menu.d/luci-app-kea.json  menu entries
root/usr/share/rpcd/acl.d/luci-app-kea.json   rpcd ACL
po/templates/kea.pot                          translation template
tools/update-pot.sh                           regenerates the template
test/js/                                      unit tests for the configuration model (Node.js)
test/ucode/                                   tests for the backend library (ucode)
test/browser/                                 browser tests (Playwright)
test/fixtures/                                Kea and UCI fixtures
package.json, eslint.config.mjs               development tooling (ESLint)
.github/workflows/ci.yml                      CI
docs/                                         project documentation
```

`luci.mk` installs `htdocs/` to `/www/`, `root/` to `/` and `ucode/` to
`/usr/share/ucode/luci/`, and builds translation packages from `po/`. Nothing
else in the repository is packaged.

View names are part of the page URL. Keep them stable.

## How the structured editors save

`kea/model.js` is the only place that turns the form into Kea JSON. Its rule:
the editors never rebuild a subnet. A tab keeps the original subnet object and
the values the form started with; on save, only values that differ from the
starting ones are written back into a copy of that object. Unknown keys,
their order and the formatting of untouched values survive.

When adding a field, add it to the family description at the top of
`model.js`, load it in `loadSubnet()`, write it in `mergeSubnet()` behind a
`fieldChanged()` check, and add a unit test that changing it changes nothing
else. `kea/editor.js` only renders inputs bound to the tab model.

`model.js` has no DOM or RPC code so that it can be tested under Node.
`test/js/luci-loader.js` loads it the way LuCI does.

## How the backend is organized

The rpcd plugin `root/usr/share/rpcd/ucode/luci.kea` contains no logic. Each
ubus method calls one function of the library in `ucode/kea/`:

- `config.uc`: paths, validation with `kea-* -t`, read, save, backups,
  restore;
- `service.uc`: component state from procd, init actions, runtime files;
- `importer.uc`: dnsmasq host classification and merge;
- `jsonc.uc`, `net.uc`: comment stripping and IPv4 helpers.

Method names and reply shapes are what the views expect. Changing them means
changing the views and the ACL in the same commit.

Every library function takes a context from `config.context()`. In
production it is built without options. Tests pass options: a temporary
`root`, a UCI directory, a stand-in for the Kea binary (`validator`), a fixed
`clock`, a stand-in for the procd reply (`service_list`). Keep new code
behind the context so it stays testable.

`config.save()` is the only function that replaces a Kea configuration file.
It validates the new content, backs up the current file, then renames the
new one into place. Route every new write path through it.

The plugin runs inside `rpcd` and is loaded when `rpcd` starts. Restart
`rpcd` after changing the plugin or the library on a target. An exception in
the plugin shows up in `logread -e rpcd`.

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

`make package/feeds/base/ucode/host/compile` additionally gives a host ucode
interpreter in `staging_dir/hostpkg/bin/ucode` for the backend tests.

The last command of the block builds only this package. The usual
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
scp -O root/usr/share/rpcd/ucode/luci.kea           $T:/usr/share/rpcd/ucode/
scp -O ucode/kea/*.uc                               $T:/usr/share/ucode/luci/kea/
scp -O root/usr/share/luci/menu.d/luci-app-kea.json $T:/usr/share/luci/menu.d/
scp -O root/usr/share/rpcd/acl.d/luci-app-kea.json  $T:/usr/share/rpcd/acl.d/
scp -O htdocs/luci-static/resources/kea/*.js        $T:/www/luci-static/resources/kea/
scp -O htdocs/luci-static/resources/view/kea/*.js   $T:/www/luci-static/resources/view/kea/

ssh $T 'rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
        /etc/init.d/rpcd restart'
```

Restart `rpcd` after changing the plugin, the library or the ACL. Clear the
LuCI caches after changing the menu.

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

Run before every commit. These need Node.js and `jq`:

```sh
npm ci                           # once: installs ESLint
find htdocs test -name '*.js' -exec node --check {} \;
for f in test/*.sh tools/*.sh; do sh -n "$f"; done
jq -e . root/usr/share/luci/menu.d/luci-app-kea.json >/dev/null
jq -e . root/usr/share/rpcd/acl.d/luci-app-kea.json >/dev/null
npm run lint                     # ESLint with the LuCI rules, no warnings allowed
npm test                         # configuration model
```

The backend tests need a ucode interpreter with the `fs` module, for example
the host build from the SDK:

```sh
UCODE=/path/to/openwrt-sdk/staging_dir/hostpkg/bin/ucode test/run-ucode-tests.sh
```

They use a stand-in for the Kea binary and a temporary directory.

To run the model tests against the configs of an installed Kea package as
well, copy `kea-dhcp4.conf` and `kea-dhcp6.conf` from a target and point
`KEA_STOCK_DIR` at the directory.

After changing a user-visible string, regenerate the translation template:

```sh
tools/update-pot.sh /path/to/luci-checkout
```

More backend tests need OpenWrt itself: the real Kea binary, UCI and procd.
Copy `ucode/` and `test/` to a target that has `kea-dhcp-ddns` installed and
run there:

```sh
sh test/run-ucode-tests.sh --target               # the library copied with the tests
sh test/run-ucode-tests.sh --target --installed   # the library of the installed package
```

They work in a temporary root and do not touch `/etc/kea` or `/etc/config`.

The browser tests drive LuCI on a target. They need Node.js with the
`playwright` package:

```sh
npm install playwright
npx playwright install chromium-headless-shell
export BASE_URL=http://<target> LUCI_PASSWORD=<password>
node test/browser/smoke.js       # every page renders without errors
node test/browser/editor.js      # editors, raw editor and backups end to end
```

`editor.js` rewrites `/etc/kea/kea-dhcp4.conf` and `kea-dhcp6.conf` while it
runs and puts the originals back at the end. Run it only against a test
target whose LAN device is `br-lan`. Set `OUT_DIR` to keep screenshots.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to
`main`:

- **Lint and unit tests**: the syntax checks above, ShellCheck, a check that
  the ACL grants exactly the RPC methods the pages use, ESLint and the
  configuration model tests.
- **Build with the OpenWrt SDK**: downloads the official SDK, checks the
  package metadata, runs the backend library tests with the SDK's host
  ucode, checks that `po/templates/kea.pot` is up to date, builds the package
  and keeps it as a workflow artifact.

The on-target tests and the browser tests are not part of CI; they need a
running OpenWrt system.

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
ubus call luci.kea listBackups '{"name":"dhcp4"}'
ubus call luci.kea importDnsmasqDryRun
```

The library can be called without rpcd:

```sh
ucode -e 'import * as c from "luci.kea.config"; printf("%.J\n", c.validate_all(c.context()));'
```

Errors raised inside the plugin are logged by rpcd: `logread -e rpcd`.

Installed Kea packages:

```sh
apk list --installed | grep -E '^(kea|luci-app-kea)-'
```

## Working safely with a DHCP server

- Back up `/etc/config/dhcp`, `/etc/config/kea` and `/etc/kea/*.conf` on the
  target before testing saves or imports.
- Keep the Kea components disabled unless a test needs them, so Kea does not
  answer on an interface that dnsmasq or odhcpd still serves.
- Every config write from LuCI leaves a backup in `/etc/kea/backups/`. Only
  the ten newest per file are kept, so a test that saves many times pushes
  older backups out.
- A config that passes `kea-dhcp4 -t` can still fail to start. Check the
  system log (`logread | grep kea`) after starting a daemon.
- Do not judge whether a daemon runs with `pgrep -f`: it also matches your
  own shell when the command line names the daemon. Use `pidof kea-dhcp4` or
  `ubus call service list '{"name":"kea"}'`.

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
