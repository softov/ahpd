import { createHost } from './host.js';
import { listen } from './listen.js';

/**
 * The daemon.
 *
 * One host, one working directory, one port. A second directory is a second
 * daemon rather than a flag, because the working directory is what the
 * catalogue *is* - a host that served several would have to answer "which
 * sessions" before it could answer anything, and the protocol has no place to
 * ask.
 */

interface Options {
  port: number;
  path: string;
  help: boolean;
}

const USAGE = `ahpd - an Agent Host Protocol host that runs Claude Code

  ahpd [options]

  --port <n>      Listen here. Default 9187.
  --path <dir>    The directory this host's sessions live in.
                  Default: the directory the daemon was started in.
  --help, -h      This

Point a client at it:
  pnpm example chat --host ws://127.0.0.1:9187
`;

function parse(argv: string[]): Options {
  const options: Options = { port: 9187, path: process.cwd(), help: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': options.port = Number(argv[++i]); break;
      case '--path': options.path = String(argv[++i]); break;
      case '--help': case '-h': options.help = true; break;
      default:
        if (argv[i]?.startsWith('-')) {
          process.stderr.write(`Unknown option ${argv[i]}. Try --help.\n`);
          process.exit(2);
        }
    }
  }
  return options;
}

const options = parse(process.argv.slice(2));
if (options.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const host = createHost({
  path: options.path,
  onEvent: (message) => process.stdout.write(`${message}\n`),
});

// Whichever runtime this is. `listen` is the only file that knows, and it
// says which one it found - a daemon that silently ran somewhere unexpected
// would be a daemon nobody could tell apart from the one they meant to start.
const listener = await listen(options.port, (peer) => host.accept(peer));

process.stdout.write(
  `ahpd on ws://127.0.0.1:${listener.port} (${listener.runtime}), sessions in ${options.path}\n`,
);

const stop = (): void => {
  void Promise.resolve(listener.close()).finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
