#!/usr/bin/env node
// Renders the brand assets from the one source image, so every one of them can
// be regenerated instead of being a file somebody once exported by hand.
//
//   node scripts/render-brand.mjs
//
// Source:  assets/ghostapi-logo.png   (the mascot, on the brand blue)
// Outputs: assets/ghostapi-mark.png   (the mascot alone, transparent)
//          assets/ghostapi-social.png (1280×640 GitHub / X social preview)
//
// Requires ImageMagick 7 (`brew install imagemagick`).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const BRAND_BLUE = '#061EFD';
const INK = '#08080D';
const TEXT = '#FFFFFF';
const MUTED = '#9A9BAD';
const ACCENT = '#7C8CFF';

const SOURCE = join(ASSETS, 'ghostapi-logo.png');
const MARK = join(ASSETS, 'ghostapi-mark.png');
const SOCIAL = join(ASSETS, 'ghostapi-social.png');

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

if (!existsSync(SOURCE)) {
  process.stderr.write(`render-brand: missing ${SOURCE}\n`);
  process.exit(1);
}

// 1. The mascot alone. The source background is a flat brand blue and nothing in
//    the mascot is blue, so a keyed cut is exact rather than approximate.
magick([SOURCE, '-alpha', 'set', '-fuzz', '22%', '-transparent', BRAND_BLUE, '-trim', '+repage', MARK]);

// 2. The social card: 1280×640, which GitHub and X both accept without cropping.
const W = 1280;
const H = 640;
const GHOST_H = 400;

magick([
  // ink background with a brand-blue bloom behind where the mascot will sit
  '-size', `${W}x${H}`, `xc:${INK}`,
  // the bloom fades to fully transparent, so it leaves no tile edge behind
  '(', '-size', '900x900', `radial-gradient:${BRAND_BLUE}-none`,
  '-alpha', 'set', '-channel', 'A', '-evaluate', 'multiply', '0.5', '+channel',
  ')', '-geometry', '-130-130', '-compose', 'over', '-composite',

  // the mascot
  '(', MARK, '-resize', `x${GHOST_H}`, ')', '-geometry', '+130+120', '-compose', 'over', '-composite',

  // wordmark and tagline
  '-font', 'Helvetica-Neue-Bold', '-pointsize', '96', '-fill', TEXT,
  '-annotate', '+600+282', 'GhostAPI',
  '-font', 'Helvetica-Neue-Medium', '-pointsize', '27', '-fill', MUTED,
  '-annotate', '+604+336', 'Turn web apps into agent-native operations.',

  // the command, because that is the whole pitch
  '-fill', '#16161F', '-draw', 'roundrectangle 600,384 1176,446 10,10',
  '-font', 'JetBrains-Mono-Regular', '-pointsize', '22', '-fill', ACCENT,
  '-annotate', '+624+423', 'npx ghostapi open https://app.example.com',

  SOCIAL,
]);

process.stdout.write(`render-brand: wrote ${MARK}\nrender-brand: wrote ${SOCIAL}\n`);
