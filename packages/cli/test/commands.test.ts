import test from 'ava';
import mock from 'mock-fs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createMockLogger } from '@openfn/logger';

import { cmd } from '../src/cli';
import commandParser from '../src/commands';
import type { Opts } from '../src/options';
import { DEFAULT_REPO_DIR } from '../src/constants';

const logger = createMockLogger('', { level: 'debug' });

test.afterEach(() => {
  mock.restore();
  logger._reset();
});

const JOB_EXPORT_42 = 'export default [() => ({ data: { count: 42 } })];';
const JOB_TIMES_2 =
  'export default [(state) => { state.data.count = state.data.count * 2; return state; }];';
const JOB_MOCK_ADAPTOR =
  'import { byTwo } from "times-two"; export default [byTwo];';
const JOB_EXPORT_STATE =
  "export default [() => ({ configuration: {}, data: {}, foo: 'bar' })];";

type RunOptions = {
  jobPath?: string;
  statePath?: string;
  outputPath?: string;
  state?: any;
  repoDir?: string;
  logger?: {
    log: (s: string) => void;
  };
  disableMock?: boolean;
  mockfs: object;
};

// Helper function to mock a file system with particular paths and values,
// then run the CLI against it
async function run(command: string, job: string, options: RunOptions = {}) {
  // The command parser is consuming the openfn command wrongly all of a sudden
  // A good reason to move all these into integration tests tbh!
  command = command.replace(/^openfn /, '');

  const jobPath = options.jobPath || 'job.js';
  const statePath = options.statePath || 'state.json';
  const outputPath = options.outputPath || 'output.json';
  const state =
    JSON.stringify(options.state) || '{ "data": {}, "configuration": {} }';

  // Ensure that pnpm is not mocked out
  // This is needed to ensure that pnpm dependencies can be dynamically loaded
  // (for recast in particular)
  const pnpm = path.resolve('../../node_modules/.pnpm');
  const pkgPath = path.resolve('./package.json');

  // Mock the file system in-memory
  if (!options.disableMock) {
    mock({
      [jobPath]: job,
      [statePath]: state,
      [outputPath]: '{}',
      [pnpm]: mock.load(pnpm, {}),
      // enable us to load test modules through the mock
      '/modules/': mock.load(path.resolve('test/__modules__/'), {}),
      '/repo/': mock.load(path.resolve('test/__repo__/'), {}),
      '/monorepo/': mock.load(path.resolve('test/__monorepo__/'), {}),
      //'node_modules': mock.load(path.resolve('node_modules/'), {}),
      [pkgPath]: mock.load(pkgPath),
      ...(options.mockfs ?? {}),
    });
  }

  const opts = cmd.parse(command) as Opts;
  opts.path = jobPath;
  opts.repoDir = options.repoDir;

  opts.log = ['none'];
  opts.skipAdaptorValidation = true;

  await commandParser(jobPath, opts, logger);

  try {
    // Try and load the result as json as a test convenience
    const result = await fs.readFile(outputPath, 'utf8');
    if (result) {
      return JSON.parse(result);
    }
  } catch (e) {
    // do nothing
  }
}

test.serial('print version information with version', async (t) => {
  await run('version', '', { logger });

  const last = logger._parse(logger._last);
  const message = last.message as string;
  t.assert(message.length > 1);
  t.regex(message, /Versions:/);
  t.regex(message, /node.js/);
});

test.serial('run test job with default state', async (t) => {
  await run('test', '', { logger });
  const { message } = logger._parse(logger._last);
  t.assert(message === 'Result: 42');
});

test.serial('run test job with custom state', async (t) => {
  const state = JSON.stringify({ data: { answer: 1 } });
  await run(`test -S ${state}`, '', { logger });
  const { message } = logger._parse(logger._last);
  t.assert(message === 'Result: 1');
});

test.serial('run a job with defaults: openfn job.js', async (t) => {
  const result = await run('openfn job.js', JOB_EXPORT_42);
  t.assert(result.data.count === 42);
});

test.serial('run a workflow', async (t) => {
  const workflow = {
    jobs: [
      {
        id: 'job1',
        data: { x: 0 },
        expression: 'export default [s => { s.data.x += 1; return s; } ]',
        next: { job2: true },
      },
      {
        id: 'job2',
        expression: 'export default [s => { s.data.x += 1; return s; } ]',
      },
    ],
  };

  const options = {
    outputPath: 'output.json',
    jobPath: 'wf.json', // just to fool the test
  };

  const result = await run('openfn wf.json', JSON.stringify(workflow), options);
  t.assert(result.data.x === 2);
});

test.serial('run a workflow with config as an object', async (t) => {
  const workflow = {
    jobs: [
      {
        data: { x: 0 },
        configuration: { y: 0 },
        expression:
          'export default [s => { s.data.y = s.configuration.y; return s}]',
      },
    ],
  };

  const options = {
    outputPath: 'output.json',
    jobPath: 'wf.json', // just to fool the test
  };
  const result = await run('openfn wf.json', JSON.stringify(workflow), options);
  t.deepEqual(result, {
    data: { x: 0, y: 0 },
  });
});

test.serial('run a workflow with config as a path', async (t) => {
  const workflow = {
    jobs: [
      {
        data: { x: 0 },
        configuration: '/config.json',
        expression:
          'export default [s => { s.data.y = s.configuration.y; return s}]',
      },
    ],
  };

  const options = {
    outputPath: 'output.json',
    jobPath: 'wf.json', // just to fool the test
    mockfs: {
      '/config.json': JSON.stringify({ y: 0 }),
    },
  };
  const result = await run('openfn wf.json', JSON.stringify(workflow), options);
  t.deepEqual(result, {
    data: { x: 0, y: 0 },
  });
});

// TODO: this fails because of how paths are resolved in the test harness
//      We'll move it to an integration test soon
test.serial.skip(
  'run a trivial job from a folder: openfn ~/openfn/jobs/the-question',
  async (t) => {
    const options = {
      // set up the file system
      jobPath:
        '~/openfn/jobs/the-question/what-is-the-answer-to-life-the-universe-and-everything.js',
      outputPath: '~/openfn/jobs/the-question/output.json',
      statePath: '~/openfn/jobs/the-question/state.json',
    };

    const result = await run(
      'openfn ~/openfn/jobs/the-question',
      JOB_EXPORT_42,
      options
    );
    t.assert(result === 42);

    const output = await fs.readFile(
      '~/openfn/jobs/the-question/output.json',
      'utf8'
    );
    t.assert(output === '42');
  }
);

test.serial(
  'output to file: openfn job.js --output-path=/tmp/my-output.json',
  async (t) => {
    const options = {
      outputPath: '/tmp/my-output.json',
    };
    const result = await run(
      'openfn job.js --output-path=/tmp/my-output.json',
      JOB_EXPORT_42,
      options
    );
    t.is(result.data.count, 42);

    const output = await fs.readFile('/tmp/my-output.json', 'utf8');
    const outputJson = JSON.parse(output);
    t.is(outputJson.data.count, 42);
  }
);

test.serial(
  'output to file with alias: openfn job.js -o=/tmp/my-output.json',
  async (t) => {
    const options = {
      outputPath: '/tmp/my-output.json',
    };
    const result = await run(
      'openfn job.js -o /tmp/my-output.json',
      JOB_EXPORT_42,
      options
    );
    t.is(result.data.count, 42);

    const output = await fs.readFile('/tmp/my-output.json', 'utf8');
    const outputJson = JSON.parse(output);
    t.is(outputJson.data.count, 42);
  }
);

test.serial(
  'output to file with strict state: openfn job.js --output-path=/tmp/my-output.json --strict',
  async (t) => {
    const options = {
      outputPath: '/tmp/my-output.json',
    };

    const result = await run(
      'openfn job.js --output-path=/tmp/my-output.json --strict',
      JOB_EXPORT_STATE,
      options
    );
    t.deepEqual(result, { data: {} });

    const expectedFileContents = JSON.stringify({ data: {} }, null, 2);
    const output = await fs.readFile('/tmp/my-output.json', 'utf8');
    t.is(output, expectedFileContents);
  }
);

test.serial(
  'output to file with non-strict state: openfn job.js --output-path=/tmp/my-output.json --no-strict-output',
  async (t) => {
    const options = {
      outputPath: '/tmp/my-output.json',
    };

    const result = await run(
      'openfn job.js --output-path=/tmp/my-output.json --no-strict-output',
      JOB_EXPORT_STATE,
      options
    );
    t.deepEqual(result, { data: {}, foo: 'bar' });

    const expectedFileContents = JSON.stringify(
      { data: {}, foo: 'bar' },
      null,
      2
    );
    const output = await fs.readFile('/tmp/my-output.json', 'utf8');
    t.assert(output === expectedFileContents);
  }
);

test.serial(
  'output to file with non-strict state: openfn job.js --output-path=/tmp/my-output.json --no-strict',
  async (t) => {
    const options = {
      outputPath: '/tmp/my-output.json',
    };

    const result = await run(
      'openfn job.js --output-path=/tmp/my-output.json --no-strict',
      JOB_EXPORT_STATE,
      options
    );
    t.deepEqual(result, { data: {}, foo: 'bar' });

    const expectedFileContents = JSON.stringify(
      { data: {}, foo: 'bar' },
      null,
      2
    );
    const output = await fs.readFile('/tmp/my-output.json', 'utf8');
    t.assert(output === expectedFileContents);
  }
);

test.serial(
  'read state from file: openfn job.js --state-path=/tmp/my-state.json',
  async (t) => {
    const options = {
      statePath: '/tmp/my-state.json',
      state: { data: { count: 33 } },
    };
    const result = await run(
      'openfn job.js --state-path=/tmp/my-state.json',
      JOB_TIMES_2,
      options
    );
    t.assert(result.data.count === 66);
  }
);

test.serial(
  'read state from file with alias: openfn job.js -s /tmp/my-state.json',
  async (t) => {
    const options = {
      statePath: '/tmp/my-state.json',
      state: { data: { count: 33 } },
    };
    const result = await run(
      'openfn job.js -s /tmp/my-state.json',
      JOB_TIMES_2,
      options
    );
    t.assert(result.data.count === 66);
  }
);

test.serial(
  'read state from stdin: openfn job.js --state-stdin=<obj>',
  async (t) => {
    const state = JSON.stringify({ data: { count: 11 } });
    const result = await run(
      `openfn job.js --state-stdin=${state}`,
      JOB_TIMES_2
    );
    t.assert(result.data.count === 22);
  }
);

test.serial(
  'read state from stdin with alias: openfn job.js -S <obj>',
  async (t) => {
    const state = JSON.stringify({ data: { count: 44 } });
    const result = await run(`openfn job.js -S ${state}`, JOB_TIMES_2);
    t.assert(result.data.count === 88);
  }
);

test.serial(
  'override an adaptor: openfn --no-expand-adaptors -S <obj> --adaptor times-two=/modules/times-two',
  async (t) => {
    const state = JSON.stringify({ data: { count: 49.5 } });
    const result = await run(
      `openfn --no-expand-adaptors -S ${state} --adaptor times-two=/modules/times-two`,
      JOB_MOCK_ADAPTOR
    );
    t.assert(result.data.count === 99);
  }
);

test.serial(
  'override adaptors: openfn --no-expand-adaptors -S <obj> --adaptors times-two=/modules/times-two',
  async (t) => {
    const state = JSON.stringify({ data: { count: 49.5 } });
    const result = await run(
      `openfn --no-expand-adaptors -S ${state} --adaptors times-two=/modules/times-two`,
      JOB_MOCK_ADAPTOR
    );
    t.assert(result.data.count === 99);
  }
);

test.serial(
  'override adaptors: openfn --no-expand-adaptors -S <obj> -a times-two=/modules/times-two',
  async (t) => {
    const state = JSON.stringify({ data: { count: 49.5 } });
    const result = await run(
      `openfn --no-expand-adaptors -S ${state} -a times-two=/modules/times-two`,
      JOB_MOCK_ADAPTOR
    );
    t.assert(result.data.count === 99);
  }
);

test.serial(
  'auto-import from test module with repoDir: openfn job.js -S <obj> -a times-two',
  async (t) => {
    const state = JSON.stringify({ data: { count: 11 } });
    const job = 'export default [byTwo]';
    const result = await run(
      `openfn --no-expand-adaptors -S ${state} -a times-two`,
      job,
      {
        repoDir: '/repo',
      }
    );
    t.assert(result.data.count === 22);
  }
);

test.serial(
  'auto-import from test module with path: openfn job.js -S <obj> -a times-two',
  async (t) => {
    const state = JSON.stringify({ data: { count: 22 } });
    const job = 'export default [byTwo]';
    const result = await run(
      `openfn -S ${state} -a times-two=/modules/times-two`,
      job
    );
    t.assert(result.data.count === 44);
  }
);

test.serial(
  'auto-import from language-common (job): openfn job.js -a @openfn/language-common',
  async (t) => {
    const job = 'fn((state) => { state.data.done = true; return state; });';
    const result = await run('openfn -a @openfn/language-common', job, {
      repoDir: '/repo',
    });
    t.true(result.data?.done);
  }
);

test.serial(
  'run a workflow using language-common: openfn wf.json',
  async (t) => {
    const workflow = {
      jobs: [
        {
          adaptor: '@openfn/language-common',
          expression:
            'fn((state) => { state.data.done = true; return state; });',
        },
      ],
    };

    const options = {
      outputPath: 'output.json',
      jobPath: 'wf.json',
      repoDir: '/repo',
    };

    const result = await run(
      'openfn wf.json',
      JSON.stringify(workflow),
      options
    );
    t.true(result.data?.done);
  }
);

test.serial(
  'use execute from language-postgres: openfn job.js -a @openfn/language-postgres',
  async (t) => {
    const job =
      'fn((state) => { /* function isn\t actually called by the mock adaptor */ throw new Error("fake adaptor") });';
    const result = await run('openfn -a @openfn/language-postgres', job, {
      repoDir: '/repo',
    });
    t.assert(result === 'execute called!');
  }
);

test.serial(
  'load an adaptor from the monorepo env var: openfn job.js -m -a common',
  async (t) => {
    process.env.OPENFN_ADAPTORS_REPO = '/monorepo/';
    const job = 'export default [alterState(() => 39)]';
    const result = await run('openfn job.js -m -a common', job);
    t.assert(result === 39);
    delete process.env.OPENFN_ADAPTORS_REPO;
  }
);

test.serial('compile a job: openfn compile job.js to stdout', async (t) => {
  const options = {};
  await run('compile job.js', 'fn(42);', options);

  const { message } = logger._parse(logger._last);
  t.regex(message, /export default/);
});

test.serial('compile a job: openfn compile job.js to file', async (t) => {
  const options = {
    outputPath: 'out.js',
  };
  await run('compile job.js -o out.js', 'fn(42);', options);

  const output = await fs.readFile('out.js', 'utf8');
  t.is(output, 'export default [fn(42)];');
});

test.serial('compile a workflow: openfn compile wf.json to file', async (t) => {
  const options = {
    outputPath: 'out.json',
    jobPath: 'wf.json', // just to fool the test
  };

  const wf = JSON.stringify({
    start: 'a',
    jobs: [{ expression: 'x()' }],
  });
  await run('compile wf.json -o out.json', wf, options);

  const output = await fs.readFile('out.json', 'utf8');
  const result = JSON.parse(output);
  t.truthy(result);
  t.is(result.jobs[0].expression, 'export default [x()];');
});

test.serial.skip('repo should return the default repo path', async (t) => {
  const dir = process.env.OPENFN_REPO_DIR;
  delete process.env.OPENFN_REPO_DIR; // ensure this is unset

  const options = {
    logger,
  };
  await run('repo', '', options);
  console.log(logger._history);
  const { message } = logger._parse(logger._last);
  t.is(message, `Repo working directory is: ${DEFAULT_REPO_DIR}`);

  process.env.OPENFN_REPO_DIR = dir;
});

test.serial.skip('repo if modules_home is passed', async (t) => {
  const options = {
    repoDir: 'a/b/c',
    logger,
  };
  await run('repo', '', options);

  const { message } = logger._parse(logger._last);
  t.is(message, 'Repo working directory is: a/b/c');
});

test.serial.skip('repo with modules_home from env', async (t) => {
  const dir = process.env.OPENFN_REPO_DIR;
  process.env.OPENFN_REPO_DIR = 'x/y/z';

  const options = {
    logger,
  };
  await run('repo', '', options);

  const { message } = logger._parse(logger._last);
  t.is(message, 'Repo working directory is: x/y/z');

  process.env.OPENFN_REPO_DIR = dir;
});

test.serial('repo list should return something', async (t) => {
  const options = {
    logger,
    repoDir: 'a/b/c',
  };
  await run('repo list', '', options);

  // Rough check of the shape of the output
  const [_dir, pwd, installed] = logger._history;
  t.is(logger._parse(pwd).message, 'Repo working directory is: a/b/c');

  const message = logger._parse(installed).message as string;
  t.assert(message.startsWith('Installed packages:'));
});

// This used to throw, see #70
test.serial(
  'repo list does not throw if repo is not initialised',
  async (t) => {
    mock({
      '/repo/': {}, // empty dir
    });

    const opts = cmd.parse('repo list') as Opts;
    opts.repoDir = '/repo/';

    await commandParser('', opts, logger);

    const { message } = logger._parse(logger._last);
    t.truthy(message);
  }
);

test.serial('docs should print documentation with full names', async (t) => {
  mock({
    '/repo/docs/@openfn/language-common@1.0.0.json': JSON.stringify({
      name: 'test',
      functions: [
        {
          name: 'fn',
          parameters: [],
          examples: [],
        },
      ],
    }),
  });

  const opts = cmd.parse('docs @openfn/language-common@1.0.0 fn') as Opts;
  opts.repoDir = '/repo';

  await commandParser('', opts, logger);
  const docs = logger._parse(logger._history[3]).message as string;
  // match the signature
  t.regex(docs, /\#\# fn\(\)/);
  // Match usage examples
  t.regex(docs, /\#\#\# Usage Examples/);
  t.regex(
    docs,
    /https:\/\/docs.openfn.org\/adaptors\/packages\/common-docs#fn/
  );

  const { message, level } = logger._parse(logger._last);
  t.is(level, 'success');
  t.is(message, 'Done!');
});

test.serial('docs adaptor should print list operations', async (t) => {
  const pkgPath = path.resolve('./package.json');
  mock({
    [pkgPath]: mock.load(pkgPath),
    '/repo/docs/@openfn/language-common@1.0.0.json': JSON.stringify({
      name: 'test',
      version: '1.0.0',
      functions: [
        {
          name: 'fn',
          parameters: [{ name: 'a' }, { name: 'b' }],
          examples: [],
        },
      ],
    }),
  });

  const opts = cmd.parse('docs common@1.0.0') as Opts;
  opts.repoDir = '/repo';

  await commandParser('', opts, logger);
  const docs = logger._parse(logger._history[2]).message as string;
  t.notRegex(docs, /\[object Object\]/);
  t.notRegex(docs, /\#\#\# Usage Examples/);
  t.regex(docs, /fn\(a, b\)/);

  const { message, level } = logger._parse(logger._last);
  t.is(level, 'success');
  t.is(message, 'Done!');
});

test.serial(
  'docs adaptor + operation should print documention with shorthand names',
  async (t) => {
    mock({
      '/repo/docs/@openfn/language-common@1.0.0.json': JSON.stringify({
        name: 'test',
        functions: [
          {
            name: 'fn',
            parameters: [],
            examples: [],
          },
        ],
      }),
    });

    const opts = cmd.parse('docs common@1.0.0 fn') as Opts;
    opts.repoDir = '/repo';

    await commandParser('', opts, logger);
    const docs = logger._parse(logger._history[3]).message as string;
    // match the signature
    t.regex(docs, /\#\# fn\(\)/);
    // Match usage examples
    t.regex(docs, /\#\#\# Usage Examples/);
    t.notRegex(docs, /\[object Object\]/);
    t.regex(
      docs,
      /https:\/\/docs.openfn.org\/adaptors\/packages\/common-docs#fn/
    );

    const { message, level } = logger._parse(logger._last);
    t.is(level, 'success');
    t.is(message, 'Done!');
  }
);

// TODO - need to work out a way to test agaist stdout
// should return to stdout
// should log stuff to console
// should not log if silent is true

// TODO how would we test skip compilation and no validation? I guess we pass illegal code?
