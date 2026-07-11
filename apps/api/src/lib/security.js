const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const pbkdf2Iterations = 120000;

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  const binary = atob(base64);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function utf8ToBytes(value) {
  return textEncoder.encode(value);
}

function bytesToUtf8(bytes) {
  return textDecoder.decode(bytes);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function pbkdf2Hash(value, salt = randomBytes(16), iterations = pbkdf2Iterations) {
  const key = await crypto.subtle.importKey("raw", utf8ToBytes(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );

  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

async function verifyPbkdf2(value, storedHash) {
  const [kind, iterationsText, saltText, hashText] = storedHash.split("$");

  if (kind !== "pbkdf2" || !iterationsText || !saltText || !hashText) {
    return false;
  }

  const expectedHash = await pbkdf2Hash(
    value,
    base64UrlToBytes(saltText),
    Number(iterationsText),
  );

  return expectedHash === storedHash;
}

export async function hashPassword(password) {
  return pbkdf2Hash(password);
}

export async function verifyPassword(password, storedHash) {
  return verifyPbkdf2(password, storedHash);
}

export function generateOtp() {
  const digits = new Uint32Array(1);
  crypto.getRandomValues(digits);
  return String(digits[0] % 1_000_000).padStart(6, "0");
}

export async function hashOtp(otp) {
  return pbkdf2Hash(`otp:${otp}`);
}

export async function verifyOtp(otp, storedHash) {
  return verifyPbkdf2(`otp:${otp}`, storedHash);
}

function slugifyUsername(username) {
  return (
    username
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "user"
  );
}

export async function generateUniqueUserTag(db, username) {
  const base = slugifyUsername(username);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `${base}#${suffix}`;
    const existing = await db.prepare("SELECT 1 FROM users WHERE user_tag = ? LIMIT 1").bind(candidate).first();

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique user tag");
}

export async function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = bytesToBase64Url(utf8ToBytes(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const encodedPayload = bytesToBase64Url(utf8ToBytes(JSON.stringify(body)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey("raw", utf8ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, utf8ToBytes(signingInput));

  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyJwt(token, secret) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey("raw", utf8ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(encodedSignature),
    utf8ToBytes(signingInput),
  );

  if (!verified) {
    return null;
  }

  const payload = JSON.parse(bytesToUtf8(base64UrlToBytes(encodedPayload)));

  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}