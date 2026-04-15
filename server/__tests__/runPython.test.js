import { describe, it, expect } from 'vitest';
import { runPython } from '../runPython.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writeFixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'runpy-'));
  const file = join(dir, 'fixture.py');
  writeFileSync(file, body, 'utf-8');
  return file;
}

describe('runPython', () => {
  it('parses stdout JSON on success', async () => {
    const script = writeFixture(
      'import sys, json\nd = json.loads(sys.stdin.read())\nprint(json.dumps({"ok": True, "echo": d["x"]}))\n'
    );
    const result = await runPython(script, { x: 42 }, { timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    expect(result.echo).toBe(42);
  });

  it('returns {ok:false, error:timeout} if the script exceeds timeoutMs', async () => {
    const script = writeFixture('import time\ntime.sleep(10)\n');
    const result = await runPython(script, {}, { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
  });

  it('returns {ok:false, error:"parse-error"} on invalid JSON stdout', async () => {
    const script = writeFixture('print("not json")\n');
    const result = await runPython(script, {}, { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('parse-error');
  });

  it('returns {ok:false, error:"exit-N"} on non-zero exit', async () => {
    const script = writeFixture('import sys; sys.exit(3)');
    const result = await runPython(script, {}, { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('exit-3');
  });
});
