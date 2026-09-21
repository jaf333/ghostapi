import { newId } from './ids.js';

export type TraceSpanStatus = 'ok' | 'error';

export interface TraceSpan {
  readonly id: string;
  readonly name: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly status: TraceSpanStatus;
  readonly data: Record<string, unknown>;
}

export interface Trace {
  readonly id: string;
  readonly startedAt: number;
  readonly spans: TraceSpan[];
  readonly labels: Record<string, string>;
}

/**
 * A trace is the debuggable record of one intent turning into one HTTP call.
 * It is intentionally mutable at the edges and frozen when read.
 */
export class TraceRecorder {
  readonly id: string;
  private readonly startedAt: number;
  private readonly spans: TraceSpan[] = [];
  private readonly labels: Record<string, string> = {};

  constructor(labels: Record<string, string> = {}) {
    this.id = newId('trace');
    this.startedAt = Date.now();
    Object.assign(this.labels, labels);
  }

  label(key: string, value: string): void {
    this.labels[key] = value;
  }

  async span<T>(name: string, fn: () => Promise<T>, data: Record<string, unknown> = {}): Promise<T> {
    const startedAt = Date.now();
    const id = newId('span');
    try {
      const result = await fn();
      this.spans.push({
        id,
        name,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: 'ok',
        data,
      });
      return result;
    } catch (error) {
      this.spans.push({
        id,
        name,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: 'error',
        data: { ...data, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  event(name: string, data: Record<string, unknown> = {}): void {
    this.spans.push({
      id: newId('span'),
      name,
      startedAt: Date.now(),
      durationMs: 0,
      status: 'ok',
      data,
    });
  }

  snapshot(): Trace {
    return {
      id: this.id,
      startedAt: this.startedAt,
      spans: [...this.spans],
      labels: { ...this.labels },
    };
  }

  get totalDurationMs(): number {
    return Date.now() - this.startedAt;
  }
}
