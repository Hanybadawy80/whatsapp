// app.js
import express from "express";

const app = express();
app.use(express.json());

// -------- FortiSOAR Forwarding Config --------
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ""; // used if your provider does GET verification

const FSOAR_WEBHOOK_URL =
  process.env.FSOAR_WEBHOOK_URL ||
  "https://ativ4jeppvogma5u4x7.eu-central-1.fortisoar.forticloud.com:443/api/triggers/1/whatsapp";

const FSOAR_TOKEN = process.env.FSOAR_TOKEN || "da161494ec7d984f2b1f1f3e068be4bdf091bc512f2b85aec3757966f8de6313"; // API key
const FSOAR_TIMEOUT_MS = Number(process.env.FSOAR_TIMEOUT_MS || 5000);
const FSOAR_MAX_RETRIES = Number(process.env.FSOAR_MAX_RETRIES || 3);

// -------- Helper: forward to FortiSOAR --------
async function sendToFortiSOAR(payload, sourceHeaders = {}) {
  if (!FSOAR_WEBHOOK_URL) {
    console.warn("FSOAR_WEBHOOK_URL not set; skipping forward.");
    return { skipped: true };
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `API-KEY ${FSOAR_TOKEN}`,
    ...["x-hub-signature", "x-hub-signature-256", "x-request-id"]
      .reduce((acc, h) => (sourceHeaders[h] ? { ...acc, [h]: sourceHeaders[h] } : acc), {}),
  };

  for (let attempt = 1; attempt <= FSOAR_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FSOAR_TIMEOUT_MS);

    try {
      const res = await fetch(FSOAR_WEBHOOK_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

      console.log(`Forwarded to FortiSOAR (attempt ${attempt})`);
      return { ok: true };
    } catch (err) {
      clearTimeout(timer);
      const last = attempt === FSOAR_MAX_RETRIES;
      console.error(`Forward failed (attempt ${attempt}/${FSOAR_MAX_RETRIES}): ${err.message}`);
      if (last) return { ok: false, error: err.message };
      await new Promise(r => setTimeout(r, 300 * 2 ** (attempt - 1))); // backoff
    }
  }
}

// -------- Webhook Routes --------
app.get("/", (_req, res) => res.redirect("/deletion"));

app.get("/deletion", (_req, res) => {
  res.status(200).type("html").send(`
    <!doctype html><html><head><meta charset="utf-8"><title>Data Deletion</title></head>
    <body style="font-family:sans-serif">
      <h2>User Data Deletion</h2>
      <p>Contact <a href="mailto:support@example.com">support@example.com</a>
         or POST to <code>/delete-request</code>.</p>
    </body></html>
  `);
});

app.post("/delete-request", express.json(), (req, res) => {
  console.log("Received deletion request:", req.body);
  // TODO: store, notify, or process the deletion request
  res.json({ ok: true, message: "Deletion request received." });
});

// GET verification (if needed by WhatsApp/Facebook webhook setup)
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query;
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// POST webhook (forward to FortiSOAR)
app.post("/webhook", async (req, res) => {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\nWebhook received ${ts}`);
  console.log(JSON.stringify(req.body, null, 2));

  await sendToFortiSOAR(req.body, req.headers);
  res.status(200).end(); // always acknowledge quickly
});

// -------- Start Server --------
app.listen(PORT, () => {
  console.log(`\nListening on port ${PORT}`);
  console.log(`Forwarding webhook posts to: ${FSOAR_WEBHOOK_URL}`);
});
