#!/usr/bin/env node
/**
 * Prove the Connect draft-only slice: vault recall, voice draft, never-send scan.
 * Run: node apps/connect/verify.mjs
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

test('local vault stores and recalls relationship memory', async () => {
  const { upsertProfile, getProfile, saveVoice, loadVault } = await import(
    pathToFileURL(path.join(ROOT, 'lib/vault.js')).href
  );
  const storage = memoryStorage();
  const profile = upsertProfile(
    {
      display_name: 'Alex',
      notes: ['Prefers weekend plans'],
      do: ['Ask one clear question'],
      avoid: ['Over-apologizing'],
    },
    storage,
  );
  assert.equal(profile.id, 'alex');
  assert.equal(getProfile('alex', storage)?.notes[0], 'Prefers weekend plans');
  saveVoice(
    {
      common_phrases: ['hey — means a lot'],
      avoid_habits: ['no worries if not'],
      warmth_note: 'Keep it short and warm',
    },
    storage,
  );
  const vault = loadVault(storage);
  assert.equal(vault.voice.common_phrases[0], 'hey — means a lot');
  assert.equal(vault.profiles.length, 1);
});

test('draft uses voice + memory and never claims send capability', async () => {
  const { draftReply, SEND_CAPABILITY } = await import(
    pathToFileURL(path.join(ROOT, 'lib/draft.js')).href
  );
  assert.equal(SEND_CAPABILITY.canSend, false);

  const result = draftReply({
    incomingMessage: 'Want to grab coffee this weekend?',
    voice: {
      schema_version: 1,
      common_phrases: ['hey — means a lot'],
      avoid_habits: [],
      warmth_note: 'Keep it short and warm',
    },
    profile: {
      schema_version: 1,
      id: 'alex',
      display_name: 'Alex',
      notes: ['Prefers weekend plans'],
      do: ['Ask one clear question'],
      avoid: [],
    },
  });

  assert.equal(result.neverSends, true);
  assert.equal(result.provider, 'local-deterministic');
  assert.match(result.draft, /hey — means a lot/i);
  assert.match(result.draft, /Ask one clear question/i);
  assert.equal(result.usedProfile, 'Alex');
});

test('shipped Connect sources contain no send / Messages / Contacts path', async () => {
  const forbidden =
    /\b(osascript|AppleScript|chat\.db|AddressBook|CNContactStore|Contacts\.framework|twilio|sendgrid|nexmo|messagebird)\b|sendMessage\s*\(|sendSMS\s*\(|fetch\s*\(\s*['"`]https?:\/\/[^'"`]*(send|messages?|sms)/i;

  const stripComments = (source) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');

  const offenders = [];
  for await (const file of walk(ROOT)) {
    if (!/\.(js|mjs|html|css)$/.test(file)) continue;
    if (path.basename(file) === 'verify.mjs') continue; // this file names forbidden APIs on purpose
    const code = stripComments(await readFile(file, 'utf8'));
    if (forbidden.test(code)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test('UI is labeled draft-only: banner present, no Send message control', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /data-never-send-banner/);
  assert.match(html, /Drafts never send/i);
  assert.match(html, /id="draft-button"/);
  assert.match(html, /id="copy-draft"/);
  // No control that promises to send a message.
  assert.doesNotMatch(html, /<(button|a)[^>]*>\s*Send(\s+message)?\s*</i);
  assert.doesNotMatch(html, /id="send-/i);
});
