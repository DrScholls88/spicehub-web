/**
 * Home Group section inside Settings sheet.
 * Collapsed when not in a group; expanded when active.
 * See spec Section 5: "Settings state matrix"
 */
import { useState } from 'react';
import { getAvatar, getAvatarInitial } from '../data/pixelAvatars';

export default function HomeGroupSection({
  homeGroup, // { state, groupInfo, syncStatus, ... } from useHomeGroup
  profile,
  isOnline,
  onCreateGroup,
  onJoinGroup,
  onLeaveGroup,
  onSignIn,
  onSignOut,
  onRegenerateCode,
  showToast,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  if (!homeGroup.isEnabled) return null;

  const { state, groupInfo, syncStatus } = homeGroup;

  return (
    <div className="st-section">
      <h3>Home Group</h3>

      {/* State 1 or 2: show Create / Join buttons */}
      {(state === 'local' || state === 'auth_no_group') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '0 0 4px' }}>
            Share your week plan and grocery list with someone in your household.
          </p>

          <button
            className="st-install-btn"
            onClick={() => setShowCreate(true)}
            disabled={!isOnline}
          >
            <span className="st-install-icon">🏠</span>
            <span>Create a group</span>
          </button>

          <button
            className="st-install-btn"
            onClick={() => setShowJoin(true)}
            disabled={!isOnline}
          >
            <span className="st-install-icon">🔗</span>
            <span>Join with code</span>
          </button>

          {!isOnline && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0' }}>
              Connect to the internet to create or join a group
            </p>
          )}

          {state === 'auth_no_group' && (
            <button
              className="st-install-btn"
              onClick={onSignOut}
              style={{ marginTop: '8px', opacity: 0.7 }}
            >
              <span className="st-install-icon">🚪</span>
              <span>Sign out</span>
            </button>
          )}
        </div>
      )}

      {/* State 3: in group — show group info */}
      {state === 'in_group' && groupInfo?.group && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Group name + sync status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🏠</span>
            <span style={{ fontWeight: 600 }}>{groupInfo.group.name}</span>
            {syncStatus === 'idle' && isOnline && (
              <span title="Synced" style={{ fontSize: '14px', marginLeft: 'auto' }}>☁️✓</span>
            )}
            {syncStatus === 'syncing' && (
              <span title="Syncing…" style={{ fontSize: '14px', marginLeft: 'auto' }}>⏳</span>
            )}
            {syncStatus === 'error' && (
              <span title="Sync error" style={{ fontSize: '14px', marginLeft: 'auto' }}>⚠️</span>
            )}
            {!isOnline && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Will sync when online
              </span>
            )}
          </div>

          {/* Member list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {groupInfo.members.map(m => {
              const av = m.avatar ? getAvatar(m.avatar) : null;
              return (
                <div key={m.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '4px 0',
                }}>
                  <span style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: av?.color || 'var(--primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px',
                  }}>
                    {av?.emoji || getAvatarInitial(m.display_name)}
                  </span>
                  <span style={{ fontSize: '14px' }}>{m.display_name}</span>
                  {m.role === 'owner' && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>owner</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Invite code (owner only) */}
          {groupInfo.members.find(m =>
            m.user_id === profile?.supabaseUid && m.role === 'owner'
          ) && (
            <InviteCodeDisplay
              code={groupInfo.group.invite_code}
              onRegenerate={onRegenerateCode}
              showToast={showToast}
            />
          )}

          {/* Leave */}
          {!leaveConfirm ? (
            <button
              className="st-install-btn"
              onClick={() => setLeaveConfirm(true)}
              style={{ marginTop: '8px', opacity: 0.7 }}
            >
              <span className="st-install-icon">🚪</span>
              <span>Leave group</span>
            </button>
          ) : (
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '10px', padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
                Leave "{groupInfo.group.name}"?
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                Your personal recipes stay on this device.
                Shared week plan and grocery list will no longer update.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="st-install-btn"
                  onClick={() => setLeaveConfirm(false)}
                  style={{ flex: 1 }}
                >Cancel</button>
                <button
                  className="st-install-btn"
                  onClick={() => { setLeaveConfirm(false); onLeaveGroup(); }}
                  style={{ flex: 1, background: 'var(--error, #e53935)', color: '#fff' }}
                >Leave group</button>
              </div>
            </div>
          )}
          {/*
            "Sign out" is intentionally hidden while in a group: it tears
            down the Supabase session but keeps the group membership and
            local data, which reads as a no-op ("why didn't I leave the
            group?") next to "Leave group" (which does the opposite —
            drops membership, keeps the session). Sign out remains
            reachable from the auth_no_group / local states above.
          */}
        </div>
      )}

      {/* Loading state */}
      {state === 'loading' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</p>
      )}

      {/* Create / Join sheets */}
      {showCreate && (
        <CreateGroupInline
          onClose={() => setShowCreate(false)}
          onCreate={async (name) => {
            await onCreateGroup(name);
            setShowCreate(false);
          }}
          onSignIn={onSignIn}
          needsAuth={state === 'local'}
        />
      )}
      {showJoin && (
        <JoinGroupInline
          onClose={() => setShowJoin(false)}
          onJoin={async (code) => {
            await onJoinGroup(code);
            setShowJoin(false);
          }}
          onSignIn={onSignIn}
          needsAuth={state === 'local'}
        />
      )}
    </div>
  );
}

function InviteCodeDisplay({ code, onRegenerate, showToast }) {
  const [copied, setCopied] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* fallback: select text */ }
  };

  const confirmRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
      setRegenConfirm(false);
      showToast?.('Invite code refreshed', 'success', 2000);
    } catch (err) {
      // Leave regenConfirm true so the Confirm button stays visible and
      // the user can retry — but now they actually hear about the failure.
      showToast?.(err?.message || "Couldn't refresh the invite code — try again.", 'error', 3500);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '10px', padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Invite code:</span>
      <span style={{
        fontFamily: 'monospace', fontSize: '18px', fontWeight: 700,
        letterSpacing: '2px',
      }}>{code}</span>
      <button
        onClick={copyCode}
        style={{
          marginLeft: 'auto', padding: '4px 10px', fontSize: '12px',
          borderRadius: '6px', border: '1px solid var(--border)',
          background: 'transparent', cursor: 'pointer',
          color: 'var(--text)',
        }}
      >{copied ? 'Copied!' : 'Copy'}</button>
      {!regenConfirm ? (
        <button
          onClick={() => setRegenConfirm(true)}
          style={{
            padding: '4px 8px', fontSize: '12px',
            borderRadius: '6px', border: '1px solid var(--border)',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >↻</button>
      ) : (
        <button
          onClick={confirmRegenerate}
          disabled={regenerating}
          style={{
            padding: '4px 8px', fontSize: '11px',
            borderRadius: '6px', border: '1px solid var(--error, #e53935)',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--error, #e53935)',
            opacity: regenerating ? 0.6 : 1,
          }}
        >{regenerating ? '…' : 'Confirm'}</button>
      )}
    </div>
  );
}

function CreateGroupInline({ onClose, onCreate, onSignIn, needsAuth }) {
  const [name, setName] = useState('Our Kitchen');
  const [loading, setLoading] = useState(false);
  const [authStep, setAuthStep] = useState(false);
  const [email, setEmail] = useState('');

  if (needsAuth && !authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <p style={{ margin: '0 0 10px', fontSize: '14px' }}>
          Sign in to create a group
        </p>
        <button className="st-install-btn" onClick={() => onSignIn('google')}>
          <span>Continue with Google</span>
        </button>
        <button className="st-install-btn" onClick={() => setAuthStep(true)}
          style={{ marginTop: '6px' }}>
          <span>Use email link</span>
        </button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  if (authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <input
          type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          style={{
            width: '100%', padding: '10px', fontSize: '16px',
            borderRadius: '8px', border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <button className="st-install-btn" onClick={() => onSignIn('magic', email)}
          style={{ marginTop: '8px' }}>Send sign-in link</button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: '12px',
      padding: '16px', marginTop: '8px',
    }}>
      <input
        type="text" value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Group name"
        maxLength={30}
        style={{
          width: '100%', padding: '10px', fontSize: '16px',
          borderRadius: '8px', border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
        }}
      />
      <button
        className="st-install-btn"
        onClick={async () => {
          setLoading(true);
          try { await onCreate(name); }
          catch (err) { console.warn('[CreateGroup] error:', err.message); }
          finally { setLoading(false); }
        }}
        disabled={loading}
        style={{ marginTop: '8px' }}
      >{loading ? 'Creating…' : 'Create'}</button>
      <button className="st-install-btn" onClick={onClose}
        style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
    </div>
  );
}

function JoinGroupInline({ onClose, onJoin, onSignIn, needsAuth }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authStep, setAuthStep] = useState(false);
  const [email, setEmail] = useState('');

  if (needsAuth && !authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <p style={{ margin: '0 0 10px', fontSize: '14px' }}>
          Sign in to join a group
        </p>
        <button className="st-install-btn" onClick={() => onSignIn('google')}>
          <span>Continue with Google</span>
        </button>
        <button className="st-install-btn" onClick={() => setAuthStep(true)}
          style={{ marginTop: '6px' }}>
          <span>Use email link</span>
        </button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  if (authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <input
          type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          style={{
            width: '100%', padding: '10px', fontSize: '16px',
            borderRadius: '8px', border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <button className="st-install-btn" onClick={() => onSignIn('magic', email)}
          style={{ marginTop: '8px' }}>Send sign-in link</button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: '12px',
      padding: '16px', marginTop: '8px',
    }}>
      <input
        type="text" value={code}
        onChange={e => {
          setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
          setError('');
        }}
        placeholder="Enter 6-letter code"
        maxLength={6}
        style={{
          width: '100%', padding: '10px', fontSize: '20px',
          borderRadius: '8px', border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)',
          fontFamily: 'monospace', letterSpacing: '4px', textAlign: 'center',
          boxSizing: 'border-box',
        }}
        autoFocus
      />
      {error && <p style={{ color: 'var(--error, #e53935)', fontSize: '13px', margin: '6px 0 0' }}>{error}</p>}
      <button
        className="st-install-btn"
        onClick={async () => {
          if (code.length !== 6) { setError('Enter a 6-character code'); return; }
          setLoading(true);
          try {
            await onJoin(code);
            // Success normally unmounts this component (parent closes the
            // inline on success). If the parent ever resolves without
            // closing, the finally below still clears the spinner instead
            // of leaving it running forever.
          } catch (e) {
            setError(e.message);
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading || code.length !== 6}
        style={{ marginTop: '8px' }}
      >{loading ? 'Joining…' : 'Join'}</button>
      <button className="st-install-btn" onClick={onClose}
        style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
    </div>
  );
}
