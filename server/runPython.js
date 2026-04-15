import { spawn } from 'node:child_process';

// Resolve python executable: PYTHON_BIN env overrides; default to 'python3'.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

export async function runPython(scriptPath, input, { timeoutMs = 30_000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks = [];
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      finish({ ok: false, error: 'timeout' });
    }, timeoutMs);

    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', () => { /* swallow for now; could wire logging */ });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: `spawn-error: ${err.code || err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish({ ok: false, error: `exit-${code}` });
      try { finish(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { finish({ ok: false, error: 'parse-error' }); }
    });

    try { child.stdin.end(JSON.stringify(input)); }
    catch (err) { clearTimeout(timer); finish({ ok: false, error: 'stdin-error' }); }
  });
}
