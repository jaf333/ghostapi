import { notFound } from 'next/navigation';
import type { JsonSchema } from '@ghostapi/core';
import { Meter } from '@/app/Meter';
import { store, viewOperation } from '@/lib/store';
import { RunPanel } from './RunPanel';

export const dynamic = 'force-dynamic';

function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (schema.enum) return schema.enum.map((value) => String(value)).join(' | ');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : ['unknown'];
  return schema.nullable ? `${types.join(' | ')} | null` : types.join(' | ');
}

/** A starting input built only from values that were actually observed. */
function sampleInput(inputs: JsonSchema): string {
  const properties = inputs.properties ?? {};
  const required = inputs.required ?? [];
  const sample: Record<string, unknown> = {};
  for (const key of required) {
    const schema = properties[key];
    const example = schema?.examples?.[0] ?? schema?.enum?.[0];
    if (example !== undefined) sample[key] = example;
    else if (schema?.type === 'number' || schema?.type === 'integer') sample[key] = 0;
    else if (schema?.type === 'boolean') sample[key] = false;
    else sample[key] = '';
  }
  return JSON.stringify(sample, null, 2);
}

export default async function OperationPage({
  params,
}: {
  params: Promise<{ slug: string; name: string }>;
}) {
  const { slug, name } = await params;
  const ghost = store();
  const target = await ghost.readTarget(slug);
  const operation = target ? await ghost.readOperation(slug, name) : undefined;
  if (!target || !operation) notFound();

  const view = viewOperation(operation);
  const properties = operation.inputs.properties ?? {};
  const required = new Set(operation.inputs.required ?? []);
  const inputNames = Object.keys(properties).sort(
    (a, b) => Number(required.has(b)) - Number(required.has(a)) || a.localeCompare(b),
  );

  return (
    <main>
      <p className="faint mono" style={{ margin: 0 }}>
        <a href={`/t/${slug}`}>{slug}</a> / {operation.name}
      </p>
      <h1 className="mono">{operation.name}</h1>
      <p className="lede">{operation.description}</p>

      <dl className="kv">
        <dt>request</dt>
        <dd className="mono">{view.request}</dd>
        <dt>confidence</dt>
        <dd>
          <Meter confidence={operation.confidence} band={view.band} />{' '}
          <span className="faint">{view.band}</span>
        </dd>
        <dt>observations</dt>
        <dd>{operation.observationCount}</dd>
        <dt>verified</dt>
        <dd>{operation.verified ? 'replayed successfully without the UI' : 'not yet replayed'}</dd>
        <dt>destructive</dt>
        <dd>{operation.destructive ? <span className="tag danger">yes</span> : 'no'}</dd>
        <dt>idempotent</dt>
        <dd>{operation.idempotent === undefined ? 'unknown' : operation.idempotent ? 'yes' : 'no'}</dd>
        <dt>auth</dt>
        <dd>{view.authLabel}</dd>
        <dt>transports</dt>
        <dd className="mono">{view.transports.join(' → ')}</dd>
      </dl>

      <h2>Input</h2>
      {inputNames.length === 0 ? (
        <p className="muted">This operation takes no input.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Required</th>
              <th>Observed</th>
            </tr>
          </thead>
          <tbody>
            {inputNames.map((key) => (
              <tr key={key}>
                <td className="mono">{key}</td>
                <td className="mono muted">{typeLabel(properties[key])}</td>
                <td>{required.has(key) ? 'required' : <span className="faint">optional</span>}</td>
                <td className="mono faint">
                  {properties[key]?.examples?.[0] !== undefined
                    ? JSON.stringify(properties[key]?.examples?.[0])
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Run</h2>
      <RunPanel
        slug={slug}
        name={operation.name}
        destructive={operation.destructive}
        sample={sampleInput(operation.inputs)}
      />

      {operation.uiTriggers.length > 0 ? (
        <>
          <h2>UI triggers observed</h2>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Element</th>
                <th>Selector</th>
                <th className="num">Times</th>
              </tr>
            </thead>
            <tbody>
              {operation.uiTriggers.map((trigger, index) => (
                <tr key={`${trigger.description}-${index}`}>
                  <td>{trigger.kind}</td>
                  <td className="muted">{trigger.description}</td>
                  <td className="mono faint">{trigger.selector ?? '—'}</td>
                  <td className="num">{trigger.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Evidence</h2>
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Note</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {operation.evidence.map((item, index) => (
            <tr key={`${item.kind}-${index}`}>
              <td className="mono faint">{item.kind}</td>
              <td className="muted">{item.note}</td>
              <td className="num faint">{item.score !== undefined ? item.score.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Transport</h2>
      <pre>{JSON.stringify(operation.transport, null, 2)}</pre>
    </main>
  );
}
