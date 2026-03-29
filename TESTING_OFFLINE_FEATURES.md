# Testing Online/Offline Features

## Quick Testing Guide for SpiceHub PWA Offline/Online State Management

### 1. Testing in Browser DevTools

#### Chrome/Edge
1. Open SpiceHub in browser
2. Open DevTools (F12)
3. Go to **Network** tab
4. Check "Offline" checkbox at the top
5. Observe:
   - OfflineIndicator appears in top-right corner
   - Red "🔌 Offline" badge appears
   - BrowserAssist shows offline message instead of loading

#### Firefox
1. Open DevTools (F12)
2. Go to **Network** tab
3. Click the settings icon (⚙️)
4. Check "Throttling" → Select "Offline"
5. Same behavior as Chrome

### 2. Testing Online Status Changes

**Simulate Going Offline:**
```javascript
// In console
navigator.onLine = false;
window.dispatchEvent(new Event('offline'));
```

**Simulate Coming Back Online:**
```javascript
// In console
navigator.onLine = true;
window.dispatchEvent(new Event('online'));
```

### 3. Testing Cross-Tab Synchronization

1. Open SpiceHub in two browser tabs
2. Go offline in DevTools in one tab
3. Observe: Both tabs show offline indicator
4. Come back online in DevTools
5. Observe: Both tabs update simultaneously

### 4. Testing OfflineIndicator Component

**Verify UI states:**

**Online State (initial):**
- OfflineIndicator is hidden (no red badge visible)
- App functions normally

**Offline State:**
- Red badge appears in top-right: "🔌 Offline"
- Click to open status panel
- Panel shows "Offline" status
- Panel shows queued operations count
- Click outside to close

**Syncing State:**
- When isSyncing=true: shows "⏱️ Syncing..."
- Dot pulses with animation
- Shows badge with operation count

**Synced State:**
- When isSyncing=false and queuedOps=0
- Shows "✓ All synced" message
- Green/success color scheme

### 5. Testing BrowserAssist Offline Mode

1. Open any page to import recipe from
2. Go offline
3. Click "Import Recipe"
4. BrowserAssist should show:
   - "🔌 Offline Mode" message
   - "Cannot fetch recipe from the web while offline"
   - Button: "Paste Recipe Text Instead"
5. Click button to switch to manual paste mode
6. Can still manually add recipe content and save

### 6. Testing Offline Features

**With app offline, verify these work:**
- ✅ View existing recipes
- ✅ View meal library
- ✅ View bar inventory
- ✅ Plan meals (local data only)
- ✅ Manage grocery lists
- ✅ All local calculations work
- ❌ Import from web URLs (fallback to paste text)
- ❌ Fetch external images

**All data stays in local storage:**
- IndexedDB contains all recipes, meals, drinks
- Week plans saved locally
- Grocery lists in local storage
- No data loss

### 7. Testing Debounce Behavior (Flaky Network)

To simulate flaky WiFi (rapid online/offline):

```javascript
// Rapid on/off simulation
setInterval(() => {
  window.dispatchEvent(new Event('offline'));
  setTimeout(() => {
    window.dispatchEvent(new Event('online'));
  }, 500);
}, 3000);
```

Expected behavior:
- Offline indicator doesn't flicker constantly
- 2s debounce prevents false triggers
- UI stays stable after 2s of confirmed offline

### 8. Testing Mobile Responsiveness

**Viewport sizes to test:**
- 375px (iPhone SE)
- 414px (iPhone 12)
- 480px (Galaxy S10)
- 600px (Tablet portrait)
- 800px (Tablet landscape)

**On small screens:**
- OfflineIndicator still visible and functional
- Labels may be hidden (just icon/dot)
- Status panel positioned correctly
- No horizontal scroll needed

### 9. Testing Toast Notifications

When syncing completes (coming back online):
- Toast appears at bottom (above tab bar)
- Shows "✓ All changes synced"
- Green checkmark icon
- Auto-dismisses after 2.5 seconds
- Smooth slide-up animation

### 10. Testing with Service Worker

Once offline, Service Worker takes over:

1. Go offline
2. Refresh page (F5)
3. App should load completely from cache
4. All local features work

**Verify in DevTools:**
- Application → Service Workers → Shows registered SW
- Cache → Cache Storage shows precached assets

### 11. Manual Testing Checklist

Run through these scenarios:

- [ ] Start online → all features work
- [ ] Go offline → indicator appears
- [ ] Import recipe offline → shows message
- [ ] Click offline badge → status panel opens
- [ ] Click outside panel → closes
- [ ] Come back online → toast appears
- [ ] Import recipe online → works again
- [ ] View cached recipes offline → works
- [ ] Switch between tabs offline → both show indicator
- [ ] Refresh page offline → works from cache
- [ ] Test on mobile device → responsive and usable

### 12. Console Debugging

Enable detailed logging:

```javascript
// In DevTools console
localStorage.setItem('debug_offline', 'true');
// Reload page
```

Then you'll see:
- Online status changes
- Event emissions
- Storage sync messages

### 13. Performance Testing

Check performance impact:

1. DevTools → Performance tab
2. Record while toggling offline
3. Look for:
   - ✅ No excessive re-renders
   - ✅ No memory leaks
   - ✅ Smooth animations
   - ✅ Fast indicator updates

### 14. Edge Cases to Test

1. **App loaded offline**
   - Load app with network disabled
   - Should show loading → offline message
   - Local data available

2. **Multiple rapid changes**
   - Toggle online/offline rapidly
   - Should debounce correctly
   - No UI flicker

3. **Long offline period**
   - Stay offline for 5+ minutes
   - All features continue to work
   - Data persists

4. **Browser loses Internet mid-operation**
   - Start recipe import
   - Disconnect network during import
   - Should handle gracefully (not crash)

5. **Service Worker + Offline**
   - Offline + refresh
   - Should load from cache
   - All local features work

## Expected Results

All tests should pass without errors. The app should be fully functional offline with graceful degradation for web-dependent features.

## Reporting Issues

If any test fails:
1. Check browser console for errors
2. Verify all files are created correctly
3. Check that imports are correct
4. Clear cache and reload
5. Test in incognito mode (avoid cache issues)

---
**For questions about the implementation, see: OFFLINE_STATUS_IMPLEMENTATION.md**
