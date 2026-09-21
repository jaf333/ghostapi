import type { NetworkObservation, StateChange, UiInteraction } from '@ghostapi/core';

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${(counter += 1)}`;

export function networkFixture(overrides: Partial<NetworkObservation> = {}): NetworkObservation {
  const base: NetworkObservation = {
    id: nextId('obs'),
    sessionId: 'sess_test',
    kind: 'network',
    startedAt: 1_000,
    completedAt: 1_050,
    durationMs: 50,
    method: 'POST',
    url: 'https://app.example.com/api/todos',
    origin: 'https://app.example.com',
    path: '/api/todos',
    query: {},
    requestHeaders: { 'content-type': 'application/json' },
    requestBodyKind: 'json',
    requestBody: { title: 'Buy milk' },
    status: 201,
    statusText: 'Created',
    responseHeaders: { 'content-type': 'application/json' },
    responseBodyKind: 'json',
    responseBody: { todo: { id: 'todo_1', title: 'Buy milk' } },
    resourceType: 'Fetch',
    initiator: { type: 'script', stack: [] },
    redactionCount: 0,
    sensitiveRequestHeaders: ['cookie'],
  };
  return { ...base, ...overrides };
}

export function uiFixture(overrides: Partial<UiInteraction> = {}): UiInteraction {
  const base: UiInteraction = {
    id: nextId('ui'),
    sessionId: 'sess_test',
    kind: 'ui',
    at: 900,
    type: 'submit',
    selector: '#create-form',
    submitterSelector: '#create-form button[type="submit"]',
    tagName: 'form',
    label: 'Create',
    text: 'Create',
    modifiers: [],
    url: 'https://app.example.com/',
    formFields: [
      { name: 'title', type: 'text', label: 'Title', valueSample: 'Buy milk', redacted: false },
    ],
  };
  return { ...base, ...overrides };
}

export function stateFixture(overrides: Partial<StateChange> = {}): StateChange {
  const base: StateChange = {
    id: nextId('chg'),
    sessionId: 'sess_test',
    kind: 'state',
    at: 1_100,
    type: 'dom-mutation',
    detail: '1 node added',
    addedTextSamples: ['Buy milk'],
  };
  return { ...base, ...overrides };
}
