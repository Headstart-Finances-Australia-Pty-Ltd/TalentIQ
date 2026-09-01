import { useEffect, useState, useCallback } from "react";

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function App() {
  const [tab, setTab] = useState("call"); // call | settings

  const [toNumber, setToNumber] = useState("");
  const [callState, setCallState] = useState("idle"); // idle | dialing | active | error
  const [callError, setCallError] = useState("");

  const [health, setHealth] = useState({ deviceConnected: false, device: null, needsAuthorization: false, allDevices: [] });
  const [apiUnreachable, setApiUnreachable] = useState(false);

  const [pairIp, setPairIp] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMsg, setPairMsg] = useState(null); // {ok, text}

  const [connectIp, setConnectIp] = useState("");
  const [connectPort, setConnectPort] = useState("5555");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState(null);

  const pollHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
      setApiUnreachable(false);
    } catch {
      setApiUnreachable(true);
    }
  }, []);

  useEffect(() => {
    pollHealth();
    const id = setInterval(pollHealth, 5000);
    return () => clearInterval(id);
  }, [pollHealth]);

  async function handlePair() {
    setPairMsg(null);
    setPairBusy(true);
    const { ok, data } = await postJson("/api/adb/pair", { ip: pairIp, port: pairPort, code: pairCode });
    setPairMsg({ ok, text: ok ? "Paired. Now connect below." : data.message || "Pairing failed." });
    setPairBusy(false);
    if (ok) pollHealth();
  }

  async function handleConnect() {
    setConnectMsg(null);
    setConnectBusy(true);
    const { ok, data } = await postJson("/api/adb/connect", { ip: connectIp || pairIp, port: connectPort });
    setConnectMsg({ ok, text: ok ? "Connected! Check the status pill up top." : data.message || "Connect failed." });
    setConnectBusy(false);
    if (ok) pollHealth();
  }

  async function handleCall() {
    setCallError("");
    if (!toNumber.trim()) {
      setCallError("Enter a number to dial first.");
      return;
    }
    setCallState("dialing");
    const { ok, data } = await postJson("/api/call", { toNumber });
    if (!ok) {
      setCallError(data.message || "Failed to start call.");
      setCallState("error");
    } else {
      setCallState("active");
    }
  }

  async function handleHangup() {
    setCallError("");
    try {
      const res = await fetch("/api/hangup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setCallError(data.message || "Failed to end call.");
    } catch {
      setCallError("Could not reach the Local API. Is the server running?");
    } finally {
      setCallState("idle");
    }
  }

  const canCall = health.deviceConnected && (callState === "idle" || callState === "error");
  const canHangup = callState === "dialing" || callState === "active";

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <div className="mark">📞</div>
          <div>
            <h1>Android Caller</h1>
            <div className="sub">Local API &rarr; your phone&apos;s SIM</div>
          </div>
        </div>
        <div className="status-pill">
          <span className={`dot ${apiUnreachable ? "down" : health.deviceConnected ? "up" : "warn"}`} />
          <span>
            {apiUnreachable
              ? "local api offline"
              : health.deviceConnected
              ? "phone connected"
              : health.needsAuthorization
              ? "authorize on phone"
              : "phone not connected"}
          </span>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "call" ? "active" : ""} onClick={() => setTab("call")}>Call</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
      </nav>

      {tab === "call" && (
        <section className="panel">
          {!health.deviceConnected && (
            <div className="msg info show">
              No phone connected yet. Go to the Settings tab to pair it over Wi-Fi.
            </div>
          )}

          <div className="field">
            <label htmlFor="toNumber">Phone number</label>
            <input
              id="toNumber"
              type="tel"
              inputMode="tel"
              placeholder="04XX XXX XXX"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              disabled={callState === "dialing" || callState === "active"}
            />
          </div>

          {callError && <div className="msg show">{callError}</div>}

          <div className="btn-row">
            <button className="primary" onClick={handleCall} disabled={!canCall}>
              📞 Call
            </button>
            <button className="danger" onClick={handleHangup} disabled={!canHangup}>
              ❌ Hangup
            </button>
          </div>

          {(callState === "dialing" || callState === "active") && (
            <div className="callcard">
              <div className="row">
                <span className="number">{toNumber}</span>
                <span className={`badge ${callState}`}>{callState === "dialing" ? "dialing" : "in call"}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "settings" && (
        <section className="panel">
          <div className="subhead">1. Pair (Android 11+, one time per phone)</div>
          <div className="hint">
            On the phone: Settings &rarr; Developer options &rarr; Wireless debugging &rarr; Pair device with
            pairing code. Copy the IP, port, and 6-digit code shown there into here.
          </div>
          <div className="field-row">
            <div className="field">
              <label>Phone IP</label>
              <input placeholder="192.168.1.42" value={pairIp} onChange={(e) => setPairIp(e.target.value)} />
            </div>
            <div className="field narrow">
              <label>Pairing port</label>
              <input placeholder="37251" value={pairPort} onChange={(e) => setPairPort(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Pairing code</label>
            <input placeholder="123456" value={pairCode} onChange={(e) => setPairCode(e.target.value)} />
          </div>
          {pairMsg && <div className={`msg show ${pairMsg.ok ? "info" : ""}`}>{pairMsg.text}</div>}
          <button className="primary" onClick={handlePair} disabled={pairBusy}>
            {pairBusy ? "Pairing…" : "Pair device"}
          </button>

          <div className="divider" />

          <div className="subhead">2. Connect</div>
          <div className="hint">
            After pairing, go back to the main Wireless debugging screen on the phone — it shows a
            <em> different</em> IP:port to connect on. Enter that here (or, on older Android, run
            <code> adb tcpip 5555</code> over USB once and use port 5555).
          </div>
          <div className="field-row">
            <div className="field">
              <label>Phone IP</label>
              <input placeholder="192.168.1.42" value={connectIp} onChange={(e) => setConnectIp(e.target.value)} />
            </div>
            <div className="field narrow">
              <label>Connect port</label>
              <input placeholder="5555" value={connectPort} onChange={(e) => setConnectPort(e.target.value)} />
            </div>
          </div>
          {connectMsg && <div className={`msg show ${connectMsg.ok ? "info" : ""}`}>{connectMsg.text}</div>}
          <button className="primary" onClick={handleConnect} disabled={connectBusy}>
            {connectBusy ? "Connecting…" : "Connect"}
          </button>

          <div className="divider" />
          <div className="subhead">Detected devices</div>
          <div className="device-list">
            {health.allDevices?.length ? (
              health.allDevices.map((d) => (
                <div className="device-row" key={d.serial}>
                  <span>{d.serial}</span>
                  <span className={`badge ${d.state === "device" ? "active" : "dialing"}`}>{d.state}</span>
                </div>
              ))
            ) : (
              <div className="hint">None yet — pair and connect above.</div>
            )}
          </div>
        </section>
      )}

      <footer>Local API on this laptop &middot; phone dials over its own SIM</footer>
    </div>
  );
}
