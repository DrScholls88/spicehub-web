# Native release runbook (Capacitor 8)

The store builds bundle `dist/` into the app (no `server.url`), so they work offline from first launch. Everything native is in `android/`, `ios/`, `capacitor.config.json` and `src/lib/nativeShell.js`.

## Every build (Windows, PowerShell)

Requires Node 22+ and Android Studio Otter (2025.2.1) or newer.

Store requirements, both already met by the generated projects (checked 2026-10-24):
- **Google Play:** since August 31, 2026, new apps and updates must target API 36. `android/variables.gradle` has `compileSdkVersion` and `targetSdkVersion` at 36, with AGP 8.13.0 and Gradle 8.14.3.
- **App Store:** since April 28, 2026, uploads must be built with Xcode 26 and the iOS 26 SDK. Capacitor 8 already requires Xcode 26, and the project builds against the current SDK. The deployment target stays at iOS 15, which is a separate setting and only sets the oldest iPhone that can install the app.

```powershell
npm install
npm run cap:sync          # vite build + copy dist/ into android/ and ios/
npx cap open android      # Run on a device, or Build > Generate Signed App Bundle
```

`cap:sync` bumps `buildNumber.json` like any build. Bump `versionCode` / `versionName` in `android/app/build.gradle` (and Version / Build in Xcode) before each store upload.

## One-time setup

1. **Supabase**: Auth > URL Configuration > Redirect URLs, add `com.spicehub.app://auth/callback`. Without it, Google and magic-link sign-in can't return to the app. Also apply `supabase/migrations/007_delete_my_account.sql`, or Delete Account in Settings will fail.
2. **App ID**: `com.spicehub.app` is permanent once uploaded. Confirm it's what you want in Play Console and App Store Connect first.
3. **Signing**: see Signing and keys below.

## Signing and keys

**Android (Play App Signing).** Google holds the key that signs what users install. You only keep an *upload key*.
1. Android Studio > Build > Generate Signed App Bundle > Android App Bundle > Create new. Save it outside the repo, for example `Documents\keys\spicehub-upload.jks`, with a strong password and alias `upload`.
2. In Play Console, create the app and upload that first `.aab` under Release > Testing > Internal testing. New apps are enrolled in Play App Signing by default; accept "Let Google manage and protect your app signing key". Don't export or upload your own signing key.
3. Back up the `.jks` file, its store password, key alias and key password together in a password manager, plus a second copy off this PC. Keep the Play Console "App signing" certificate fingerprints next to them; you'll need the SHA-256 for Google sign-in or App Links later.
4. A lost upload key isn't fatal under Play App Signing: Play Console > Setup > App signing > Request upload key reset. It costs a few days, so the backup still matters.
5. Bump `versionCode` (must always increase) and `versionName` in `android/app/build.gradle` for every upload.

**iOS.** Let Xcode manage signing: in Signing & Capabilities, tick Automatically manage signing and pick your team for both the App and ShareExtension targets. Apple holds the distribution certificate, and it can be revoked and reissued, so there's no file you must keep. Two exceptions:
- If you create an App Store Connect API key (`.p8`) for CI or Transporter, it downloads only once. Store it in the password manager with its Key ID and Issuer ID.
- If you ever export a distribution certificate (`.p12`) for another Mac, keep it and its password with the Android key.

`.gitignore` now refuses `*.jks`, `*.keystore`, `keystore.properties`, `*.p12`, `*.p8` and `*.mobileprovision`, so none can be committed by accident.

## iOS (needs a Mac with Xcode 26+)

```bash
npm install && npm run cap:sync && npx cap open ios
```

Copy `.env.local` to the Mac first. The build reads `VITE_SERVER_URL` and the Supabase keys from it.

1. **App** target > Signing & Capabilities > **+ App Groups** > `group.com.spicehub.app`.
2. File > New > Target > **Share Extension**, name it `ShareExtension` (bundle id `com.spicehub.app.ShareExtension`). Don't activate its scheme.
3. Replace the generated `ShareExtension/ShareViewController.swift` and `ShareExtension/Info.plist` with the copies in `ios/App/ShareExtension.template/`, and add its `PrivacyInfo.xcprivacy` to the ShareExtension target. Delete `MainInterface.storyboard`, then delete the template folder.
4. **ShareExtension** target: iOS Deployment Target 15.0, and add the same App Group.
5. If Xcode reports `open(_:options:completionHandler:)` unavailable in extensions, set Build Settings > *Require Only App-Extension-Safe API* to **No** on the ShareExtension target.

The extension code hasn't been compiled yet. If it can't open the app, the share still arrives the next time SpiceHub is foregrounded, because the plugin also checks on `didBecomeActive`.

## Versioning and updates

Use one scheme on both stores:

| Field | Android (`android/app/build.gradle`) | iOS (Xcode > App target > General) | Rule |
|---|---|---|---|
| User-facing version | `versionName` | Version (`MARKETING_VERSION`) | `2.1.0` style. Bump minor for features, patch for fixes. Keep `package.json` `version` in step |
| Build number | `versionCode` | Build (`CURRENT_PROJECT_VERSION`) | One integer, +1 on **every** upload. Stores reject a repeat |

The header `v2.0xx` badge (`buildNumber.json`) is a web build stamp, not the store version. It now shows only in the Settings footer on phones.

**What needs a store release:** anything in `android/`, `ios/`, `capacitor.config.json` or a native plugin change, plus web fixes for the store apps, because the web layer is bundled. Google review usually takes hours; Apple's usually takes about a day. The website and PWA still update the moment Vercel deploys.

**Live updates (not set up; decide after launch).** If waiting for review on small web fixes starts to hurt, the zero-cost route is `@capgo/capacitor-updater` in self-hosted manual mode:
- **How it works:** publish `dist.zip` plus a small `latest.json` from Vercel. The app checks on resume, downloads in the background, and swaps on the next launch.
- **Rollback:** `notifyAppReady()` rolls back to the bundled version if a new bundle fails to start.
- **Cost:** no Capgo cloud plan is needed.
- **Rules:**
  - Only ship web-layer changes this way. Apple's developer agreement allows downloaded JS/HTML that doesn't change the app's primary purpose.
  - Tag each zip with the native build it was built against, and refuse it on any other.
  - Never use it to add features that reviewers haven't seen.

## Device test plan

Use a notched phone and a small one, on each platform, in light and dark mode.

- [ ] Cold start offline (airplane mode): app loads, meals and pantry are present.
- [ ] Instagram > Share > SpiceHub with the app **closed**: the import sheet opens with the link. Repeat with the app open.
- [ ] Paste a recipe blog URL: import completes. This exercises `/api/*` going to Vercel.
- [ ] Import > Take Photo: the system camera opens, iOS asks for permission with the SpiceHub text, and the photo imports.
- [ ] Status bar and home indicator never cover the header, tab bar or the capture `+` (rotate too).
- [ ] Focus the import URL field and the AddEditMeal ingredient rows: nothing ends up under the keyboard, and closing the keyboard leaves no gap.
- [ ] Android back: closes the top sheet, then shows "Press back again to exit" on Home, then exits.
- [ ] Settings > Export backup, Bar backup and Starter ZIP: the native share sheet opens with the file.
- [ ] Grocery "Share list": the native share sheet opens with text.
- [ ] Settings shows no "Install to phone" or "Check for Updates".
- [ ] Friends > Sign in with Google, then with a magic link: you come back signed in.

## Known gaps before submission

- **Sign in with Apple (App Store Guideline 4.8)**: iOS offers Google sign-in, so Apple expects an equivalent privacy-preserving option. You can add Sign in with Apple, or hide Google on iOS and keep the magic link.
- **Icon source**: `assets/icon-only.png` is `public/icon-512.png` upscaled. Replace it with a 1024×1024 master, then run `npx @capacitor/assets generate --ios --android --iconBackgroundColor "#e65100" --splashBackgroundColor "#fff8f0" --splashBackgroundColorDark "#1c1410"`.
- **Shared images**: shared screenshots aren't accepted (text/URL only, same as the web share target).
- **Store listings**: privacy answers and URLs are in `docs/store-privacy.md`. Screenshots and descriptions are still to do.
