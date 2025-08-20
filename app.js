// app.js
const express = require('express');
const app = express();
app.use(express.json());

// ---- FortiSOAR webhook (defaults from your message) ----
const FSOAR_WEBHOOK_URL = process.env.FSOAR_WEBHOOK_URL
  || 'https://ativ4jeppvogma5u4x7.eu-central-1.fortisoar.forticloud.com:443/api/triggers/1/whatsapp';
const FSOAR_TOKEN = process.env.FSOAR_TOKEN || 'da161494ec7d984f2b1f1f3e068be4bdf091bc512f2b85aec3757966f8de6313'; // Bearer token

// Server & verify token (for the GET verification route you already had)
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Node 18+ has global fetch; if not, fall back to node-fetch
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  return (await import('node-fetch')).default;
}

// Send payload to FortiSOAR
async function sendToFortiSOAR(payload, headersFromSource = {}) {
  if (!FSOAR_WEBHOOK_URL) {
    console.warn('FSOAR_WEBHOOK_URL not set; skipping.');
    return { skipped: true };
  }

  const f = await getFetch();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${FSOAR_TOKEN}`,          // common pattern
    // Also include a common alt header in case your instance expects it
    'X-Auth-Token': FSOAR_TOKEN,
    // pass through some source headers if helpful for correlation
    ...['x-hub-signature', 'x-hub-signature-256', 'x-request-id']
      .reduce((acc, h) => (headersFromSource[h] ? (acc[h] = headersFromSource[h], acc) : acc), {}),
  };

  try {
    const res = await f(FSOAR_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    console.log('Forwarded to FortiSOAR successfully.');
    return { ok: true, body: text };
  } catch (err) {
    console.error('FortiSOAR forward failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// --- Routes ---
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  const result = await sendToFortiSOAR(req.body, req.headers);

  // Always acknowledge upstream quickly
  res.status(200).end();

  if (!result.ok && !result.skipped) {
    console.error('Failed to forward to FortiSOAR:', result.error);
  }
});

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
  console.log(`Forwarding to: ${FSOAR_WEBHOOK_URL}`);
});
