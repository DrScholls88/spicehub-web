/**
 * ProfileCard — Settings "Identity" card (SettingsPlan.md PKG B-1).
 * Avatar picker (tap circle → horizontal swatch row), inline-editable
 * display name, and a compact row of home-group member dots when in a
 * group. Local-first: writes to the Dexie profile immediately, and best-
 * effort mirrors to the cloud profile (+ home_group_members) when signed
 * in and online — never blocks on the network.
 */
import { useState, useRef, useCallback } from 'react';
import PIXEL_AVATARS from '../data/pixelAvatars';
import AvatarCircle from './AvatarCircle';
import { hapticLight } from '../haptics';
import { updateCloudProfile } from '../lib/cloudProfile';
import { updateAvatar, removeCustomAvatar } from '../lib/avatarUpload';

export default function ProfileCard({ profile, onUpdateProfile, homeGroup, isOnline, showToast }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.displayName || 'Me');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [optimisticUrl, setOptimisticUrl] = useState(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const canSyncCloud = isOnline && !!profile?.supabaseUid;

  const handlePhotoSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !canSyncCloud) return;

    // Optimistic: show the photo immediately
    const localUrl = URL.createObjectURL(file);
    setOptimisticUrl(localUrl);
    setUploading(true);

    try {
      const { publicUrl } = await updateAvatar(file);
      setOptimisticUrl(publicUrl);
      // Mirror into local Dexie profile so it survives reload/offline —
      // updateAvatar() only writes the cloud profiles.avatar_url row.
      onUpdateProfile?.({ avatarUrl: publicUrl })?.catch(() => {});
      showToast?.('Avatar updated!', 'success', 2000);
    } catch (err) {
      setOptimisticUrl(null);
      showToast?.(`Upload failed: ${err.message}`, 'error', 3000);
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [canSyncCloud, showToast, onUpdateProfile]);

  const handleRemovePhoto = useCallback(async () => {
    if (!canSyncCloud) return;
    setOptimisticUrl(null);
    try {
      await removeCustomAvatar();
      onUpdateProfile?.({ avatarUrl: null })?.catch(() => {});
      showToast?.('Photo removed', 'info', 2000);
    } catch {
      showToast?.('Could not remove photo', 'error', 2500);
    }
  }, [canSyncCloud, showToast, onUpdateProfile]);

  const pickAvatar = useCallback(async (id) => {
    setPickerOpen(false);
    if (!onUpdateProfile || id === (profile?.avatar || PIXEL_AVATARS[0].id)) return;
    hapticLight();
    try {
      await onUpdateProfile({ avatar: id });
      if (canSyncCloud) updateCloudProfile({ avatarId: id }).catch(() => {});
    } catch {
      showToast?.('Could not update avatar', 'error', 2500);
    }
  }, [profile, onUpdateProfile, canSyncCloud, showToast]);

  const startEditName = () => {
    setNameDraft(profile?.displayName || 'Me');
    setEditingName(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitName = useCallback(async () => {
    setEditingName(false);
    const trimmed = nameDraft.trim().slice(0, 30);
    if (!onUpdateProfile || !trimmed || trimmed === profile?.displayName) return;
    setSaving(true);
    try {
      await onUpdateProfile({ displayName: trimmed });
      if (canSyncCloud) updateCloudProfile({ displayName: trimmed }).catch(() => {});
    } catch {
      showToast?.('Could not update name', 'error', 2500);
    } finally {
      setSaving(false);
    }
  }, [nameDraft, profile, onUpdateProfile, canSyncCloud, showToast]);

  const members = homeGroup?.state === 'in_group' ? (homeGroup.groupInfo?.members || []) : [];
  const otherMembers = members.filter(m => m.user_id !== profile?.supabaseUid);

  return (
    <div className="pc-card">
      <div className="pc-top">
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <AvatarCircle
            avatarUrl={optimisticUrl || profile?.avatarUrl}
            avatarId={profile?.avatar}
            displayName={profile?.displayName}
            size={56}
            onClick={() => {
              hapticLight();
              if (canSyncCloud) {
                fileInputRef.current?.click();
              } else {
                setPickerOpen(v => !v);
              }
            }}
          />
          {canSyncCloud && (
            <span
              style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, border: '2px solid var(--bg)',
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            >
              {uploading ? '⏳' : '📷'}
            </span>
          )}
          {/* Hidden file input — iOS opens photo picker natively (Camera +
              Photo Library + Browse). No capture="environment" — that would
              force camera-only and skip the Photo Library. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handlePhotoSelect}
            style={{ display: 'none' }}
            aria-label="Upload avatar photo"
          />
        </div>

        <div className="pc-identity">
          {editingName ? (
            <input
              ref={inputRef}
              className="pc-name-input"
              value={nameDraft}
              maxLength={30}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') inputRef.current?.blur();
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <button type="button" className="pc-name-btn" onClick={startEditName}>
              <span className="pc-name">{profile?.displayName || 'Me'}</span>
              <span className="pc-edit-hint">{saving ? '…' : '✏️'}</span>
            </button>
          )}

          {otherMembers.length > 0 && (
            <div className="pc-member-dots" aria-label={`${otherMembers.length} other people in your home group`}>
              {otherMembers.slice(0, 5).map(m => (
                <AvatarCircle
                  key={m.user_id}
                  avatarUrl={m.avatar_url}
                  avatarId={m.avatar}
                  displayName={m.display_name}
                  size={28}
                  className="pc-dot"
                />
              ))}
              {otherMembers.length > 5 && (
                <span className="pc-dot pc-dot-more">+{otherMembers.length - 5}</span>
              )}
            </div>
          )}

          {canSyncCloud && (
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Use emoji avatar instead
              </button>
              {(optimisticUrl || profile?.avatarUrl) && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  Remove photo
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="pc-avatar-picker" role="listbox" aria-label="Choose an avatar">
          {PIXEL_AVATARS.map(a => {
            const isActive = a.id === (profile?.avatar || PIXEL_AVATARS[0].id);
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`pc-avatar-swatch stg-pulse ${isActive ? 'pc-avatar-active' : ''}`}
                style={{ background: a.color }}
                onClick={() => pickAvatar(a.id)}
                title={a.label}
              >
                {a.emoji}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
