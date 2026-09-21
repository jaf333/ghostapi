import { describe, expect, it } from 'vitest';
import { operationSchema, type Operation } from '@ghostapi/core';
import { HeuristicDecisionEngine } from './heuristic-engine.js';
import { extractArguments } from './extract-arguments.js';
import { routeIntent } from './router.js';

function operation(
  name: string,
  verb: Operation['verb'],
  entity: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
  destructive = false,
): Operation {
  return operationSchema.parse({
    id: `op_${name}`,
    name,
    description: `${verb} a ${entity}. Derived from evidence.`,
    entity,
    verb,
    inputs: { type: 'object', properties, required, additionalProperties: false },
    transport: {
      type: 'http',
      method: 'POST',
      urlTemplate: 'https://app.example.com/api/x',
      pathParams: [],
      query: {},
      headers: {},
      bodyKind: 'json',
      successStatuses: [200],
    },
    auth: { strategy: 'none' },
    confidence: 0.9,
    destructive,
    source: 'observed',
    createdAt: 1,
    updatedAt: 1,
  });
}

const catalogue: Operation[] = [
  operation(
    'createTodo',
    'create',
    'todo',
    {
      title: { type: 'string', examples: ['Buy milk'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], examples: ['normal'] },
    },
    ['title', 'priority'],
  ),
  operation('listTodos', 'list', 'todo'),
  operation('searchTodos', 'search', 'todo', { query: { type: 'string' } }, ['query']),
  operation(
    'updateTodo',
    'update',
    'todo',
    {
      todoId: { type: 'string', description: 'path parameter' },
      title: { type: 'string' },
    },
    ['todoId', 'title'],
  ),
  operation(
    'archiveTodo',
    'archive',
    'todo',
    {
      todoId: { type: 'string', description: 'path parameter' },
    },
    ['todoId'],
    true,
  ),
  operation(
    'deleteTodo',
    'delete',
    'todo',
    {
      todoId: { type: 'string', description: 'path parameter' },
    },
    ['todoId'],
    true,
  ),
  operation('listProjects', 'list', 'project'),
  operation('signIn', 'auth', 'session'),
];

const engine = new HeuristicDecisionEngine();

describe('HeuristicDecisionEngine', () => {
  const cases: [string, string][] = [
    ['create a todo called buy coffee', 'createTodo'],
    ['add a new todo named ship GhostAPI', 'createTodo'],
    ['show me all my todos', 'listTodos'],
    ['find todos about milk', 'searchTodos'],
    ['rename the todo to buy bread', 'updateTodo'],
    ['archive that todo', 'archiveTodo'],
    ['delete the todo', 'deleteTodo'],
    ['list my projects', 'listProjects'],
  ];

  for (const [intent, expected] of cases) {
    it(`routes "${intent}" to ${expected}`, async () => {
      const decision = await engine.choose({
        state: { request: intent },
        choices: catalogue.map((item) => item.name),
        criteria: Object.fromEntries(catalogue.map((item) => [item.name, item.description])),
        instructions: 'pick one',
      });
      expect(decision.choice).toBe(expected);
    });
  }

  it('reports a probability distribution that sums to one', async () => {
    const decision = await engine.choose({
      state: { request: 'create a todo' },
      choices: catalogue.map((item) => item.name),
      instructions: 'pick one',
    });
    const total = Object.values(decision.probabilities ?? {}).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(total).toBeCloseTo(1, 5);
  });

  it('reports low confidence when nothing matches', async () => {
    const decision = await engine.choose({
      state: { request: 'zzzz qqqq' },
      choices: catalogue.map((item) => item.name),
      instructions: 'pick one',
    });
    expect(decision.confidence).toBeLessThan(0.6);
  });

  it('is deterministic', async () => {
    const run = async () =>
      (
        await engine.choose({
          state: { request: 'create a todo called x' },
          choices: catalogue.map((item) => item.name),
          instructions: 'pick one',
        })
      ).choice;
    expect(await run()).toBe(await run());
  });
});

describe('extractArguments', () => {
  const createTodo = catalogue[0] as Operation;

  it('pulls a name out of a naming phrase', () => {
    const binding = extractArguments('create a todo called buy coffee', createTodo);
    expect(binding.inputs.title).toBe('buy coffee');
    expect(binding.bound.find((item) => item.field === 'title')?.source).toBe('phrase');
  });

  it('prefers quoted text', () => {
    const binding = extractArguments('create a todo "ship the launch post"', createTodo);
    expect(binding.inputs.title).toBe('ship the launch post');
  });

  it('honours an explicit assignment', () => {
    const binding = extractArguments('create a todo title="Explicit" priority=high', createTodo);
    expect(binding.inputs.title).toBe('Explicit');
    expect(binding.inputs.priority).toBe('high');
  });

  it('picks an enum member mentioned in the intent', () => {
    const binding = extractArguments('create a high priority todo called ship it', createTodo);
    expect(binding.inputs.priority).toBe('high');
  });

  it('falls back to the observed value and says so', () => {
    const binding = extractArguments('create a todo called x', createTodo);
    const priority = binding.bound.find((item) => item.field === 'priority');
    expect(priority?.source).toBe('observed-default');
    expect(priority?.note).toMatch(/observed/);
  });

  it('never invents an identifier for a destructive operation', () => {
    const archive = catalogue.find((item) => item.name === 'archiveTodo') as Operation;
    const binding = extractArguments('archive the todo', archive);
    expect(binding.inputs.todoId).toBeUndefined();
    expect(binding.missing).toContain('todoId');
  });

  it('never invents a path parameter even for a safe operation', () => {
    const update = catalogue.find((item) => item.name === 'updateTodo') as Operation;
    const binding = extractArguments('rename the todo to buy bread', update);
    expect(binding.inputs.title).toBe('buy bread');
    expect(binding.inputs.todoId).toBeUndefined();
    expect(binding.missing).toEqual(['todoId']);
  });
});

describe('routeIntent', () => {
  it('returns the chosen operation with bound arguments', async () => {
    const result = await routeIntent({
      intent: 'create a todo called buy coffee',
      operations: catalogue,
      engine,
    });
    expect(result.operation.name).toBe('createTodo');
    expect(result.binding.inputs.title).toBe('buy coffee');
  });

  it('refuses to act below the confidence threshold', async () => {
    await expect(
      routeIntent({ intent: 'zzzz qqqq', operations: catalogue, engine, minConfidence: 0.9 }),
    ).rejects.toThrow(/confident/i);
  });

  it('explains itself when there is nothing to choose from', async () => {
    await expect(routeIntent({ intent: 'anything', operations: [], engine })).rejects.toThrow(
      /no discovered operations/i,
    );
  });

  it('only ever chooses from the known catalogue', async () => {
    const result = await routeIntent({ intent: 'create a todo', operations: catalogue, engine });
    expect(catalogue.map((item) => item.name)).toContain(result.decision.choice);
  });
});
