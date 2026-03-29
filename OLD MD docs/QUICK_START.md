# SpiceHub PWA - Quick Start Guide

## What Changed?

SpiceHub is now a **fully offline-capable Progressive Web App** that doesn't require the Express server to function.

- Server is now **optional** (only for advanced social media extraction)
- All recipes stored locally in IndexedDB (survives app restart)
- Works completely offline
- Installable as native app on mobile
- Ready to deploy to Vercel, Netlify, or any static host

## Try It Now (2 minutes)

### Development Mode (No Server)
```bash
npm run dev
# Open http://localhost:5173
# All core features work!
```

### With Server (Advanced Features)
```bash
npm run dev:full
# Runs both frontend (5173) + backend (3001)
# Full social media extraction support
```

## Test Offline

1. Open http://localhost:5173
2. Open DevTools → Application tab
3. Check "Offline" checkbox
4. Refresh the page
5. Everything still works! (Try adding recipes, editing meals, building grocery lists)

## Deploy in 30 Seconds (Vercel)

```bash
npm run build
npx vercel --prod
```

That's it! Your app is live with a public URL.

## What Works Without Server

| Feature | Works Offline |
|---------|---------------|
| Browse recipes | ✅ |
| Add/edit meals | ✅ |
| Create week plans | ✅ |
| Build grocery lists | ✅ |
| Assign stores to items | ✅ |
| Import from recipe blogs | ✅ |
| Import spreadsheets | ✅ |
| Import from Paprika 3 | ✅ |
| Search recipes | ✅ |
| Rate/favorite meals | ✅ |

## What Needs Server

| Feature | Requires Server |
|---------|-----------------|
| Instagram extraction | ✅ (with fallback) |
| TikTok extraction | ✅ (with fallback) |
| Pinterest extraction | ✅ (with fallback) |
| Private social posts | ✅ |

## Key Files

- **`/src/api.js`** - Automatic server detection & fallback
- **`/src/db.js`** - Local data storage (IndexedDB)
- **`/vercel.json`** - Ready for Vercel
- **`/netlify.toml`** - Ready for Netlify
- **`PWA_DEPLOYMENT.md`** - Full deployment guide
- **`REFACTOR_SUMMARY.md`** - All technical details

## Troubleshooting

### Recipes disappeared after restart?
- Check DevTools → Application → IndexedDB → SpiceHubDB
- Should see meals, drinks, and storeMemory tables

### App not updating after deploy?
- Force refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
- Clear cache: DevTools → Storage → Clear site data

### Recipe import failing?
- Check if server is running (for social media)
- Try a recipe blog URL instead (uses CORS proxy)
- Check console for error messages

### Can't import from Instagram/TikTok?
- These need the server for best results
- Run `npm run dev:full` locally
- Or use CORS proxy fallback (may show placeholder)

## Next Steps

1. **Test offline:** See "Test Offline" section above
2. **Deploy:** Follow Vercel/Netlify steps
3. **Install on mobile:** Visit app → "Add to Home Screen"
4. **Check persistence:** DevTools → IndexedDB to see saved data

## Support

- Full docs: See `PWA_DEPLOYMENT.md`
- Technical details: See `REFACTOR_SUMMARY.md`
- Changes made: See `CHANGES.md`

---

**Ready to deploy? Start with `npm run build`, then use Vercel or Netlify!**
