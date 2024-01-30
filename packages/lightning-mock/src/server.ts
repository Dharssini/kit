import { EventEmitter } from 'node:events';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import koaLogger from 'koa-logger';
import createLogger, {
  createMockLogger,
  LogLevel,
  Logger,
} from '@openfn/logger';

import createWebSocketAPI from './api-sockets';
import createDevAPI from './api-dev';

import type { RunLogPayload, Run, DevServer } from './types';

type StepId = string;
type JobId = string;

export type RunState = {
  status: 'queued' | 'started' | 'complete';
  logs: RunLogPayload[];
  steps: Record<JobId, StepId>;
};

export type ServerState = {
  queue: RunId[];

  // list of credentials by id
  credentials: Record<string, any>;

  // list of runs by id
  runs: Record<string, Run>;

  // list of dataclips by id
  dataclips: Record<string, any>;

  // Tracking state of known runs
  // TODO include the engine id and token
  pending: Record<string, RunState>;

  // Track all completed runs here
  results: Record<string, { workerId: string; state: null | any }>;

  // event emitter for debugging and observability
  events: EventEmitter;
};

export type LightningOptions = {
  logger?: Logger;
  logLevel?: LogLevel;
  port?: string | number;
};

export type RunId = string;

// a mock lightning server
const createLightningServer = (options: LightningOptions = {}) => {
  const logger = options.logger || createMockLogger();

  const state = {
    credentials: {},
    runs: {},
    dataclips: {},
    pending: {},

    queue: [] as RunId[],
    results: {},
    events: new EventEmitter(),
  } as ServerState;

  const app = new Koa() as DevServer;
  app.use(bodyParser());

  app.state = state;

  const port = options.port || 8888;
  const server = app.listen(port);
  logger.info('Listening on ', port);

  // Only create a http logger if there's a top-level logger passed
  // This is a bit flaky really but whatever
  if (options.logger) {
    const httpLogger = createLogger('HTTP', { level: options.logLevel });
    const klogger = koaLogger((str) => httpLogger.debug(str));
    app.use(klogger);
  }

  // Setup the websocket API
  const api = createWebSocketAPI(
    state,
    '/worker', // TODO I should option drive this
    server,
    options.logger,
    options.logLevel
  );

  app.use(createDevAPI(app as any, state, logger, api));

  app.destroy = () => {
    server.close();
    api.close();
  };
  return app;
};

export default createLightningServer;
