import { describe, expect, it } from 'vitest';

import { firstSentence } from './ui.js';

describe('firstSentence', () => {
  it('keeps a host and port that contain dots', () => {
    expect(
      firstSentence('Authenticate against http://127.0.0.1:4123. Derived from POST /api/session.'),
    ).toBe('Authenticate against http://127.0.0.1:4123');
  });

  it('stops at the first sentence boundary', () => {
    expect(firstSentence('Create a todo. Derived from POST /api/todos.')).toBe('Create a todo');
  });

  it('returns the whole text when there is no boundary', () => {
    expect(firstSentence('List todo records')).toBe('List todo records');
  });

  it('drops a trailing period on a single-sentence description', () => {
    expect(firstSentence('List todo records.')).toBe('List todo records');
  });

  it('survives a description that is only punctuation or blank', () => {
    expect(firstSentence('   ')).toBe('');
    expect(firstSentence('.')).toBe('');
  });
});
