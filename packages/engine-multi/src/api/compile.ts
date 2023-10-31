// This function will compile a workflow
// Later we'll add an in-memory cache to prevent the same job
// being compiled twice

import type { Logger } from '@openfn/logger';
import compile, { preloadAdaptorExports, Options } from '@openfn/compiler';
import { getModulePath } from '@openfn/runtime';
import { ExecutionContext } from '../types';

// TODO this compiler is going to change anyway to run just in time
// the runtime will have an onCompile hook
// We'll keep this for now though while we get everything else working
export default async (context: ExecutionContext) => {
  const { logger, state, options } = context;
  const { repoDir, noCompile } = options;

  if (!noCompile && state.plan?.jobs?.length) {
    for (const job of state.plan.jobs) {
      if (job.expression) {
        job.expression = await compileJob(
          job.expression as string,
          logger,
          repoDir,
          job.adaptor // TODO need to expand this. Or do I?
        );
      }
    }
  }
};

// TODO copied out of CLI - how can we share code here?
// engine should not have a dependency on the cli
// maybe this is a runtime  util
const stripVersionSpecifier = (specifier: string) => {
  const idx = specifier.lastIndexOf('@');
  if (idx > 0) {
    return specifier.substring(0, idx);
  }
  return specifier;
};

const compileJob = async (
  job: string,
  logger: Logger,
  repoDir?: string,
  adaptor?: string
) => {
  const compilerOptions: Options = {
    logger,
  };

  if (adaptor && repoDir) {
    // TODO I probably dont want to log this stuff
    const pathToAdaptor = await getModulePath(adaptor, repoDir, logger);
    const exports = await preloadAdaptorExports(pathToAdaptor!, false, logger);
    compilerOptions['add-imports'] = {
      adaptor: {
        name: stripVersionSpecifier(adaptor),
        exports,
        exportAll: true,
      },
    };
  }
  return compile(job, compilerOptions);
};
