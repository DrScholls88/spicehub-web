Service Worker registered: ServiceWorkerRegistration {installing: null, waiting: null, active: ServiceWorker, navigationPreload: NavigationPreloadManager, scope: 'https://spicehub-web.vercel.app/', …}
main.jsx:70 Background Sync API available
VM1416 keyboard-shortcuts.js:214 Extension keyboard shortcuts loaded. Available shortcuts:
VM1416 keyboard-shortcuts.js:215 - Alt+C: Toggle Copy Mode
VM1416 keyboard-shortcuts.js:216 - Alt+A: Toggle Absolute Mode
VM1416 keyboard-shortcuts.js:217 - Alt+O: Trigger OCR Mode
backgroundSync.js:32 [BackgroundSync] Registered sync-recipe-imports
keyboard-shortcuts.js:214 Extension keyboard shortcuts loaded. Available shortcuts:
keyboard-shortcuts.js:215 - Alt+C: Toggle Copy Mode
keyboard-shortcuts.js:216 - Alt+A: Toggle Absolute Mode
keyboard-shortcuts.js:217 - Alt+O: Trigger OCR Mode
api.js:85 [fetchHtmlViaProxy] Target: https://www.allrecipes.com/recipe/13637/three-bean-salad
api.js:105 [fetchHtmlViaProxy] Internal proxy returned empty/error, trying public proxies...
(index):1 Access to fetch at 'https://api.allorigins.win/raw?url=https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://api.allorigins.win/raw?url=https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad net::ERR_FAILED 500 (Internal Server Error)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ ImportModal.jsx:397
(anonymous) @ ImportModal.jsx:1377
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274Understand this error
api.js:128  GET https://corsproxy.io/?https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad 403 (Forbidden)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ ImportModal.jsx:397
(anonymous) @ ImportModal.jsx:1377
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274Understand this error
(index):1 Access to fetch at 'https://proxy.cors.sh/https://www.allrecipes.com/recipe/13637/three-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://proxy.cors.sh/https://www.allrecipes.com/recipe/13637/three-bean-salad net::ERR_FAILED 429 (Too Many Requests)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ ImportModal.jsx:397
(anonymous) @ ImportModal.jsx:1377
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274Understand this error
(index):1 Access to fetch at 'https://cors.bridged.cc/https://www.allrecipes.com/recipe/13637/three-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://cors.bridged.cc/https://www.allrecipes.com/recipe/13637/three-bean-salad net::ERR_FAILED 429 (Too Many Requests)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ ImportModal.jsx:397
(anonymous) @ ImportModal.jsx:1377
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274Understand this error
installHook.js:1 [fetchHtmlViaProxy] ❌ All proxies failed for: https://www.allrecipes.com/recipe/13637/three-bean-salad
overrideMethod @ installHook.js:1
fetchHtmlViaProxy @ api.js:161
await in fetchHtmlViaProxy
(anonymous) @ ImportModal.jsx:397
(anonymous) @ ImportModal.jsx:1377
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274Understand this warning
api.js:85 [fetchHtmlViaProxy] Target: https://www.allrecipes.com/recipe/13637/three-bean-salad
api.js:105 [fetchHtmlViaProxy] Internal proxy returned empty/error, trying public proxies...
(index):1 Access to fetch at 'https://api.allorigins.win/get?url=https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://api.allorigins.win/get?url=https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad net::ERR_FAILED 520
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ BrowserAssist.jsx:304
(anonymous) @ BrowserAssist.jsx:368
commitHookEffectListMount @ react-dom-client.production.js:8583
commitPassiveMountOnFiber @ react-dom-client.production.js:10126
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10137
flushPassiveEffects @ react-dom-client.production.js:11763
(anonymous) @ react-dom-client.production.js:11498
performWorkUntilDeadline @ scheduler.production.js:151
postMessage
(anonymous) @ scheduler.production.js:202
performWorkUntilDeadline @ scheduler.production.js:187
postMessage
(anonymous) @ scheduler.production.js:202
(anonymous) @ scheduler.production.js:325
scheduleTaskForRootDuringMicrotask @ react-dom-client.production.js:12055
processRootScheduleInMicrotask @ react-dom-client.production.js:11978
(anonymous) @ react-dom-client.production.js:12095Understand this error
api.js:128  GET https://corsproxy.io/?https%3A%2F%2Fwww.allrecipes.com%2Frecipe%2F13637%2Fthree-bean-salad 403 (Forbidden)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ BrowserAssist.jsx:304
(anonymous) @ BrowserAssist.jsx:368
commitHookEffectListMount @ react-dom-client.production.js:8583
commitPassiveMountOnFiber @ react-dom-client.production.js:10126
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10137
flushPassiveEffects @ react-dom-client.production.js:11763
(anonymous) @ react-dom-client.production.js:11498
performWorkUntilDeadline @ scheduler.production.js:151
postMessage
(anonymous) @ scheduler.production.js:202
performWorkUntilDeadline @ scheduler.production.js:187
postMessage
(anonymous) @ scheduler.production.js:202
(anonymous) @ scheduler.production.js:325
scheduleTaskForRootDuringMicrotask @ react-dom-client.production.js:12055
processRootScheduleInMicrotask @ react-dom-client.production.js:11978
(anonymous) @ react-dom-client.production.js:12095Understand this error
(index):1 Access to fetch at 'https://proxy.cors.sh/https://www.allrecipes.com/recipe/13637/three-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://proxy.cors.sh/https://www.allrecipes.com/recipe/13637/three-bean-salad net::ERR_FAILED 429 (Too Many Requests)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ BrowserAssist.jsx:304
(anonymous) @ BrowserAssist.jsx:368
commitHookEffectListMount @ react-dom-client.production.js:8583
commitPassiveMountOnFiber @ react-dom-client.production.js:10126
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10137
flushPassiveEffects @ react-dom-client.production.js:11763
(anonymous) @ react-dom-client.production.js:11498
performWorkUntilDeadline @ scheduler.production.js:151
postMessage
(anonymous) @ scheduler.production.js:202
performWorkUntilDeadline @ scheduler.production.js:187
postMessage
(anonymous) @ scheduler.production.js:202
(anonymous) @ scheduler.production.js:325
scheduleTaskForRootDuringMicrotask @ react-dom-client.production.js:12055
processRootScheduleInMicrotask @ react-dom-client.production.js:11978
(anonymous) @ react-dom-client.production.js:12095Understand this error
(index):1 Access to fetch at 'https://cors.bridged.cc/https://www.allrecipes.com/recipe/13637/three-bean-salad' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.Understand this error
api.js:128  GET https://cors.bridged.cc/https://www.allrecipes.com/recipe/13637/three-bean-salad net::ERR_FAILED 429 (Too Many Requests)
fetchHtmlViaProxy @ api.js:128
await in fetchHtmlViaProxy
(anonymous) @ BrowserAssist.jsx:304
(anonymous) @ BrowserAssist.jsx:368
commitHookEffectListMount @ react-dom-client.production.js:8583
commitPassiveMountOnFiber @ react-dom-client.production.js:10126
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10137
flushPassiveEffects @ react-dom-client.production.js:11763
(anonymous) @ react-dom-client.production.js:11498
performWorkUntilDeadline @ scheduler.production.js:151
postMessage
(anonymous) @ scheduler.production.js:202
performWorkUntilDeadline @ scheduler.production.js:187
postMessage
(anonymous) @ scheduler.production.js:202
(anonymous) @ scheduler.production.js:325
scheduleTaskForRootDuringMicrotask @ react-dom-client.production.js:12055
processRootScheduleInMicrotask @ react-dom-client.production.js:11978
(anonymous) @ react-dom-client.production.js:12095Understand this error
installHook.js:1 [fetchHtmlViaProxy] ❌ All proxies failed for: https://www.allrecipes.com/recipe/13637/three-bean-salad
overrideMethod @ installHook.js:1
fetchHtmlViaProxy @ api.js:161
await in fetchHtmlViaProxy
(anonymous) @ BrowserAssist.jsx:304
(anonymous) @ BrowserAssist.jsx:368
commitHookEffectListMount @ react-dom-client.production.js:8583
commitPassiveMountOnFiber @ react-dom-client.production.js:10126
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10120
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10241
recursivelyTraversePassiveMountEffects @ react-dom-client.production.js:10101
commitPassiveMountOnFiber @ react-dom-client.production.js:10137
flushPassiveEffects @ react-dom-client.production.js:11763
(anonymous) @ react-dom-client.production.js:11498
performWorkUntilDeadline @ scheduler.production.js:151
postMessage
(anonymous) @ scheduler.production.js:202
performWorkUntilDeadline @ scheduler.production.js:187
postMessage
(anonymous) @ scheduler.production.js:202
(anonymous) @ scheduler.production.js:325
scheduleTaskForRootDuringMicrotask @ react-dom-client.production.js:12055
processRootScheduleInMicrotask @ react-dom-client.production.js:11978
(anonymous) @ react-dom-client.production.js:12095Understand this warning
BrowserAssist.jsx:314 [BrowserAssist] Proxy failed, falling back to direct iframe source
Framing 'https://www.allrecipes.com/' violates the following Content Security Policy directive: "frame-ancestors 'self' https://*.seo.aws.about.com https://*.dotdash.com *.allrecipes.com". The request has been blocked.
Understand this error
(index):1 Unsafe attempt to load URL https://www.allrecipes.com/recipe/13637/three-bean-salad/ from frame with URL chrome-error://chromewebdata/. Domains, protocols and ports must match.