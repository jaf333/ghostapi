import { describe, expect, it } from 'vitest';
import { boolFlag, parse, parseJsonArgument, requirePositional, stringFlag } from './args.js';

describe('parse', () => {
  it('reads global flags', () => {
    const parsed = parse(['createTodo', '--json', '--target', 'demo', '-y']);
    expect(parsed.positionals).toEqual(['createTodo']);
    expect(boolFlag(parsed, 'json')).toBe(true);
    expect(boolFlag(parsed, 'yes')).toBe(true);
    expect(stringFlag(parsed, 'target')).toBe('demo');
  });

  it('reads command-specific flags', () => {
    const parsed = parse(['--runs', '3'], { runs: { type: 'string' } });
    expect(stringFlag(parsed, 'runs')).toBe('3');
  });

  it('explains an unknown flag instead of failing silently', () => {
    expect(() => parse(['--nope'])).toThrow(/command line/i);
  });

  it('defaults booleans to false', () => {
    expect(boolFlag(parse([]), 'json')).toBe(false);
  });
});

describe('requirePositional', () => {
  it('names what is missing', () => {
    expect(() => requirePositional(parse([]), 0, 'operation name')).toThrow(/operation name/);
  });
});

describe('parseJsonArgument', () => {
  it('accepts an object', () => {
    expect(parseJsonArgument('{"title":"x"}')).toEqual({ title: 'x' });
  });

  it('treats an absent argument as no inputs', () => {
    expect(parseJsonArgument(undefined)).toEqual({});
    expect(parseJsonArgument('   ')).toEqual({});
  });

  it('rejects a non-object', () => {
    expect(() => parseJsonArgument('[1,2]')).toThrow(/must be a JSON object/);
    expect(() => parseJsonArgument('"x"')).toThrow(/must be a JSON object/);
  });

  it('shows how to quote JSON when the shell mangled it', () => {
    try {
      parseJsonArgument('{title:x}');
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as { remedy?: string }).remedy).toMatch(/ghostapi run/);
    }
  });
});
