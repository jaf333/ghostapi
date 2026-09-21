import { isGhostError } from '@ghostapi/core';

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

const wrap = (open: string, close: string) => (text: string): string =>
  useColor ? `\u001b[${open}m${text}\u001b[${close}m` : text;

export const style = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  italic: wrap('3', '23'),
  underline: wrap('4', '24'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  cyan: wrap('36', '39'),
  gray: wrap('90', '39'),
};

export function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function err(line = ''): void {
  process.stderr.write(`${line}\n`);
}

export function heading(text: string): void {
  out();
  out(style.bold(text));
}

export function rule(width = 56): void {
  out(style.gray('─'.repeat(width)));
}

/** Two-column key/value block. Values align on a single column. */
export function keyValues(pairs: readonly (readonly [string, string])[], indent = ''): void {
  const width = pairs.reduce((max, [key]) => Math.max(max, key.length), 0);
  for (const [key, value] of pairs) {
    out(`${indent}${style.gray(key.padEnd(width))}  ${value}`);
  }
}

export interface Column {
  readonly header: string;
  readonly align?: 'left' | 'right';
}

export function table(columns: readonly Column[], rows: readonly (readonly string[])[]): void {
  if (rows.length === 0) return;
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...rows.map((row) => visibleLength(row[index] ?? ''))),
  );
  const renderRow = (cells: readonly string[], decorate: (text: string) => string): void => {
    const line = cells
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        const padding = ' '.repeat(Math.max(0, width - visibleLength(cell)));
        return columns[index]?.align === 'right' ? `${padding}${cell}` : `${cell}${padding}`;
      })
      .join('  ')
      .trimEnd();
    out(decorate(line));
  };
  renderRow(
    columns.map((column) => column.header),
    style.gray,
  );
  for (const row of rows) renderRow(row, (text) => text);
}

function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

export const symbols = {
  ok: style.green('✓'),
  fail: style.red('✗'),
  skip: style.gray('–'),
  arrow: style.gray('→'),
  bullet: style.gray('•'),
};

export function step(text: string): void {
  out(`${symbols.ok} ${text}`);
}

export function note(text: string): void {
  out(style.gray(text));
}

export function warn(text: string): void {
  err(`${style.yellow('!')} ${text}`);
}

/** Renders an error as title / detail / remedy. Nothing ever prints "Failed." */
export function renderError(error: unknown): void {
  err();
  if (isGhostError(error)) {
    err(style.red(style.bold(error.title)));
    err();
    err(error.detail);
    if (error.remedy) {
      err();
      for (const line of error.remedy.split('\n')) {
        err(line.startsWith('  ') ? style.cyan(line) : line);
      }
    }
    err();
    err(style.gray(`code: ${error.code}`));
    return;
  }
  err(style.red(style.bold('Unexpected error')));
  err();
  err(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack && process.env.GHOSTAPI_DEBUG === '1') {
    err();
    err(style.gray(error.stack));
  } else {
    err();
    err(style.gray('Re-run with GHOSTAPI_DEBUG=1 for a stack trace.'));
  }
}

export function confidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  const label = `${Math.round(confidence * 100)}%`.padStart(4);
  const color = confidence >= 0.95 ? style.green : confidence >= 0.75 ? style.cyan : style.yellow;
  return `${color(bar)} ${label}`;
}

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
