/**
 * Deterministic draft-only reply — thinnest port of focx-legacy FakeModelProvider
 * + voice/profile resolution ideas.
 *
 * No model provider I/O. No Messages / Contacts / SMS / webhook send path.
 * Output is always a draft the human may copy; nothing is transmitted.
 */

/**
 * @typedef {import('./vault.js').RelationshipProfile} RelationshipProfile
 * @typedef {import('./vault.js').VoiceProfile} VoiceProfile
 */

/**
 * @typedef {{
 *   draft: string,
 *   usedVoicePhrase: string | null,
 *   usedProfile: string | null,
 *   neverSends: true,
 *   provider: 'local-deterministic',
 * }} DraftResult
 */

/**
 * @param {{
 *   incomingMessage: string,
 *   voice?: VoiceProfile | null,
 *   profile?: RelationshipProfile | null,
 * }} input
 * @returns {DraftResult}
 */
export function draftReply(input) {
  const incoming = String(input.incomingMessage || '').trim();
  if (!incoming) {
    throw new DraftRequestError('Paste the message you want to answer.');
  }
  if (incoming.length > 4000) {
    throw new DraftRequestError('Keep the pasted message under 4000 characters for this slice.');
  }

  const voice = input.voice ?? null;
  const profile = input.profile ?? null;
  const phrase = voice?.common_phrases?.[0] ?? null;
  const avoid = [
    ...(voice?.avoid_habits ?? []),
    ...(profile?.avoid ?? []),
  ].filter(Boolean);
  const doHints = profile?.do ?? [];
  const notes = profile?.notes ?? [];
  const warmth = voice?.warmth_note?.trim() || null;

  const lines = [];
  lines.push(openingFor(incoming, phrase));
  if (doHints[0]) {
    lines.push(reflectDo(doHints[0]));
  } else if (notes[0]) {
    lines.push(`I've been keeping ${notes[0].replace(/\.$/, '')} in mind.`);
  } else if (warmth) {
    lines.push(warmth.endsWith('.') ? warmth : `${warmth}.`);
  }
  lines.push(closingFor(incoming, phrase));

  let draft = lines.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  for (const habit of avoid) {
    // Soft strip of avoided literal phrases from the draft body (voice precedence).
    if (!habit) continue;
    const re = new RegExp(escapeRegExp(habit), 'gi');
    draft = draft.replace(re, '').replace(/\s+/g, ' ').trim();
  }

  return {
    draft,
    usedVoicePhrase: phrase,
    usedProfile: profile?.display_name ?? null,
    neverSends: true,
    provider: 'local-deterministic',
  };
}

export class DraftRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DraftRequestError';
  }
}

/** There is no send capability in this module — exported for the verify harness. */
export const SEND_CAPABILITY = Object.freeze({
  canSend: false,
  reason: 'Connect drafts. It never sends.',
});

/**
 * @param {string} incoming
 * @param {string | null} phrase
 */
function openingFor(incoming, phrase) {
  const question = /\?/.test(incoming);
  if (phrase) {
    return question
      ? `${phrase} — thanks for asking.`
      : `${phrase} — thanks for writing.`;
  }
  return question ? 'Thanks for asking.' : 'Thanks for writing.';
}

/** @param {string} hint */
function reflectDo(hint) {
  const cleaned = hint.replace(/\.$/, '');
  return `Wanted to stay true to that: ${cleaned}.`;
}

/**
 * @param {string} incoming
 * @param {string | null} phrase
 */
function closingFor(incoming, phrase) {
  const lower = incoming.toLowerCase();
  if (/\b(meet|coffee|call|hang)\b/.test(lower)) {
    return phrase
      ? 'Happy to figure out a time that works.'
      : 'Happy to figure out a time that works — what looks good for you?';
  }
  if (/\?/.test(incoming)) {
    return 'Happy to say more if useful.';
  }
  return 'Talk soon.';
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
