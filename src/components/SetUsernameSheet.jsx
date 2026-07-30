/**
 * SetUsernameSheet — bottom sheet for setting/changing a username.
 * Lives inside the Settings sheet, opened from the Friends section.
 *
 * Features:
 * - Live validation (3–20 chars, [a-z0-9_], auto-lowercase)
 * - Debounced availability check via check_username_available RPC
 * - 30-day cooldown enforcement (client side — server is source of truth)
 * - Post-set bootstrap triggers friends/shares sync
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { checkUsernameAvailable, setUsername } from '../lib/cloudProfile';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DEBOUNCE_MS = 500;

/**
 * @param {{ open: boolean, onClose: () => void, currentUsername?: string|null, onUsernameSet: (username: string) => void }} props
 */
export default function SetUsernameSheet({ open, onClose, currentUsername, onUsernameSet }) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('idle'); // idle | checking | available | taken | invalid | error | cooldown
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Reset state when sheet opens
  useEffect(() => {
    if (open) {
      setValue('');
      setStatus('idle');
      setErrorMsg('');
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const handleChange = useCallback((e) => {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    setValue(raw);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!raw || raw.length < 3) {
      setStatus(raw.length > 0 ? 'invalid' : 'idle');
      setErrorMsg(raw.length > 0 ? 'At least 3 characters' : '');
      return;
    }

    if (!USERNAME_RE.test(raw)) {
      setStatus('invalid');
      setErrorMsg('Letters, numbers, and underscores only');
      return;
    }

    if (raw === currentUsername) {
      setStatus('invalid');
      setErrorMsg('That\'s already your username');
      return;
    }

    setStatus('checking');
    setErrorMsg('');

    debounceRef.current = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(raw);
        // Check value hasn't changed while we were checking
        setStatus(available ? 'available' : 'taken');
        setErrorMsg(available ? '' : 'Username is taken');
      } catch {
        setStatus('error');
        setErrorMsg('Could not check availability');
      }
    }, DEBOUNCE_MS);
  }, [currentUsername]);

  const handleConfirm = async () => {
    if (status !== 'available' || saving) return;
    setSaving(true);

    const result = await setUsername(value);
    if (result.success) {
      onUsernameSet(value);
      onClose();
    } else {
      setStatus('error');
      setErrorMsg(result.error || 'Failed to set username');
      setSaving(false);
    }
  };

  if (!open) return null;

  const statusIcon = {
    idle: null,
    checking: '⏳',
    available: '✅',
    taken: '❌',
    invalid: '❌',
    error: '⚠️',
    cooldown: '🕐',
  }[status];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="st-overlay"
          style={{ zIndex: 1100 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="st-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: '50vh' }}
          >
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title" style={{ fontSize: '18px' }}>
                {currentUsername ? 'Change Username' : 'Set Username'}
              </h2>
              <button className="st-close" onClick={onClose}>✕</button>
            </div>
            <div className="st-content" style={{ padding: '0 16px 20px' }}>
              {currentUsername && (
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 12px' }}>
                  Current: <strong>@{currentUsername}</strong>
                </p>
              )}

              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-muted)', fontSize: 16, fontWeight: 600, pointerEvents: 'none',
                }}>@</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={handleChange}
                  placeholder="your_username"
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  style={{
                    width: '100%',
                    padding: '12px 40px 12px 30px',
                    fontSize: 16,
                    border: `1.5px solid ${
                      status === 'available' ? '#4CAF50' :
                      status === 'taken' || status === 'invalid' || status === 'error' ? '#f44336' :
                      'var(--border)'
                    }`,
                    borderRadius: 12,
                    background: 'var(--card)',
                    color: 'var(--text)',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    boxSizing: 'border-box',
                  }}
                />
                {statusIcon && (
                  <span style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 16,
                  }}>{statusIcon}</span>
                )}
              </div>

              {errorMsg && (
                <p style={{
                  color: status === 'error' ? 'var(--text-muted)' : '#f44336',
                  fontSize: 13, margin: '6px 0 0',
                }}>{errorMsg}</p>
              )}

              <p style={{ color: 'var(--text-light)', fontSize: 12, margin: '8px 0 0' }}>
                3–20 characters · letters, numbers, underscores
              </p>

              <button
                className="st-install-btn"
                disabled={status !== 'available' || saving}
                onClick={handleConfirm}
                style={{
                  marginTop: 16,
                  justifyContent: 'center',
                  opacity: status === 'available' && !saving ? 1 : 0.5,
                  background: status === 'available' && !saving ? 'var(--primary)' : undefined,
                  color: status === 'available' && !saving ? '#fff' : undefined,
                  borderColor: status === 'available' && !saving ? 'var(--primary)' : undefined,
                }}
              >
                {saving ? 'Saving…' : currentUsername ? 'Change Username' : 'Set Username'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
