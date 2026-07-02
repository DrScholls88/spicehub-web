/**
 * Legal content for SpiceHub — Privacy Policy, Terms of Service, and a
 * summary of third-party licenses.
 *
 * IMPORTANT: This is plain-language, non-legal-advice content written for a
 * small, mostly-private household PWA. It is NOT a substitute for review by
 * a licensed attorney. If SpiceHub's userbase grows materially, or it starts
 * handling payments/accounts/health claims, have a lawyer review and replace
 * this content.
 *
 * `LEGAL_VERSION` is a version stamp, not a date-only convenience — bumping
 * it forces every existing user to re-accept the clickwrap gate (see
 * ConsentGate.jsx, which keys its localStorage record on this value).
 * Bump it any time the substance of the policy text changes.
 */

export const LEGAL_CONTACT_NAME = 'SpiceHub';
export const LEGAL_CONTACT_EMAIL = 'bjgoeke@gmail.com';
export const LEGAL_VERSION = '2026-07-01';

export const PRIVACY_POLICY_SECTIONS = [
  {
    title: 'What SpiceHub is',
    paragraphs: [
      'SpiceHub is a small, independently-run meal and recipe planner. It is not a company product — there is no corporate entity behind it, just a single maintainer (contact: ' + LEGAL_CONTACT_EMAIL + ').',
      'SpiceHub does not have user accounts, does not have a server-side database of your data, and does not sell or share your information with advertisers.',
    ],
  },
  {
    title: 'What data SpiceHub stores, and where',
    paragraphs: [
      'All of your recipes, meal plans, grocery lists, drink recipes, photos, and preferences are stored locally on your device using your browser’s IndexedDB storage. This data never leaves your device unless you explicitly export or share it.',
      'SpiceHub does not have a server-side account system. There is no "SpiceHub cloud" copy of your data. If you clear your browser storage, uninstall the app, or switch devices without exporting first, your data is gone — SpiceHub cannot recover it for you.',
    ],
  },
  {
    title: 'When data leaves your device',
    paragraphs: [
      'A few features send data to third-party services in order to work, and only when you actively use them:',
      '• Recipe import from a URL or Instagram link sends that URL (and, for video/caption extraction, the downloaded media or transcript) to SpiceHub’s backend server and, from there, to Google’s Gemini API to convert messy captions into structured recipe data.',
      '• Audio transcription (if used) sends recorded/extracted audio to a speech-to-text process to produce a transcript.',
      '• Recipe photos you import from the web may be fetched through a proxy to work around cross-origin restrictions.',
      'None of these calls include your name, contacts, or device identity — only the content you’re actively trying to import. SpiceHub does not use tracking pixels, analytics SDKs, or advertising identifiers.',
    ],
  },
  {
    title: 'Cookies and local storage',
    paragraphs: [
      'SpiceHub uses localStorage and IndexedDB — not cookies — to remember your preferences (theme, dietary settings, consent status) and your saved data. These are standard browser storage mechanisms and are never transmitted to a server automatically.',
    ],
  },
  {
    title: 'Your choices',
    paragraphs: [
      'You can delete all locally-stored SpiceHub data at any time by clearing your browser’s site data for this app, or by uninstalling the installed PWA. You can export your recipes before doing so via the app’s export feature.',
    ],
  },
  {
    title: 'Children',
    paragraphs: [
      'SpiceHub is not directed at children and is not knowingly used to collect information from children. The Bar/Saloon area additionally requires users to confirm they are of legal drinking age in their jurisdiction before entering (see the in-app age gate).',
    ],
  },
  {
    title: 'Changes to this policy',
    paragraphs: [
      'If this policy changes in a meaningful way, the version stamp at the top of the in-app Privacy Policy screen will change, and you’ll be asked to re-accept it the next time you open SpiceHub.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Questions about this policy or your data: ' + LEGAL_CONTACT_EMAIL + '.',
    ],
  },
];

export const TERMS_OF_SERVICE_SECTIONS = [
  {
    title: 'Agreement',
    paragraphs: [
      'By using SpiceHub, you agree to these Terms of Service and the Privacy Policy. If you don’t agree, please don’t use the app.',
      'This is a basic terms-of-service document intended for a small, low-risk personal project. It is expected to be revised as SpiceHub’s userbase or feature set grows.',
    ],
  },
  {
    title: 'The service, as-is',
    paragraphs: [
      'SpiceHub is provided "as is" and "as available," without warranties of any kind, express or implied — including, without limitation, warranties of merchantability, fitness for a particular purpose, or non-infringement.',
      'SpiceHub is a hobby/personal project maintained by one person. There is no guaranteed uptime, no SLA, and features may change, break, or be removed without notice.',
    ],
  },
  {
    title: 'Your content',
    paragraphs: [
      'Recipes, photos, notes, and other content you add or import into SpiceHub remain yours. SpiceHub doesn’t claim ownership of anything you put into it, and (per the Privacy Policy) doesn’t store it anywhere except your own device.',
      'You’re responsible for having the right to import and store any content you bring into SpiceHub (for example, recipe text or images copied from a website or social media post). SpiceHub’s Instagram/social import tools are meant for personal reference use, similar to bookmarking or saving a recipe for your own kitchen.',
    ],
  },
  {
    title: 'Limitation of liability',
    paragraphs: [
      'To the maximum extent permitted by law, the maintainer of SpiceHub is not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, arising from your use of (or inability to use) the app — including, without limitation, any recipe, ingredient, dosage/measurement, or allergen information displayed, imported, or generated by the app.',
      'SpiceHub involves cooking and, in its Bar/Saloon area, alcoholic drink recipes. You are solely responsible for verifying ingredient safety, allergens, substitutions, and alcohol content before consuming anything prepared using information from this app. See the Drink Responsibly notice for more on the Bar/Saloon area specifically.',
    ],
  },
  {
    title: 'Age requirements',
    paragraphs: [
      'The Bar/Saloon area of SpiceHub contains alcoholic drink recipes and requires you to confirm you are of legal drinking age in your jurisdiction before entering. By confirming, you represent that this is true.',
    ],
  },
  {
    title: 'Third-party services',
    paragraphs: [
      'SpiceHub’s import features rely on third-party services (for example, Google’s Gemini API) to process content you submit. Your use of those features is also subject to those third parties’ own terms, which SpiceHub does not control.',
    ],
  },
  {
    title: 'Changes',
    paragraphs: [
      'These terms may be updated from time to time. Material changes will bump the version stamp shown in-app, which will prompt you to re-accept before continuing to use SpiceHub.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Questions about these terms: ' + LEGAL_CONTACT_EMAIL + '.',
    ],
  },
];

export const DRINK_RESPONSIBLY_TEXT = {
  title: 'Drink Responsibly',
  paragraphs: [
    'This area of SpiceHub contains alcoholic drink recipes for personal reference.',
    'By continuing, you confirm that you are of legal drinking age in your jurisdiction, and you agree to drink responsibly and not to operate a vehicle or machinery after consuming alcohol.',
    'SpiceHub does not verify age and relies entirely on your confirmation. If you or someone you know struggles with alcohol use, SAMHSA’s National Helpline (1-800-662-4357, free, confidential, 24/7) is a good place to start.',
  ],
};

/**
 * Condensed in-app summary of third-party software SpiceHub bundles or
 * depends on. See THIRD_PARTY_LICENSES.md at the repo root for the full list
 * generated from package.json.
 */
export const THIRD_PARTY_NOTICES = [
  {
    name: 'PhotoSwipe 4.1.1',
    author: 'Dmitry Semenov',
    license: 'MIT',
    note: 'Bundled directly in src/lib/photoswipe/ for the photo gallery lightbox.',
  },
  {
    name: 'React',
    author: 'Meta Platforms, Inc.',
    license: 'MIT',
  },
  {
    name: 'Dexie.js',
    author: 'David Fahlander',
    license: 'Apache-2.0',
  },
  {
    name: 'Framer Motion / Motion',
    author: 'Framer',
    license: 'MIT',
  },
  {
    name: 'lucide-react',
    author: 'Lucide Contributors',
    license: 'ISC',
  },
  {
    name: 'JSZip',
    author: 'Stuart Knightley and contributors',
    license: 'MIT / GPLv3 (dual)',
  },
  {
    name: 'Tesseract.js',
    author: 'Project Naptha',
    license: 'Apache-2.0',
  },
  {
    name: 'Turndown',
    author: 'Dom Christie',
    license: 'MIT',
  },
  {
    name: 'Express',
    author: 'Express Contributors',
    license: 'MIT',
  },
  {
    name: 'express-rate-limit',
    author: 'nfriedly and contributors',
    license: 'MIT',
  },
  {
    name: 'CORS',
    author: 'Troy Goode',
    license: 'MIT',
  },
];
