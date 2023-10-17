// Execute a compiled workflow
import * as workerEvents from '../worker/events';
import { ExecutionContext } from '../types';

import autoinstall from './autoinstall';
import compile from './compile';
import { workflowStart, workflowComplete, log } from './lifecycle';

const execute = async (context: ExecutionContext) => {
  const { state, callWorker, logger } = context;

  const adaptorPaths = await autoinstall(context);
  await compile(context);
  const events = {
    [workerEvents.WORKFLOW_START]: (evt: workerEvents.WorkflowStartEvent) => {
      workflowStart(context, evt);
    },
    [workerEvents.WORKFLOW_COMPLETE]: (
      evt: workerEvents.WorkflowCompleteEvent
    ) => {
      workflowComplete(context, evt);
    },
    [workerEvents.LOG]: (evt: workerEvents.LogEvent) => {
      log(context, evt);
    },
  };

  return callWorker('run', [state.plan, adaptorPaths], events).catch(
    (e: any) => {
      // TODO what about errors then?

      // If the worker file can't be found, we get:
      // code: MODULE_NOT_FOUND
      // message: cannot find modulle <path> (worker.js)

      logger.error(e);
    }
  );
};

export default execute;
