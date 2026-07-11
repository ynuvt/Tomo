import { handleAuthRequest } from "./routes/auth.js";
import { handleConversationsRequest } from "./routes/conversations.js";
import { handleUsersRequest } from "./routes/users.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
};

function buildCorsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(data, status = 200, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...jsonHeaders,
      ...buildCorsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function notImplemented(route, origin) {
  return jsonResponse(
    {
      status: "stub",
      route,
      message: "This endpoint is scaffolded and will be implemented next.",
    },
    501,
    origin,
  );
}

async function handleHealth(env) {
  return jsonResponse({
    status: "ok",
    service: "api",
    platform: "cloudflare-workers",
    appName: env.PUBLIC_APP_NAME ?? "Tomo",
  });
}

async function handleDbHealth(env) {
  if (!env.DB) {
    return jsonResponse(
      {
        status: "missing_binding",
        database: "DB",
        message: "Set up the D1 binding in wrangler.jsonc.",
      },
      500,
    );
  }

  const result = await env.DB.prepare("SELECT 1 AS ok").first();

  return jsonResponse({
    status: "ok",
    database: "connected",
    result,
  });
}

async function handleConfig(env) {
  return jsonResponse({
    status: "ok",
    bindings: {
      db: Boolean(env.DB),
      assets: Boolean(env.ASSETS),
    },
    publicVars: {
      appName: env.PUBLIC_APP_NAME ?? null,
      corsOrigin: env.CORS_ORIGIN ?? null,
    },
    placeholdersToFillLater: [
      "D1 database_id in wrangler.jsonc",
      "R2 bucket name in wrangler.jsonc",
      "CORS_ORIGIN for your deployed frontend URL",
      "JWT secret",
    ],
  });
}

export default {
  async fetch(request, env) {
    const origin = env.CORS_ORIGIN ?? "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return handleHealth(env);
    }

    if (url.pathname === "/health/db") {
      return handleDbHealth(env);
    }

    if (url.pathname === "/config") {
      return handleConfig(env);
    }

    if (url.pathname.startsWith("/auth")) {
      return handleAuthRequest(request, env);
    }

    if (url.pathname.startsWith("/users")) {
      return handleUsersRequest(request, env);
    }

    if (url.pathname.startsWith("/conversations")) {
      return handleConversationsRequest(request, env);
    }

    if (url.pathname.startsWith("/messages")) {
      return notImplemented(url.pathname, origin);
    }

    return jsonResponse(
      {
        status: "not_found",
        path: url.pathname,
      },
      404,
      origin,
    );
  },
};
