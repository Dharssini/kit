import path from 'node:path';
import { Opts, SafeOpts } from '../commands';
import { LogLevel, isValidLogLevel } from './logger';

export const defaultLoggerOptions = {
  default: 'default' as const,
  //  TODO fix to lower case
  job: 'debug' as const,
};

export const ERROR_MESSAGE_LOG_LEVEL =
  'Unknown log level. Valid levels are none, debug, info and default.';
export const ERROR_MESSAGE_LOG_COMPONENT =
  'Unknown log component. Valid components are cli, compiler, runtime and job.';

const componentShorthands: Record<string, string> = {
  cmp: 'compiler',
  rt: 'runtime',
  'r/t': 'runtime',
};

// TODO what about shorthands?
const isValidComponent = (v: string) =>
  /^(cli|runtime|compiler|job|default)$/i.test(v);

const ensureLogOpts = (opts: Opts) => {
  const components: Record<string, LogLevel> = {};
  if (opts.log) {
    // Parse and validate each incoming log argument
    opts.log.forEach((l: string) => {
      let component = '';
      let level = '';

      if (l.match(/=/)) {
        const parts = l.split('=');
        component = parts[0].toLowerCase();
        if (componentShorthands[component]) {
          component = componentShorthands[component];
        }
        level = parts[1].toLowerCase() as LogLevel;
      } else {
        component = 'default';
        level = l.toLowerCase() as LogLevel;
      }

      if (!isValidComponent(component)) {
        throw new Error(ERROR_MESSAGE_LOG_COMPONENT);
      }

      level = level.toLowerCase();
      if (!isValidLogLevel(level)) {
        // TODO need to think about how the CLI frontend handles these errors
        // But this is fine for now
        throw new Error(ERROR_MESSAGE_LOG_LEVEL);
      }

      components[component] = level as LogLevel;
    });
    // TODO what if other log options are passed? Not really a concern right now
  }
  return {
    ...defaultLoggerOptions,
    ...components,
  };
};

// TODO should this vary by command?
export default function ensureOpts(
  basePath: string = '.',
  opts: Opts
): SafeOpts {
  const newOpts = {
    adaptor: opts.adaptor, // TODO needs testing (and should only apply to the install command)
    autoinstall: opts.autoinstall,
    command: opts.command,
    force: opts.force || false,
    repoDir: opts.repoDir || process.env.OPENFN_REPO_DIR,
    noCompile: Boolean(opts.noCompile),
    outputStdout: Boolean(opts.outputStdout),
    packages: opts.packages, // TODO needs testing (and should only apply to the install command)
    stateStdin: opts.stateStdin,
    immutable: opts.immutable || false,
  } as SafeOpts;

  const set = (key: keyof Opts, value: string) => {
    // @ts-ignore TODO
    newOpts[key] = opts.hasOwnProperty(key) ? opts[key] : value;
  };

  let baseDir = basePath;
  if (basePath.endsWith('.js')) {
    baseDir = path.dirname(basePath);
    set('jobPath', basePath);
  } else {
    set('jobPath', `${baseDir}/job.js`);
  }
  set('statePath', `${baseDir}/state.json`);

  if (!opts.outputStdout) {
    set(
      'outputPath',
      newOpts.command === 'compile'
        ? `${baseDir}/output.js`
        : `${baseDir}/output.json`
    );
  }

  newOpts.log = ensureLogOpts(opts);

  // TODO if no adaptor is provided, default to language common
  // Should we go further and bundle language-common?
  // But 90% of jobs use something else. Better to use auto loading.
  if (opts.adaptors) {
    newOpts.adaptors = opts.adaptors;
    // newOpts.adaptors = opts.adaptors.map((adaptor) => {
    //   if (!adaptor.startsWith('@openfn/')) {
    //     return `@openfn/${adaptor}`
    //   }
    //   return adaptor
    // });
  }

  return newOpts;
}
