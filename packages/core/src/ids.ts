import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Monotonic-ish, sortable, collision-resistant id.
 * Time prefix keeps ids ordered on disk, which matters because observations are
 * correlated by time and we list them straight off the filesystem.
 */
function token(): string {
  const now = Date.now();
  let time = '';
  let n = now;
  while (n > 0) {
    time = ALPHABET[n % 36] + time;
    n = Math.floor(n / 36);
  }
  const random = randomBytes(6).toString('hex');
  return `${time}${random}`;
}

export type IdPrefix =
  | 'obs'
  | 'ui'
  | 'chg'
  | 'op'
  | 'sess'
  | 'trace'
  | 'span'
  | 'ev'
  | 'run'
  | 'bench';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${token()}`;
}

/** Deterministic, filesystem-safe slug used for target directory names. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length > 0 ? slug : 'target';
}
