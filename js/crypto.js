export function b64ToBytes(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function derivedKeyName(dataset) {
  return `solar.derivedKey.v1.${dataset}`;
}

export function readDerivedKey(dataset) {
  try {
    const raw = localStorage.getItem(derivedKeyName(dataset));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.salt_b64 !== "string" || typeof parsed.key_b64 !== "string") {
      return null;
    }
    return { salt_b64: parsed.salt_b64, key_b64: parsed.key_b64 };
  } catch {
    return null;
  }
}

export function writeDerivedKey(dataset, saltB64, keyB64) {
  localStorage.setItem(derivedKeyName(dataset), JSON.stringify({
    v: 1,
    salt_b64: saltB64,
    key_b64: keyB64,
  }));
}

export function clearDerivedKey(dataset) {
  try {
    localStorage.removeItem(derivedKeyName(dataset));
  } catch {
    /* el almacenamiento puede estar bloqueado */
  }
}

function formatError() {
  const error = new Error("formato");
  error.code = "format";
  return error;
}

function passwordError() {
  const error = new Error("password");
  error.code = "password";
  return error;
}

export async function importStoredKey(keyB64) {
  return crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
}

export async function decryptWithKey(envelope, key) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(envelope.iv_b64) },
      key,
      b64ToBytes(envelope.ct_b64),
    );
  } catch {
    throw passwordError();
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    const error = new Error("parse");
    error.code = "parse";
    throw error;
  }
}

export async function decryptWithPassword(envelope, password, { extractable = false } = {}) {
  const iterations = envelope.iter;
  if (!Number.isInteger(iterations) || iterations < 1) throw formatError();
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(envelope.salt_b64), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    extractable,
    ["decrypt"],
  );
  const data = await decryptWithKey(envelope, key);
  return { data, key };
}
