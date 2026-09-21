import { readFile } from 'node:fs/promises';
import {
  assertSafeUrl,
  browserStepSchema,
  newId,
  sessionSchema,
  type BrowserStep,
  type Observation,
  type Session,
} from '@ghostapi/core';
import { PlaywrightDriver, type CaptureSink } from '@ghostapi/browser';
import { inferOperations } from '@ghostapi/discovery';
import type { GhostStore } from '@ghostapi/store';
import { boolFlag, parse, requirePositional, stringFlag, type Parsed } from '../args.js';
import { openStore } from '../context.js';
import { emitJson, heading, keyValues, note, out, step, style, symbols } from '../ui.js';
import { runDiscovery } from './observe.js';

function timestamp(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

async function readScript(file: string): Promise<BrowserStep[]> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const steps = Array.isArray(raw) ? raw : [];
  return steps.map((step) => browserStepSchema.parse(step));
}

export async function openCommand(argv: readonly string[]): Promise<void> {
  const parsed: Parsed = parse(argv, {
    headless: { type: 'boolean', default: false },
    name: { type: 'string' },
    script: { type: 'string' },
    duration: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  });
  const url = requirePositional(parsed, 0, 'URL');
  assertSafeUrl(url);

  const store = await openStore();
  const target = await store.createTarget({ url, name: stringFlag(parsed, 'name') });
  const json = boolFlag(parsed, 'json');
  const quiet = boolFlag(parsed, 'quiet') || json;

  const sessionId = newId('sess');
  const buffered: Observation[] = [];
  const sink: CaptureSink = {
    network: (observation) => {
      buffered.push(observation);
      if (!quiet) {
        out(
          `${style.gray(timestamp(observation.startedAt))}  ${style.bold(
            observation.method.padEnd(6),
          )} ${observation.path} ${style.gray(String(observation.status ?? '…'))}`,
        );
      }
    },
    ui: (interaction) => {
      buffered.push(interaction);
      if (!quiet) {
        const label = interaction.label ?? interaction.text ?? interaction.selector ?? '';
        out(
          `${style.gray(timestamp(interaction.at))}  ${style.cyan(interaction.type.padEnd(6))} ${style.gray(
            label.slice(0, 48),
          )}`,
        );
      }
    },
    state: (change) => buffered.push(change),
  };

  if (!json) {
    heading(`GhostAPI ${symbols.arrow} ${target.name}`);
    keyValues([
      ['target', target.slug],
      ['profile', store.targetProfileDir(target.slug)],
      ['session', sessionId],
    ]);
    out();
    note(
      stringFlag(parsed, 'script')
        ? 'Replaying a recorded script. GhostAPI is watching the network.'
        : 'Sign in if needed, then use the app normally. Close the browser window when you are done.',
    );
    out();
  }

  const driver = new PlaywrightDriver();
  const session = await driver.open({
    url,
    sessionId,
    profileDir: store.targetProfileDir(target.slug),
    headless: boolFlag(parsed, 'headless'),
    channel: (await store.config()).browserChannel,
    ignorePatterns: target.ignorePatterns,
    sink,
  });

  const scriptFile = stringFlag(parsed, 'script');
  const durationSeconds = Number(stringFlag(parsed, 'duration') ?? '0');

  try {
    if (scriptFile) {
      const steps = await readScript(scriptFile);
      await session.runSteps(steps, {});
      // Let trailing requests and mutations land before the window closes.
      await new Promise((resolve) => setTimeout(resolve, 800));
    } else if (durationSeconds > 0) {
      await Promise.race([
        session.waitForClose(),
        new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000)),
      ]);
    } else {
      await session.waitForClose();
    }

    const cookies = await session.cookies().catch(() => []);
    if (cookies.length > 0) {
      await store.writeAuth(target.slug, {
        origin: target.origin,
        updatedAt: Date.now(),
        cookies,
      });
    }
  } finally {
    await session.close().catch(() => undefined);
  }

  const record: Session = sessionSchema.parse({
    id: sessionId,
    targetSlug: target.slug,
    startedAt: Date.now(),
    endedAt: Date.now(),
    startUrl: url,
    mode: scriptFile ? 'scripted' : 'interactive',
    counts: {
      network: buffered.filter((item) => item.kind === 'network').length,
      ui: buffered.filter((item) => item.kind === 'ui').length,
      state: buffered.filter((item) => item.kind === 'state').length,
    },
  });
  await store.saveSession(record);
  await store.appendObservations(target.slug, sessionId, buffered);

  const discovery = await runDiscovery(store, target.slug);

  if (json) {
    emitJson({
      target: target.slug,
      session: sessionId,
      observations: record.counts,
      operations: discovery.operations.map((operation) => ({
        name: operation.name,
        confidence: operation.confidence,
        verb: operation.verb,
      })),
    });
    return;
  }

  out();
  step(`${record.counts.network} request(s) observed`);
  step(`${record.counts.ui} UI interaction(s) recorded`);
  step(`${discovery.candidateGroups} candidate endpoint group(s)`);
  step(`${discovery.operations.length} operation(s) derived`);
  out();
  const ranked = [...discovery.operations].sort((a, b) => b.confidence - a.confidence);
  for (const operation of ranked) {
    out(
      `  ${style.bold(operation.name.padEnd(18))} ${style.gray(
        `${Math.round(operation.confidence * 100)}%`.padStart(4),
      )}  ${style.gray(operation.description.split('.')[0] ?? '')}`,
    );
  }
  out();
  const suggestion = ranked.find((operation) => !operation.destructive) ?? ranked[0];
  note(`Next:  ghostapi inspect ${suggestion?.name ?? '<operation>'}`);
  note(`       ghostapi ask "…"`);
  out();
}

export async function saveDiscovered(
  store: GhostStore,
  slug: string,
  observations: readonly Observation[],
): Promise<void> {
  const target = await store.requireTarget(slug);
  const existing = await store.listOperations(slug);
  const result = inferOperations({ target, observations, existing });
  for (const operation of result.operations) await store.saveOperation(slug, operation);
}
