import { badRequest, jsonResponse } from "../lib/http.js";

function normalizeTag(tag) {
  return String(tag || "").trim().toLowerCase();
}

export async function handleUsersRequest(request, env) {
  const url = new URL(request.url);
  const tag = normalizeTag(url.searchParams.get("tag") || url.searchParams.get("q"));
  const origin = env.CORS_ORIGIN || "*";

  if (request.method !== "GET") {
    return jsonResponse(
      {
        status: "error",
        message: "Method not allowed",
      },
      405,
      origin,
    );
  }

  if (!tag) {
    return badRequest("tag query parameter is required", origin);
  }

  const user = await env.DB.prepare(
    `SELECT id, username, display_name, user_tag, email_verified, created_at, updated_at
     FROM users
     WHERE LOWER(user_tag) = ?
     LIMIT 1`,
  )
    .bind(tag)
    .first();

  if (!user) {
    return jsonResponse(
      {
        status: "not_found",
        message: "No user found for that tag.",
      },
      404,
      origin,
    );
  }

  return jsonResponse(
    {
      status: "ok",
      user: {
        id: user.id,
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