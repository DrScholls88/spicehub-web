/* eslint-disable no-unused-vars */
declare const __SPICEHUB_BUILD__: number;
// Wall-clock ms at build time (Date.now(), computed once in vite.config.js).
// This is the field update-detection actually compares (see
// src/lib/pwaUpdateSignal.js) — __SPICEHUB_BUILD__ is a human-maintained
// counter in buildNumber.json that CI increments in an ephemeral checkout
// and never commits back, so it is NOT reliably monotonic across real
// deploys (git history shows it jump 613 -> 13 -> 32 -> 33 -> 1). A build
// timestamp needs no coordination and is monotonic by construction.
declare const __SPICEHUB_BUILD_TIME__: number;
declare const __SPICEHUB_VERSION__: string;
