import { ExecutionPlan, Step } from '@openfn/lexicon';
import { ValidationError } from '../errors';
import { z } from 'zod';

// Define Zod schemas for validation
const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, { message: 'Name must be at least 3 characters long' }).optional(),
  next: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  previous: z.any().optional(),
  adaptor: z.string().min(3, { message: 'Adaptor must be at least 3 characters long' }).optional(),
  expression: z.string().optional(),
  state: z.any().optional(),
  configuration: z.any().optional(),
  linker: z.any().optional(),
});

const executionPlanSchema = z.object({
  options: z.object({
    timeout: z.number().min(0, { message: 'Timeout must be a non-negative number' }).optional(),
    stepTimeout: z.number().min(0, { message: 'Step timeout must be a non-negative number' }).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    sanitize: z.boolean().optional(),
  }),
  workflow: z.object({
    steps: z.array(stepSchema),
  }),
});

// Type for the model node
type ModelNode = {
  up: Record<string, true>;
  down: Record<string, true>;
};

type Model = {
  [nodeId: string]: ModelNode;
};

//Main function to validate the execution plan
export default (plan: ExecutionPlan) => {
  // Validate the execution plan using zod schema
  try {
    executionPlanSchema.parse(plan);
    
  }
  catch (error) { 
    const zodError = error as z.ZodError;
    const formattedErrors = formatZodErrors(zodError.issues);
    throw new ValidationError(formattedErrorsToString(formattedErrors));
  }

  assertStart(plan);
  const model = buildModel(plan);
  assertNoCircularReferences(model);
  assertSingletonDependencies(model);
  //additional validation checks
  assertStepKeys(plan);
  assertValidOptions(plan.options);
  assertValidStepIds(plan.workflow.steps);
  assertUnreferencedSteps(model);
  return true;
};

// Helper function to format Zod errors
export const formatZodErrors = (errors: any[]) => {
  return errors.map(error => {
    return {
      code: error.code,
      message: error.message,
      path: error.path.join('.'),
    };
  });
};

export const formattedErrorsToString = (formattedErrors: { code: any; message: any; path: any; }[]) => {
  return formattedErrors.map(error => `${error.path}: ${error.message}`).join('\n');
};
export const buildModel = ({ workflow }: ExecutionPlan) => {
  const model: Model = {};
  if (workflow.steps.length === 0) {
    console.warn('[Validation Warning]: The steps array is empty. There are no jobs to execute.');
  }

  workflow.steps.forEach((step, index) => {
    const stepKeys = Object.keys(step);
    const requiredKeys = ['name', 'id', 'adaptor', 'configuration']; 
    const hasRequiredKey = requiredKeys.some(key => stepKeys.includes(key));

    if (!hasRequiredKey) {
      console.warn(`[Validation Warning]: The step at index ${index} is considered empty or invalid as it lacks required properties.`);
    }
  });

  const jobIdx = workflow.steps.reduce((obj, item) => {
    if (item.id) {
      obj[item.id] = item;
    }
    //// TODO warn if there's no id? It's usually fine (until it isn't)
    return obj;
  }, {} as Record<string, Step>);

  const ensureModel = (jobId: string) => {
    if (!model[jobId]) {
      model[jobId] = {
        up: {}, //ancestors / dependencies
        down: {}, //next / descendents
      };
    }
    return model[jobId];
  };

  const validateJob = (jobId: string) => {
    const next = jobIdx[jobId];
    if (!next) {
      throw new ValidationError(`Cannot find job: ${jobId}`);
    }
  };

  for (const job of workflow.steps) {
    let node = job.id ? ensureModel(job.id) : { up: {}, down: {} };
    if (typeof job.next === 'string') {
      validateJob(job.next);
    } else {
      for (const nextId in job.next) {
        validateJob(nextId);

        node.down[nextId] = true;

        const nextNode = ensureModel(nextId);
        if (job.id) {
            // TODO is this a big problem if a node is downstream of a node with no id?
          // Probably not, as there's no way to loop back to it
          nextNode.up[job.id] = true;
        }
      }
    }
  }
  return model;
};

const assertStart = (plan: ExecutionPlan) => {
  const { start } = plan.options;
  if (typeof start === 'string') {
    if (!plan.workflow.steps.find(({ id }) => id === start)) {
      throw new ValidationError(`Could not find start job: ${start}`);
    }
  }
};

// TODO this can be improved by reporting ALL circular references
// But that's out of scope for now
const assertNoCircularReferences = (model: Model) => {
  // Search the model for the same key in either direction
  const search = (from: keyof Model, targetId: keyof Model, key: 'up' | 'down') => {
    const node = model[from];
    const stream = node[key];
    for (const nextId in stream) {
      if (nextId === targetId) {
        throw new ValidationError(`Circular dependency: ${from} <-> ${targetId}`);
      }
      search(nextId, targetId, key);
    }
  };
  for (const id in model) {
    search(id, id, 'down');
    
  }
};
// This ensures that each step only has a single upstream edge,
// ie, each step only has a single input
// This is importand for the `--cache` functionality in the CLI,
// which assumes this rule when working out the input to a custom start node
const assertSingletonDependencies = (model: Model) => {
  for (const id in model) {
    const node = model[id];
    if (Object.keys(node.up).length > 1) {
      throw new ValidationError(`Multiple dependencies detected for: ${id}`);
    }
  }
};

// Ensure step keys are valid and meet specific requirements
const assertStepKeys = ({ workflow }: ExecutionPlan) => {
  const validKeys =new Set(['id', 'name', 'next', 'previous', 'adaptor', 'expression', 'state', 'configuration', 'linker']);
  workflow.steps.forEach(step => {
    if ('adaptor' in step && step.adaptor && !step.expression) {
      throw new ValidationError(`Step with adaptor '${step.adaptor}' must have an expression. Step id: '${step.id}'.`);
    }
    Object.keys(step).forEach(key => {
      if (!validKeys.has(key)) {
        throw new ValidationError(`Invalid key '${key}' found in step with id '${step.id}'.`);
      }
    });
  });
};

// Ensure options are valid
const assertValidOptions = (options: any) => {
  const validOptionsKeys = new Set(['timeout', 'stepTimeout', 'start', 'end', 'sanitize']);
  Object.keys(options).forEach(key => {
    if (!validOptionsKeys.has(key)) {
      console.warn(`Warning: Unrecognized option '${key}'`);
    }
  });
};

// Ensure step IDs don't contain duplicates
const assertValidStepIds = (steps: Step[]) => {
  const ids = new Set();
  for (const step of steps) {
    // if (!step.id) {
    //   throw new ValidationError(`Step without ID detected: ${JSON.stringify(step)}`);
    // }
    if (ids.has(step.id)) {
      throw new ValidationError(`Duplicate step ID detected: ${step.id}`);
    }
    ids.add(step.id);
  }
};

// Warn about unreferenced steps
const assertUnreferencedSteps = (model: Model) => {
  const referencedSteps = new Set();
  for (const id in model) {
    const node = model[id];
    Object.keys(node.up).forEach(upId => referencedSteps.add(upId));
    Object.keys(node.down).forEach(downId => referencedSteps.add(downId));
  }
  for (const id in model) {
    if (!referencedSteps.has(id) && Object.keys(model[id].down).length === 0) {
      console.warn(`[Validation Warning]: Unreferenced step detected: ${id}`);
    }
  }
};
