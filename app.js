// app.js (CommonJS) — keeps webhook at '/', adds deletion routes, forwards to FortiSOAR

const express = require('express');
const app = express();
app.use(express.json());

// ---- Config ----
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN || ''; // for GET verification
const FSOAR_WEBHOOK_URL =
  process.env.FSOAR_WEBHOOK_URL ||
  'https://ativ4jeppvogma5u4x7.eu-central-1.fortisoar.forticloud.com:443/api/triggers/1/whatsapp';
const FSOAR_TOKEN = process.env.FSOAR_TOKEN || "90d7b1fc4643f568311ffb080b6c56e702b65a34bc4d163b66ab129c1bcb965e";
const FSOAR_TIMEOUT_MS = Number(process.env.FSOAR_TIMEOUT_MS || 5000);
const FSOAR_MAX_RETRIES = Number(process.env.FSOAR_MAX_RETRIES || 3);

// Helper: fetch (works on Node 16/18+)
// Node 18+ has global fetch; on older Node, lazy-load node-fetch (ESM-only) via dynamic import.
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  return (await import('node-fetch')).default;
}

// ---- Forward to FortiSOAR ----
async function sendToFortiSOAR(payload, sourceHeaders = {}) {
  if (!FSOAR_WEBHOOK_URL) {
    console.warn('FSOAR_WEBHOOK_URL not set; skipping forward.');
    return { skipped: true };
  }

  const f = await getFetch();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `API-KEY ${FSOAR_TOKEN}`,
    // pass through a couple of useful headers for correlation (optional)
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
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);

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

// ---- Webhook routes (stay at '/') ----

// GET '/' — handle verification if hub.* params exist; otherwise show deletion page
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query || {};

  if (mode === 'subscribe') {
    if (token === verifyToken) {
      console.log('WEBHOOK VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  // No verification params? Serve the deletion info page instead of redirecting.
  return res
    .status(200)
    .type('html')
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>Data Deletion</title></head>
<body style="font-family:sans-serif">
  <h2>User Data Deletion</h2>
  <p>Contact <a href="mailto:support@example.com">support@example.com</a>
     or POST to <code>/delete-request</code>.</p>
</body></html>`);
});

// POST '/' — receive webhook and forward to FortiSOAR
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${timestamp}`);
  console.log(JSON.stringify(req.body, null, 2));

  // Acknowledge upstream quickly
  res.status(200).end();

  // Forward asynchronously (await so errors log in order; response already sent)
  const result = await sendToFortiSOAR(req.body, req.headers);
  if (!result.ok && !result.skipped) {
    console.error('Final failure forwarding to FortiSOAR:', result.error);
  }
});

// ---- Data deletion endpoints (additional) ----
app.get('/deletion', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>Data Deletion</title></head>
<body style="font-family:sans-serif">
  <h2>User Data Deletion</h2>
  <p>Contact <a href="mailto:support@example.com">support@example.com</a>
     or POST to <code>/delete-request</code>.</p>
</body></html>`);
});

app.post('/delete-request', express.json(), (req, res) => {
  console.log('Received deletion request:', req.body);
  // TODO: persist / email / ticket this request
  res.json({ ok: true, message: 'Deletion request received.' });
});

// ---- Start server ----
app.listen(port, () => {
  console.log(`\nListening on port ${port}`);
  console.log(`Forwarding webhook posts to: ${FSOAR_WEBHOOK_URL}`);
});
