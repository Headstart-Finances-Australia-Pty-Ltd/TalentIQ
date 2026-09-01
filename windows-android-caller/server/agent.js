// Relay mode — this laptop makes an OUTBOUND WebSocket connection to
// TalentIQ's own backend and stays connected. TalentIQ's normal HTTP API
// (callable from any device, any browser — not just this laptop) forwards
// call/hangup/pair/connect commands down that socket; this file executes
// them via adb and sends the result back. No inbound port or CORS/mixed-
// content configuration needed on this end, unlike server.js's Direct mode.
import dotenv from "dotenv";
import WebSocket from "ws";
import * as adb from "./adb.js";

dotenv.config();

// Where TalentIQ is hosted, e.g. wss://app.talentiq.example — get the
// exact value from Settings → Phone Connection → Relay mode in the app.
const SERVER_URL = process.env.SERVER_URL || "";
// Per-user secret from that same Settings page ("Generate token"). Treat
// it like a password — whoever holds it can command this phone.
const AGENT_TOKEN = process.env.AGENT_TOKEN || "";
const HEALTH_INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS || 5000);
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

if (!SERVER_URL || !AGENT_TOKEN) {
  console.error(
    "Missing SERVER_URL and/or AGENT_TOKEN. Copy server/.env.default to server/.env, " +
      "set SERVER_URL to your TalentIQ backend's wss:// URL, and AGENT_TOKEN to the token " +
      "generated in TalentIQ's Settings \u2192 Phone Connection \u2192 Relay mode."
  );
  process.exit(1);
}

let reconnectDelay = RECONNECT_BASE_MS;
let healthTimer = null;

function wsUrl() {
  const base = SERVER_URL.replace(/\/$/, "");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(AGENT_TOKEN)}`;
}

async function handleCommand(ws, msg) {
  const { id, cmd } = msg;
  const reply = (ok, data, message) => {
    ws.send(JSON.stringify({ type: "result", id, ok, data, message }));
  };
  try {
    switch (cmd) {
      case "call":
        return reply(true, await adb.call(msg.toNumber));
      case "hangup":
        return reply(true, await adb.hangup());
      case "pair":
        return reply(true, await adb.pair(msg));
      case "connect":
        return reply(true, await adb.connect(msg));
      case "health": {
        const h = await adb.health();
        return reply(true, h);
      }
      default:
        return reply(false, null, `Unknown command: ${cmd}`);
    }
  } catch (error) {
    reply(false, null, error.message);
  }
}

function pushHealth(ws) {
  adb
    .health()
    .then((h) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "health", ...h }));
      }
    })
    .catch(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "health", deviceConnected: false }));
      }
    });
}

function connect() {
  console.log(`Connecting to ${SERVER_URL} ...`);
  const ws = new WebSocket(wsUrl());

  ws.on("open", () => {
    console.log("Connected. This laptop is now reachable from TalentIQ's Call Candidate button.");
    reconnectDelay = RECONNECT_BASE_MS;
    pushHealth(ws);
    healthTimer = setInterval(() => pushHealth(ws), HEALTH_INTERVAL_MS);
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg && msg.cmd) handleCommand(ws, msg);
  });

  ws.on("close", (code) => {
    clearInterval(healthTimer);
    if (code === 4401 || code === 4403) {
      console.error("Rejected by server — AGENT_TOKEN is missing or invalid. Generate a fresh one in Settings and update .env.");
      process.exit(1);
    }
    console.log(`Disconnected (code ${code}). Reconnecting in ${Math.round(reconnectDelay / 1000)}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  });

  ws.on("error", (err) => {
    console.error("Connection error:", err.message);
  });
}

connect();
