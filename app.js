// app.js
// Minimal Express webhook relay -> FortiSOAR

const express = require('express');
const app = express();
app.use(express.json());

// -------- Config (env vars with safe defaults from your message) --------
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ''; // used by GET verification (if your source uses it)

const FSOAR_WEBHOOK_URL =
  process.env.FSOAR_WEBHOOK_URL ||
  'https://ativ4jeppvogma5u4x7.eu-central-1.fortisoar.forticloud.com:443/api/triggers/1/whatsapp';

const FSOAR_TOKEN = process.env.FSOAR_TOKEN || 'da161494ec7d984f2b1f1f3e068be4bdf091bc512f2b85aec3757966f8de6313'; // API key token

// Networking behavior
const FSOAR_TIMEOUT_MS = Number(process.env.FSOAR_TIMEOUT_MS || 5000);
const FSOAR_MAX_RETRIES = Number(process.env.FSOAR_MAX_RETRIES || 3);

// Node 18+ has global fetch; polyfill only if missing
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  return (await import('node-fetch')).default;
}

// -------- Helper: forward payload to FortiSOAR with retries --------
async function sendToFortiSOAR(payload, sourceHeaders = {}) {
  if (!FSOAR_WEBHOOK_URL) {
    console.warn('FSOAR_WEBHOOK_URL not set; skipping forward.');
    return { skipped: true };
  }

  const f = await getFetch();

  // Build headers: FortiSOAR expects "Authorization: API-KEY <token>"
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `API-KEY ${FSOAR_TOKEN}`,
    // optionally pass through selected source headers for correlation (remove if you don't need these)
    ...['x-hub-signature', 'x-hub-signature-256', 'x-request-id']
      .reduce((acc, h) => (sourceHeaders[h] ? (acc[h] = sourceHeaders[h], acc) : acc), {}),
  };

  for (let attempt = 1; attempt <= FSOAR_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FSOAR_TIMEOUT_MS);

    try {
      const res = await f(FSOAR_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text().catch(() => '');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
      }

      console.log(`FortiSOAR forward ok (attempt ${attempt}).`);
      return { ok: true, status: res.status, body: text };
    } catch (err) {
      clearTimeout(timer);
      const last = attempt === FSOAR_MAX_RETRIES;
      console.error(`FortiSOAR forward failed (attempt ${attempt}/${FSOAR_MAX_RETRIES}): ${err.message}`);
      if (last) return { ok: false, error: err.message };
      const backoffMs = 300 * 2 ** (attempt - 1); // 300, 600, 1200...
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

// -------- Routes --------

// Optional GET verification (e.g., for Facebook/WhatsApp webhook verification)
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Main POST webhook receiver -> forwards to FortiSOAR
app.post('/', async (req, res) => {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${ts}`);
  console.log(JSON.stringify(req.body, null, 2));

  // Forward to FortiSOAR
  const result = await sendToFortiSOAR(req.body, req.headers);

  // Always acknowledge upstream quickly to avoid their retries
  res.status(200).end();

  if (!result.ok && !result.skipped) {
    console.error('Final failure forwarding to FortiSOAR:', result.error);
  }
});

// -------- Start server --------
app.listen(PORT, () => {
  console.log(`\nListening on port ${PORT}`);
  console.log(`Forwarding to FortiSOAR: ${FSOAR_WEBHOOK_URL}`);
});
