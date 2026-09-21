import { afterEach, describe, expect, it } from 'vitest';
import { PortInUseError, startDemoTarget, type DemoServerHandle } from './server.js';

const started: DemoServerHandle[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((handle) => handle.close()));
});

describe('startDemoTarget', () => {
  it('picks a free port when asked for zero and reports it', async () => {
    const handle = await startDemoTarget(0);
    started.push(handle);
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
  });

  it('explains a busy port instead of throwing a bare listen error', async () => {
    const first = await startDemoTarget(0);
    started.push(first);
    try {
      await startDemoTarget(first.port);
      throw new Error('expected the second server to refuse to start');
    } catch (error) {
      expect(error).toBeInstanceOf(PortInUseError);
      const message = (error as Error).message;
      expect(message).toContain(String(first.port));
      expect(message).toContain('lsof');
      expect(message).toContain('PORT=');
      expect(message).not.toContain('EADDRINUSE');
    }
  });

  it('closes cleanly even with a keep-alive connection open', async () => {
    const handle = await startDemoTarget(0);
    // A keep-alive socket used to leave close() pending forever.
    await fetch(`${handle.url}/api/todos`).then((response) => response.text());
    await expect(
      Promise.race([
        handle.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('close hung')), 3_000)),
      ]),
    ).resolves.toBeUndefined();
  });
});
