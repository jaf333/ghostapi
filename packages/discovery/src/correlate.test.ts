import { describe, expect, it } from 'vitest';
import {
  AMBIGUITY_MARGIN,
  CORRELATION_THRESHOLD,
  correlate,
  payloadSimilarity,
  scoreCorrelation,
} from './correlate.js';
import { groupKeyOf } from './group.js';
import { networkFixture, stateFixture, uiFixture } from './fixtures.js';

const context = {
  repetitionByEndpoint: new Map<string, number>(),
  endpointKeyOf: groupKeyOf,
};

describe('payloadSimilarity', () => {
  it('finds entered values inside the request body', () => {
    const result = payloadSimilarity(uiFixture(), networkFixture());
    expect(result.strength).toBe(1);
    expect(result.matched).toEqual(['Buy milk']);
  });

  it('scores zero when nothing the user typed reached the request', () => {
    const result = payloadSimilarity(
      uiFixture(),
      networkFixture({ requestBody: { title: 'Other' } }),
    );
    expect(result.strength).toBe(0);
  });

  it('stays neutral when there is nothing to compare', () => {
    const result = payloadSimilarity(uiFixture({ formFields: [] }), networkFixture());
    expect(result.strength).toBe(0.5);
    expect(result.total).toBe(0);
  });

  it('ignores redacted fields entirely', () => {
    const interaction = uiFixture({
      formFields: [{ name: 'password', type: 'password', redacted: true, valueSample: undefined }],
    });
    expect(payloadSimilarity(interaction, networkFixture()).total).toBe(0);
  });
});

describe('scoreCorrelation', () => {
  it('scores a matching click-then-request pair above the threshold', () => {
    const candidate = scoreCorrelation(uiFixture(), networkFixture(), [stateFixture()], context);
    expect(candidate.score).toBeGreaterThan(CORRELATION_THRESHOLD);
  });

  it('scores zero temporal strength for a request that preceded the interaction', () => {
    const candidate = scoreCorrelation(
      uiFixture({ at: 5_000 }),
      networkFixture({ startedAt: 1_000 }),
      [],
      context,
    );
    const temporal = candidate.signals.find((signal) => signal.name === 'temporalProximity');
    expect(temporal?.strength).toBe(0);
  });

  it('decays with distance in time', () => {
    const near = scoreCorrelation(uiFixture({ at: 950 }), networkFixture(), [], context);
    const far = scoreCorrelation(
      uiFixture({ at: 0 }),
      networkFixture({ startedAt: 3_500 }),
      [],
      context,
    );
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('prefers a script-initiated request over a parser-initiated one', () => {
    const script = scoreCorrelation(uiFixture(), networkFixture(), [], context);
    const parser = scoreCorrelation(
      uiFixture(),
      networkFixture({ initiator: { type: 'parser', stack: [] } }),
      [],
      context,
    );
    expect(script.score).toBeGreaterThan(parser.score);
  });

  it('rewards repeated observation of the same endpoint', () => {
    const repeated = new Map([[groupKeyOf(networkFixture()), 5]]);
    const once = scoreCorrelation(uiFixture(), networkFixture(), [], context);
    const many = scoreCorrelation(uiFixture(), networkFixture(), [], {
      repetitionByEndpoint: repeated,
      endpointKeyOf: groupKeyOf,
    });
    expect(many.score).toBeGreaterThan(once.score);
  });
});

describe('correlate', () => {
  it('does not assume the closest interaction in time is the cause', () => {
    const observation = networkFixture({ startedAt: 1_000, requestBody: { title: 'Buy milk' } });
    const unrelatedButCloser = uiFixture({
      at: 995,
      type: 'click',
      selector: '#sidebar',
      label: 'Sidebar',
      formFields: [{ name: 'q', type: 'text', valueSample: 'unrelated text', redacted: false }],
    });
    const realCause = uiFixture({ at: 900 });

    const [result] = correlate({
      network: [observation],
      interactions: [unrelatedButCloser, realCause],
      changes: [],
      context,
    });
    expect(result?.best?.interaction.id).toBe(realCause.id);
  });

  it('prefers a submit over a change when the evidence otherwise ties', () => {
    const observation = networkFixture();
    const change = uiFixture({ id: 'ui_change', type: 'change', at: 900 });
    const submit = uiFixture({ id: 'ui_submit', type: 'submit', at: 900 });
    const [result] = correlate({
      network: [observation],
      interactions: [change, submit],
      changes: [],
      context,
    });
    expect(result?.best?.interaction.type).toBe('submit');
  });

  it('flags genuinely ambiguous cases instead of guessing quietly', () => {
    const observation = networkFixture();
    const a = uiFixture({ id: 'ui_a', type: 'submit', at: 900 });
    const b = uiFixture({ id: 'ui_b', type: 'submit', at: 900 });
    const [result] = correlate({
      network: [observation],
      interactions: [a, b],
      changes: [],
      context,
    });
    expect(result?.ambiguous).toBe(true);
    expect((result?.best?.score ?? 0) - (result?.runnerUp?.score ?? 0)).toBeLessThan(
      AMBIGUITY_MARGIN,
    );
  });

  it('lets one interaction own several requests', () => {
    const interaction = uiFixture();
    const create = networkFixture();
    const refresh = networkFixture({
      method: 'GET',
      path: '/api/todos',
      requestBody: undefined,
      requestBodyKind: 'none',
      startedAt: 1_100,
    });
    const results = correlate({
      network: [create, refresh],
      interactions: [interaction],
      changes: [],
      context,
    });
    expect(results.every((result) => result.best?.interaction.id === interaction.id)).toBe(true);
  });

  it('leaves a request with no plausible cause unlinked', () => {
    const [result] = correlate({
      network: [networkFixture({ startedAt: 90_000, initiator: { type: 'parser', stack: [] } })],
      interactions: [uiFixture({ at: 0, formFields: [] })],
      changes: [],
      context,
    });
    expect(result?.best).toBeUndefined();
  });
});
