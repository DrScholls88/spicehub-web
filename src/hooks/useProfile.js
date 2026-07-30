/**
 * React hook for local profile state.
 * Loads profile from Dexie on mount, provides update function.
 */
import { useState, useEffect, useCallback } from 'react';
import { getProfile, updateProfile, getDietaryPref, saveDietaryPref } from '../lib/profile';

export default function useProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getProfile();
      if (!cancelled) {
        setProfile(p);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(async (fields) => {
    const updated = await updateProfile(fields);
    setProfile(updated);
    return updated;
  }, []);

  const loadDietaryPref = useCallback(async () => {
    return getDietaryPref();
  }, []);

  const updateDietaryPref = useCallback(async (pref) => {
    const updated = await saveDietaryPref(pref);
    setProfile(updated);
    return pref;
  }, []);

  return { profile, loading, update, loadDietaryPref, updateDietaryPref };
}
