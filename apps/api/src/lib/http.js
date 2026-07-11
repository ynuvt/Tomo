export function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function jsonResponse(data, status = 200, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());

  for (const cookie of cookies) {
    if (!cookie) continue;

    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = cookie.slice(0, separatorIndex);
    if (key !== name) continue;

    return cookie.slice(separatorIndex + 1);
  }

  return null;
}

export function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  parts.push(`Path=${options.path || "/"}`);

  return parts.join("; ");
}

export function clearCookie(name, options = {}) {
  return buildCookie(name, "", {
    ...options,
    maxAge: 0,
  });
}

export function badRequest(message, origin) {
  return jsonResponse({ status: "error", message }, 400, origin);
}

export function unauthorized(message, origin) {
  return jsonResponse({ status: "error", message }, 401, origin);
}

export function forbidden(message, origin) {
  return jsonResponse({ status: "error", message }, 403, origin);
}

export function notFound(message, origin) {
  return jsonResponse({ status: "error", message }, 404, origin);
}