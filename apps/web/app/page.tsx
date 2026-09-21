import { listTargetSummaries } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const targets = await listTargetSummaries();

  return (
    <main>
      <h1>Targets</h1>
      <p className="lede">
        GhostAPI watches a web application, discovers the operations behind its interface, and
        exposes them as typed tools. This inspector reads the workspace in{' '}
        <span className="mono">.ghostapi</span>.
      </p>

      {targets.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>No targets yet.</p>
          <p className="mono" style={{ marginBottom: 0 }}>
            ghostapi open https://app.example.com
          </p>
          <p className="faint" style={{ marginBottom: 0 }}>
            Sign in, use the application once, then close the window.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Origin</th>
              <th className="num">Operations</th>
              <th className="num">Verified</th>
              <th className="num">Sessions</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((entry) => (
              <tr key={entry.target.slug}>
                <td>
                  <a href={`/t/${entry.target.slug}`} className="mono">
                    {entry.target.slug}
                  </a>
                </td>
                <td className="mono muted">{entry.target.origin}</td>
                <td className="num">{entry.operations}</td>
                <td className="num">{entry.verified}</td>
                <td className="num">{entry.sessions}</td>
                <td>
                  {entry.hasSession ? (
                    <span className="tag ok">stored</span>
                  ) : (
                    <span className="tag">none</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Start a discovery session</h2>
      <p className="notice">
        Discovery opens a real browser on this machine, so it runs from the terminal rather than
        from this page. Point it at an application you are allowed to automate, sign in yourself,
        and use it once.
      </p>
      <pre style={{ marginTop: 12 }}>{`ghostapi open https://app.example.com
# use the app, then close the window

ghostapi operations
ghostapi run createTodo '{"title":"Buy bread"}'
ghostapi ask "create a todo called buy coffee"`}</pre>
    </main>
  );
}
