// This will eventually contain all the error classes thrown by the engine

export class EngineError extends Error {
  source = 'engine';

  severity = '-'; // subclasses MUST provide this!
}

// This is thrown if a workflow takes too long to run
// It is generated by workerpool and thrown if the workerpool promise fails to resolve
export class TimeoutError extends EngineError {
  severity = 'kill';
  type = 'TimeoutError';
  duration;
  constructor(durationInMs: number) {
    super();
    this.duration = durationInMs;

    if (durationInMs) {
      this.message = `Workflow failed to return within ${durationInMs}ms`;
    } else {
      this.message = `Workflow failed to return within the specified time limit`;
    }
  }
}

// This is a catch-all error thrown during execution
export class ExecutionError extends EngineError {
  severity = 'exception';
  type = 'ExecutionError';
  name = 'ExecutionError';
  message;

  original: any; // this is the original error
  constructor(original: any) {
    super();
    this.original = original;

    this.message = original.message;
  }
}

export class CompileError extends EngineError {
  severity = 'crash'; // Syntax errors are crashes, but what if we get a module resolution thing?
  type = 'CompileError';
  subtype;
  message;
  jobId;

  constructor(error: any, jobId: string) {
    super();

    this.jobId = jobId;
    this.message = `${jobId}: ${error.message}`;
    this.subtype = error.type || error.constructor.name;
  }
}

export class AutoinstallError extends EngineError {
  severity = 'exception'; // Syntax errors are crashes, but what if we get a module resolution thing?
  type = 'AutoinstallError';
  name = 'AutoinstallError';
  message;

  constructor(specifier: string, error: any) {
    super();

    this.message = `Error installing ${specifier}: ${error.message}`;
  }
}

export class OOMError extends EngineError {
  severity = 'kill';
  type = 'OOMError';
  name = 'OOMError';
  message;

  constructor() {
    super();

    this.message = `Run exceeded maximum memory usage`;
  }
}

export class ExitError extends EngineError {
  severity = 'crash';
  type = 'ExitError';
  name = 'ExitError';
  code;
  message;

  constructor(code: number) {
    super();
    this.code = code;
    this.message = `Process exited with code: ${code}`;
    // Remove the stack trace
    // It contains no useful information
    this.stack = '';
  }
}

// CredentialsError (exception)
