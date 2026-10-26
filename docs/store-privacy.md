# Store privacy answers

Answers for App Store Connect (App Privacy) and Play Console (Data safety), checked against the code on 2026-10-24. The policy text lives in `src/legal/legalContent.js`; the in-app viewer and the public pages are both rendered from it.

| URL | Use it for |
|---|---|
| https://spicehub-web.vercel.app/privacy.html | Privacy policy URL (both stores) |
| https://spicehub-web.vercel.app/delete-account.html | Play: account deletion URL. App Store: User Privacy Choices URL (optional) |
| https://spicehub-web.vercel.app/terms.html | Terms of use / EULA link, if asked |

These pages exist only after the next Vercel deploy.

## What leaves the device, and why

| Data | Goes to | When | Tied to an account? |
|---|---|---|---|
| Email, user id, sign-in tokens | Supabase Auth (via Google sign-in or magic link) | Only if you sign in (Home Group / Friends) | Yes |
| Username, display name, profile photo, "What's cooking" status | Supabase | Only if you set them | Yes |
| Friends, shared recipes, share notes, reactions | Supabase | Only when you use Friends | Yes |
| Household plan snapshots and grocery items | Supabase | Only in a Home Group | Yes |
| Import link | Vercel and Render servers; Apify for social posts; public CORS proxies as a fallback | When you import | No |
| Page text, captions, transcripts | Google Gemini | When you import | No |
| Imported photos and PDFs | Google Gemini, or Mistral AI as a fallback | When you import a photo | No |
| Audio of a public video | Render server (temporary), then on-device speech-to-text | Video imports | No |
| IP address and the address requested | Vercel, Render and Supabase request logs | Any server request | No |

Stays on the device and is **not** declared: the recipe library, pantry, bar, meal plan, preferences, photos stored locally and offline queues.

There are no analytics, crash-reporting or advertising SDKs, no advertising ID, and no tracking.

## Apple: App Privacy ("nutrition label")

**Do you or your third-party partners collect data from this app?** Yes.

Declare these five types. Each is used for **App Functionality** only, is **Linked to the user's identity**, and is **not** used for tracking.

| Category | Data type | Source |
|---|---|---|
| Contact Info | Email Address | Sign-in |
| Contact Info | Name | Username and display name |
| Identifiers | User ID | Supabase user id |
| User Content | Photos or Videos | Profile photo; recipe photos sent for import |
| User Content | Other User Content | Shared recipes and notes, household lists, status, reactions, import text and links |

Answer "not collected" for everything else: Location, Health & Fitness, Financial Info, Contacts, Browsing History, Search History, Usage Data, Diagnostics, Sensitive Info, Purchases and Audio Data.

`ios/App/App/PrivacyInfo.xcprivacy` declares the same five types. It also lists the required-reason APIs:
- **UserDefaults**: CA92.1 and 1C8F.1, used by the App Group share handoff.
- **File timestamp**: C617.1, used by `@capacitor/filesystem`.

Capacitor ships its own (empty) manifest. The share extension has its own manifest in `ios/App/ShareExtension.template/`.

Apple's definition: import content counts as "collected" only because Gemini and Mistral may keep it beyond the request. That depends on your API tier. Declaring it is the safe answer either way.

## Google Play: Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes. Everything goes over HTTPS.
- **Do you provide a way for users to request that their data is deleted?** Yes. Deletion is in the app (Settings > Danger Zone > Delete Account), and the account deletion URL is above.
- **Account creation:** the app allows account creation with OAuth (Google) and email (magic link). Paste the account deletion URL in App content > Data deletion.
- **Advertising ID:** No.

Mark every type below as **Collected**, **not Shared**, **optional** (the app works without it), and **not processed ephemerally**. Gemini, Mistral, Apify, Vercel, Render and Supabase act as service providers, which Google exempts from "shared".

| Category | Type | Purposes |
|---|---|---|
| Personal info | Email address | App functionality, Account management |
| Personal info | Name | App functionality, Account management |
| Personal info | User IDs | App functionality, Account management |
| Photos and videos | Photos | App functionality |
| Messages | Other in-app messages (notes attached to shared recipes) | App functionality |
| App activity | Other user-generated content | App functionality |

Answer "not collected" for Location, Financial info, Health and fitness, Contacts, Calendar, Audio, Files and docs, Web browsing, App info and performance, and Device or other IDs.

## Gray areas you may want to settle

- **Public CORS proxies** (allorigins.win, codetabs.com, corsproxy.io) are not contracted service providers. They only ever see the public recipe address being fetched, which I treated as not user data. If you'd rather not argue that, route the fallback through `/api/proxy` only and drop them from the policy.
- **Gemini API tier:** on the free tier Google may use submitted content to improve its products, which the policy now says. On a paid tier it doesn't.

## When this needs updating

Revisit the policy, this page and `PrivacyInfo.xcprivacy` when any of these change:
- a new AI provider or `/api/*` processor
- analytics or crash reporting
- push notifications
- any new account field
- any new native plugin

Bump `LEGAL_VERSION` when the policy text changes. That re-prompts users to accept and stamps the public pages.
