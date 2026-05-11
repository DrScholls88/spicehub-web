import { spawn } from 'node:child_process';

export function runPython(scriptPath, input = {}, { timeoutMs = 10000, pythonBin = process.env.PYTHON_BIN || 'python' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: `exit-${code}`, stderr });
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, error: 'parse-error', stdout });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
