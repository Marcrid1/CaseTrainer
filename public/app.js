// --------- Model ---------
const REALTIME_MODEL = "gpt-4o-mini-realtime-preview";

// --------- UI State ---------
const state = {
  language: localStorage.getItem("rt_lang") || "en",
  mode: localStorage.getItem("rt_mode") || "personal-fit", // nur personal-fit | behavioral
};
const $lang = document.getElementById("language");
const $mode = document.getElementById("mode");
const $apply = document.getElementById("apply");
$lang.value = state.language;
$mode.value = state.mode;

// --------- Logging ---------
const log = (...a) => {
  document.getElementById("log").textContent += a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\n";
};

// --------- Settings ---------
$apply.onclick = () => {
  state.language = $lang.value;
  state.mode = $mode.value;
  localStorage.setItem("rt_lang", state.language);
  localStorage.setItem("rt_mode", state.mode);
  log("✅ Settings gespeichert → language:", state.language, "mode:", state.mode);
};

// --------- OPTIONAL TURN (behind symmetric NAT) ---------
// window.TURN = { urls: ["turn:your.turn.host:3478"], username: "user", credential: "pass" };

// --------- Expiry Helper ---------
function normalizeExpiry(expVal) {
  if (!expVal) return null;
  if (typeof expVal === "string") {
    const t = Date.parse(expVal);
    return isNaN(t) ? null : t;
  }
  if (typeof expVal === "number") {
    return expVal < 1e12 ? expVal * 1000 : expVal; // s → ms
  }
  return null;
}

// --------- Session Fetch (mit Query) ---------
async function fetchSession() {
  const qs = new URLSearchParams({
    language: state.language || "en",
    mode: state.mode || "personal-fit"
  });
  const r = await fetch(`/session?${qs.toString()}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);

  const key = data?.client_secret?.value || data?.client_secret || data?.value;
  const rawExp =
    data?.expires_at ||
    data?.client_secret?.expires_at ||
    data?.session?.expires_at ||
    data?.session?.client_secret?.expires_at ||
    null;

  const expMs = normalizeExpiry(rawExp);
  if (!key) {
    console.error("Session response:", data);
    throw new Error("No client secret in /session");
  }
  log("ℹ️ Session erstellt mit Settings → language:", state.language, "mode:", state.mode);
  if (rawExp && !expMs) log("⚠️ expires_at konnte nicht geparst werden:", rawExp);
  if (expMs) log("ℹ️ expires_at (ms):", expMs, "→ in", Math.max(0, Math.round((expMs - Date.now())/1000)), "s");
  return { key, expiresAtMs: expMs };
}

// --------- WebRTC Globals ---------
let pc = null;
let micStream = null;
let dc = null;
let rolloverTimer = null;
let currentKey = null;
let currentExpiryMs = null;

const audioEl = document.getElementById("audio-out"); // verborgen

function getIceServers() {
  const ice = [{ urls: ["stun:stun.l.google.com:19302"] }];
  if (window.TURN?.urls?.length) {
    ice.push({ urls: window.TURN.urls, username: window.TURN.username, credential: window.TURN.credential });
  }
  return ice;
}

function cleanup() {
  if (rolloverTimer) clearTimeout(rolloverTimer), rolloverTimer = null;
  try { dc && dc.close(); } catch {}
  if (pc) {
    try { pc.getSenders().forEach(s => { try { s.track && s.track.stop(); } catch {} }); } catch {}
    try { pc.close(); } catch {}
  }
  if (micStream) { try { micStream.getTracks().forEach(t => t.stop()); } catch {} }
  pc = null; micStream = null; dc = null;
  audioEl.srcObject = null;
  log("⏹️ Cleaned up");
}

function attachDCHandlers(targetPc, channel, origin) {
  channel.onopen = () => {
    if (targetPc === pc) {
      dc = channel;
      log(`ℹ️ DataChannel open (${origin})`);
    } else {
      targetPc._pendingOAIChannel = channel;
      log(`ℹ️ Secondary DataChannel open (${origin}), pending promote`);
    }
    // Kickoff: politely instruct the model to fetch the first question via the tool.
try {
  dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Start the interview now. Please fetch ONE ${state.mode === "behavioral" ? "behavioral" : "personal-fit"} question via function 'question_bank_get' and ask it in ${state.language === "de" ? "German" : "English"}.`
      }]
    }
  }));
  dc.send(JSON.stringify({ type: "response.create" }));
} catch {}

  };
  channel.onclose = () => { if (targetPc === pc) log("ℹ️ DataChannel closed"); };

  const pendingToolArgs = new Map(); 
channel.onmessage = async (evt) => {
  if (typeof evt.data !== "string") return;
  let msg; try { msg = JSON.parse(evt.data); } catch { log("evt non-json:", evt.data); return; }

  // 1) Ein-Schuss-Call
  if (msg?.type === "response.function_call" || msg?.type === "response.tool_call") {
    const { name, call_id, arguments_json } = msg;
    await handleFunctionCall({ name, call_id, arguments_json });
    return;
  }

  // 2) Streaming-Args – beide Schreibweisen abdecken
  const isDelta = msg?.type === "response.function_call.arguments.delta" || msg?.type === "response.function_call_arguments.delta";
  const isDone  = msg?.type === "response.function_call.arguments.done"  || msg?.type === "response.function_call_arguments.done";

  if (isDelta) {
    const { call_id, delta } = msg;
    const entry = pendingToolArgs.get(call_id) || { name: msg.name, chunks: [] };
    entry.chunks.push(delta || "");
    if (msg.name) entry.name = msg.name;
    pendingToolArgs.set(call_id, entry);
    log("evt (tool delta):", msg.type);
    return;
  }

  if (isDone) {
    const { call_id, name } = msg;
    const entry = pendingToolArgs.get(call_id) || { name, chunks: [] };
    if (!entry.name && name) entry.name = name;
    const arguments_json = (entry.chunks || []).join("");
    pendingToolArgs.delete(call_id);
    log("evt (tool done):", msg.type, "name:", entry.name);
    await handleFunctionCall({ name: entry.name, call_id, arguments_json });
    return;
  }

  // Logging
  if (typeof msg?.type === "string" && (msg.type.startsWith("response.function_call") || msg.type.startsWith("response.tool_call"))) {
    log("evt (tool):", msg.type);
  } else if (msg?.type) {
    log("evt:", msg.type);
  } else {
    log("evt (untyped):", msg);
  }
};


async function handleFunctionCall({ name, call_id, arguments_json }) {
  try {
    if (name === "question_bank_get") {
      const args = JSON.parse(arguments_json || "{}");
      const qtype = args.qtype || (state.mode === "behavioral" ? "behavioral" : "personal-fit");

      const q = await fetch(`/tool/question?` + new URLSearchParams({ qtype })).then(r => r.json());

      // ✅ RICHTIG: zuerst ein conversation.item.create mit function_call_output ...
      dc?.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id,
          output: JSON.stringify(q)   // Muss ein String sein
        }
      }));

      // ... und dann die Fortsetzung anfordern
      dc?.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    // Unbekanntes Tool
    dc?.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id,
        output: JSON.stringify({ error: `Unknown tool: ${name}` })
      }
    }));
    dc?.send(JSON.stringify({ type: "response.create" }));
  } catch (e) {
    dc?.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id,
        output: JSON.stringify({ error: String(e.message || e) })
      }
    }));
    dc?.send(JSON.stringify({ type: "response.create" }));
  }
}



}

function scheduleRollover() {
  let msUntil = currentExpiryMs ? (currentExpiryMs - Date.now() - 15_000) : 90_000;
  msUntil = Math.max(msUntil, 10_000);
  log("⏱️ Rollover in", Math.round(msUntil/1000), "s geplant");
  rolloverTimer = setTimeout(() => {
    softRollover().catch(e => log("Rollover error:", e.message || e));
  }, msUntil);
}

async function createPeer(key, reuseMic = null) {
  const p = new RTCPeerConnection({ iceServers: getIceServers(), iceCandidatePoolSize: 2 });

  p.onicegatheringstatechange   = () => log("ICE-Gathering:", p.iceGatheringState);
  p.onsignalingstatechange      = () => log("Signaling:", p.signalingState);
  p.oniceconnectionstatechange  = () => log("ICE:", p.iceConnectionState);
  p.onconnectionstatechange     = () => log("PC:", p.connectionState);

  p.ontrack = (ev) => { audioEl.srcObject = ev.streams[0]; };

  p.ondatachannel = (evt) => attachDCHandlers(p, evt.channel, "server");

  const ch = p.createDataChannel("oai-events");
  attachDCHandlers(p, ch, "client");

  const mic = reuseMic || await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  });
  mic.getTracks().forEach(t => p.addTrack(t, mic));

  const offer = await p.createOffer({ offerToReceiveAudio: true });
  await p.setLocalDescription(offer);

const resp = await fetch(`https://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/sdp",
      "OpenAI-Beta": "realtime=v1"
    },
    body: offer.sdp
  });
  const answer = await resp.text();
  await p.setRemoteDescription({ type: "answer", sdp: answer });

  return { peer: p, mic };
}

async function startConnection() {
  const sess = await fetchSession();
  currentKey = sess.key;
  currentExpiryMs = sess.expiresAtMs;

  const { peer, mic } = await createPeer(currentKey);
  pc = peer;
  micStream = mic;

  log("✅ WebRTC verbunden. Du kannst sprechen.");
  scheduleRollover();
}

async function softRollover() {
  if (!pc) return;
  log("🔄 Starte Session-Rollover …");
  const sess = await fetchSession();
  const { peer, mic } = await createPeer(sess.key, micStream);

  const ok = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 20000);
    const onState = () => {
      if (peer.connectionState === "connected" || peer.iceConnectionState === "connected") {
        clearTimeout(to);
        peer.removeEventListener("connectionstatechange", onState);
        resolve(true);
      }
    };
    peer.addEventListener("connectionstatechange", onState);
    onState();
  });

  if (!ok) {
    log("⚠️ Rollover: Secondary nicht verbunden – bleibe auf aktueller Session.");
    try { peer.close(); } catch {}
    scheduleRollover();
    return;
  }

  const oldPc = pc, oldDc = dc;
  pc = peer; micStream = mic;
  currentKey = sess.key; currentExpiryMs = sess.expiresAtMs;

  if (peer._pendingOAIChannel && peer._pendingOAIChannel.readyState === "open") {
    dc = peer._pendingOAIChannel;
    log("ℹ️ DataChannel reattached after promote");
  }
  try { oldDc && oldDc.close(); } catch {}
  try { oldPc && oldPc.close(); } catch {}

  log("🔄 Session rollover completed.");
  scheduleRollover();
}

// --------- Buttons ---------
document.getElementById("start").onclick = async () => {
  try {
    document.getElementById("start").disabled = true;
    document.getElementById("stop").disabled = false;
    await startConnection();
  } catch (e) {
    log("❌ start error:", e.message || e);
    document.getElementById("start").disabled = false;
    document.getElementById("stop").disabled = true;
  }
};

document.getElementById("stop").onclick = () => {
  cleanup();
  document.getElementById("start").disabled = false;
  document.getElementById("stop").disabled = true;
};

window.addEventListener("beforeunload", () => cleanup());

// --------- Initial Info ---------
log("ℹ️ Aktuelle Settings → language:", state.language, "mode:", state.mode);
