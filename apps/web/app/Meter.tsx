export function Meter({ confidence, band }: { confidence: number; band: string }) {
  return (
    <span className={`meter ${band}`} title={`${band} · ${(confidence * 100).toFixed(1)}%`}>
      <span className="track">
        <span className="fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
      </span>
      <span className="mono">{Math.round(confidence * 100)}%</span>
    </span>
  );
}
