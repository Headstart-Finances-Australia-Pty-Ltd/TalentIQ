import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

const ADB_PATH = process.env.ADB_PATH || "adb";
const FIXED_SERIAL = process.env.ANDROID_SERIAL || "";

/** Run adb with an argument array (never a shell string) so there's no
 * command-injection surface, regardless of what's in the phone number. */
function runAdb(args) {
  return execFileP(ADB_PATH, args, { timeout: 10000 });
}

/** Prefix adb args with -s <serial> only when a specific device is pinned
 * via ANDROID_SERIAL; otherwise let adb use its default single device. */
function withDevice(args) {
  return FIXED_SERIAL ? ["-s", FIXED_SERIAL, ...args] : args;
}

/** Parses `adb devices -l` output into a list of {serial, state}. */
export async function listDevices() {
  const { stdout } = await runAdb(["devices", "-l"]);
  return stdout
    .split("\n")
    .slice(1) // drop the "List of devices attached" header line
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
}

/** Strict allow-list for phone numbers: digits, an optional leading +,
 * spaces (stripped before use). Rejects anything that isn't recognisably
 * a phone number before it ever reaches a subprocess. */
function normalizeNumber(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\+?[0-9 ]{6,18}$/.test(trimmed)) return null;
  return trimmed.replace(/\s+/g, "");
}

/** Loose but safe validators for the values that go into `adb pair` /
 * `adb connect` — an IPv4 address, a 1-5 digit port, and (for pairing) the
 * 6-digit code Android shows on the Wireless debugging screen. */
function normalizeIp(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed) ? trimmed : null;
}
function normalizePort(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim();
  if (!/^\d{2,5}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n > 0 && n < 65536 ? String(n) : null;
}
function normalizePairingCode(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const trimmed = String(raw).trim();
  return /^\d{6}$/.test(trimmed) ? trimmed : null;
}

export async function health() {
  const devices = await listDevices();
  const connected = FIXED_SERIAL
    ? devices.find((d) => d.serial === FIXED_SERIAL && d.state === "device")
    : devices.find((d) => d.state === "device");
  const unauthorized = devices.find((d) => d.state === "unauthorized");
  return {
    deviceConnected: !!connected,
    device: connected ? connected.serial : null,
    needsAuthorization: !!unauthorized && !connected,
    allDevices: devices,
  };
}

/** Android 11+ "Wireless debugging → Pair device with pairing code" flow.
 * The phone shows an IP:port and a 6-digit code; `adb pair` is fully
 * non-interactive when given all three. Throws on bad input or failure. */
export async function pair({ ip, port, code }) {
  const nIp = normalizeIp(ip);
  const nPort = normalizePort(port);
  const nCode = normalizePairingCode(code);
  if (!nIp || !nPort || !nCode) {
    const err = new Error("Need a valid ip, port, and 6-digit pairing code.");
    err.userFacing = true;
    throw err;
  }
  const { stdout, stderr } = await runAdb(["pair", `${nIp}:${nPort}`, nCode]);
  const output = stdout || stderr || "";
  if (!/successfully paired/i.test(output)) {
    const err = new Error("Pairing failed. Double-check the code hasn't expired.");
    err.userFacing = true;
    err.output = output;
    throw err;
  }
  return { status: "paired", output };
}

/** `adb connect` — either right after pairing (Android 11+), or as the
 * whole flow on Android 10 and older after a one-time `adb tcpip 5555`
 * over USB. Also non-interactive. Throws on bad input or failure. */
export async function connect({ ip, port }) {
  const nIp = normalizeIp(ip);
  const nPort = normalizePort(port);
  if (!nIp || !nPort) {
    const err = new Error("Need a valid ip and port.");
    err.userFacing = true;
    throw err;
  }
  const { stdout, stderr } = await runAdb(["connect", `${nIp}:${nPort}`]);
  const output = stdout || stderr || "";
  if (!/connected to/i.test(output)) {
    const err = new Error("Connect failed.");
    err.userFacing = true;
    err.output = output;
    throw err;
  }
  return { status: "connected", output };
}

/** Fires Android's native "dial this number" intent, which opens the
 * phone's own dialer/telephony stack and calls out on your SIM exactly
 * as if you'd tapped the number yourself. Throws on bad input or failure. */
export async function call(toNumber) {
  const number = normalizeNumber(toNumber);
  if (!number) {
    const err = new Error("toNumber must be a valid phone number, e.g. +61412345678");
    err.userFacing = true;
    throw err;
  }
  await runAdb(withDevice(["shell", "am", "start", "-a", "android.intent.action.CALL", "-d", `tel:${number}`]));
  return { status: "dialing", toNumber: number };
}

/** KEYCODE_ENDCALL = 6. Same effect as pressing the phone's own "end
 * call" control, so this ends whatever call is currently active. */
export async function hangup() {
  await runAdb(withDevice(["shell", "input", "keyevent", "6"]));
  return { status: "ended" };
}
