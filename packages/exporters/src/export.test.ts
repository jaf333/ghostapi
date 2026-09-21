import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { operationSchema, targetSchema, type Operation } from '@ghostapi/core';
import { selectForExport } from './select.js';
import { sanitizeDescription, skillNameFor, exportSkill } from './export-skill.js';
import { renderType } from './ts-types.js';
import { exportMcp } from './export-mcp.js';
import { exportTypescript } from './export-ts.js';
import { readTargetBundle } from './export-target.js';

const target = targetSchema.parse({
  slug: 'demo-app',
  name: 'Demo App',
  origin: 'https://app.example.com',
  startUrl: 'https://app.example.com',
  createdAt: 1,
  updatedAt: 1,
});

function op(overrides: Record<string, unknown>): Operation {
  return operationSchema.parse({
    id: 'op_x',
    name: 'createTodo',
    description: 'Create a todo.',
    entity: 'todo',
    verb: 'create',
    inputs: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'high'] },
      },
      required: ['title'],
      additionalProperties: false,
    },
    output: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    transport: {
      type: 'http',
      method: 'POST',
      urlTemplate: 'https://app.example.com/api/todos',
      pathParams: [],
      query: {},
      headers: {},
      bodyKind: 'json',
      body: { kind: 'object', properties: { title: { kind: 'input', field: 'title' } } },
      successStatuses: [201],
    },
    auth: { strategy: 'browser-session', cookieNames: ['sid'] },
    confidence: 0.96,
    destructive: false,
    source: 'observed',
    observationCount: 5,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe('selectForExport', () => {
  it('keeps confident, non-destructive operations', () => {
    const result = selectForExport([op({})]);
    expect(result.selected).toHaveLength(1);
  });

  it('holds back destructive operations by default and explains why', () => {
    const result = selectForExport([op({ name: 'deleteTodo', destructive: true })]);
    expect(result.selected).toHaveLength(0);
    expect(result.excluded[0]?.reason).toMatch(/destructive/);
  });

  it('includes destructive operations when explicitly asked', () => {
    const result = selectForExport([op({ name: 'deleteTodo', destructive: true })], {
      includeDestructive: true,
    });
    expect(result.selected).toHaveLength(1);
  });

  it('holds back weakly evidenced operations', () => {
    const result = selectForExport([op({ confidence: 0.4 })]);
    expect(result.excluded[0]?.reason).toMatch(/confidence/);
  });

  it('holds back browser-only operations, which cannot run outside the CLI', () => {
    const result = selectForExport([
      op({
        transport: { type: 'browser', startUrl: 'https://app.example.com', steps: [] },
        fallbacks: [],
      }),
    ]);
    expect(result.excluded[0]?.reason).toMatch(/browser-only/);
  });

  it('honours an explicit allow-list', () => {
    const result = selectForExport([op({}), op({ name: 'listTodos', verb: 'list' })], {
      only: ['listTodos'],
    });
    expect(result.selected.map((item) => item.name)).toEqual(['listTodos']);
  });
});

describe('Agent Skill frontmatter rules', () => {
  it('strips angle brackets, which the spec rejects', () => {
    const description = sanitizeDescription('Handles GET /users/<id> returning Array<User>');
    expect(description).not.toMatch(/[<>]/);
  });

  it('caps the description at the spec limit', () => {
    expect(sanitizeDescription('x'.repeat(2000)).length).toBeLessThanOrEqual(1024);
  });

  it('produces a spec-legal skill name', () => {
    for (const slug of ['demo-app', 'Weird_Slug!!', '127-0-0-1-4123', 'a'.repeat(120)]) {
      const name = skillNameFor(slug);
      expect(name, slug).toMatch(/^[a-z0-9-]+$/);
      expect(name.startsWith('-')).toBe(false);
      expect(name.endsWith('-')).toBe(false);
      expect(name).not.toContain('--');
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });

  it('writes a SKILL.md whose directory name matches its name field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-skill-'));
    const result = await exportSkill({ target, operations: [op({})], outDir: dir });
    const content = await readFile(join(result.outDir, 'SKILL.md'), 'utf8');
    const name = /^name:\s*"?([^"\n]+)"?/m.exec(content)?.[1];
    expect(name).toBe(result.outDir.split('/').pop());
    expect(content.split('\n')[0]).toBe('---');
  });

  it('uses only the six frontmatter keys the spec allows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-skill-'));
    const result = await exportSkill({ target, operations: [op({})], outDir: dir });
    const content = await readFile(join(result.outDir, 'SKILL.md'), 'utf8');
    const frontmatter = content.split('---')[1] ?? '';
    const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((match) => match[1]);
    for (const key of keys) {
      expect([
        'name',
        'description',
        'license',
        'compatibility',
        'metadata',
        'allowed-tools',
      ]).toContain(key);
    }
  });

  it('keeps the catalogue out of SKILL.md and in references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-skill-'));
    const result = await exportSkill({ target, operations: [op({})], outDir: dir });
    expect(result.files).toContain('references/operations.md');
    const catalogue = await readFile(join(result.outDir, 'references/operations.md'), 'utf8');
    expect(catalogue).toContain('createTodo');
  });
});

describe('renderType', () => {
  it('renders an enum as a union of literals', () => {
    expect(renderType({ type: 'string', enum: ['low', 'high'] })).toBe("'low' | 'high'");
  });

  it('renders required and optional object properties', () => {
    const rendered = renderType({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    expect(rendered).toContain('a: string;');
    expect(rendered).toContain('b?: number;');
  });

  it('renders arrays and nullables', () => {
    expect(renderType({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(renderType({ type: 'string', nullable: true })).toBe('string | null');
  });

  it('quotes a property name that is not an identifier', () => {
    const rendered = renderType({
      type: 'object',
      properties: { 'x-y': { type: 'string' } },
      required: [],
    });
    expect(rendered).toContain("'x-y'?: string;");
  });
});

describe('exports carry no credentials', () => {
  it('writes no cookie or token value into any generated file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-export-'));
    const mcp = await exportMcp({ target, operations: [op({})], outDir: join(dir, 'mcp') });
    const ts = await exportTypescript({ target, operations: [op({})], outDir: join(dir, 'ts') });
    const skill = await exportSkill({ target, operations: [op({})], outDir: join(dir, 'skills') });

    const files = [
      ...mcp.files.map((name) => join(mcp.outDir, name)),
      ...ts.files.map((name) => join(ts.outDir, name)),
      ...skill.files.map((name) => join(skill.outDir, name)),
    ];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content, file).not.toMatch(/sid=|Bearer\s+[A-Za-z0-9._-]{8,}/);
    }
  });

  it('describes browser-session auth as a reference, not a value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-export-'));
    const mcp = await exportMcp({ target, operations: [op({})], outDir: join(dir, 'mcp') });
    const manifest = JSON.parse(await readFile(join(mcp.outDir, 'operations.json'), 'utf8')) as {
      operations: { auth: { strategy: string } }[];
    };
    expect(manifest.operations[0]?.auth.strategy).toBe('browser-session');
    expect(JSON.stringify(manifest)).not.toContain('value');
  });

  it('emits an MCP manifest with honest safety annotations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-export-'));
    const mcp = await exportMcp({
      target,
      operations: [op({ name: 'listTodos', verb: 'list', destructive: false, idempotent: true })],
      outDir: join(dir, 'mcp'),
    });
    const manifest = JSON.parse(await readFile(join(mcp.outDir, 'operations.json'), 'utf8')) as {
      operations: { readOnly: boolean; destructive: boolean }[];
    };
    expect(manifest.operations[0]?.readOnly).toBe(true);
    expect(manifest.operations[0]?.destructive).toBe(false);
  });
});

describe('importing an untrusted target bundle', () => {
  async function bundleFile(mutate: (bundle: Record<string, unknown>) => void): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-bundle-'));
    const file = join(dir, 'target.ghost.json');
    const base = {
      format: 1,
      generator: 'ghostapi/test',
      exportedAt: 1,
      target: { ...target, startUrl: 'https://app.example.com', origin: 'https://app.example.com' },
      operations: [op({})],
    } as unknown as Record<string, unknown>;
    mutate(base);
    await writeFile(file, JSON.stringify(base), 'utf8');
    return file;
  }

  it('accepts a well-formed public bundle', async () => {
    const file = await bundleFile(() => undefined);
    const audit = await readTargetBundle(file);
    expect(audit.bundle.operations).toHaveLength(1);
  });

  it('blocks a bundle aimed at cloud metadata, including via IPv4-mapped IPv6', async () => {
    for (const host of ['169.254.169.254', '[::ffff:169.254.169.254]', '127.0.0.1', '[::1]']) {
      const file = await bundleFile((bundle) => {
        const targetEntry = bundle.target as Record<string, unknown>;
        targetEntry.startUrl = `http://${host}/latest/meta-data/`;
        targetEntry.origin = `http://${host}`;
      });
      await expect(readTargetBundle(file), host).rejects.toThrow(/private/i);
    }
  });

  it('blocks a bundle whose operation URL points at a private address', async () => {
    const file = await bundleFile((bundle) => {
      const operations = bundle.operations as Record<string, unknown>[];
      const transport = operations[0]?.transport as Record<string, unknown>;
      transport.urlTemplate = 'http://[::ffff:10.0.0.5]/api/todos';
    });
    await expect(readTargetBundle(file)).rejects.toThrow(/private/i);
  });

  it('refuses a bundle that would replay a literal credential header', async () => {
    const file = await bundleFile((bundle) => {
      const operations = bundle.operations as Record<string, unknown>[];
      const transport = operations[0]?.transport as Record<string, unknown>;
      transport.headers = {
        'x-vendor-token': { kind: 'literal', value: 'shpat_1234567890abcdef1234567890abcdef' },
      };
    });
    await expect(readTargetBundle(file)).rejects.toThrow(/credential/i);
  });

  it('refuses a bundle from an unknown format version', async () => {
    const file = await bundleFile((bundle) => {
      bundle.format = 99;
    });
    await expect(readTargetBundle(file)).rejects.toThrow(/Unsupported target file/i);
  });

  it('warns about destructive operations instead of hiding them', async () => {
    const file = await bundleFile((bundle) => {
      bundle.operations = [op({ name: 'deleteTodo', verb: 'delete', destructive: true })];
    });
    const audit = await readTargetBundle(file);
    expect(audit.warnings.join(' ')).toMatch(/deleteTodo is destructive/);
  });
});
