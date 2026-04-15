// src/shaHex.js
export async function shaHex(input) {
  const bytes = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
