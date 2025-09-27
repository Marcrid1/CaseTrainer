// Model
const REALTIME_MODEL = "gpt-4o-mini-realtime-preview";

// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const path = require("path");
const { buildInstructions, normalizeMode, normalizeLanguage } = require("./agent/buildInstructions");
const { getQuestion } = require("./tools/questionBank");

// Node >=18: global fetch verfügbar
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Ephemere Realtime-Session erzeugen; VAD im Backend setzen.
// Achtung: Einige Tenants liefern expires_at als UNIX-SECONDS!
app.get("/session", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }

    // 1) Query-Settings (mit Defaults)
    const mode = normalizeMode(req.query.mode);          // "personal-fit" | "behavioral" | "case" | "full"
    const language = normalizeLanguage(req.query.language); // "en" | "de"

    // 2) Instruction zusammensetzen (Preamble + recruiter_en.md)
    const instructions = await buildInstructions({ mode, language });

    // 3) Request-Payload für die Realtime-Session
    const sessionBody = {
      model: REALTIME_MODEL,
      voice: "ash",
      instructions,
      turn_detection: {
        type: "server_vad",
        threshold: 0.40,
        silence_duration_ms: 220,
        prefix_padding_ms: 160,
        interrupt_response: true,
      },
      tools: [
      {
        type: "function",
        name: "question_bank_get",
        description: "Fetch a question from the question pool. The agent translates to the session language.",
        parameters: {
          type: "object",
          properties: {
            qtype: { type: "string", enum: ["personal-fit", "behavioral"] }
          },
          required: ["qtype"]
        }
      }
    ]
    };

    // 4) Realtime-Session beim OpenAI-Endpoint anlegen
    console.log("tools enabled:", sessionBody.tools?.map(t=>t.name));
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1"
      },
      body: JSON.stringify(sessionBody)
    });

    const raw = await r.text();
    if (!r.ok) {
      console.error("Realtime /sessions error:", r.status, raw);
      // versuche, Fehlermeldung schöner zu machen
      let errMsg = raw;
      try {
        const ej = JSON.parse(raw);
        errMsg = ej.error?.message || ej.error || raw;
      } catch {}
      return res.status(500).json({ error: errMsg });
    }

    // 5) Erfolgreiche Antwort parsen & Debug-Expiry loggen (Tenant liefert ISO oder Unix Sekunden)
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error("Realtime /sessions JSON parse error:", e, raw);
      return res.status(500).json({ error: "Invalid JSON from OpenAI realtime/sessions" });
    }

    const rawExp =
      json?.expires_at ||
      json?.client_secret?.expires_at ||
      json?.session?.expires_at ||
      json?.session?.client_secret?.expires_at ||
      null;

    console.log("✅ Ephemeral session created",
      "| mode:", mode,
      "| language:", language,
      "| expires_at (raw):", rawExp
    );

    // 6) 1:1 an den Client zurück – dein Frontend normalisiert expires_at und key
    res.json(json);

  } catch (e) {
    console.error("Unhandled /session error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/tool/question", async (req, res) => {
  try {
    const qtype = (req.query.qtype || "").toLowerCase();
    if (!["personal-fit", "behavioral"].includes(qtype)) {
      return res.status(400).json({ error: "qtype must be 'personal-fit' or 'behavioral'" });
    }
    const q = await getQuestion({ qtype });
    res.json(q); // { id, type, question, guidance }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Realtime RTC helper on http://localhost:${PORT}`);
  console.log(`📁 Serving static from: ${PUBLIC_DIR}`);
});
