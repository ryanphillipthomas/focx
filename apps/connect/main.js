/**
 * Connect — draft-only vertical slice (static).
 * Memory (vault) + voice-aware draft. Never sends.
 */
import { getProfile, loadVault, saveVoice, upsertProfile } from './lib/vault.js';
import { DraftRequestError, SEND_CAPABILITY, draftReply } from './lib/draft.js';

const els = {
  banner: document.querySelector('[data-never-send-banner]'),
  personName: document.querySelector('#person-name'),
  personNotes: document.querySelector('#person-notes'),
  personDo: document.querySelector('#person-do'),
  personAvoid: document.querySelector('#person-avoid'),
  savePerson: document.querySelector('#save-person'),
  personStatus: document.querySelector('#person-status'),
  personSelect: document.querySelector('#person-select'),
  voicePhrases: document.querySelector('#voice-phrases'),
  voiceAvoid: document.querySelector('#voice-avoid'),
  voiceWarmth: document.querySelector('#voice-warmth'),
  saveVoice: document.querySelector('#save-voice'),
  voiceStatus: document.querySelector('#voice-status'),
  incoming: document.querySelector('#incoming-message'),
  draftButton: document.querySelector('#draft-button'),
  draftOutput: document.querySelector('#draft-output'),
  draftMeta: document.querySelector('#draft-meta'),
  copyDraft: document.querySelector('#copy-draft'),
  copyStatus: document.querySelector('#copy-status'),
};

let lastDraft = '';

function refreshPersonSelect() {
  const vault = loadVault();
  const select = els.personSelect;
  const current = select.value;
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'No specific person';
  select.append(blank);
  for (const profile of vault.profiles) {
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = profile.display_name;
    select.append(opt);
  }
  if ([...select.options].some((o) => o.value === current)) {
    select.value = current;
  }
}

function hydrateVoiceForm() {
  const { voice } = loadVault();
  els.voicePhrases.value = voice.common_phrases.join('\n');
  els.voiceAvoid.value = voice.avoid_habits.join('\n');
  els.voiceWarmth.value = voice.warmth_note;
}

function hydratePersonForm(id) {
  const profile = id ? getProfile(id) : null;
  if (!profile) {
    els.personName.value = '';
    els.personNotes.value = '';
    els.personDo.value = '';
    els.personAvoid.value = '';
    return;
  }
  els.personName.value = profile.display_name;
  els.personNotes.value = profile.notes.join('\n');
  els.personDo.value = profile.do.join('\n');
  els.personAvoid.value = profile.avoid.join('\n');
}

els.savePerson.addEventListener('click', () => {
  const saved = upsertProfile({
    display_name: els.personName.value,
    notes: els.personNotes.value,
    do: els.personDo.value,
    avoid: els.personAvoid.value,
  });
  els.personStatus.textContent = `Saved ${saved.display_name} in the local vault (this browser only).`;
  refreshPersonSelect();
  els.personSelect.value = saved.id;
});

els.saveVoice.addEventListener('click', () => {
  saveVoice({
    common_phrases: els.voicePhrases.value,
    avoid_habits: els.voiceAvoid.value,
    warmth_note: els.voiceWarmth.value,
  });
  els.voiceStatus.textContent = 'Voice saved in the local vault (this browser only).';
});

els.personSelect.addEventListener('change', () => {
  hydratePersonForm(els.personSelect.value);
});

els.draftButton.addEventListener('click', () => {
  els.copyStatus.textContent = '';
  try {
    const vault = loadVault();
    const profile = els.personSelect.value ? getProfile(els.personSelect.value) : null;
    const result = draftReply({
      incomingMessage: els.incoming.value,
      voice: vault.voice,
      profile,
    });
    if (result.neverSends !== true || SEND_CAPABILITY.canSend !== false) {
      throw new Error('Draft path violated never-send invariant.');
    }
    lastDraft = result.draft;
    els.draftOutput.textContent = result.draft;
    const bits = [
      `Provider: ${result.provider}`,
      'Action: draft only — nothing was sent',
    ];
    if (result.usedProfile) bits.push(`Memory: ${result.usedProfile}`);
    if (result.usedVoicePhrase) bits.push(`Voice phrase: “${result.usedVoicePhrase}”`);
    els.draftMeta.textContent = bits.join(' · ');
    els.copyDraft.disabled = false;
  } catch (err) {
    lastDraft = '';
    els.draftOutput.textContent = '';
    els.draftMeta.textContent =
      err instanceof DraftRequestError || err instanceof Error
        ? err.message
        : 'Could not draft.';
    els.copyDraft.disabled = true;
  }
});

els.copyDraft.addEventListener('click', async () => {
  if (!lastDraft) return;
  try {
    await navigator.clipboard.writeText(lastDraft);
    els.copyStatus.textContent = 'Copied. Paste it yourself wherever you message — Connect does not send.';
  } catch {
    els.copyStatus.textContent = 'Clipboard blocked. Select the draft and copy manually.';
  }
});

// Boot
if (els.banner) {
  els.banner.hidden = false;
}
refreshPersonSelect();
hydrateVoiceForm();
els.copyDraft.disabled = true;
els.draftOutput.textContent = '';
els.draftMeta.textContent = 'Drafts stay on this device. There is no send button and no send API.';
