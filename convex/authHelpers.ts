const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 120000;
const JWT_ISSUER = "nearbytes";
const JWT_DEFAULT_SECRET = "dev-secret-change-me";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const SUPPORTED_ROLES = ["customer", "owner", "moderator"] as const;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function getJwtSecret() {
  const env = (globalThis as any).process?.env || {};
  return String(env.JWT_SECRET || JWT_DEFAULT_SECRET);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const bits = (first << 16) | (second << 8) | third;

    output += BASE64URL_ALPHABET[(bits >> 18) & 63];
    output += BASE64URL_ALPHABET[(bits >> 12) & 63];
    if (index + 1 < bytes.length) {
      output += BASE64URL_ALPHABET[(bits >> 6) & 63];
    }
    if (index + 2 < bytes.length) {
      output += BASE64URL_ALPHABET[bits & 63];
    }
  }

  return output;
}

function base64UrlToBytes(value: string) {
  const cleaned = String(value || "").replace(/=+$/, "");
  const bytes: number[] = [];

  for (let index = 0; index < cleaned.length; index += 4) {
    const chunk = cleaned.slice(index, index + 4);
    const values = chunk.split("").map((character) => BASE64URL_ALPHABET.indexOf(character));
    if (values.some((entry) => entry < 0)) {
      throw new Error("Invalid base64url payload.");
    }

    const first = values[0] ?? 0;
    const second = values[1] ?? 0;
    const third = values[2] ?? 0;
    const fourth = values[3] ?? 0;
    const bits = (first << 18) | (second << 12) | (third << 6) | fourth;

    bytes.push((bits >> 16) & 255);
    if (chunk.length > 2) {
      bytes.push((bits >> 8) & 255);
    }
    if (chunk.length > 3) {
      bytes.push(bits & 255);
    }
  }

  return new Uint8Array(bytes);
}

function encodeJwtPart(value: Record<string, any>) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJwtPart(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

async function signJwt(unsignedToken: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getJwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedToken));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function issueSessionJwt(userId: any, sessionId: string, expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();
  const header = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const payload = encodeJwtPart({
    iss: JWT_ISSUER,
    sub: String(userId),
    sid: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAtMs / 1000),
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = await signJwt(unsignedToken);

  return `${unsignedToken}.${signature}`;
}

async function verifySessionJwt(sessionToken: string) {
  const parts = String(sessionToken || "").split(".");
  if (parts.length !== 3) {
    return false;
  }

  try {
    const payload = decodeJwtPart(parts[1]);
    const expiresAtSeconds = Number(payload?.exp || 0);
    if (payload?.iss !== JWT_ISSUER || !Number.isFinite(expiresAtSeconds)) {
      return false;
    }
    if (expiresAtSeconds * 1000 <= Date.now()) {
      return false;
    }

    const expectedSignature = await signJwt(`${parts[0]}.${parts[1]}`);
    return constantTimeEqual(expectedSignature, parts[2]);
  } catch (_error) {
    return false;
  }
}

function normalizeWhitespace(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeEmail(email: string) {
  return normalizeWhitespace(email).toLowerCase();
}

export function normalizeDisplayName(displayName: string, email: string) {
  const cleaned = normalizeWhitespace(displayName);
  if (cleaned) {
    return cleaned.slice(0, 80);
  }

  const fallback = normalizeEmail(email).split("@")[0] || "Nearby Bites User";
  return fallback.slice(0, 80);
}

export function normalizeRole(role: string) {
  const normalized = normalizeWhitespace(role).toLowerCase();
  if (SUPPORTED_ROLES.includes(normalized as (typeof SUPPORTED_ROLES)[number])) {
    return normalized as (typeof SUPPORTED_ROLES)[number];
  }

  return "customer";
}

export function validatePassword(password: string) {
  const trimmed = String(password || "");
  if (trimmed.length < 8) {
    throw new Error("Use a password with at least 8 characters.");
  }

  return trimmed;
}

export function normalizeOptionalString(value: unknown, maxLength = 2000) {
  const cleaned = normalizeWhitespace(String(value || ""));
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function normalizeTagList(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) =>
            String(entry || "")
              .trim()
              .toLowerCase()
              .replace(/[_\s]+/g, "-"),
          )
          .filter(Boolean),
      ),
    );
  }

  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((entry) =>
          entry
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, "-"),
        )
        .filter(Boolean),
    ),
  );
}

export function normalizeHttpUrl(value: unknown) {
  const cleaned = normalizeOptionalString(value, 1000);
  if (!cleaned) {
    return null;
  }

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http and https URLs are supported.");
    }

    return parsed.toString();
  } catch (_error) {
    throw new Error("Enter a valid http or https URL.");
  }
}

export function normalizePrice(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Enter a valid non-negative price.");
  }

  return Number(parsed.toFixed(2));
}

export function normalizeLatLng(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sessionExpiryIso() {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

export function presentUser(user: Record<string, any>) {
  return {
    id: user._id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isBanned: Boolean(user.isBanned),
    bannedAt: user.bannedAt || null,
    bannedReason: user.bannedReason || null,
  };
}

export async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(password: string, salt: string) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return bytesToHex(new Uint8Array(bits));
}

export function generateRandomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function issueSession(ctx: any, userId: any) {
  const existingSessions = await ctx.db
    .query("sessions")
    .withIndex("by_user_id", (query: any) => query.eq("userId", userId))
    .collect();
  const now = Date.now();
  const activeSessions = existingSessions
    .filter((session: any) => {
      const expiresAt = new Date(session.expiresAt).getTime();
      return Number.isFinite(expiresAt) && expiresAt > now;
    })
    .sort((left: any, right: any) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
    );

  for (const session of existingSessions) {
    const expiresAt = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      await ctx.db.delete(session._id);
    }
  }

  for (const session of activeSessions.slice(4)) {
    await ctx.db.delete(session._id);
  }

  const sessionId = generateRandomHex(16);
  const expiresAt = sessionExpiryIso();
  const sessionToken = await issueSessionJwt(userId, sessionId, expiresAt);
  const tokenHash = await sha256Hex(sessionToken);
  await ctx.db.insert("sessions", {
    userId,
    tokenHash,
    createdAt: nowIso(),
    expiresAt,
  });

  return sessionToken;
}

export async function resolveSession(ctx: any, sessionToken: string | undefined | null) {
  const trimmed = String(sessionToken || "").trim();
  if (!trimmed) {
    return null;
  }

  if (!(await verifySessionJwt(trimmed))) {
    return null;
  }

  const tokenHash = await sha256Hex(trimmed);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token_hash", (query: any) => query.eq("tokenHash", tokenHash))
    .unique();

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = await ctx.db.get(session.userId);
  if (!user) {
    return null;
  }

  if (user.isBanned) {
    return null;
  }

  return { session, user };
}

export async function requireUser(ctx: any, sessionToken: string | undefined | null) {
  const result = await resolveSession(ctx, sessionToken);
  if (!result?.user) {
    throw new Error("Please sign in to continue.");
  }

  if (result.user.isBanned) {
    throw new Error("This account has been suspended.");
  }

  return result;
}

export async function requireRole(
  ctx: any,
  sessionToken: string | undefined | null,
  roles: string[],
) {
  const result = await requireUser(ctx, sessionToken);
  if (!roles.includes(result.user.role)) {
    throw new Error("You do not have permission for that action.");
  }

  return result;
}

export async function invalidateSession(ctx: any, sessionToken: string | undefined | null) {
  const trimmed = String(sessionToken || "").trim();
  if (!trimmed) {
    return;
  }

  const tokenHash = await sha256Hex(trimmed);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token_hash", (query: any) => query.eq("tokenHash", tokenHash))
    .unique();

  if (session) {
    await ctx.db.delete(session._id);
  }
}
