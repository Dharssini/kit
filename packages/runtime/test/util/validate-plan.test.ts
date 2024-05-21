import test from 'ava';
import type { ExecutionPlan, Job } from '@openfn/lexicon';

import validate, { buildModel} from '../../src/util/validate-plan';

const job = (id: string, next?: Record<string, boolean>) =>
  ({
    id,
    next,
    expression: '.',
  } as Job);

  const mockConsoleWarn = () => {
    let consoleWarnMessages: string[] = [];
    const originalConsoleWarn = console.warn;
    console.warn = (...messages: string[]) => {
      consoleWarnMessages.push(...messages);
    };
    return { consoleWarnMessages, restore: () => { console.warn = originalConsoleWarn; } };
  };

test('builds a simple model', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [job('a', { b: true }), job('b')],
    },
  };

  const model = buildModel(plan);
  t.deepEqual(model, {
    a: {
      down: { b: true },
      up: {},
    },
    b: {
      down: {},
      up: { a: true },
    },
  });
});

test('builds a more complex model', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [job('a', { b: true }), job('b', { c: true, a: true }), job('c')],
    },
  };

  const model = buildModel(plan);
  t.deepEqual(model, {
    a: {
      down: { b: true },
      up: { b: true },
    },
    b: {
      down: { c: true, a: true },
      up: { a: true },
    },
    c: {
      up: { b: true },
      down: {},
    },
  });
});

test('throws for a circular dependency', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [job('a', { b: true }), job('b', { a: true })],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Circular dependency: b <-> a',
  });
});

test('throws for an indirect circular dependency', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true }),
        job('b', { c: true }),
        job('c', { a: true }),
      ],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Circular dependency: c <-> a',
  });
});

test('throws for a multiple inputs', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true, c: true }),
        job('b', { z: true }),
        job('c', { z: true }),
        job('z'),
      ],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Multiple dependencies detected for: z',
  });
});

test('throws for a an unknown job', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [job('next', { z: true })],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Cannot find job: z',
  });
});

test('throws for a an unknown job with shorthand syntax', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        {
          next: 'z',
          expression: '.',
        },
      ],
    },
  };
  t.throws(() => validate(plan), {
    message: 'Cannot find job: z',
  });
});

test('throws for invalid string start', (t) => {
  const plan: ExecutionPlan = {
    options: {
      start: 'z',
    },
    workflow: {
      steps: [job('a')],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Could not find start job: z',
  });
});


test('throws for step with adaptor but missing expression', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true }),
        { id: 'b', adaptor: 'some-adaptor' },
      ],
    },
  };

  t.throws(() => validate(plan), {
    message: "Step with adaptor 'some-adaptor' must have an expression. Step id: 'b'.",
  });
});

interface CustomStep extends Job {
  [key: string]: any;
}


test('throws for step with invalid key', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true }),
        { id: 'b', invalidKey: 'invalid', expression: '.' } as CustomStep, // Include required properties
      ],
    },
  };

  t.throws(() => validate(plan), {
    message: "Invalid key 'invalidKey' found in step with id 'b'.",
  });
});


test('throws for duplicate step IDs', (t) => {
  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true }),
        job('b', { c: true }),
        job('b', { c: true }),
        job('c'),
      ],
    },
  };

  t.throws(() => validate(plan), {
    message: 'Duplicate step ID detected: b',
  });
});

test('warns for unreferenced steps', (t) => {
  // Mock console.warn
  const { consoleWarnMessages, restore } = mockConsoleWarn();

  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [
        job('a', { b: true }),
        job('b', { c: true }),
        job('c'),
        job('d'),
      ],
    },
  };

  validate(plan);

  t.true(consoleWarnMessages.some(message => message.includes('[Validation Warning]: Unreferenced step detected: d')));

  // Restore original console.warn
    restore();
});

test('logs warning when steps array is empty', (t) => {
  // Mock console.warn
 
  const { consoleWarnMessages, restore } = mockConsoleWarn();

  const plan: ExecutionPlan = {
    options: {},
    workflow: {
      steps: [],
    },
  };

  validate(plan);

  t.true(consoleWarnMessages.some(message => message.includes('[Validation Warning]: The steps array is empty. There are no jobs to execute.')));

  // Restore original console.warn
  restore();
});

//warning if unrecognized options are passed
// Define a custom interface for options with indexer to allow for unrecognized keys
interface CustomOptions {
  [key: string]: any;
}

test('warns for unrecognized options', (t) => {
  // Mock console.warn
  const { consoleWarnMessages, restore } = mockConsoleWarn();

  const plan: ExecutionPlan = {
    options: {
      unrecognizedOption: 'value', // Pass an unrecognized option directly
    } as CustomOptions, // Cast to CustomOptions to allow unrecognized keys
    workflow: {
      steps: [],
    },
  };

  validate(plan);

  t.true(consoleWarnMessages.some(message => message.includes("Warning: Unrecognized option 'unrecognizedOption'")));


  restore();
});


//zod expression evaluation
test('throws error for step schema with invalid data', (t) => {
  const invalidStep = {
    id: 'step1',
    name: 'St', // Invalid name
    next: { step2: 'invalid' }, // Invalid next value
    adaptor: 'Ad', // Invalid adaptor
    expression: 123, // Invalid expression type
  };
  const executionPlan: ExecutionPlan = { options: {}, workflow: { steps: [invalidStep] } };
  const error = t.throws(() => validate(executionPlan)) as Error;
  t.is(error.message, "workflow.steps.0.name: Name must be at least 3 characters long\nworkflow.steps.0.adaptor: Adaptor must be at least 3 characters long\nworkflow.steps.0.expression: Expected string, received number");
});

test('throws error for execution plan schema with invalid data', (t) => {
  const invalidExecutionPlan = {
    options: {
      timeout: -5, // Invalid timeout
      start: 'start',
      end: 'end',
      
    },
    workflow: {
      steps: [
        { id: 'step1', expression: '.' },
        { id: 'step2', expression: '.' },
      ],
    },
  };
  const error = t.throws(() => validate(invalidExecutionPlan)) as Error;
  t.is(error.message, "options.timeout: Timeout must be a non-negative number");
});