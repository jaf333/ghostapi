import { heading, note, out, style } from './ui.js';

const COMMANDS: readonly (readonly [string, string])[] = [
  ['init', 'create a .ghostapi workspace in the current directory'],
  ['open <url>', 'open a real browser session and learn from what you do'],
  ['observe', 're-derive operations from everything already recorded'],
  ['targets', 'list known targets'],
  ['operations', 'list the operations discovered for a target'],
  ['inspect <operation>', 'show a single operation, its schema and its evidence'],
  ['run <operation> [json]', 'execute an operation without the UI'],
  ['ask "<intent>"', 'route natural language to an operation and run it'],
  [
    'export mcp|skill|ts|target',
    'emit an MCP server, an Agent Skill, a typed client or a portable target',
  ],
  ['import <file>', 'import a target definition someone else exported'],
  ['eval', 'run reliability evals against the target'],
  ['benchmark <operation>', 'measure the browser path against the API path'],
  ['mcp', 'serve the current operations over stdio MCP'],
  ['doctor', 'check Chrome, sessions, engines and workspace'],
];

const FLAGS: readonly (readonly [string, string])[] = [
  ['--target <slug>', 'act on a target other than the default'],
  ['--json', 'machine-readable output'],
  ['--yes, -y', 'confirm a destructive operation'],
  ['--headless', 'run the browser without a window'],
  ['--help, -h', 'show this message'],
];

export function printHelp(): void {
  out();
  out(`${style.bold('ghostapi')} ${style.gray('— turn web apps into agent-native operations')}`);
  out();
  out(style.gray('USAGE'));
  out('  ghostapi <command> [options]');
  heading('COMMANDS');
  const width = COMMANDS.reduce((max, [name]) => Math.max(max, name.length), 0);
  for (const [name, description] of COMMANDS) {
    out(`  ${name.padEnd(width)}  ${style.gray(description)}`);
  }
  heading('OPTIONS');
  const flagWidth = FLAGS.reduce((max, [name]) => Math.max(max, name.length), 0);
  for (const [name, description] of FLAGS) {
    out(`  ${name.padEnd(flagWidth)}  ${style.gray(description)}`);
  }
  out();
  out(style.gray('EXAMPLES'));
  out(`  ghostapi open http://localhost:4123`);
  out(`  ghostapi run createTodo '{"title":"Buy bread"}'`);
  out(`  ghostapi ask "create a todo called buy coffee"`);
  out(`  ghostapi export mcp`);
  out();
  note('Docs: https://github.com/ghostapi/ghostapi');
  out();
}
