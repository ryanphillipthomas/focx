/**
 * Browser vault — thinnest port of focx-legacy @focx/connect-storage mindset.
 *
 * Relationship memory and voice live only in this origin's localStorage.
 * Drafting never writes message content here (legacy privacy.test.ts: drafts
 * retain nothing by default). No network; no shared cloud vault in this slice.
 */

export const VAULT_KEY = 'focx.connect.vault.v1';

export const DEFAULT_VOICE = Object.freeze({
  schema_version: 1,
  common_phrases: [],
  avoid_habits: [],
  warmth_note: '',
});

/**
 * @typedef {{
 *   schema_version: 1,
 *   id: string,
 *   display_name: string,
 *   notes: string[],
 *   do: string[],
 *   avoid: string[],
 * }} RelationshipProfile
 */

/**
 * @typedef {{
 *   schema_version: 1,
 *   common_phrases: string[],
 *   avoid_habits: string[],
 *   warmth_note: string,
 * }} VoiceProfile
 */

/**
 * @typedef {{
 *   schema_version: 1,
 *   profiles: RelationshipProfile[],
 *   voice: VoiceProfile,
 * }} VaultData
 */

/** @returns {VaultData} */
export function emptyVault() {
  return {
    schema_version: 1,
    profiles: [],
    voice: { ...DEFAULT_VOICE, common_phrases: [], avoid_habits: [] },
  };
}

/**
 * @param {Storage} [storage]
 * @returns {VaultData}
 */
export function loadVault(storage = globalThis.localStorage) {
  if (!storage) return emptyVault();
  try {
    const raw = storage.getItem(VAULT_KEY);
    if (!raw) return emptyVault();
    const parsed = JSON.parse(raw);
    return normalizeVault(parsed);
  } catch {
    return emptyVault();
  }
}

/**
 * @param {VaultData} data
 * @param {Storage} [storage]
 */
export function saveVault(data, storage = globalThis.localStorage) {
  if (!storage) throw new Error('No storage available for the local vault.');
  const normalized = normalizeVault(data);
  storage.setItem(VAULT_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * Save or replace one relationship profile. Does not touch drafts or messages.
 * @param {Omit<RelationshipProfile, 'schema_version'> & { schema_version?: 1 }} profile
 * @param {Storage} [storage]
 */
export function upsertProfile(profile, storage = globalThis.localStorage) {
  const vault = loadVault(storage);
  const id = slugId(profile.id || profile.display_name);
  const next = {
    schema_version: 1,
    id,
    display_name: String(profile.display_name || '').trim() || 'Someone',
    notes: asStringList(profile.notes),
    do: asStringList(profile.do),
    avoid: asStringList(profile.avoid),
  };
  const others = vault.profiles.filter((p) => p.id !== id);
  vault.profiles = [...others, next];
  saveVault(vault, storage);
  return next;
}

/**
 * @param {Partial<VoiceProfile>} voice
 * @param {Storage} [storage]
 */
export function saveVoice(voice, storage = globalThis.localStorage) {
  const vault = loadVault(storage);
  vault.voice = {
    schema_version: 1,
    common_phrases: asStringList(voice.common_phrases),
    avoid_habits: asStringList(voice.avoid_habits),
    warmth_note: String(voice.warmth_note || '').trim(),
  };
  saveVault(vault, storage);
  return vault.voice;
}

/**
 * @param {string} id
 * @param {Storage} [storage]
 * @returns {RelationshipProfile | null}
 */
export function getProfile(id, storage = globalThis.localStorage) {
  return loadVault(storage).profiles.find((p) => p.id === id) ?? null;
}

/** @param {unknown} value */
function asStringList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|,/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/** @param {string} value */
export function slugId(value) {
  return String(value || 'someone')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'someone';
}

/** @param {unknown} parsed */
function normalizeVault(parsed) {
  const base = emptyVault();
  if (!parsed || typeof parsed !== 'object') return base;
  const profiles = Array.isArray(parsed.profiles)
    ? parsed.profiles
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          schema_version: 1,
          id: slugId(p.id || p.display_name),
          display_name: String(p.display_name || 'Someone').trim() || 'Someone',
          notes: asStringList(p.notes),
          do: asStringList(p.do),
          avoid: asStringList(p.avoid),
        }))
    : [];
  const voiceIn = parsed.voice && typeof parsed.voice === 'object' ? parsed.voice : {};
  return {
    schema_version: 1,
    profiles,
    voice: {
      schema_version: 1,
      common_phrases: asStringList(voiceIn.common_phrases),
      avoid_habits: asStringList(voiceIn.avoid_habits),
      warmth_note: String(voiceIn.warmth_note || '').trim(),
    },
  };
}
