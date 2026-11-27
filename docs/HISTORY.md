# History

A condensed development log. It replaces the working notes that were kept in
`LUCI_APP_KEA.md` (still available in the git history up to commit `b6eedcf`).

Section dates are the days the work was done, taken from those notes. Work was
often committed later; the [commit table](#commits) shows where each part
landed.

## 2026-11-27: Release `v0.15.2`

- The owner said to merge and release. The pull request was merged with a
  merge commit, so the commit the image of the `ha-cluster` project had
  pinned stays in the history of `main`; the tag is on the merge commit.
- The release workflow passed, with 187 backend tests and eight browser
  tests. The attached file holds the same files as a package built from
  the merged `main` by hand (compared with `apk adbdump`); its checksum is
  in the release text and matched the public download. Published as a
  pre-release.
- Before the merge, the `ha-cluster` project ran the head of the pull
  request on its bench twice: once with the package alone (the switch to
  Kea, the move of the leases, "Reserve IP" on the standby), once in a
  router image, upgraded from the previous one on both nodes of a pair.
  Neither run found a problem.

## 2026-11-26: After the audit of `0.15.1` (`0.15.2-r1`)

- An external audit of `0.15.1`, made for the image w0w6 of the owner, was
  passed on by the `ha-cluster` project with the owner's go, together with
  that project's own check of each finding against the code and the
  sources of Kea 3.0.4. Each point was checked here again.
- F-LUCIKEA-01 held in part. "Show changes" put the lines of a file into
  the page as HTML, and the raw editor and the JSON fields put their text
  in as HTML too, which decodes entities. The way in the audit named, a
  LAN client sending a host name with markup, did not hold: Kea 3.0.4
  replaces every character but letters, digits, dots and hyphens in the
  name a client sends. What remains is a lease that another server of a
  pair passes on with any name, reserved and then shown in a diff. Fixed
  on the pages, with a check of all pages for such strings
  (`test/js/children.test.js`), and in the backend: a reservation gets
  only a host name.
- F-LUCIKEA-02 held. Kea's lexer reads `<? include "x" ?>`, with blanks,
  tabs and line ends inside, or with none (tried with `kea-dhcp4 -t`); the
  check looked for `<?include` only. Every `<?` is now checked. The
  masking for readers missed a secret behind a comment before the colon
  or with an escaped name; it now reads the text as the lexer does.
- F-LUCIKEA-03 held in part. A new file is created with mode 0600 and
  existing ones keep theirs until the chmod, so the window for other
  readers that the audit named did not exist. The lock in `/var/lock`,
  which anyone can write to, the exit code of `apk audit` that was not
  looked at, and the read of the lease file without a limit held.
- F-LUCIKEA-04 held in part. The backend of the services reads no JSON.
  The editor kept the entries of the interfaces it found, but wrote a
  device it newly listened on by its name alone; it now writes it with
  the interface's own address, as the generator does since `0.15.1`. The
  missing reload trigger is in the init script of the Kea package of the
  image, which the `ha-cluster` project maintains.
- Not done: the audit's advice to write `hostname-char-set` into the
  configuration the generator makes. Kea 3.0.4 uses that set by default
  already.
- The `ha-cluster` project tried the package of the pull request on its
  bench of two nodes in hot standby, on the owner's word: the cluster's
  switch to Kea, the move of the leases, "Reserve IP" on the standby, the
  lock and the lease read all did what they should.
- A second reading of the fixes by the same auditors (R-LUCIKEA-01) found
  four more points, all checked here:
  - Kea trims blanks, tabs and line ends off the path of a library
    (`PathChecker::validatePath()`), the check did not: with
    `"libdhcp_run_script.so "` and `/etc/shadow` as the script, Kea's
    check ran and said whether the file was executable. The path is now
    trimmed first.
  - Kea's lexer quotes a string it cannot read as it is written
    (`Bad escape in "..."`), and the output of the check went to readers
    as it was. So did the log, where a daemon that failed to start writes
    the same. Both now have the secrets of the files masked.
  - Between the check of the lease file and its read, a file in `/tmp`
    that anyone had made could become a pipe. Only a file of root's own,
    which nobody else can replace there, is read now.
  - The editor dropped the second entry of a device listed twice, such as
    `br-lan/a` and `br-lan/b`. Fixed. The other point, that every `<?` is
    taken for a directive also within strings and comments, stays: a check
    that told strings and comments apart would have to agree with Kea's
    lexer exactly, and the cost is a text refused with a clear reason.

## 2026-11-23: Release `v0.15.1`

- The owner said to merge and release. The tag is on the merge commit on
  `main`.
- The release workflow passed, with 174 backend tests and eight browser
  tests. The attached file holds the same files as a package built from
  the merged `main` by hand (compared with `apk adbdump`); its checksum is
  in the release text and matched the public download. Published as a
  pre-release.
- On the owner's two test routers, which have the files written by
  `0.15.0`, the `ha-cluster` project changed the entries of the interfaces
  by hand, on the owner's word. There, `br-lan` carried four addresses,
  and one exchange with a client was taken twelve times and answered
  eight times.

## 2026-11-23: One socket per device (`0.15.1-r1`)

- The two test routers of the owner were switched to Kea through
  `ha-cluster`, with the configuration made by `0.15.0`: both pairs in hot
  standby, 36 reservations and 27 leases moved. Kea warned at start with
  DHCPSRV_MULTIPLE_RAW_SOCKETS_PER_IFACE, since `br-lan` carried the
  address of the node and virtual addresses, as the `ha-cluster` project
  reported.
- The sources of Kea say why (`cfg_iface.cc`): a device named alone has
  all its IPv4 addresses active, and with raw sockets each address gets a
  socket that receives the broadcasts. Measured on the test machine with
  three addresses: three DISCOVERs, two OFFERs, three REQUESTs and three
  ACKs for one exchange; with `device/address`, one of each.
- The generator now writes the device with the router's own address. The
  files already written are left alone, as always.
- Also from those routers: static leases the import leaves for review
  (a lease time of its own) or blocks (no IPv4 address), which
  `ha-cluster` lists and points to the Import page for.

## 2026-11-22: Release `v0.15.0`

- The owner said to merge and release when ready. The tag is on the merge
  commit on `main`.
- The release workflow passed, with 173 backend tests and eight browser
  tests. The attached file holds the same files as a package built from
  the merged `main` by hand (compared with `apk adbdump`); its checksum is
  in the release text and matched the public download. Published as a
  pre-release.

## 2026-11-22: From dnsmasq to Kea in one step (M12, `0.15.0-r1`)

- Decided by the owner and passed on by the `ha-cluster` project, after a
  router of the owner whose Kea configuration, made by hand, listened on
  no interface. The contract of the command was agreed with that project
  before the work.
- apk keeps a checksum of every file of a package, and `apk audit
  --backup` marks a changed configuration file with "U": that tells the
  example of the Kea package from a file someone changed. OpenWrt has no
  `sha1sum` to compare the checksum directly, so the audit is used.
- Tried with a real client: dnsmasq served it, the command wrote the
  configuration, Kea started, the lease moved, and the client got its
  address again from Kea.
- The bench of the `ha-cluster` project ran this version on its pair of
  routers: the configuration written on both nodes, the pair in hot
  standby, a static lease and two leases moved, the client keeping both
  of its addresses and getting its renewals from Kea, its names in DNS.
  It also saw `ha-cluster nodes` not answering for a moment after a
  package was installed; the page and the command now ask again, and
  write nothing without an answer.
- The page first did not replace a changed file at all. Asked, the owner
  decided, as relayed, that it may after an explicit confirmation, keeping
  a backup; the command still never does.
- Asked by the `ha-cluster` project, which moves the leases after it has
  switched dnsmasq's DHCP off: dnsmasq 2.93 restarted without any DHCPv4
  range kept its lease file. With dnsmasq sending router advertisements
  instead of odhcpd the init script wrote no ra-only range on the test
  machine, so that case was not measured; `--leases-file` lets a caller
  pass a copy it saved before.

## 2026-11-22: Release `v0.14.0`

- The owner asked for the pull request to be merged and released
  ("сливай и выпускай"). The tag is on the merge commit on `main`.
- The release workflow passed, with 160 backend tests and seven browser
  tests. The attached file holds the same files as the package tested by
  hand (compared with `apk adbdump`), its checksum is in the release text
  and matched the public download. Published as a pre-release.

## 2026-11-22: After the audit (`0.14.0-r1`)

- An external audit of `v0.11.0` and `v0.13.0`, made for the image w0w6 of
  the owner, was passed on by the `ha-cluster` project with the owner's go.
  Each finding was checked against the code first.
- CA-LUCIKEA-01 held in part. `getConfig` gave readers the secrets of the
  files, and `saveConfig` let a writer have Kea, as root, read any file
  through an include directive and probe paths through the run_script
  hook. The point that a reader could have Kea check a text of their own
  did not hold: `validate` takes no text.
- CA-LUCIKEA-03 held and went further than the audit said: most pages,
  not only the lease tables, put texts from the router into the page as
  HTML. A real DHCP client that sent a host name with markup got it
  stripped by Kea 3.0.4, so a client on the LAN could not have used it
  with Kea's default settings.
- CA-LUCIKEA-02 held. Stop and Disable are gone for dnsmasq and odhcpd.
- Verified by hand over LuCI's JSON-RPC with a login that has the read
  groups only, and as root.
- For CA-HACLUSTER-01, the authentication of a Kea pair was measured with
  two servers: basic-auth on the peers left a stranger's `dhcp-disable`
  carried out, mutual TLS refused it. Kea 3.0.4 sets no authentication on
  the listener of a pair; its basic-auth parameters are for the requests a
  server sends. The results went to the `ha-cluster` project, which is to
  bring the question of the certificate to the owner.
- Two slips on the way, both found by the tests: an exported function of
  ucode needs a semicolon after its body; and a test that linked to
  `/etc/hostname`, which OpenWrt does not have. The second made the check
  stricter: an include that is a link is refused wherever it points.

## 2026-11-22: Releases `v0.11.0`, `v0.12.0` and `v0.13.0`

- The owner asked for the four open pull requests to be merged and
  released ("слей и выпусти сам и удали ветки потом"). They were merged in
  their order, and each version was tagged on its own merge commit on
  `main`, so that the three releases carry the version their changelog
  section names.
- The three runs of the release workflow passed: 152 backend tests and six
  browser tests for `v0.11.0`, 156 and seven for `v0.12.0` and `v0.13.0`.
  Each draft had its package, the checksum of that file in its text and
  its changelog section; the file of `v0.13.0` holds the same files as the
  package tested by hand (compared with `apk adbdump`). The drafts were
  published as pre-releases, and each file downloaded from its public link
  had its checksum.
- None of them was installed on the second test machine. The switch of
  `v0.13.0` waits for a build of `kea-dnsmasq-hosts` that puts its script in
  `/usr/share/kea/scripts`.

## 2026-11-22: Client names in DNS (`0.13.0-r1`)

- Approved by the owner, as relayed by the `ha-cluster` project, which made
  the packages for the other side: `kea-hook-run-script` and
  `kea-dnsmasq-hosts`. The application writes one hook entry.
- Kea refuses a configuration whose hook library is missing, with `-t` and
  with `-T` ("HOOKS_OPEN_ERROR"), so a package removed later shows as an
  error of the check of Kea; the application adds no warning of its own.
- Tried with the packages as that project built them: Kea 3.0.4 refused
  the script in `/usr/lib/kea-dnsmasq-hosts/`, because Kea 3 runs scripts
  from `/usr/share/kea/scripts` only. That project was told; the switch
  names `/usr/share/kea/scripts/kea-dnsmasq-hosts`. With the script copied
  there, the whole way worked: the switch, Save & Apply, a client's lease,
  the hosts file, and dnsmasq answering for the name.
- On the test machine Kea could not open its socket on the new interface
  while dnsmasq served DHCPv4 on `lan` ("failed to bind fallback socket"),
  as found before; with DHCP of dnsmasq off on `lan` it could.

## 2026-11-22: Leases on the overviews, and "Reserve IP" (`0.12.0-r1`)

- The owner asked whether the leases could be shown on the overview, with
  a picture of the section "DHCP Leases" of LuCI, and asked for both: the
  status overview of LuCI and the Overview page of the application.
- A section for the status overview of LuCI, and the same tables on the
  Overview page. The button "Reserve IP" of LuCI's section is there as
  well; it goes through the import, which already knew how to place a
  reservation and when not to.
- `getLeases` now marks the leases Kea reserves, and names the subnets
  with their interface.
- On the test machine the status overview showed the dialog of
  luci-app-attendedsysupgrade over the page, which the browser test closes
  without answering. A first version of that test waited for a change on
  the status overview while it had already moved to the Configuration page
  to read the file; it reopens the overview now.
- LuCI writes a remaining time as "0h 49m 57s"; the tables use its format,
  the Leases page keeps its own.

## 2026-11-22: The import from a shell, and an event after Kea (M10, `0.11.0-r1`)

- The owner decided that `ha-cluster` switches a cluster between dnsmasq
  and Kea by itself, and that the static leases are imported first, at the
  switch. Asked by the `ha-cluster` project, the import was first tried
  from a root shell over ubus on the test machine: it worked, and a nested
  call from an rpcd exec plugin as well, but not from anything the backend
  runs and waits for, and only while rpcd runs. A ucode script using the
  library directly worked with rpcd stopped.
- So: a command, `/usr/libexec/luci-app-kea/import-dnsmasq`, with the
  arguments and exit statuses agreed with that project, and a report of
  what it left. And the procd event `kea.service` after the four init
  actions, for a trigger of `ha-cluster`. An event at the change of a
  service flag, asked for first, was left out: it would have switched
  dnsmasq off before Kea was started.
- With two writers of the Kea files, every change now takes a lock. ucode
  locks a file with `lock("x")`, `lock("xn")` and `lock("u")`; `"ex"` is
  refused.
- Two slips on the way, both shown by the first test runs: ucode resolves
  names in order, so a function that calls one declared further down
  fails at run time ("access to undeclared variable"); and an assertion
  helper was used in an on-target test without being imported.
- Both items were approved by the owner in the words "luci-app-kea сделать
  команду импорта и отправлять событие после запуска, перезапуска или
  остановки Kea. - разрешаю", relayed by the `ha-cluster` project.

## 2026-11-21: A pair made by the application, on the bench of `ha-cluster`

No change to the package. The `ha-cluster` project ran the released
`0.10.1-r1` on its pair, as asked after the fix.

- The DHCP pages appeared at once, the button filled in the tab from the
  reply of `ha-cluster`, and Save & Apply on both nodes gave a pair of each
  protocol in hot-standby, with the firewall rule following and a client
  served by the primary. The first time this application made the
  configuration of a working pair.
- A LuCI user with only the group `luci-app-kea` gets "Login session is
  expired": LuCI itself needs `unauthenticated` and `luci-base` as well.
  The README and PACKAGING now name the three groups.

## 2026-11-21: Release `v0.10.1`

- The owner merged the pull request and asked for the release. The tag
  `v0.10.1` is on the merge commit on `main`.
- The release workflow passed: the tag and the changelog fit the version,
  the tagged commit is on `main`, the three CI jobs, and the draft release
  with the package, its checksum and the changelog section.
- The attached `luci-app-kea-0.10.1-r1.apk` holds the same files as the
  package built and tested by hand with the rpcd plugin of `ha-cluster`
  (compared with `apk adbdump`); the checksum in the release text is the
  one of the file. The draft was then published.
- It was tested in QEMU by the workflow, 137 backend tests on the router
  and six browser tests, not on the second test machine and not yet on the
  pair of the `ha-cluster` project, which was asked to run it again.

## 2026-11-21: The question to `ha-cluster` stopped LuCI (`0.10.1-r1`)

- The `ha-cluster` project ran `0.10.0-r1` on a pair of routers with its
  packages installed. The call of its firewall command worked: a port
  changed on both nodes was let through, and the pair came back to
  hot-standby. But `getHaNodes` took 30 seconds, returned nothing, and
  rpcd answered no other call in that time.
- Reproduced here with the rpcd plugin of its development tree on the test
  machine: 30.03 seconds, `session list` timing out meanwhile. Asked
  directly, `ha-cluster nodes` answers in 0.01 seconds.
- The cause: the backend runs inside rpcd and called an object that rpcd
  serves itself. It was in the package since `0.9.0`. No test had that
  plugin on its target; the browser test answered in its place.
- The fix: the pages ask `ha-cluster` themselves, the ACL names the call,
  and `getHaNodes` is gone, with the reduction of the reply moved from the
  backend to the model of the tab. A new test reads the backend sources
  and fails on a call to any ubus object but the one of procd.
- With the fix and the same plugin: the page is there after 0.2 seconds and
  the button fills in this server and both peers. This is the first time
  the fill-in met something other than the test's own answer.
- An edit made for this removed one more on-target test than intended; the
  count of cases, 136 where 137 were expected, showed it before the commit.

## 2026-11-21: Release `v0.10.0`

- The owner merged the pull request and pushed the tag `v0.10.0`, on the
  merge commit on `main`.
- The release workflow passed: the tag and the changelog fit the version,
  the tagged commit is on `main`, the three CI jobs, and the draft release
  with the package, its checksum and the changelog section. The section
  carries both the new call of `ha-cluster` and the fix made as `0.9.1-r1`.
- The attached `luci-app-kea-0.10.0-r1.apk` holds the same files as the
  package built and tested by hand before the pull request (compared with
  `apk adbdump`); the checksum in the release text is the one of the file.
- It was tested in QEMU by the workflow, 142 backend tests on the router
  and six browser tests, not on the second test machine.
- After the pull request, the `ha-cluster` project put a lock around
  everything that writes its firewall rules: a call from here may now wait
  for another writer, for a fraction of a second. The command and the lock
  are in its sources as `ha-cluster` 2.0.0-r11; no package was built from
  them yet.

## 2026-11-21: The firewall rules of `ha-cluster` follow Kea (`0.10.0-r1`)

- Asked for by the `ha-cluster` project, which now keeps the firewall rule
  for the ports of Kea's high availability and takes them from the Kea
  files; approved by the owner. The request was to reload `ha-cluster`
  after a Kea file was applied.
- Its sources were read first. A reload there starts an enabled cluster
  that is not running and stops a running one that is disabled. A first
  version here reloaded only a cluster that was enabled and running, in
  the background. Asked about it, the `ha-cluster` project made a command
  for the purpose, `/etc/init.d/ha-cluster firewall`, which touches the
  rules and no daemon. The backend calls that, and waits for it.
- rc.common answers an unknown command with its help text and the exit
  status 0, measured on OpenWrt 25.12.6. So the backend reads the init
  script and calls only a script that names the command.
- Tried on the test machine with the init script and library of the
  development tree of `ha-cluster` copied there: the rule appeared with
  port 8001 when Kea was started from the application and followed the
  port to 8011 and 8021 on reloads; a call that changed the port took 0.6
  seconds, one that changed nothing under 0.1; no cluster was started.
- The version is `0.10.0` by the rules, since an existing action now does
  more. `0.9.1-r1` was merged and never tagged; its fix is released with
  this version, and the changelog has one section for both.

## 2026-11-21: A peer URL needs a port (`0.9.1-r1`)

- The `ha-cluster` project read in the Kea sources that a peer URL without
  a port means port 0, and asked for a check on a running Kea. Two servers
  paired on the test machine with `http://127.0.0.1/` and
  `http://127.0.0.2/`: the hook accepted the files, the servers listened on
  ports 37387 and 35023, the heartbeats were refused, and both went to
  partner-down. With `:8001` and `:8002` they reached hot-standby.
- The tab had taken such a URL, as the hook does. It now asks for a port
  between 1 and 65535. The backend reports a file with such a URL as a
  third kind of warning: the pair cannot meet.
- One more on-target test saves such a file with the Kea of the target, to
  notice if the hook begins to refuse it.

## 2026-11-21: The server identifier of DHCPv6, measured

No change to the package. The owner agreed to a fixed identifier "if that
is a problem at all", so it was measured first.

- 22 boots with `kea-dhcp6` enabled, 12 of them with `kea-dhcp4` as well:
  it started every time, and had a new identifier every time. The boot of
  the day before, in which it did not start because it could not make an
  identifier, did not happen again.
- A real client on a pair of virtual interfaces, lifetimes of seconds, and
  a server that lost its lease file and identifier: the renewals at 15
  seconds were not answered, the rebind at 30 seconds was, and the client
  kept its address. With a fixed identifier the renewal at 15 seconds was
  answered.
- Conclusion: a later renewal, no loss. The item is set aside in the
  roadmap, and the README no longer presents it as something to do before
  use.
- From the `ha-cluster` project: it now writes the firewall rule for the
  ports of the pair itself, reading them from the Kea files, and asks that
  it be reloaded after the URLs change.

## 2026-11-21: Release `v0.9.0`

- The owner merged the M9 pull request and pushed the tag `v0.9.0`. It
  points at the last commit of that pull request, which is part of `main`
  and has the same content as its merge commit.
- The release workflow passed: the tag and the changelog fit the version,
  the tagged commit is on `main`, the three CI jobs, and the draft release
  with the package, its checksum and the changelog section.
- The attached `luci-app-kea-0.9.0-r1.apk` holds the same files as the
  package built and tested by hand the day before (compared with
  `apk adbdump`); the checksum in the release text is the one of the file.
- It was tested in QEMU by the workflow, not on the second test machine.

## 2026-11-20: Sockets at boot, the state of a daemon, peers from a cluster (M9, `0.9.0-r1`)

Approved by the owner after the findings of the same day.

- The DHCP pages write retries for the sockets when they make Kea listen on
  an interface; the Global settings tab has the two fields; a file that
  listens without retries is warned about.
- `getDaemonState`: the backend asks the running DHCP daemons for
  `status-get` over their control sockets, with the ucode socket module, a
  new dependency. Overview and Services show whether a daemon listens and
  the state of high availability.
- `getHaNodes` and the button **Fill in from ha-cluster**: the peers of the
  high availability tab from the nodes of a cluster.
- Measured again with DHCP of dnsmasq and odhcpd switched off on the LAN,
  because the first series was mixed up with dnsmasq holding port 67:
  without retries `kea-dhcp6` did not listen after any of four boots,
  `kea-dhcp4` after two of seven; with them both listened after four of
  four. A reload does not cure the state, a restart does.
- Seen for real through the pages: a daemon that does not listen, a pair of
  two Kea processes on one machine in hot standby, the pair while it
  synchronized, and the primary after its partner was stopped.
- Found on the way: the server identifier of DHCPv6 changes at every boot,
  and in one boot `kea-dhcp6` did not start because it could not make one.
  Written down in STATUS and proposed in the roadmap; not changed.
- The firewall rule for the ports of the pair is for `ha-cluster` to write,
  by the owner's word; passed on to that project.
- Tests: 100 ucode cases on any machine, 132 on a target, 80 JavaScript
  cases, six browser tests. The fixtures now carry the retries.

## 2026-11-20: Kea at boot, and a pair of Kea servers on another bench

No change to the package. The `ha-cluster` project, another project of the
owner, ran a pair of Kea 3.0.4 servers in hot standby next to VRRP and
passed on what it found.

- Reproduced on the test machine: Kea started at boot before the LAN
  bridge is ready runs without listening and stays that way; the two
  `service-sockets` parameters in `interfaces-config` cure it. In that state
  the application shows the daemon as running.
- Measured for this application: Kea accepts `<?include?>` for a part of the
  high availability settings, and the forms cannot open such a file; a
  SIGHUP makes a daemon read a file that was saved without applying, and
  with a file it cannot load it keeps its previous configuration.
- Taken as reported, not reproduced: the pair exchanged leases and a client
  kept its addresses through a stopped server, a cut-off node and a reboot;
  a Kea goes deaf when netifd creates its device anew, until it reads its
  configuration again.
- Written down: the limits in STATUS, a note in the README on what to add to
  `interfaces-config`, and a proposed roadmap milestone M9.

## 2026-11-20: Release `v0.8.0`, the first one the workflow prepared

- The owner merged the M8 pull request and pushed the tag `v0.8.0`. It
  points at the last commit of that pull request, which is part of `main`
  and has the same content as its merge commit.
- The release workflow ran for a real tag for the first time and passed:
  the tag fits the version in the Makefile, the tagged commit is on `main`,
  the three CI jobs, and the draft release with the package, its checksum,
  the changelog section and what it was tested on. The two steps that could
  not be rehearsed on a pull request, the check against `main` and the
  creation of the draft, worked.
- The attached `luci-app-kea-0.8.0-r1.apk` holds the same files as the
  package built and tested by hand the day before (compared with
  `apk adbdump`); the checksum in the release text is the one of the file.
- It was tested in QEMU by the workflow, not on the second test machine.

## 2026-11-19: Warnings beyond the Kea check (M8, `0.8.0-r1`)

The work proposed after the measurements of the same day, approved by the
owner.

- The rules were measured first, with Kea 3.0.4 on the QEMU machine. Kea
  compares the text before the last slash of a lease or log file name with
  its directory, so a subdirectory, `./` and a doubled slash are refused
  like `/tmp`. `kea-dhcp-ddns` and `kea-ctrl-agent` refuse a wrong log
  directory in their check, the DHCP daemons only when they start. Without
  loggers, and with the output `stdout`, every message reaches the system
  log through procd; with the files of the package, only what a daemon
  prints before it has read its loggers.
- Backend: `start_warnings()` and `log_outputs()` in `config.uc`; the
  warnings travel with the result of the check, with a file that is read and
  with a save; `getLog` also returns the log outputs. `openwrt.uc` reads
  what dnsmasq and odhcpd serve. `parse_log_line()` splits the lines that
  come through procd.
- Pages: the warning box, the question before a reload of a running daemon,
  the log file note on Overview, the Log Output field, and the "Configured
  to serve" column with the question before stopping dnsmasq or odhcpd.
- Checked by hand on the QEMU machine with `kea-dhcp4` running: with the
  answer no the daemon keeps running, with the answer yes it is gone after
  the reload.
- Tests: 88 ucode cases on any machine, 117 on a target, 72 JavaScript
  cases, and a sixth browser test, `warnings.js`, which answers the calls
  that would act on a service itself.
- Found on the way and written down, not changed: on a fresh installation
  the control agent file is reported as invalid until Kea was started once,
  because its password file does not exist yet.
- Not done: the names of Kea leases in the local DNS. `0.8.0-r1` was not
  installed on the second test machine.

## 2026-11-19: Lease and log paths of Kea 3, corrected documentation

Another project ran the release with a configuration it had generated and
reported that Kea did not start with a lease file in `/tmp`, although the
check had accepted the file. Measured again on the test machine with
Kea 3.0.4; no change to the package yet.

- A lease file outside `/var/lib/kea` and a log file outside `/var/log/kea`
  pass `-t` and `-T` and stop the daemon at start. A control socket or a
  hook library in a wrong directory is refused by the check.
- The configuration files shipped with Kea name a log file. `/var/log/kea`
  does not exist on OpenWrt, so their messages are lost, except the lines a
  daemon prints before it has read its loggers.
- Two statements in these documents were wrong and are corrected: that a
  configuration can name another place for the lease file, and that the
  shipped configurations log to syslog. The Overview picture shows a full
  log because its test configuration logged to syslog.
- Log lines that arrive through procd are shown without their severity
  split off.
- Proposed as roadmap milestone M8: warnings for such paths, the log
  destination on Overview, and a Services page that says what dnsmasq and
  odhcpd still serve.

## 2026-11-18: More pictures of the high availability tab

- Three pictures added to `docs/SCREENSHOTS.md`: load balancing with a
  backup server, input the form refuses, and the lines that switching high
  availability on adds to the file. The README shows the tab on its front
  page.
- `test/browser/screenshots.js` takes them, and accepts picture names to
  take only some.

## 2026-11-17: Target tests in CI, release from a tag, feed layout (M7)

No change to the package: the files of `0.7.0-r1` built after this work are
the same as those of the release.

- The package moved into the directory `luci-app-kea/`, the layout of an
  application in `openwrt/luci`. The repository now works as an OpenWrt
  feed. It did not before: tried in the SDK, the feed scripts ignore a
  package whose Makefile is at the root of the feed. CI builds from a
  `src-link` feed. `src-git` was tried by hand with the branch of this
  work; a tag is fetched the same way (tried with `v0.7.0`), but no tag has
  the new layout yet.
- `test/qemu-target.sh` boots the official OpenWrt image under QEMU and
  installs Kea and the package; `test/run-target-tests.sh` runs the
  on-target tests and the five browser tests against a target, with the
  fixtures loaded and removed. Both replace commands that were typed by
  hand before every release.
- A third CI job runs them for every pull request and for `main`. It took
  1 minute 44 seconds in its first run, with KVM on the GitHub runner, and
  6 minutes in a run the next day, in which the runner needed four and a
  half minutes to install QEMU and the browser. The machine and the tests
  took the same 80 seconds both times.
- `.github/workflows/release.yml` prepares a draft release from a version
  tag: it checks the tag against the Makefile and the changelog, runs the CI
  jobs on the tagged commit and attaches the package with its checksum.
  `tools/release-notes.sh` writes the text and runs in CI for every build.
- Playwright became a development dependency.
- `PKG_LICENSE_FILES` was dropped from the Makefile: the license text stays
  at the root of the repository.
- Not done: a signed package repository for `apk`, and a real DHCP client in
  the CI machine. The creation of the draft itself runs for the first time
  with the next tag; everything before it is rehearsed on pull requests that
  change the workflow.

## 2026-11-17: First release, `v0.7.0`

- Tag `v0.7.0` on `main` and a GitHub release, marked as a pre-release, with
  `luci-app-kea-0.7.0-r1.apk` from the CI run of the tagged commit.
- That file was installed on both test machines first and passed the
  on-target tests and the five browser tests.
- The README now sends users to the Releases page; the package CI builds
  from `main` is described as the development version.

## 2026-11-13: Changelog, version rules, installation from CI (M7, part)

- `CHANGELOG.md` with every version since `0.1.0-r1`, written for users of
  the package.
- `docs/RELEASING.md`: how versions are numbered, what stays stable within
  0.x, what to update with a version, and the steps of a release.
- The README explains how to install the package that CI builds.
- Open in M7, for the owner: tags and releases, tests on a target in CI, a
  custom feed, the submission to `openwrt/luci`.

## 2026-11-13: Runtime visibility (M6, `0.7.0-r1`)

- A Leases page: the DHCPv4 and DHCPv6 leases in use, read from the lease
  files of the memfile backend in the order Kea loads them. No hook library
  and no control channel is needed.
- Overview shows the Kea version and the last Kea messages of the system
  log, and folds the output of a successful configuration check.
- Two new read-only backend methods, `getLeases` and `getLog`.
- The lease file format was taken from the Kea 3.0.4 sources and checked
  with a DHCP client on a virtual interface pair: its DHCPv4 address, DHCPv6
  address and delegated prefix appeared on the page.
- Tests: 11 host cases and 3 on-target cases for the new module, a browser
  test of the page with a lease fixture.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-13: High availability (M5, `0.6.0-r1`)

- A "High availability" tab in the DHCPv4 and DHCPv6 editors, offered when
  `kea-hook-ha` is installed or the file already loads the hook: mode, this
  server, peers, timers, lease update switches, other parameters as JSON.
- The hook's rules were measured with about sixty configurations against
  `kea-dhcp4 -T` and `kea-dhcp6 -T` of Kea 3.0.4, and its fallback values
  taken from the Kea 3.0.4 sources.
- Finding: `kea-dhcp4 -t` does not look at hook parameters. The backend now
  checks the DHCP daemons with `-T`, which loads the hooks, and shows the
  error lines of the Kea output first.
- A save that Kea refuses no longer discards what the user typed, in the
  editors and in the raw editor.
- The form elements of the editor moved to `kea/widgets.js`.
- Tests: 20 cases for the high availability model, 16 browser checks of the
  tab, a backend case with the real hook.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4,
  including a daemon started with a setup made on the tab.

## 2026-11-12: Editor completeness (M4, `0.5.0-r1`)

- The DHCPv4 and DHCPv6 pages show every address pool and prefix delegation
  pool of a subnet as a row, and every option that has no field of its own.
  Until now the second pool of a subnet could not be seen or changed.
- Subnets inside shared networks have tabs and are edited where they are.
- A tab for the global settings: timers, lease file cleanup interval and
  global options.
- Input is checked in the browser against what Kea 3.0.4 was measured to
  refuse: pools and reserved addresses outside the subnet, overlapping
  pools, duplicate reservations, malformed identifiers, the same subnet
  twice. Wrong values are marked while typing. Only changed values are
  checked.
- A warning on an interface that OpenWrt already serves with dnsmasq or
  odhcpd; `getNetworkInterfaces` reports that per interface.
- **Show changes** in the editors and in the raw editor; the raw editor
  refuses text that is not JSON before sending it.
- One confirmation dialog for all pages (`kea/dialogs.js`).
- Tests: 47 model cases, 32 browser checks of the editors.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-12: Static lease import completed (M3, `0.4.0-r1`)

- The import reads static leases the way OpenWrt writes them: one host
  section yields a DHCPv4 entry (`mac`, `ip`) and a DHCPv6 entry (`duid`,
  `hostid`). Until now such a section was treated as DHCPv6 only and its
  DHCPv4 half was lost, and hex DUIDs without colons were rejected.
- Entries are compared with the Kea subnets and reservations: ready, needs
  review, changes Kea, already in Kea, or cannot import with the reason.
- DHCPv6 reservations are written to `kea-dhcp6.conf`; the IPv6 token is
  combined with the subnet prefix.
- Duplicate identifiers and addresses are detected.
- The user selects what to import. Both files are validated before either is
  replaced.
- No staging file: `/etc/kea/luci-reservations.json` is no longer read or
  written, and the package has no `conffiles` any more. A disabled static
  lease becomes a disabled reservation.
- The backend writes JSON in the same layout as the editors.
- Tests: 81 ucode cases (60 without a router), a browser test of the import.
- Verified on OpenWrt 25.12.6 (QEMU) and 25.12.5 (VMware) with Kea 3.0.4.

## 2026-11-12: ucode backend, tests and CI (M2, `0.3.0-r1`)

- The shell rpcd plugin is replaced by an rpcd ucode plugin
  (`/usr/share/rpcd/ucode/luci.kea`) on top of a library in `ucode/kea/`.
  The ubus object, its 14 methods and their replies are unchanged; the pages
  and the ACL were not touched, and the browser tests written for `0.2.0`
  pass unmodified.
- Component and service state comes from procd instead of `pgrep`.
- `validate` covers the control agent config.
- `kea-lfc` is a dependency.
- `setService` creates a missing `/etc/config/kea` section instead of
  reporting success without writing.
- Interfaces configured with `ipaddr` plus `netmask` are reported in CIDR
  form, so their subnet is matched to the interface tab.
- Backups made within one second keep their order after older ones are
  pruned. The earlier numbering reused freed numbers.
- Tests: 44 ucode cases that run on any machine with a ucode interpreter and
  23 more that run on OpenWrt; they replace `run-backend-tests.sh` and
  `run-import-fixture.sh`.
- ESLint with the JavaScript rules of the LuCI repository; GitHub Actions CI
  with lint, unit tests and an SDK build.
- Verified on OpenWrt 25.12.6 with Kea 3.0.4, as an upgrade from `0.2.0-r1`.

## 2026-11-11: Configuration safety (M1, `0.2.0-r1`)

- New shared modules under `htdocs/luci-static/resources/kea/`: `model.js`
  (configuration model), `backend.js` (RPC and save/apply sequence),
  `editor.js` (subnet editor used by both DHCP pages).
- The structured editors merge changed values into the existing subnet
  instead of rebuilding it. Extra pools, options, relay settings, client
  classes, `user-context` and reservation fields survive a save.
- DHCPv4 reservations by client ID, DUID, circuit ID and flex ID. "Client ID"
  removed from the DHCPv6 identifier list: Kea rejects it.
- Disabled reservations are stored in the subnet's `user-context`.
- Stock example entries are no longer removed silently; the page announces
  them and removes them on request.
- Subnets can be removed explicitly. New subnets get an unused ID.
- Backups in `/etc/kea/backups/` (ten per file), `listBackups` and
  `restoreBackup`, restore control on the Configuration page.
- **Save & Apply** reloads a running daemon and reports its state. The pages'
  own Save/Reload buttons are gone.
- The API password is never generated from the clock; a service section
  without `disabled` is read as enabled, like the init script does.
- `getConfig` no longer drops the final newline; `#` comments are understood.
- Tests: unit tests for the model, backend tests, end-to-end browser test.
- Verified on OpenWrt 25.12.6 with Kea 3.0.4. Finding: the stock Kea configs
  need the `kea-lfc` package to start, although `kea-* -t` accepts them
  without it.

## 2026-11-11: Packaging hygiene (M0, `0.1.0-r2`)

- Makefile reports the project URL, maintainer and a description; redundant
  dependencies dropped; `conffiles` declared; full Apache-2.0 license text.
- Ten unused view files removed; the remaining six have stable names.
- Menu parent uses `firstchild`. ACL reduced to the `luci.kea` methods.
- Translation template `po/templates/kea.pot` and `tools/update-pot.sh`.
- `create-and-push-github-repo.sh` removed.
- `test/run-import-fixture.sh` fixed: it compared against compact JSON, which
  `jshn` does not produce, so it had never passed on OpenWrt.
- Added `test/browser/smoke.js`.
- Verified with the OpenWrt 25.12.6 SDK and an OpenWrt 25.12.6 virtual machine
  running Kea 3.0.4.

## 2026-11-11: Project review

- Reviewed the code, the packaging and the documentation at `b6eedcf`.
- Compared the package with `luci.mk` and the feed contribution rules from an
  OpenWrt 25.12.6 tree. Results in [PACKAGING.md](PACKAGING.md).
- Recorded the implemented features and defects in [STATUS.md](STATUS.md) and
  reordered the plan in [ROADMAP.md](ROADMAP.md).
- Split the documentation into status, packaging, roadmap, design and
  development files. No code changes.
- Owner decisions: the maintainer entry stays as it is for now; the project
  stays a standalone repository with a later submission to `openwrt/luci` as
  the goal.

## 2026-05-16: Services page and alpha README

- Component checkboxes on the Services page are staged in the browser and
  written only by Save or Save & Apply.
- Save & Apply restarts Kea only when a component was already running.
- `setInitAction start|restart|reload` prepares `/var/run/kea`,
  `/var/lib/kea` and `/etc/kea/kea-api-password` first. This fixed start
  failures such as `Unable to open '/var/lib/kea/kea-leases4.csv'` and
  `Expected a file at path '/etc/kea/kea-api-password'`.
- `getStatus` reports runtime prerequisites and the state of dnsmasq and
  odhcpd.
- Added `setConflictAction`, limited to dnsmasq and odhcpd, and a "Potential
  Conflicts" table. The application never stops those services on its own.

## 2026-05-14: DHCPv6 editor

- Structured DHCPv6 page: one tab per interface, subnet, address pool, prefix
  delegation pool, DNS servers, domain search, timers.
- Reservations by DUID, MAC address, client ID or flex ID, with address and
  prefix lists.
- The listen checkbox reflects `interfaces-config.interfaces`; a tab with
  settings but no listen flag is still saved as a subnet.
- Unbound sample subnets under `2001:db8::/32` are hidden from the tabs.

## 2026-05-13: DHCPv4 editor, services rework, import commit

- Structured DHCPv4 page modeled on the pfSense per-interface layout.
- Added `getNetworkInterfaces`.
- Subnets without an `interface` are matched to an OpenWrt interface by
  network; unmatched subnets get a tab named after their CIDR.
- Saving from the structured pages removes the stock Kea sample subnets,
  options and client class.
- The LuCI footer buttons are wired to the editor save and reload handlers.
- Services page rebuilt as an init service table plus a component table.
- Removed `String.format()` from the views while fixing a blank page, and
  fixed nested-array rendering in the services and import tables.
- `importDnsmasqCommit` implemented: all entries staged in
  `/etc/kea/luci-reservations.json`, ready DHCPv4 entries merged into the
  matching Kea subnet.
- Views were renamed several times to defeat browser caching while files were
  copied to the test target by hand. This left the unused copies listed in
  [PACKAGING.md](PACKAGING.md#unused-view-files).

## 2026-05-12: Raw configuration editor

- Configuration page with `getConfigList`, `getConfig` and `saveConfig`.
- Validation changed to `kea-* -t <config>` (it was `-t -c <config>`).
- The backend creates `/var/run/kea` before validating, so default configs
  validate on a clean install before any Kea service has started.
- Added `test/run-import-fixture.sh`.

## 2026-05-10: Initial skeleton

- Package Makefile, menu, ACL.
- rpcd backend with `getStatus`, `getServices`, `setService`, `setInitAction`,
  `validate`, `importDnsmasqDryRun`.
- Overview, Services and Import preview pages.
- Import fixtures: valid IPv4, missing MAC, DHCPv6 DUID, truncated DUID,
  dnsmasq-only tag and DNS flag.
- Finding: `kea-uci` models only service switches, so DHCP settings must be
  edited as Kea JSON. See [DESIGN.md](DESIGN.md).
- First build as `luci-app-kea-0.1.0-r1.apk` in an OpenWrt 25.12.3 x86_64
  tree, installed on a test VM with Kea 3.0.2.

## Commits

| Commit | Date | Content |
|--------|------|---------|
| `543e2cb` | 2026-05-10 | Initial skeleton |
| `3d90e18` | 2026-05-10 | GitHub publish helper script |
| `fff2fb5` | 2026-05-13 | DHCPv4 editor, raw configuration editor, import fixture test |
| `db75250` | 2026-05-13 | Services status page |
| `b0c64d2` | 2026-05-13 | `String.format()` removal |
| `b6eedcf` | 2026-05-16 | DHCPv6 editor, import commit, staged service toggles, conflict controls, alpha README |
