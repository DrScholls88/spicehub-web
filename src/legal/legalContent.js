/**
 * Legal content for SpiceHub — Privacy Policy, Terms of Service, and a
 * summary of third-party licenses.
 *
 * IMPORTANT: This is plain-language, non-legal-advice content written for a
 * small, independently maintained household PWA. It is NOT a substitute for
 * review by a licensed attorney. If SpiceHub's userbase grows materially, or
 * it starts handling payments, regulated health claims, or large-scale
 * social features, have a lawyer review and replace this content.
 *
 * `LEGAL_VERSION` is a version stamp, not a date-only convenience — bumping
 * it forces every existing user to re-accept the clickwrap gate (see
 * ConsentGate.jsx, which keys its localStorage record on this value).
 * Bump it any time the substance of the policy text changes.
 *
 * 2026-07-31: Major overhaul for optional Supabase Auth, Home Groups
 * (shared week plan / grocery), cloud profiles, and (when enabled) Friends
 * & direct recipe share. Previous text incorrectly stated there were no
 * accounts and no server-side data of any kind.
 */

export const LEGAL_CONTACT_NAME = 'SpiceHub';
export const LEGAL_CONTACT_EMAIL = 'bjgoeke@gmail.com';
export const LEGAL_VERSION = '2026-07-31';

export const PRIVACY_POLICY_SECTIONS = [
  {
    title: 'What SpiceHub is',
    paragraphs: [
      'SpiceHub is a small, independently run meal and recipe planner Progressive Web App (PWA). It is not a corporate product — there is no company entity behind it, just a single maintainer (contact: ' +
        LEGAL_CONTACT_EMAIL +
        ').',
      'SpiceHub is built offline-first: your personal recipe library, pantry, bar inventory, and most preferences live on your device. Optional cloud features (accounts, household sharing, and friend sharing) are additive and only activate when you choose to use them.',
      'SpiceHub does not sell your information, does not show ads, and does not use advertising trackers or advertising identifiers.',
    ],
  },
  {
    title: 'Two modes: local-only and optional cloud features',
    paragraphs: [
      'By default, SpiceHub works entirely on your device. You do not need an account to plan meals, save recipes, manage a grocery list, or use the Bar/Saloon area.',
      'If you create or join a Home Group, or use Friends features (when enabled), SpiceHub uses optional cloud services so you can coordinate with other people. Signing in is only required for those cloud features — not for ordinary personal use.',
    ],
  },
  {
    title: 'What stays on your device (local data)',
    paragraphs: [
      'The following are stored locally in your browser (IndexedDB / localStorage) and are the primary copy of your personal data:',
      '• Recipes and drinks you save or import',
      '• Photos and images stored on-device',
      '• Personal meal history, cooking log, and library organization (tags, etc.)',
      '• Pantry and bar inventory',
      '• App preferences (theme, dietary preferences, UI settings)',
      '• Offline queues and import drafts',
      'This local data is not automatically uploaded to a SpiceHub “cloud library.” If you clear site data, uninstall the PWA, or switch devices without exporting, that local data can be lost and cannot be recovered by the maintainer.',
    ],
  },
  {
    title: 'Accounts and sign-in (optional)',
    paragraphs: [
      'Cloud features use Supabase Auth. You may sign in with Google or a magic link sent to your email when you choose actions that need a cloud identity (for example, creating or joining a Home Group, or using Friends features when enabled).',
      'When you sign in, Supabase stores authentication data such as your user id, email (depending on the provider), session tokens, and sign-in metadata. Session tokens are kept in your browser so you can stay signed in across visits.',
      'SpiceHub links that cloud identity to a local profile id on your device. Your personal recipe library remains on the device unless you explicitly share something.',
    ],
  },
  {
    title: 'Cloud profile information',
    paragraphs: [
      'If you use account features, SpiceHub may store a cloud profile record that can include:',
      '• A user id from the auth provider',
      '• An optional username (if you set one) for finding friends',
      '• A display name and avatar choice',
      '• A setting for whether your username is searchable',
      'Username search is designed for people who opt in by setting a username and leaving search enabled. You can turn off searchability where the product provides that control.',
    ],
  },
  {
    title: 'Home Groups — shared household data',
    paragraphs: [
      'A Home Group lets a small household coordinate a shared week plan and shared grocery list. When you create or join a group:',
      '• Membership information (who is in the group, roles such as owner/member, display name/avatar as shown in the group) is stored in the cloud',
      '• Shared week-plan slots store a limited snapshot (for example: dish name, public image URL if available, ingredient list for shopping, servings, and who last updated the slot) — not your entire private recipe database',
      '• Shared grocery items (name, quantity, store label, checked state, who added/checked) are stored in the cloud and sync to group members',
      '• Invite codes are used to join a group. Treat invite codes like household secrets; anyone with a valid code may be able to join while the code is active',
      'Personal libraries (full recipes, directions, private notes, local-only photos) are not bulk-uploaded into the Home Group. Assigning a meal to the shared plan sends a snapshot for coordination, not a live copy of every private field.',
    ],
  },
  {
    title: 'Friends and direct recipe sharing (when enabled)',
    paragraphs: [
      'If Friends features are enabled in your build of SpiceHub, you may set a username, send and accept friend requests, and share recipes with accepted friends.',
      'Friend relationships (requests, accepts, blocks) are stored in the cloud so both people see a consistent friends list.',
      'When you share a meal or drink with a friend, SpiceHub sends a copy of the recipe content you chose to share (name, ingredients, directions when included, public image URLs, and similar recipe fields) plus an optional short note. Local-only images and internal device ids are not included. The recipient can save that copy into their own on-device library or dismiss it.',
      'Sharing is explicit: nothing is shared with another person until you use Share. Blocks are intended to stop further search, requests, and shares between the blocked pair.',
    ],
  },
  {
    title: 'Realtime sync and connectivity',
    paragraphs: [
      'When you are signed in and using Home Group or Friends features, SpiceHub may open a realtime connection so shared plan changes, grocery updates, friend events, or incoming shares can appear without a full refresh.',
      'If you are offline, personal features continue to work from local data. Some social actions (searching for users, sending friend requests, sending shares) require a network connection. Certain status updates may retry when you are back online.',
    ],
  },
  {
    title: 'When data leaves your device for import and AI features',
    paragraphs: [
      'Separate from accounts and sharing, some features send content to third-party processors only when you actively use them:',
      '• Recipe import from a URL or Instagram/social link may send that URL and extracted media/transcript text to SpiceHub’s backend and to AI services (such as Google Gemini) to structure a recipe',
      '• Audio transcription (if used) may send audio to a speech-to-text process',
      '• Some remote images may be fetched through a proxy to work around browser restrictions',
      'These processing calls are for the content you are importing or analyzing, not a bulk upload of your library. Third parties process data under their own terms and privacy policies.',
    ],
  },
  {
    title: 'Service providers who process data',
    paragraphs: [
      'Depending on which features you use, processors may include:',
      '• Supabase — authentication, database, and realtime for optional cloud features',
      '• Google (Sign-In and/or Gemini API) — sign-in and/or AI structuring of import content',
      '• Hosting providers for the website and API (for example Vercel and/or Render)',
      '• Scraping or media helper services used only during import flows when configured',
      'SpiceHub does not control third-party policies. Review their documentation if you rely on those features.',
    ],
  },
  {
    title: 'Cookies, local storage, and similar technologies',
    paragraphs: [
      'SpiceHub uses localStorage and IndexedDB for preferences, local library data, consent records, and offline queues. Auth session tokens for optional sign-in are stored by the auth client as required to keep you signed in.',
      'SpiceHub does not use third-party advertising cookies or advertising SDKs.',
    ],
  },
  {
    title: 'Data retention',
    paragraphs: [
      'Local data remains on your device until you delete it, clear site storage, or uninstall the app.',
      'Cloud Home Group data remains while the group exists and you remain a member; leaving a group stops your access to that group’s shared plan and grocery list going forward.',
      'Friend relationships remain until unfriended or blocked. Shared recipe inbox items may be removed after a limited retention period (for example about 30 days) whether or not they were saved.',
      'Auth records remain until you delete your account or request deletion (see Your choices). Backups operated by infrastructure providers may persist for a limited technical period after deletion.',
    ],
  },
  {
    title: 'Your choices',
    paragraphs: [
      'You can:',
      '• Use SpiceHub without signing in',
      '• Export your recipes before clearing storage or switching devices',
      '• Leave a Home Group; your personal on-device library is not deleted by leaving',
      '• Unfriend or block other users when Friends features are enabled',
      '• Turn off username searchability where the product provides that control',
      '• Sign out (local library remains on the device)',
      '• Clear browser site data or uninstall the PWA to remove local data',
      '• Contact ' +
        LEGAL_CONTACT_EMAIL +
        ' to request deletion of cloud account/profile data associated with your sign-in. Describe the email or username you used so the request can be matched. Local device data must be cleared on the device itself.',
    ],
  },
  {
    title: 'Children',
    paragraphs: [
      'SpiceHub is not directed at children under 13 (or the minimum age required in your country) and is not intended to collect personal information from children. The Bar/Saloon area additionally requires confirmation that you are of legal drinking age in your jurisdiction before entry.',
    ],
  },
  {
    title: 'Security',
    paragraphs: [
      'Optional cloud features use encrypted transport (HTTPS) and access rules so that shared household data and friend data are limited to authorized users. No method of transmission or storage is 100% secure. You are responsible for protecting access to your device and your sign-in email.',
    ],
  },
  {
    title: 'International users',
    paragraphs: [
      'SpiceHub may be accessed from outside the United States. Cloud processors may store or process data in the United States or other countries where they operate. If that is not acceptable for your situation, use SpiceHub in local-only mode and do not sign in or use sharing features.',
    ],
  },
  {
    title: 'Changes to this policy',
    paragraphs: [
      'If this policy changes in a meaningful way, the version stamp used by the in-app consent gate will change, and you will be asked to review and accept the updated terms before continuing.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Questions about this policy, your data, or deletion requests: ' + LEGAL_CONTACT_EMAIL + '.',
    ],
  },
];

export const TERMS_OF_SERVICE_SECTIONS = [
  {
    title: 'Agreement',
    paragraphs: [
      'By using SpiceHub, you agree to these Terms of Service and the Privacy Policy. If you do not agree, do not use the app.',
      'This document is written for a small, independently maintained project. It should be revisited if SpiceHub’s audience, commercial model, or risk profile changes substantially.',
    ],
  },
  {
    title: 'The service, as-is',
    paragraphs: [
      'SpiceHub is provided “as is” and “as available,” without warranties of any kind, express or implied — including, without limitation, warranties of merchantability, fitness for a particular purpose, or non-infringement.',
      'SpiceHub is a personal/hobby project maintained by one person. There is no guaranteed uptime, no service-level agreement, and features may change, break, or be removed without notice. Optional cloud features may be unavailable when networks, auth providers, or hosting providers have outages.',
    ],
  },
  {
    title: 'Accounts (optional)',
    paragraphs: [
      'Most features work without an account. Accounts exist only to enable optional cloud features such as Home Groups and, when enabled, Friends and direct recipe sharing.',
      'You are responsible for the accuracy of information you provide when signing in and for keeping access to your email or Google account secure. Notify the maintainer if you believe your SpiceHub-connected account was used without authorization.',
      'SpiceHub may suspend or terminate access to cloud features in cases of abuse, security risk, or misuse of sharing features.',
    ],
  },
  {
    title: 'Your content and license to operate the app',
    paragraphs: [
      'Recipes, photos, notes, and other content you add or import remain yours. SpiceHub does not claim ownership of your content.',
      'You are responsible for having the rights needed to import, store, and (if you use sharing features) transmit content — for example, recipe text or images from websites or social posts. Import tools are intended for personal reference, similar to saving a recipe for your own kitchen.',
      'If you share content with a Home Group or with friends, you instruct SpiceHub to transmit the shared snapshot or recipe copy to those recipients’ accounts or devices as described in the Privacy Policy. You should only share content you are comfortable others saving.',
    ],
  },
  {
    title: 'Acceptable use of sharing features',
    paragraphs: [
      'When using Home Groups, usernames, friend requests, or recipe shares, you agree not to:',
      '• Harass, threaten, or abuse other users',
      '• Attempt to access someone else’s group, account, or data without authorization',
      '• Share unlawful, infringing, or highly sensitive personal information about others',
      '• Probe, scrape, or rate-limit-bypass username search or invite systems',
      '• Use automated systems to spam friend requests or shares',
      'The maintainer may remove content from cloud systems, invalidate invite codes, or disable cloud access for abuse.',
    ],
  },
  {
    title: 'AI-assisted import',
    paragraphs: [
      'Import features may use third-party AI services to turn captions, pages, or transcripts into structured recipes. AI output can be wrong, incomplete, or unsafe as a cooking instruction. You must review ingredients, steps, allergens, and quantities before cooking or serving.',
    ],
  },
  {
    title: 'Limitation of liability',
    paragraphs: [
      'To the maximum extent permitted by law, the maintainer of SpiceHub is not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, arising from your use of (or inability to use) the app — including, without limitation, any recipe, ingredient, measurement, allergen information, or shared content displayed, imported, generated, or transmitted by the app.',
      'SpiceHub involves cooking and, in its Bar/Saloon area, alcoholic drink recipes. You are solely responsible for verifying ingredient safety, allergens, substitutions, and alcohol content before consuming anything prepared using information from this app.',
    ],
  },
  {
    title: 'Age requirements',
    paragraphs: [
      'The Bar/Saloon area contains alcoholic drink recipes and requires you to confirm you are of legal drinking age in your jurisdiction before entering. By confirming, you represent that this is true. SpiceHub does not independently verify age.',
    ],
  },
  {
    title: 'Third-party services',
    paragraphs: [
      'SpiceHub relies on third-party services for hosting, authentication, database/realtime features, and (when you import) AI or media processing. Your use of those features is also subject to those third parties’ terms and policies, which SpiceHub does not control.',
    ],
  },
  {
    title: 'Termination',
    paragraphs: [
      'You may stop using SpiceHub at any time and may clear local data from your device. You may request deletion of cloud account data as described in the Privacy Policy.',
      'Provisions that by their nature should survive (including limitation of liability, disclaimers, and ownership of your content remaining yours) continue after you stop using the app.',
    ],
  },
  {
    title: 'Changes',
    paragraphs: [
      'These terms may be updated from time to time. Material changes will bump the in-app version stamp and prompt you to re-accept before continuing to use SpiceHub.',
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
 * generated from package.json when present.
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
  {
    name: '@supabase/supabase-js',
    author: 'Supabase Inc.',
    license: 'MIT',
    note: 'Used when optional account, Home Group, or Friends features are enabled.',
  },
];
