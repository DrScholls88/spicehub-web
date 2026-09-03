import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { saveWeekPlan, loadWeekPlan, getWeekHistory, saveWeekToHistory, getCookingLog } from '../db';
import { planWeek, pickForSlot, buildRecencyMap } from '../lib/weekPlanner';
import { loadSpinConstraints, saveSpinConstraints } from '../lib/landingLayout';
import { SPECIAL_DAYS } from '../lib/specialDays';

// A-1: household dietary preference for Smart Auto-Plan (device-local).
const DIETARY_PREF_KEY = 'spicehub_dietary_pref';
function loadDietaryPref() {
  try {
    const raw = localStorage.getItem(DIETARY_PREF_KEY);
    if (!raw) return { dietary: '', mode: 'require' };
    const p = JSON.parse(raw);
    return { dietary: p.dietary || '', mode: p.mode || 'require' };
  } catch { return { dietary: '', mode: 'require' }; }
}

// ── Date utilities (shared with week history logic) — duplicated from
// App.jsx's own copies rather than shared, since they're two-line pure
// functions and this keeps the hook a self-contained, dependency-free module. ──
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * useRotationEngine — owns the current week's plan, week history, locked-day
 * flags, and diet/spin filtering. Every mutator here updates React state
 * first (instant, optimistic UI) and persists to Dexie afterward — the app
 * never blocks on a write, and SpiceHub's offline-first guarantee (constitution:
 * "the app must be fully functional without an internet connection") holds
 * because Dexie itself is the local store, not a network call.
 *
 * Deliberately does NOT know about home-group real-time sync (useHomeGroup) —
 * that's a separate, optional cross-device concern. Callers that need it
 * (App.jsx) wrap the specific mutators that changed a single day (respinDay,
 * setDayMeal) with their own homeGroup.enqueueSync call after invoking these,
 * keeping this hook's responsibility to "what changed, and is it durable
 * on this device" only.
 *
 * @param {object} deps
 * @param {Array} deps.meals - full meal library (used to derive rotationMeals
 *   and as the respin/smart-plan fallback pool)
 * @param {(message: string, type?: string, duration?: number) => void} deps.showToast
 * @param {(pref: {dietary: string, mode: string}) => Promise<any>} [deps.profileUpdateDietaryPref]
 *   optional — syncs the dietary preference to the user's cloud profile when
 *   home-group/profile sync is enabled; safe to omit.
 */
export function useRotationEngine({ meals, showToast, profileUpdateDietaryPref }) {
  const [weekPlan, setWeekPlan] = useState(Array(7).fill(null));
  const [weekHistory, setWeekHistory] = useState([]); // past week plans

  // A-1: household dietary preference + cached recency map for Smart Auto-Plan
  const [dietaryPref, setDietaryPref] = useState(loadDietaryPref);
  const recencyMapRef = useRef(new Map());

  // Spin Action Center (2026-07-14): pre-spin constraints, device-local.
  // vegetarianOnly is NOT read from this persisted blob — it's always derived
  // fresh from dietaryPref below so there's exactly one vegetarian setting in
  // the app, not two that can drift out of sync.
  const [spinConstraintsRaw, setSpinConstraintsRaw] = useState(loadSpinConstraints);
  const spinConstraints = useMemo(() => ({
    ...spinConstraintsRaw,
    vegetarianOnly: dietaryPref?.dietary === 'vegetarian' && dietaryPref?.mode !== 'exclude',
  }), [spinConstraintsRaw, dietaryPref]);
  const updateSpinConstraints = useCallback((patch) => {
    setSpinConstraintsRaw(prev => {
      const next = { ...prev, ...patch };
      saveSpinConstraints(next);
      return next;
    });
  }, []);

  // ── Restore persisted week plan + history on mount ──────────────────────
  useEffect(() => {
    loadWeekPlan().then(plan => { if (plan) setWeekPlan(plan); });
    getWeekHistory().then(history => setWeekHistory(history));
  }, []);

  // ── Persist week plan whenever it changes (debounced) — Dexie write follows
  // the optimistic state update, never blocks it. ──
  useEffect(() => {
    if (!weekPlan.some(Boolean)) return; // Don't save empty plans
    const t = setTimeout(() => {
      saveWeekPlan(weekPlan);
      // Also save to history for the current week
      const monday = getMondayOfWeek(new Date());
      saveWeekToHistory(monday.toISOString(), weekPlan)
        .then(() => getWeekHistory().then(h => setWeekHistory(h)));
    }, 300);
    return () => clearTimeout(t);
  }, [weekPlan]);

  // Compute rotation meals
  const rotationMeals = useMemo(() => meals.filter(m => m.inRotation), [meals]);

  // A-1 Smart auto-plan: IDs of meals used in the last 2 weeks so MealSpinner
  // can de-prioritize them without excluding them entirely (graceful fallback).
  const recentlyUsedIds = useMemo(() => {
    const ids = new Set();
    weekHistory.slice(-2).forEach(hw => {
      (hw.meals || []).forEach(m => { if (m && m.id) ids.add(m.id); });
    });
    weekPlan.forEach(m => { if (m && m.id) ids.add(m.id); });
    return ids;
  }, [weekHistory, weekPlan]);

  // A-1: warm the recency map once so single-day rerolls are recency-aware even
  // before the first "Plan my Week" tap. Refreshed again inside smartPlanWeek.
  useEffect(() => {
    let cancelled = false;
    getCookingLog()
      .then(log => { if (!cancelled) recencyMapRef.current = buildRecencyMap(log); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A-1: reroll a single day — rotation-only and score-aware (variety/recency/
  // time-fit), with jitter so repeated rerolls vary. Falls back to all meals
  // only when The Rotation is empty so the control never dead-ends.
  // Returns the picked meal (so callers that need to sync it elsewhere can),
  // or null if there was nothing to pick (a toast already explained why).
  const respinDay = useCallback((dayIndex) => {
    const current = weekPlan[dayIndex];
    if (current && current._special) return null;
    const pool = rotationMeals.length > 0 ? rotationMeals : meals;
    const pick = pickForSlot(pool, {
      slotIndex: dayIndex,
      currentPlan: weekPlan,
      recencyMap: recencyMapRef.current,
      prefs: dietaryPref,
    });
    if (!pick) { showToast('Add more meals to your rotation to swap in 🔄'); return null; }
    setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? pick : m));
    return pick;
  }, [meals, weekPlan, rotationMeals, dietaryPref, showToast]);

  const restoreWeek = useCallback((weekMeals) => {
    if (!weekMeals || weekMeals.length !== 7) return;
    setWeekPlan(weekMeals);
    showToast('Week restored!');
  }, [showToast]);

  // A-1: Smart Auto-Plan — fill every empty, unlocked slot from The Rotation
  // using the local scoring engine. Locked/filled days are preserved.
  const smartPlanWeek = useCallback(async () => {
    if (rotationMeals.length === 0) {
      showToast('Add meals to your rotation first, then plan your week 🔄');
      return;
    }
    let recencyMap = recencyMapRef.current;
    try {
      const log = await getCookingLog();
      recencyMap = buildRecencyMap(log);
      recencyMapRef.current = recencyMap;
    } catch { /* use cached/empty recency — still works offline */ }
    const planned = planWeek(rotationMeals, {
      currentPlan: weekPlan,
      recencyMap,
      prefs: dietaryPref,
    });
    const filled = planned.filter(Boolean).length;
    setWeekPlan(planned);
    if (filled < 7) {
      showToast(`Planned ${filled} day${filled === 1 ? '' : 's'} — add more to your rotation to fill the week ✨`);
    } else {
      showToast('Week planned ✨');
    }
  }, [rotationMeals, weekPlan, dietaryPref, showToast]);

  const updateDietaryPref = useCallback((pref) => {
    const next = { dietary: pref?.dietary || '', mode: pref?.mode || 'require' };
    setDietaryPref(next);
    // Save to both localStorage (sync fallback) and profile (source of truth)
    try { localStorage.setItem(DIETARY_PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (profileUpdateDietaryPref) profileUpdateDietaryPref(next).catch(() => {});
  }, [profileUpdateDietaryPref]);

  // Pure — no home-group sync here (see file header). Returns nothing;
  // callers already have `meal` in hand if they need to sync it onward.
  const setDayMeal = useCallback((dayIndex, meal) => {
    setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? meal : m));
  }, []);

  const toggleLockDay = useCallback((dayIndex) => {
    setWeekPlan(prev => prev.map((m, i) => {
      if (i === dayIndex && m && !m._special) {
        return { ...m, _locked: !m._locked };
      }
      return m;
    }));
  }, []);

  /** Protect all planned (non-special) days from re-spin — one tap instead of 14. */
  const lockAllPlanned = useCallback(() => {
    setWeekPlan(prev => {
      const next = prev.map(m => (m && !m._special ? { ...m, _locked: true } : m));
      const n = next.filter(m => m && m._locked).length;
      if (n > 0) showToast(`Protected ${n} meal${n === 1 ? '' : 's'} from re-spin`, 'success');
      else showToast('No meals to protect — spin a week first', 'info');
      return next;
    });
  }, [showToast]);

  const unlockAllPlanned = useCallback(() => {
    setWeekPlan(prev => prev.map(m => (m && !m._special ? { ...m, _locked: false } : m)));
    showToast('All days unlocked', 'info');
  }, [showToast]);

  const setDaySpecial = useCallback((dayIndex, specialId) => {
    const special = SPECIAL_DAYS.find(s => s.id === specialId);
    if (special) {
      setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? { ...special, _special: true } : m));
    } else {
      setWeekPlan(prev => prev.map((m, i) => i === dayIndex ? null : m));
    }
  }, []);

  // Applies a MealSpinner result set (single or multi-day, current or future
  // week) to weekPlan/weekHistory. pairs = [{ date: Date, meal }]. Returns the
  // resulting current-week plan (or null if the batch didn't touch this week)
  // so callers can chain a same-tick grocery-list build without waiting on
  // the debounced persist effect above to catch up.
  const applySpinResults = useCallback(async (pairs) => {
    const todayMonday = getMondayOfWeek(new Date());
    const weekMap = new Map();

    pairs.forEach(({ date, meal }) => {
      const weekMon = getMondayOfWeek(date);
      const key = localDateKey(weekMon);
      const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // Mon-first DOW index

      if (!weekMap.has(key)) {
        const isCurrent = weekMon.getTime() === todayMonday.getTime();
        // Seed plan from current state or from history
        let plan;
        if (isCurrent) {
          plan = [...weekPlan];
        } else {
          const histEntry = weekHistory.find(hw => {
            const hwMon = new Date(hw.weekStart); hwMon.setHours(0, 0, 0, 0);
            return localDateKey(hwMon) === key;
          });
          plan = histEntry ? [...histEntry.meals] : Array(7).fill(null);
        }
        weekMap.set(key, { mon: weekMon, isCurrent, plan });
      }

      weekMap.get(key).plan[dow] = meal;
    });

    // Persist each week
    let currentPlanApplied = null;
    for (const [, { mon, isCurrent, plan }] of weekMap) {
      if (isCurrent) {
        currentPlanApplied = plan;
        setWeekPlan(plan);
      } else {
        await saveWeekToHistory(mon.toISOString(), plan);
      }
    }

    // Refresh history so calendar/Previous Weeks reflects changes
    const freshHistory = await getWeekHistory();
    setWeekHistory(freshHistory);

    return currentPlanApplied;
  }, [weekPlan, weekHistory]);

  return {
    weekPlan, setWeekPlan,
    weekHistory, setWeekHistory,
    dietaryPref, updateDietaryPref,
    spinConstraints, updateSpinConstraints,
    rotationMeals, recentlyUsedIds,
    respinDay, setDayMeal, toggleLockDay, lockAllPlanned, unlockAllPlanned,
    setDaySpecial, smartPlanWeek, restoreWeek, applySpinResults,
  };
}
