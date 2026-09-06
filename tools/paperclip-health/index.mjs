#!/usr/bin/env node
// paperclip-health — checks that the local Paperclip service is healthy.
//
// Exit 0 = reachable and healthy. Exit 1 = unreachable or unhealthy.

const BASE_URL = process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3100';
const HEALTH_URL = `${BASE_URL.replace(/\/+$/, '')}/api/health`;

try {
  const response = await fetch(HEALTH_URL, {
    signal: AbortSignal.timeout(3_000),
  });

  if (!response.ok) {
    console.error(`paperclip-health: unhealthy — ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  console.log(`paperclip-health: healthy — ${response.status} ${response.statusText}`);
  process.exit(0);
} catch (err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    console.error('paperclip-health: unreachable — request timed out after 3 seconds');
  } else {
    console.error(`paperclip-health: unreachable — ${err.message}`);
  }
  process.exit(1);
}
