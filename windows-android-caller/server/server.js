// Direct mode — the recruiter's own BROWSER TAB (on this same laptop)
// calls this HTTP server straight over 127.0.0.1. Simple, but only works
// while the browser and the paired phone are on the exact same machine,
// and can hit CORS/mixed-content friction once TalentIQ is served over
// https from a real domain — see agent.js for the Relay-mode alternative,
// which avoids both of those by having this laptop connect OUT to
// TalentIQ's own server instead of being connected TO directly.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as adb from "./adb.js";

dotenv.config();

const PORT = process.env.PORT || 4000;
// Extra origin(s) allowed to call this Local API, beyond localhost —
// needed because the caller is now TalentIQ, which is typically served
// from a real domain (e.g. https://app.talentiq.example) even though the
// browser tab making the request is running on this same laptop. Only
// the BROWSER needs to be local; the page's origin doesn't have to be.
// Comma-separated, e.g. "https://app.talentiq.example,https://staging.talentiq.example".
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(express.json());
// Local-only tool: allow any localhost origin (covers the Vite dev port,
// a preview build port, etc.), plus any origin(s) explicitly listed in
// ALLOWED_ORIGINS (e.g. TalentIQ's real URL) — without opening this up
// to the entire internet.
app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        EXTRA_ALLOWED_ORIGINS.includes(origin)
      ) {
        return cb(null, true);
      }
      cb(new Error("origin not allowed"));
    },
  })
);

app.get("/api/health", async (req, res) => {
  try {
    const h = await adb.health();
    res.send({ status: "ok", ...h });
  } catch (error) {
    res.status(500).send({
      status: "error",
      deviceConnected: false,
      message: "Could not reach adb. Is it installed and on PATH (or ADB_PATH set)?",
      error: error.message,
    });
  }
});

app.post("/api/adb/pair", async (req, res) => {
  try {
    res.send(await adb.pair(req.body || {}));
  } catch (error) {
    res.status(error.userFacing ? 400 : 500).send({ message: error.message, output: error.output, error: error.userFacing ? undefined : error.message });
  }
});

app.post("/api/adb/connect", async (req, res) => {
  try {
    res.send(await adb.connect(req.body || {}));
  } catch (error) {
    res.status(error.userFacing ? 400 : 500).send({ message: error.message, output: error.output, error: error.userFacing ? undefined : error.message });
  }
});

app.post("/api/call", async (req, res) => {
  try {
    res.send(await adb.call(req.body?.toNumber));
  } catch (error) {
    res.status(error.userFacing ? 400 : 500).send({ message: error.userFacing ? error.message : "Failed to start call on the phone", error: error.userFacing ? undefined : error.message });
  }
});

app.post("/api/hangup", async (req, res) => {
  try {
    res.send(await adb.hangup());
  } catch (error) {
    res.status(500).send({ message: "Failed to end call on the phone", error: error.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Local API (Direct mode) listening on http://127.0.0.1:${PORT}`);
  console.log(`Using adb at "${process.env.ADB_PATH || "adb"}"${process.env.ANDROID_SERIAL ? `, pinned to device ${process.env.ANDROID_SERIAL}` : ""}`);
});
