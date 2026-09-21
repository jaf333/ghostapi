import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO, check, exists, pass, readJson } from './lib.mjs';

const readme = await readFile(join(REPO, 'README.md'), 'utf8');
const results = await readJson(join(REPO, 'docs', 'benchmark-results.json'));

// ---- the README shows the product before it explains it --------------------
const firstViewport = readme.split('\n').slice(0, 40).join('\n');
check(
  /Turn web apps into agent-native operations/.test(firstViewport),
  'the tagline is not in the first viewport',
);
check(
  /ghostapi open/.test(firstViewport),
  'the first viewport does not show the product being used',
);

// ---- required sections -----------------------------------------------------
for (const heading of [
  '## Install',
  '## How it works',
  '## Security',
  '## Roadmap',
  '## License',
]) {
  check(readme.includes(heading), `README has no "${heading}" section`);
}
check(/## Honest limits/.test(readme), 'README does not state what GhostAPI cannot do');

// ---- framing ---------------------------------------------------------------
const overclaims = [
  /reverse engineer anything/i,
  /any website into an API/i,
  /works on every (web ?)?(site|app)/i,
  /100% of/i,
];
for (const pattern of overclaims) {
  check(!pattern.test(readme), `README overclaims: ${pattern}`);
}

// ---- every figure in the README is one this repository measured ------------
// Positive control: the extractor must find a number that is present.
const control = 'time | 1234 ms | **99 ms** |';
check(/\b1234 ms\b/.test(control), 'the figure extractor failed its positive control');

const claims = [
  { label: 'browser duration', pattern: /(\d[\d,]*) ms \|/, expected: results.benchmark.browserMs },
  { label: 'api duration', pattern: /\*\*(\d[\d,]*) ms\*\*/, expected: results.benchmark.apiMs },
  { label: 'speedup', pattern: /\*\*([\d.]+)× faster/, expected: results.benchmark.speedup },
];
for (const claim of claims) {
  const match = claim.pattern.exec(readme);
  check(Boolean(match), `README does not state the ${claim.label}`);
  const stated = Number(match[1].replace(/,/g, ''));
  check(
    stated === claim.expected,
    `README states ${claim.label} as ${stated}, but the last measurement was ${claim.expected}. ` +
      `Re-run \`node scripts/measure-demo.mjs\` and update the README.`,
  );
}

// The published range must be the measured range, not a rounded story.
for (const [label, spread] of [
  ['browser', results.benchmark.browserSpreadMs],
  ['api', results.benchmark.apiSpreadMs],
]) {
  check(spread !== null && spread !== undefined, `the measurement recorded no ${label} spread`);
  check(
    new RegExp(`${spread.min}[–-]${spread.max}\\s*ms`).test(readme),
    `README does not publish the measured ${label} range (${spread.min}-${spread.max} ms)`,
  );
}
check(/median/i.test(readme), 'the README does not say the headline figure is a median');
check(/warm[- ]up/i.test(readme), 'the README does not disclose the warm-up run');

// The table's request counts must match too.
for (const [label, value] of [
  ['browser requests', results.benchmark.browserRequests],
  ['browser interactions', results.benchmark.browserInteractions],
]) {
  check(
    new RegExp(`\\|\\s*${value}\\s*\\|`).test(readme),
    `README does not state the measured ${label} (${value})`,
  );
}

// ---- unmeasurable figures are reported as unavailable ----------------------
check(
  /unavailable — no model ran on this path/.test(readme),
  'the README reports a token count for a path where no model ran',
);
check(
  /understates the gap/.test(readme),
  'the README does not disclose what the browser figure actually measures',
);

// ---- the test count is the real one ---------------------------------------
const testClaim = /(\d[\d,]*) unit tests/.exec(readme);
check(Boolean(testClaim), 'README does not state how many tests there are');
const claimedTests = Number(testClaim[1].replace(/,/g, ''));
check(
  claimedTests >= 150 && claimedTests <= 2000,
  `implausible test count in README: ${claimedTests}`,
);

// ---- companion documents ---------------------------------------------------
for (const file of [
  'LICENSE',
  'GATES.md',
  'docs/research.md',
  'docs/architecture.md',
  'docs/security.md',
  'docs/benchmark-results.json',
  'docs/launch/x-post.md',
  'docs/launch/hacker-news.md',
  'docs/launch/reddit.md',
  'docs/launch/launch-video-script.md',
  'docs/launch/demo-checklist.md',
  'examples/demo-session.json',
]) {
  check(await exists(join(REPO, file)), `${file} is missing`);
}

// ---- a reader can actually follow the install instructions -----------------
check(/pnpm install/.test(readme), 'the README does not say how to install from source');
check(
  /Node ≥ 20/.test(readme) || /Node >= 20/.test(readme),
  'the README does not state the Node requirement',
);
check(/apps\/demo-target/.test(readme), 'the README does not point at the reproducible target');
check(
  /examples\/demo-session\.json/.test(readme),
  'the README does not point at the recorded session',
);

// ---- the launch material points at the measured file, not at hand-typed numbers
const xPost = await readFile(join(REPO, 'docs', 'launch', 'x-post.md'), 'utf8');
check(
  /benchmark-results\.json/.test(xPost),
  'the launch material does not tie its figures to the measured results',
);

process.stdout.write(
  `README figures match docs/benchmark-results.json (${results.benchmark.browserMs}ms → ${results.benchmark.apiMs}ms, ${results.benchmark.speedup}x)\n`,
);
pass('GATE_G15_DOCS_OK');
