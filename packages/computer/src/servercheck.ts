/**
 * What a box can run, and what to install on it when it cannot.
 *
 * A box in `ssh.machines` is one an operator set up by hand, and a profile that
 * makes machines there - a Docker on another box, a VM on a libvirt one - fails
 * late and in the runtime's own words when the box lacks the program it needs.
 * So the box is asked first: one `sh` script goes to it on stdin, prints one
 * `key=value` line per probe, and the answer is read here into a report with
 * the commands that fix each missing piece.
 *
 * Nothing is installed. The fixes are for the operator to run, because the box
 * is theirs and the commands need `sudo`. The one piece this host installs is
 * ahpd itself, in the user's own folder when a session first starts there
 * (`hostinstall.ts`), so its item says whether that install is there or can be
 * made, and the fix is what the download needs, or on a system no download is
 * made for, a `host` command for an ahpd of the box's own.
 */

import { HOST_MACHINES, HOST_ROOT, INSTALL_GLOB } from './hostinstall.js';

/** The items a report holds, in the order a reader is shown them. */
export const SERVER_ITEMS = [
  'os', 'arch', 'cpus', 'memory', 'disk',
  'docker', 'dockerAccess', 'kvm', 'libvirt', 'libvirtAccess', 'ahpd',
] as const;

/** One item a report holds. */
export type ServerItemName = typeof SERVER_ITEMS[number];

/** One item of a report. */
export interface ServerItem {
  /** Whether the box has it, as far as the probe could tell. */
  ok: boolean;
  /** What the probe found, in words a person reads: a version, a size, or why not. */
  found: string;
  /**
   * The lines that fix it, for the operator to run on the box.
   *
   * A line that starts with `#` is a note rather than a command, so the whole
   * list can be pasted into a shell as it is.
   */
  fix: string[];
}

/** What a box answered, item by item. */
export interface ServerReport {
  /** The user the box ran the script as, which is the one a group fix names. */
  user: string;
  items: Record<ServerItemName, ServerItem>;
}

/*
 * The script, which must run under any POSIX `sh` - `dash` on Debian, `ash` on
 * Alpine - and must not stop when a program is absent: every probe is guarded
 * by `command -v` or by its own `2>/dev/null`, and nothing here uses `set -e`.
 *
 * `sed` rather than `awk` or a sourced `/etc/os-release`, so a box needs only
 * what every system has and nothing of the box's own file is run as code.
 *
 * The ahpd this host installed is the newest folder under its root, and the
 * download that installs one needs `curl`, `tar`, `xz` and `sha256sum`. A box
 * whose `host` option names the command its host starts with is sent `named`
 * as the script's argument, and is asked none of that: the install does not
 * apply to it, as VS Code runs an agent host command it is given as written
 * and installs nothing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L913-L927
 */
const SCRIPT = `
first() { sed -n 1p; }
osval() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | tr -d '"' | first; }
echo "os_id=$(osval ID)"
echo "os_like=$(osval ID_LIKE)"
echo "os_name=$(osval PRETTY_NAME)"
echo "arch=$(uname -m 2>/dev/null | first)"
echo "cpus=$(nproc 2>/dev/null | first)"
echo "memory_kb=$(sed -n 's/^MemTotal: *\\([0-9]*\\).*/\\1/p' /proc/meminfo 2>/dev/null | first)"
free() { set -- $(df -Pk "$1" 2>/dev/null | sed -n 2p); echo "\${4:-}"; }
echo "home_free_kb=$(free "$HOME")"
echo "varlib_free_kb=$(free /var/lib)"
if command -v docker >/dev/null 2>&1; then
  v=$(docker version --format '{{.Client.Version}}' 2>/dev/null | first)
  echo "docker=\${v:-installed}"
  if docker info >/dev/null 2>&1; then echo docker_access=yes; else echo docker_access=no; fi
fi
if [ -e /dev/kvm ]; then echo kvm=yes; else echo kvm=no; fi
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then echo kvm_access=yes; else echo kvm_access=no; fi
if command -v virsh >/dev/null 2>&1; then
  v=$(virsh --version 2>/dev/null | first)
  echo "libvirt=\${v:-installed}"
  if virsh -c qemu:///system list >/dev/null 2>&1; then echo libvirt_access=yes; else echo libvirt_access=no; fi
fi
if [ "\${1:-}" = named ]; then
  echo host_named=yes
else
  echo "kernel=$(uname -s 2>/dev/null | first)"
  root=${HOST_ROOT}
  newest=$(ls -1td -- "$root"/${INSTALL_GLOB} 2>/dev/null | first)
  if [ -n "$newest" ] && [ -x "$newest/bin/ahpd" ]; then
    v=$("$newest/bin/ahpd" --version 2>/dev/null | first)
    echo "ahpd_installed=\${v:-installed}"
  fi
  missing=
  for tool in curl tar xz sha256sum; do command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"; done
  echo "fetch_missing=\${missing# }"
fi
echo "user=$(id -un 2>/dev/null)"
`;

/**
 * The commands the box runs, `named` the one for a box whose `host` option
 * names its host's command, and the script it reads on stdin.
 *
 * All are here, because a runtime that sends the script and a test that
 * answers in its place have to agree on the command it arrives as.
 */
export const SERVER_CHECK = { command: 'sh -s', named: 'sh -s -- named', script: SCRIPT } as const;

/** The keys the script prints, and nothing else is kept. */
const KEYS = new Set([
  'os_id', 'os_like', 'os_name', 'arch', 'cpus', 'memory_kb', 'home_free_kb', 'varlib_free_kb',
  'docker', 'docker_access', 'kvm', 'kvm_access', 'libvirt', 'libvirt_access', 'user',
  'kernel', 'ahpd_installed', 'fetch_missing', 'host_named',
]);

/** What the script printed, by key, with an unknown key left out. */
const probed = (text: string): Map<string, string> => {
  const held = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (KEYS.has(key)) held.set(key, line.slice(at + 1).trim());
  }
  return held;
};

/** A size in kibibytes, as a person reads it. */
const gib = (kb: number): string => `${(kb / 1024 / 1024).toFixed(1)} GiB`;

/** A whole number above zero, or nothing. */
const count = (value: string | undefined): number | undefined => {
  const held = Number(value);
  return value === undefined || value === '' || !Number.isFinite(held) || held <= 0 ? undefined : held;
};

const item = (ok: boolean, found: string): ServerItem => ({ ok, found, fix: [] });

/** How the ahpd item starts for a box that no Node download in `versions.json` is for. */
const NO_DOWNLOAD = 'no ahpd download is made for';

/**
 * A report from what the script printed, with no fixes yet.
 *
 * A key the script did not print is an item that is not there: `docker` is
 * printed only when the program is, so its absence is the answer.
 *
 * The ahpd item is ok when this host's install is there or the download can
 * make it, and for a box whose `host` option names the command its host starts
 * with, which is run as written.
 */
export const reportFrom = (text: string): ServerReport => {
  const said = probed(text);
  const get = (key: string): string => said.get(key) ?? '';

  const os = get('os_name') || get('os_id');
  const cpus = count(get('cpus'));
  const memory = count(get('memory_kb'));
  const home = count(get('home_free_kb'));
  const varlib = count(get('varlib_free_kb'));
  const docker = get('docker');
  const libvirt = get('libvirt');
  const installed = get('ahpd_installed');
  const missing = get('fetch_missing').split(' ').filter((one) => one !== '');
  const cannot = get('kernel') !== 'Linux' || !Object.values(HOST_MACHINES).flat().some((one) => one === get('arch'))
    ? `${NO_DOWNLOAD} ${`${get('kernel')} ${get('arch')}`.trim() || 'this system'}`
    : missing.length > 0 ? `the download needs ${missing.join(', ')}` : '';

  const disk = [
    ...(home === undefined ? [] : [`${gib(home)} free in the home folder`]),
    ...(varlib === undefined ? [] : [`${gib(varlib)} free in /var/lib`]),
  ];

  return {
    user: get('user'),
    items: {
      os: item(os !== '', os || 'unknown: /etc/os-release was not read'),
      arch: item(get('arch') !== '', get('arch') || 'unknown'),
      cpus: item(cpus !== undefined, cpus === undefined ? 'unknown' : String(cpus)),
      memory: item(memory !== undefined, memory === undefined ? 'unknown' : gib(memory)),
      disk: item(home !== undefined && varlib !== undefined, disk.length === 0 ? 'unknown' : disk.join(', ')),
      docker: item(docker !== '', docker || 'not installed'),
      dockerAccess: docker === ''
        ? item(false, 'no docker to reach')
        : get('docker_access') === 'yes'
          ? item(true, 'the user reaches the Docker daemon')
          : item(false, 'the user cannot reach the Docker daemon'),
      kvm: get('kvm') !== 'yes'
        ? item(false, 'no /dev/kvm')
        : get('kvm_access') === 'yes'
          ? item(true, 'the user can use /dev/kvm')
          : item(false, 'the user cannot read and write /dev/kvm'),
      libvirt: item(libvirt !== '', libvirt || 'not installed'),
      libvirtAccess: libvirt === ''
        ? item(false, 'no libvirt to reach')
        : get('libvirt_access') === 'yes'
          ? item(true, 'the user reaches qemu:///system')
          : item(false, 'the user cannot reach qemu:///system'),
      ahpd: get('host_named') === 'yes'
        ? item(true, 'the box starts its host with the command its host option names')
        : installed !== ''
          ? item(true, `${installed}, installed by this host`)
          : cannot === ''
            ? item(true, 'not installed yet: this host installs it when a session first starts here')
            : item(false, cannot),
    },
  };
};

/** The line a group fix ends with, because a new group takes effect only at a login. */
const RELOGIN = '# log in to the box again, so the new group applies';

/**
 * Whether the box's system is one the `apt` lines are written for.
 *
 * Read from the os item rather than kept beside it, so a report read back from
 * JSON is judged the same way.
 */
const debianLike = (text: string): boolean => /\b(debian|ubuntu)\b/i.test(text);

/**
 * The report with each missing item's fix.
 *
 * `user` is the account the group lines name, which is the box's own answer
 * when the script printed one. On a system that is not Debian or Ubuntu a fix
 * names the package only: a guessed command for a package manager this was not
 * written for is worse than none.
 */
export const fixesOf = (report: ServerReport, os: { id: string; like: string }, user = report.user): ServerReport => {
  const apt = debianLike(`${os.id} ${os.like}`);
  const who = user === '' ? '"$USER"' : user;
  const install = (packages: string, name: string): string[] => (apt
    ? [`sudo apt install ${packages}`]
    : [`# install ${name} with this system's package manager`]);
  const group = (name: string): string[] => [`sudo usermod -aG ${name} ${who}`, RELOGIN];

  const fixes: Partial<Record<ServerItemName, string[]>> = {
    docker: [...install('docker.io', 'Docker'), ...group('docker')],
    dockerAccess: report.items.docker.ok ? group('docker') : [],
    kvm: report.items.kvm.found === 'no /dev/kvm'
      ? ['# the CPU, or the machine this box runs on, does not offer KVM']
      : group('kvm'),
    libvirt: [
      ...install('libvirt-daemon-system qemu-system-x86 qemu-utils virtinst cloud-image-utils', 'libvirt, QEMU and virt-install'),
      ...group('libvirt'),
    ],
    libvirtAccess: report.items.libvirt.ok ? group('libvirt') : [],
    // What keeps this host from installing ahpd: a system no download is made
    // for starts an ahpd of the box's own, the command its `host` option names,
    // and a box short of a tool gets the packages the download runs.
    ahpd: report.items.ahpd.found.startsWith(NO_DOWNLOAD)
      ? ['# name the command that starts an ahpd of the box\'s own in its host option']
      : install('curl tar xz-utils coreutils', 'curl, tar, xz and sha256sum'),
  };

  const items = { ...report.items };
  for (const name of SERVER_ITEMS) {
    const held = items[name];
    items[name] = { ...held, fix: held.ok ? [] : fixes[name] ?? [] };
  }
  return { ...report, items };
};

/** The system a box answered, which `fixesOf` picks its lines by. */
export const osOf = (text: string): { id: string; like: string } => {
  const said = probed(text);
  return { id: said.get('os_id') ?? '', like: said.get('os_like') ?? '' };
};

/**
 * One box's report with its fixes, from a function that runs the script there.
 *
 * `run` is the runtime's: it sends `SERVER_CHECK.script` to the box as
 * `SERVER_CHECK.command`, or `SERVER_CHECK.named` for a box that names its
 * host's command, and answers what the box printed.
 */
export const checkServer = async (run: () => Promise<string>): Promise<ServerReport> => {
  const text = await run();
  return fixesOf(reportFrom(text), osOf(text));
};

/** How long a box's last report answers for it, in milliseconds. */
const KEPT_MS = 60_000;

/** What a gate answers with, before a machine is made on a box. */
export interface ServerGate {
  /**
   * Answers when the box has every need, and throws a sentence that names the
   * box, each missing need and each fix line when it does not.
   */
  requireOn(server: string, needs: readonly ServerItemName[]): Promise<void>;
}

/**
 * The check a profile with a `server` goes through before a machine is made.
 *
 * Each box's last report is kept for a minute, so a burst of creates on one
 * box costs one reach rather than one each, and a fix the operator just ran is
 * seen at the next create after that.
 */
export const serverGate = (check: (server: string) => Promise<ServerReport>, now: () => number = Date.now): ServerGate => {
  const kept = new Map<string, { at: number; report: Promise<ServerReport> }>();

  /** The box's report, from the minute just past or from a fresh check. */
  const reportOf = (server: string): Promise<ServerReport> => {
    const held = kept.get(server);
    if (held !== undefined && now() - held.at < KEPT_MS) return held.report;
    const report = check(server);
    kept.set(server, { at: now(), report });
    // A check that failed is not kept: the next create asks again.
    report.catch(() => { if (kept.get(server)?.report === report) kept.delete(server); });
    return report;
  };

  return {
    requireOn: async (server, needs) => {
      const report = await reportOf(server);
      const missing = needs.filter((need) => !report.items[need].ok);
      if (missing.length === 0) return;
      const lines = [...new Set(missing.flatMap((need) => report.items[need].fix))];
      const said = missing.map((need) => `${need} (${report.items[need].found})`).join(', ');
      throw new Error(`${server} cannot run this profile's machines: it lacks ${said}.${lines.length === 0 ? '' : ` Run on ${server}:\n${lines.join('\n')}`}`);
    },
  };
};
