This stack trace provides a crystal-clear diagnostic map of your import engine's backend and frontend handshakes.

While Apify is successfully acts as your fallback savior for text extraction, the frontend is crashing hard because of a CORS security violation triggered by a client-side image conversion method.

Here is the exact technical breakdown of what is failing, why it’s happening, and how to fix the code.

🔍 The Error Breakdown

1. The Smoking Gun: Client-Side Fetching for Data URLs

Plaintext

downloadImageAsDataUrl @ api.js:622

importFromInstagram @ recipeParser.js:4393

What is happening: Your code isn't just putting the Instagram image URL inside a standard <img src="..."> tag. At api.js:622, your script is explicitly executing a JavaScript fetch() request to download the raw image bytes, likely attempting to convert it into a Base64 string or a Blob via a function named downloadImageAsDataUrl.
Why it fails: Browsers permit cross-origin image loading via standard HTML tags, but they strictly block direct programmatic JavaScript fetch() or XMLHttpRequest requests to external CDNs unless the destination server sends a permissive header (Access-Control-Allow-Origin: *). Instagram’s CDN (scontent-lga3-1.cdninstagram.com) explicitly denies this, resulting in net::ERR_FAILED.
2. The Service Worker / PWA Crash

Plaintext

NetworkOnly.js:93 Uncaught (in promise) no-response: no-response

at Pe._handle (NetworkOnly.js:93:19)

What is happening: Your app is running a Service Worker (likely using Google's Workbox library for PWA capabilities). The image fetch request is being intercepted by a NetworkOnly caching strategy.
Why it fails: Because the browser blocks the CDN fetch request due to CORS, the network request yields an empty/rejected promise. Workbox expects a valid response stream; when it gets absolutely nothing back, it throws an uncaught runtime exception in the browser console.
3. The Meta OEmbed App Review Roadblock

Plaintext

api.js:677 [fetchInstagramOEmbed] Not configured or error:

{ message: "(#10) To use 'Meta oEmbed Read', your use of this… " }

What is happening: Your second fallback pipeline (fetchInstagramOEmbed) hit Meta's official API gateway and got rejected with an explicit OAuth Exception (Code 10).
Why it fails: Meta changed its rules regarding open graph data. To use the official oEmbed API endpoint for Instagram reels, your Meta Developer App must officially go through their formal App Review process specifically for the Meta oEmbed Read permission. Without that approved use case on your developer dashboard, Meta blocks the handshake entirely.
🛠️ How to Fix It

1. Move downloadImageAsDataUrl to the Backend (Recommended)

You cannot convert this image to a data URL on the user's mobile browser because of client-side CORS guardrails. You must execute this step on your server layer where CORS boundaries do not exist.

If you are using Next.js/Vercel API routes or a Node.js backend, rewrite the workflow:

Pass the raw Instagram CDN image URL from the frontend to your own backend endpoint: POST /api/convert-image with { imageUrl: "..." }.
On the backend, use axios or native fetch to grab the image bytes.
Convert those bytes to a base64 string on the server:
JavaScript

const response = await fetch(imageUrl);

const buffer = await response.arrayBuffer();

const base64 = Buffer.from(buffer).toString('base64');

const dataUrl = `data:image/jpeg;base64,${base64}`;

Return the dataUrl string back to your frontend UI.
2. Configure a Bypass or Fallback Image

If the image conversion fails, ensure your promise chain handles the rejection gracefully so it doesn't halt the execution of importFromInstagram. Wrap your image downloader in a strict try/catch block to ensure the user can still save the recipe text even if the photo fails to load:

JavaScript

// api.js

async function downloadImageAsDataUrl(url) {

  try {

    const res = await fetch(url);

    if (!res.ok) throw new Error('Network response failed');

    // conversion logic...

  } catch (error) {

    console.warn("CORS or Network error preventing image download. Using placeholder.");

    return "/assets/placeholder-recipe.png"; // Return a clean local asset instead of blowing up

  }

}

//====================================================

The structural shift looks drastically better. Implementing the segmented tab control ([🥕 Ingredients 11] and [📝 Steps 7]) completely solves the mobile scrolling amnesia problem. It anchors the viewport beautifully, gives the user immediate clarity on what data buckets exist, and cuts the vertical height of the modal in half.

You’ve successfully built a great mobile container on SpiceHub. Now, we just need to clean up the content inside it.

Here is a quick CX checkpoint on how the layout is performing with this live Instagram reel:

🌟 The UX Wins

Excellent Visual Hierarchy: The segmented tabs are clean, thumb-friendly, and clearly show the item counts.
Clear Micro-Actions: The reorder handles (▲/▼) and delete keys (✕) look native and responsive.
Sticky Purpose: Keeping the Save to library button anchored at the bottom ensures the primary goal is always one tap away.
🚧 The Remaining Ingestion Friction

While the layout structure is optimized, the "Data Cleaning Tax" is still high for the user here.

1. Conversational Garbage in the Ingredients List

The parser successfully extracted the actual ingredients (potatoes, spinach, pepper, eggs), but it dumped the creator's social hooks right alongside them. Out of the 11 items listed in the active tab, the first 5 are fluff:

So EASY and quick
Packed full of nutrition
Gluten free
Enjoy!
DB x
The Fix: This is where that client-side regex filter or an updated ingestion blocklist will pay massive dividends. Stripping out isolated hype words, emojis, or common sign-offs before rendering will instantly drop that ingredient counter from a bloated 11 to a crisp, accurate 6.

2. Missing Title Fallback

The Recipe title input field is completely empty, forcing the user to manually type one out on their mobile keyboard.

The Fix: If the LLM misses a distinct title, have a local script auto-populate the field with a string generated from the actual ingredients, like "Potato & Spinach Egg Bake", so the box isn't sitting blank.
3. The "High 7000%" Mystery

The badge in the upper right corner of the media card reads High 7000%. Whether this is a parsed macro-tracking stat from the caption or a temporary rendering bug, it distracts a bit from the clean culinary aesthetic.

Overall Verdict

The structural layout blueprint is a massive upgrade—it actually feels like a modern mobile application now. If you can pair this tabbed interface with a quick backend/frontend regex scrub to evict those conversational phrases, the import experience will feel incredibly slick.

Are the tabs currently handling the item migration dynamically (e.g., if you tap a button on the Steps tab, does it smoothly shift over here to Ingredients), or are you focusing on sanitizing this incoming string data next?

//=====================================================================

Based on the current state of the sheet open on your screen, there are a few likely suspects—ranging from basic frontend validation to a bricked React state from those console errors we just looked at.

Here is the breakdown of why that button is ghosting you:

1. The Input Field is Empty (Most Likely Frontend Guardrail)

Looking at the current view, the Paste recipe URL... field is sitting in its empty placeholder state.

The Culprit: In ImportInput.jsx (line 67 in your stack trace), there is almost certainly a safety check disabling the button or short-circuiting the function if the text length is zero.
The Fix: The button should ideally remain visually grayed out (disabled={!urlInput}) until a valid string is detected so the user intuitively knows why it's not clickable, rather than leaving a bright orange button looking active but acting dead.
2. A Bricked Component State (The JavaScript Hangover)

If you did paste a link, clicked it, and now it's completely unresponsive on subsequent taps, your React state queue is likely locked up.

The Culprit: Look back at that uncaught promise error from your service worker: Uncaught (in promise) no-response. When importFromInstagram threw that unhandled network exception, the execution thread halted mid-flight. If your code sets setIsLoading(true) at the start of the click but doesn't have a catch or finally block to set setIsLoading(false) when it crashes, the app permanently thinks it's still importing. The button handler sees if (isLoading) return; and ignores your thumb completely.
The Fix: Ensure every step of your recipeParser.js workflow is tightly wrapped in a try/catch block so the loading state is safely reset to false even on total network failure.
3. Touch Target / Event Bubbling Conflict

The Culprit: You have a lot of competing touch elements layered inside that modal sheet (URL tabs, Meal/Drink toggles, close buttons). If the orange button container doesn't have an explicit z-index layer or if a transparent wrapper from the input sheet is overlapping it vertically, the browser might be registering your clicks on a parent element instead of the button itself.
The Fix: Give the button a quick background color change on :active or :hover in your CSS. If it doesn't flash darker when you click it, the browser isn't even passing the pointer event to the button.
Quick test to find out which it is: Give the page a hard refresh, paste a random URL, and see if it fires. If it does on the first try but dies after a failure, you've got a state-locking bug in your try/catch blocks!