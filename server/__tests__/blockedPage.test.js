// Render's extract routes used to return `ok: true` with a bot-challenge or
// login-wall shell as the "caption" (verified live 2026-11-02 on allrecipes,
// Budget Bytes and an Instagram Reel). blockedPageReason is the one check
// both routes now share; a real recipe page must pass it untouched.
import { describe, it, expect } from 'vitest';
import { blockedPageReason } from '../index.js';

const page = (body, status = 200) => ({ ok: status < 400, status, text: `<html><head><title>t</title></head><body>${body}</body></html>` });
const RECIPE_BODY = '<h1>Garlic butter pasta</h1>' + '<p>Boil 200 g spaghetti, melt 2 tbsp butter with 3 cloves garlic, toss and serve with parmesan.</p>'.repeat(4);

describe('blockedPageReason', () => {
  it('passes a real page', () => {
    expect(blockedPageReason(page(RECIPE_BODY))).toBe('');
  });

  it('flags a Cloudflare challenge even when it comes back 200', () => {
    const cf = { ok: true, status: 200, text: '<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue<script src="https://challenges.cloudflare.com/x"></script></body></html>' };
    expect(blockedPageReason(cf)).toBe('bot-challenge');
  });

  it('flags the People Inc licensing wall', () => {
    expect(blockedPageReason(page('If you are a reader experiencing an access issue, please contact support. contentlicensing@people.inc', 402))).toBe('publisher-block');
  });

  it('passes a real page that embeds Cloudflare Turnstile on its comment form', () => {
    const withTurnstile = page(RECIPE_BODY + '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><div id="cf-chl-widget-x"></div>');
    expect(blockedPageReason(withTurnstile)).toBe('');
  });

  it('flags other upstream errors', () => {
    expect(blockedPageReason(page(RECIPE_BODY, 404))).toBe('upstream-404');
  });

  it('flags an Instagram login wall that strips to one word', () => {
    expect(blockedPageReason({ ok: true, status: 200, text: '<html><head><title>Instagram</title></head><body><div id="root"></div></body></html>' })).toBe('no-content');
  });
});
