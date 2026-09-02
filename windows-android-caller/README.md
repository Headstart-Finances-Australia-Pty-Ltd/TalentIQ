# Windows Laptop → Android Phone Caller

Matches this architecture:

```
┌─────────────────────────────┐
│       Windows Laptop        │
│  React/Web Frontend         │
│  [ 04XX XXX XXX ]           │
│  [Call] [Hangup]            │
│           ↕                 │
│      Local API (Node)       │
└───────────┬─────────────────┘
            │ Wi-Fi (ADB)
            ▼
     Android Phone + SIM
            │
            ▼
    Australian Mobile
```

No app needs to be installed on the phone. The laptop controls the phone's
own dialer over **ADB** (Android Debug Bridge) — the same tool developers
use to debug apps — which can be enabled over Wi-Fi so no cable is needed
day-to-day.

> **Note on the original diagram:** Bluetooth can't carry ADB traffic, only
> USB or Wi-Fi can. This build uses Wi-Fi (with USB as a one-time setup
> step and a reliable fallback).

## How it works

- **Frontend** (`frontend/`) — a small React app: phone number field, Call
  and Hangup buttons, live device-connection status. Used by Direct mode
  only (see below) — not needed at all for Relay mode with TalentIQ.
- **Local API** (`server/server.js`, Direct mode) — a Node/Express server
  running on the laptop that shells out to `adb` to:
  - `POST /api/call` → fires Android's native "dial this number" intent,
    which opens the phone's own dialer/telephony stack and calls out on
    your SIM exactly as if you'd tapped the number yourself.
  - `POST /api/hangup` → sends the Android "End Call" key event.
  - `GET /api/health` → reports whether a device is connected over ADB.
- **Agent** (`server/agent.js`, Relay mode) — connects OUTBOUND to
  TalentIQ's backend over WebSocket and runs the same `adb` commands
  (via the shared `server/adb.js`) when TalentIQ asks it to.

## Two ways to run this

| | **Relay mode** (recommended for TalentIQ) | **Direct mode** (original / standalone) |
|---|---|---|
| Run | `npm run start:agent` (in `server/`) | `npm start` (in `server/`) |
| How it connects | This laptop connects **out** to TalentIQ's backend over a WebSocket | TalentIQ's **browser tab** connects **in** to a local HTTP server on this laptop |
| Works from | Any device/browser signed into TalentIQ, once this agent is running | Only a browser tab open on this exact laptop |
| Firewall/CORS/mixed-content | None of that applies — outbound-only connection | Needs `ALLOWED_ORIGINS` set, and depends on the browser's http/https-to-localhost exception |
| Setup | Paste `SERVER_URL` + `AGENT_TOKEN` from TalentIQ's Settings into `server/.env` | Point TalentIQ's Settings at `http://127.0.0.1:4000` |
| Standalone frontend (`frontend/`) | Not used | Used |

Both modes drive the exact same phone the exact same way (`server/adb.js`)
— the only difference is how TalentIQ's UI reaches this laptop.

There's no double-click launcher here on purpose — a bundled `.cmd`/`.bat`
file inside a downloaded zip commonly trips Windows SmartScreen (it flags
based on low download-reputation, not actual content), so this just runs
via plain `npm` commands in a terminal instead. It's three lines either
way — see below.

Both `server/` and `frontend/` ship with a `package-lock.json`, so
`npm install` always pulls the exact same dependency versions rather than
whatever happens to be newest at install time — useful for reproducing an
install exactly, and for ruling out "a transitive dependency changed
between two installs" as an explanation if antivirus software ever flags
something here on one machine but not another.

### Relay mode setup

1. In TalentIQ: **Settings → API Keys → Phone Connection → Relay mode →
   Generate token.** Copy the token shown, and note the `SERVER_URL`
   shown alongside it (your TalentIQ backend's
   `wss://.../api/android-caller/ws`).
2. Copy `server/.env.default` to `server/.env` and fill in `SERVER_URL`
   and `AGENT_TOKEN` with those two values.
3. Do the one-time phone/laptop setup below, then open a terminal
   (PowerShell or Command Prompt) in the `server/` folder and run:
   ```
   npm install
   npm run start:agent
   ```
   Keep that terminal window open — closing it disconnects your phone
   from TalentIQ.
4. Back in TalentIQ's Settings, "Check connection" should show "agent
   connected". Pair/Connect your phone from that same page.
5. TalentIQ's "Call Candidate" button now dials through your phone from
   any device you're signed into TalentIQ from, not just this laptop.

## One-time phone setup

1. On the Android phone: **Settings → About phone → tap "Build number" 7
   times** to unlock Developer Options.
2. **Settings → System → Developer options**:
   - Turn on **USB debugging**.
   - Turn on **Wireless debugging** (Android 11+). Older Android versions:
     skip this and just use the USB steps below every time instead.
3. Connect the phone to the laptop by **USB cable** once, and accept the
   "Allow USB debugging?" prompt on the phone (tick "always allow").

## One-time laptop setup

1. Install [Android platform-tools](https://developer.android.com/tools/releases/platform-tools)
   (this gives you the `adb` command) and add it to your Windows PATH, or
   note its folder path to put in `server/.env`.
2. Install [Node.js](https://nodejs.org/) (LTS).

## Connect over Wi-Fi (do this each session, or once if the phone keeps a stable IP)

With the phone plugged in by USB and on the **same Wi-Fi network** as the
laptop:

```
adb tcpip 5555
```

Unplug the USB cable. Find the phone's Wi-Fi IP address (**Settings → About
phone → Status → IP address**), then on the laptop:

```
adb connect 192.168.1.xx:5555
adb devices
```

`adb devices` should list the phone as `192.168.1.xx:5555  device`. If it
instead says `unauthorized`, look at the phone screen and accept the
debugging prompt.

(Android 11+ wireless debugging alternative: **Settings → Developer
options → Wireless debugging → Pair device with pairing code**, then
`adb pair <ip>:<port>` with the code shown, followed by `adb connect
<ip>:<port>` using the IP/port shown on the main Wireless debugging
screen. Works without ever plugging in a cable.)

## Run it (Direct mode)

Open two terminal windows (PowerShell or Command Prompt):

**Terminal 1 — Local API:**
```
cd server
npm install
npm start
```
This listens on `http://127.0.0.1:4000`.

**Terminal 2 — standalone frontend (optional, for pairing outside of TalentIQ):**
```
cd frontend
npm install
npm run dev
```
This opens at `http://localhost:5173`.

Keep both terminals open while you use this mode; closing one stops that
half. If you're only using Direct mode through TalentIQ's own Settings →
Phone Connection page (rather than this standalone frontend), you only
need Terminal 1.

### Setup inside the app (no manual `adb` typing needed)

Once the browser opens, go to the **Settings** tab:

1. **Pair** — on the phone: *Settings → Developer options → Wireless
   debugging → Pair device with pairing code*. It shows a phone IP, a
   pairing port, and a 6-digit code. Type those three into the Settings
   tab and hit **Pair device**.
2. **Connect** — back on the phone's main *Wireless debugging* screen
   (not the pairing dialog), it shows a second IP:port — this one doesn't
   change on the pairing dialog reopen. Enter that into the **Connect**
   fields and hit **Connect**.
3. The status pill in the header switches to **"phone connected"** once
   `adb` confirms the device is authorized. Switch to the **Call** tab and
   dial.

Older Android (no Wireless debugging toggle): skip Pair, plug in by USB
once, run `adb tcpip 5555` in either service window's terminal, unplug,
then use the **Connect** fields with port `5555`.

The phone's IP can change if your router reassigns it — if "phone
connected" drops later, just re-run Connect with the current IP (or set a
DHCP reservation for the phone on your router so the IP never changes).

## Two-way audio (Bluetooth) — hearing and speaking on the call

ADB (both modes above) only controls the phone's dialer — it doesn't
carry any audio. To actually **talk** on the call from your PC, pair the
phone to Windows over Bluetooth once, the same way you'd pair a
headset. This is a phone/Windows Bluetooth setting, not a TalentIQ
feature — there's no code involved, and it works whether you're using
Direct or Relay mode above.

### One-time setup

1. **On Windows:** Settings → Bluetooth & devices → Add device → pick
   your phone. Accept the pairing prompt on both sides.
2. **On the phone:** when the pairing prompt appears, make sure
   **"Phone calls"** / **"Call audio"** is left switched ON for this
   Windows device (some phones show this toggle during pairing, others
   under the paired device's own settings afterward). This is the
   toggle that enables Bluetooth **HFP** (Hands-Free Profile) — the
   actual audio path — as opposed to just file transfer or media audio.
3. In Windows Sound settings, you should now see the phone listed as a
   **"Hands-Free"** input AND output device. Windows usually switches to
   it automatically the moment a call is active; if not, click the
   speaker icon in the taskbar and pick it manually.

### Placing a call after that

Dial as normal from TalentIQ's Call popup (Direct or Relay mode, same
as above). Once the phone shows the call as connected:

- **Most phones**: audio switches to the PC automatically within a
  second or two.
- **Some phones/OEM skins**: the call stays on the earpiece/speaker
  until you tap **"Audio route" → [your PC's name]** on the phone's own
  in-call screen — a one-time tap per phone, not per call, on the ones
  that need it at all.

### Why this isn't 100% automatic on every phone

The ADB dialer control above is a plain Android API every manufacturer
implements identically, which is why it's been reliable regardless of
phone brand. Bluetooth call-audio routing isn't standardized the same
way — it lives inside each manufacturer's own dialer app and call-audio
stack:

- **OEM skins differ** (Samsung One UI, Xiaomi MIUI, stock/Pixel
  Android, etc.) on whether an active call auto-routes to an already-
  connected Bluetooth device, or waits for you to pick it manually.
- **HFP protocol version** varies by phone age (1.6 vs 1.7/1.8) —
  affects audio quality/codec (CVSD vs the clearer mSBC), not whether
  it works.
- **Android's background-activity restrictions** (Android 10+) can
  occasionally affect how promptly some OEM dialers come to the
  foreground after an ADB-triggered call intent.

None of this affects whether calling itself works (that's plain ADB,
unaffected by any of the above) — worst case on an unfamiliar phone is
one extra tap the first time to route audio to the PC, which the phone
then remembers.

## Files

- `server/adb.js` — shared driver: all the actual `adb` calls, used by
  both modes below.
- `server/server.js` — Direct mode: Express API that calls `adb.js`.
- `server/agent.js` — Relay mode: WebSocket client that calls `adb.js`.
- `server/.env.default` — `ADB_PATH`, `ANDROID_SERIAL` (only needed if
  more than one device is ever connected), and mode-specific settings
  (`PORT`/`ALLOWED_ORIGINS` for Direct, `SERVER_URL`/`AGENT_TOKEN` for
  Relay).
- `frontend/src/App.jsx` — the standalone phone-number/Call/Hangup UI
  (Direct mode only).

## Using Direct mode from TalentIQ instead of the standalone frontend

If you'd rather use Direct mode's browser-to-localhost approach than
Relay mode's WebSocket agent (e.g. you're always on the same laptop and
want one less thing to configure), TalentIQ's Settings → Phone Connection
page can also call this Local API directly from the browser, instead of
the little standalone `frontend/` app above:

1. Copy `server/.env.default` to `server/.env` and set `ALLOWED_ORIGINS`
   to wherever TalentIQ is served from, e.g.
   `ALLOWED_ORIGINS=https://app.talentiq.example` (comma-separate more
   than one if TalentIQ is reachable at multiple URLs — staging + prod,
   for example). Leave it blank if you only ever open TalentIQ from
   `localhost`/`127.0.0.1` on this same laptop.
2. Run `npm start` inside `server/` — you don't need
   the `frontend/` half running at all for this integration; TalentIQ's
   own UI replaces it.
3. In TalentIQ, go to **Settings → API Keys → Phone Connection**, choose
   **Direct mode**, confirm the Local API Base URL
   (`http://127.0.0.1:4000` by default), and use the Pair/Connect fields
   there the same way you would in this app's own Settings tab.
4. From then on, TalentIQ's "Call Candidate" button on the Phone
   Screening popup calls out through your phone instead of Twilio.

Note: if TalentIQ is served over **https** and you fetch **http**
`127.0.0.1`, most browsers currently treat `localhost`/`127.0.0.1` as an
exception to mixed-content blocking — but this is a browser policy area
that has been getting stricter (see "Private Network Access"), so if a
future browser update blocks it, prefer Relay mode instead (it has no
mixed-content exposure at all, since the connection is outbound).
