import {
  badRequest,
  buildCookie,
  clearCookie,
  forbidden,
  getCookie,
  jsonResponse,
  notFound,
  readJsonBody,
  unauthorized,
} from "../lib/http.js";
import {
  generateOtp,
  generateUniqueUserTag,
  hashOtp,
  hashPassword,
  signJwt,
  verifyJwt,
  verifyOtp,
  verifyPassword,
} from "../lib/security.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function normalizeDisplayName(displayName) {
  return String(displayName || "").trim();
}

function normalizePassword(password) {
  return String(password || "");
}

function authCookieName(env) {
  return env.JWT_COOKIE_NAME || "tomo_auth";
}

function authCookieOptions(request) {
  const url = new URL(request.url);
  return {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
    path: "/",
  };
}

function requireJwtSecret(env) {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from dev vars or Cloudflare secrets");
  }

  return env.JWT_SECRET;
}

async function sendVerificationEmail(env, { to, displayName, otp }) {
  if (!env.EMAIL_PROVIDER_API_KEY || !env.EMAIL_FROM) {
    return { sent: false, reason: "missing_email_provider" };
  }

  if ((env.EMAIL_PROVIDER || "resend") !== "resend") {
    return { sent: false, reason: "unsupported_provider" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `Verify your ${env.PUBLIC_APP_NAME || "Tomo"} account`,
      html: `<p>Hi ${displayName},</p><p>Your verification code is:</p><h2>${otp}</h2><p>This code expires in ${env.OTP_TTL_MINUTES || 15} minutes.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider failed with status ${response.status}`);
  }

  return { sent: true };
}

async function loadCurrentUser(env, userId) {
  return env.DB.prepare(
    "SELECT id, email, username, display_name, user_tag, email_verified, created_at, updated_at FROM users WHERE id = ? LIMIT 1",
  )
    .bind(userId)
    .first();
}

async function handleRegister(request, env, origin) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const displayName = normalizeDisplayName(body.displayName);
  const password = normalizePassword(body.password);

  if (!email || !username || !displayName || !password) {
    return badRequest("email, username, displayName, and password are required", origin);
  }

  if (password.length < 8) {
    return badRequest("password must be at least 8 characters long", origin);
  }

  const existing = await env.DB.prepare(
    "SELECT id, email, username FROM users WHERE email = ? OR username = ? LIMIT 1",
  )
    .bind(email, username)
    .first();

  if (existing) {
    return jsonResponse(
      {
        status: "error",
        message: "An account already exists with that email or username.",
      },
      409,
      origin,
    );
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const userTag = await generateUniqueUserTag(env.DB, username);
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + Number(env.OTP_TTL_MINUTES || 15) * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, email, username, display_name, user_tag, password_hash, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(id, email, username, displayName, userTag, passwordHash)
    .run();

  await env.DB.prepare(
    `INSERT INTO email_otps (id, user_id, otp_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
  )
    .bind(crypto.randomUUID(), id, otpHash, expiresAt)
    .run();

  const emailResult = await sendVerificationEmail(env, { to: email, displayName, otp });
  const responseBody = {
    status: "ok",
    message: "Account created. Verify your email to continue.",
    emailVerificationRequired: true,
  };

  if (emailResult.sent) {
    responseBody.emailSent = true;
  }

  if (env.DEBUG_RETURN_OTP === "1") {
    responseBody.debugOtp = otp;
  }

  return jsonResponse(responseBody, 201, origin);
}

async function handleVerifyOtp(request, env, origin) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || "").trim();

  if (!email || !otp) {
    return badRequest("email and otp are required", origin);
  }

  const user = await env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first();

  if (!user) {
    return notFound("No account found for that email", origin);
  }

  if (user.email_verified) {
    return jsonResponse({ status: "ok", message: "Email is already verified." }, 200, origin);
  }

  const otpRecord = await env.DB.prepare(
    `SELECT id, otp_hash, expires_at, used_at
     FROM email_otps
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(user.id)
    .first();

  if (!otpRecord) {
    return badRequest("No verification code found. Register again to get a new one.", origin);
  }

  if (otpRecord.used_at) {
    return badRequest("That verification code was already used.", origin);
  }

  if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
    return badRequest("That verification code has expired.", origin);
  }

  const matches = await verifyOtp(otp, otpRecord.otp_hash);

  if (!matches) {
    return forbidden("Invalid verification code.", origin);
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id),
    env.DB.prepare("UPDATE email_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(otpRecord.id),
  ]);

  return jsonResponse(
    {
      status: "ok",
      message: "Email verified successfully.",
    },
    200,
    origin,
  );
}

async function handleLogin(request, env, origin) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);

  if (!email || !password) {
    return badRequest("email and password are required", origin);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, username, display_name, user_tag, password_hash, email_verified, created_at, updated_at FROM users WHERE email = ? LIMIT 1",
  )
    .bind(email)
    .first();

  if (!user) {
    return unauthorized("Invalid email or password", origin);
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    return unauthorized("Invalid email or password", origin);
  }

  if (!user.email_verified) {
    return forbidden("Please verify your email before logging in.", origin);
  }

  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      userTag: user.user_tag,
    },
    requireJwtSecret(env),
  );

  return jsonResponse(
    {
      status: "ok",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        userTag: user.user_tag,
        emailVerified: Boolean(user.email_verified),
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    },
    200,
    origin,
    {
      "set-cookie": buildCookie(authCookieName(env), token, authCookieOptions(request)),
    },
  );
}

async function handleMe(request, env, origin) {
  const token = getCookie(request, authCookieName(env));

  if (!token) {
    return unauthorized("Not logged in", origin);
  }

  const payload = await verifyJwt(token, requireJwtSecret(env));

  if (!payload?.sub) {
    return unauthorized("Invalid session", origin);
  }

  const user = await loadCurrentUser(env, payload.sub);

  if (!user) {
    return unauthorized("User no longer exists", origin);
  }

  return jsonResponse(
    {
      status: "ok",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        userTag: user.user_tag,
        emailVerified: Boolean(user.email_verified),
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    },
    200,
    origin,
  );
}

async function handleLogout(request, env, origin) {
  return jsonResponse(
    {
      status: "ok",
      message: "Logged out",
    },
    200,
    origin,
    {
      "set-cookie": clearCookie(authCookieName(env), authCookieOptions(request)),
    },
  );
}

export async function handleAuthRequest(request, env) {
  const origin = env.CORS_ORIGIN || "*";
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/auth/, "") || "/";

  if (request.method === "POST" && path === "/register") {
    return handleRegister(request, env, origin);
  }

  if (request.method === "POST" && path === "/verify-otp") {
    return handleVerifyOtp(request, env, origin);
  }

  if (request.method === "POST" && path === "/login") {
    return handleLogin(request, env, origin);
  }

  if (request.method === "GET" && path === "/me") {
    return handleMe(request, env, origin);
  }

  if (request.method === "POST" && path === "/logout") {
    return handleLogout(request, env, origin);
  }

  return notFound(`Unknown auth route: ${path}`, origin);
}