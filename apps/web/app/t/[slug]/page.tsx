import { notFound } from 'next/navigation';
import { Meter } from '@/app/Meter';
import { recentFeed, store, viewOperation } from '@/lib/store';

export const dynamic = 'force-dynamic';

function clockTime(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

export default async function TargetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ghost = store();
  const target = await ghost.readTarget(slug);
  if (!target) notFound();

  const operations = (await ghost.listOperations(slug)).map(viewOperation);
  const feed = await recentFeed(slug);
  const sessions = await ghost.listSessions(slug);
  const verified = operations.filter((entry) => entry.operation.verified).length;

  return (
    <main>
      <h1>{target.name}</h1>
      <p className="lede mono">{target.origin}</p>

      <dl className="kv">
        <dt>sessions</dt>
        <dd>{sessions.length}</dd>
        <dt>requests observed</dt>
        <dd>{sessions.reduce((total, session) => total + session.counts.network, 0)}</dd>
        <dt>interactions</dt>
        <dd>{sessions.reduce((total, session) => total + session.counts.ui, 0)}</dd>
        <dt>operations</dt>
        <dd>
          {operations.length} discovered · {verified} verified without the UI
        </dd>
      </dl>

      <h2>Operations</h2>
      {operations.length === 0 ? (
        <div className="empty">
          Nothing discovered yet. Run <span className="mono">ghostapi open {target.startUrl}</span>{' '}
          and use the application once.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Request</th>
              <th>Transports</th>
              <th className="num">Seen</th>
              <th>Confidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {operations.map((entry) => (
              <tr key={entry.operation.name}>
                <td>
                  <a href={`/t/${slug}/o/${entry.operation.name}`} className="mono">
                    {entry.operation.name}
                  </a>
                </td>
                <td className="mono muted">{entry.request.replace(target.origin, '')}</td>
                <td className="mono faint">{entry.transports.join(' → ')}</td>
                <td className="num">{entry.operation.observationCount}</td>
                <td>
                  <Meter confidence={entry.operation.confidence} band={entry.band} />
                </td>
                <td>
                  {entry.operation.destructive ? <span className="tag danger">destructive</span> : null}
                  {entry.operation.verified ? <span className="tag ok">verified</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Network feed · most recent session</h2>
      {feed.length === 0 ? (
        <div className="empty">No traffic recorded yet.</div>
      ) : (
        <div className="feed">
          {feed.map((entry, index) => (
            <div key={`${entry.at}-${index}`}>
              <span className="time">{clockTime(entry.at)}</span>
              <span className="method">{entry.method}</span>
              <span className="grow">{entry.path}</span>
              <span className="status">
                {entry.status ?? '—'}
                {entry.durationMs !== undefined ? ` · ${entry.durationMs}ms` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
