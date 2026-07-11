import { badRequest, forbidden, jsonResponse, notFound, readJsonBody, unauthorized, getCookie } from "../lib/http.js";
import { verifyJwt } from "../lib/security.js";

function authCookieName(env) {
  return env.JWT_COOKIE_NAME || "tomo_auth";
}

function requireJwtSecret(env) {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from dev vars or Cloudflare secrets");
  }

  return env.JWT_SECRET;
}

async function loadCurrentUser(env, userId) {
  return env.DB.prepare(
    "SELECT id, email, username, display_name, user_tag, email_verified, created_at, updated_at FROM users WHERE id = ? LIMIT 1",
  )
    .bind(userId)
    .first();
}

async function getAuthenticatedUser(request, env, origin) {
  const token = getCookie(request, authCookieName(env));

  if (!token) {
    return { error: unauthorized("Not logged in", origin) };
  }

  const payload = await verifyJwt(token, requireJwtSecret(env));

  if (!payload?.sub) {
    return { error: unauthorized("Invalid session", origin) };
  }

  const user = await loadCurrentUser(env, payload.sub);

  if (!user) {
    return { error: unauthorized("User no longer exists", origin) };
  }

  return { user };
}

async function getConversationSummary(env, conversationId, currentUserId) {
  const conversation = await env.DB.prepare(
    "SELECT id, last_message_at, created_at, updated_at FROM conversations WHERE id = ? LIMIT 1",
  )
    .bind(conversationId)
    .first();

  if (!conversation) {
    return null;
  }

  const participants = await env.DB.prepare(
    `SELECT cp.user_id, cp.accepted, u.username, u.display_name, u.user_tag
     FROM conversation_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.conversation_id = ?
     ORDER BY cp.user_id ASC`,
  )
    .bind(conversationId)
    .all();

  const lastMessage = await env.DB.prepare(
    `SELECT id, sender_id, body, created_at, read_at
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(conversationId)
    .first();

  const otherParticipant = participants.results.find((participant) => participant.user_id !== currentUserId) || null;
  const currentParticipant = participants.results.find((participant) => participant.user_id === currentUserId) || null;

  return {
    id: conversation.id,
    lastMessageAt: conversation.last_message_at,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    accepted: Boolean(currentParticipant?.accepted),
    requestStatus: currentParticipant?.accepted ? "accepted" : "pending",
    participantCount: participants.results.length,
    otherUser: otherParticipant
      ? {
          id: otherParticipant.user_id,
          username: otherParticipant.username,
          displayName: otherParticipant.display_name,
          userTag: otherParticipant.user_tag,
        }
      : null,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          senderId: lastMessage.sender_id,
          body: lastMessage.body,
          createdAt: lastMessage.created_at,
          readAt: lastMessage.read_at,
        }
      : null,
  };
}

async function listConversations(env, userId) {
  const participantRows = await env.DB.prepare(
    `SELECT conversation_id, accepted
     FROM conversation_participants
     WHERE user_id = ?
     ORDER BY conversation_id DESC`,
  )
    .bind(userId)
    .all();

  const summaries = [];

  for (const row of participantRows.results) {
    const summary = await getConversationSummary(env, row.conversation_id, userId);
    if (summary) {
      summaries.push(summary);
    }
  }

  summaries.sort((left, right) => {
    const leftTime = new Date(left.lastMessageAt || left.updatedAt || left.createdAt).getTime();
    const rightTime = new Date(right.lastMessageAt || right.updatedAt || right.createdAt).getTime();
    return rightTime - leftTime;
  });

  return summaries;
}

async function handleListConversations(request, env, origin) {
  const { user, error } = await getAuthenticatedUser(request, env, origin);

  if (error) {
    return error;
  }

  const conversations = await listConversations(env, user.id);

  return jsonResponse(
    {
      status: "ok",
      conversations,
    },
    200,
    origin,
  );
}

async function handleCreateConversation(request, env, origin) {
  const { user, error } = await getAuthenticatedUser(request, env, origin);

  if (error) {
    return error;
  }

  const body = await readJsonBody(request);
  const otherUserId = String(body.userId || body.otherUserId || "").trim();

  if (!otherUserId) {
    return badRequest("userId is required", origin);
  }

  if (otherUserId === user.id) {
    return badRequest("You cannot start a conversation with yourself", origin);
  }

  const targetUser = await env.DB.prepare(
    "SELECT id, username, display_name, user_tag FROM users WHERE id = ? LIMIT 1",
  )
    .bind(otherUserId)
    .first();

  if (!targetUser) {
    return notFound("No user found for that id", origin);
  }

  const existingConversation = await env.DB.prepare(
    `SELECT conversation_id
     FROM conversation_participants
     WHERE user_id IN (?, ?)
     GROUP BY conversation_id
     HAVING COUNT(*) = 2
     LIMIT 1`,
  )
    .bind(user.id, otherUserId)
    .first();

  if (existingConversation) {
    const summary = await getConversationSummary(env, existingConversation.conversation_id, user.id);

    return jsonResponse(
      {
        status: "ok",
        conversation: summary,
        created: false,
      },
      200,
      origin,
    );
  }

  const conversationId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO conversations (id, last_message_at, created_at, updated_at)
       VALUES (?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(conversationId),
    env.DB.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, accepted)
       VALUES (?, ?, 1)`,
    ).bind(conversationId, user.id),
    env.DB.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, accepted)
       VALUES (?, ?, 0)`,
    ).bind(conversationId, otherUserId),
  ]);

  const summary = await getConversationSummary(env, conversationId, user.id);

  return jsonResponse(
    {
      status: "ok",
      conversation: summary,
      created: true,
    },
    201,
    origin,
  );
}

async function handleAcceptConversation(request, env, origin, conversationId) {
  const { user, error } = await getAuthenticatedUser(request, env, origin);

  if (error) {
    return error;
  }

  const participant = await env.DB.prepare(
    `SELECT accepted
     FROM conversation_participants
     WHERE conversation_id = ? AND user_id = ?
     LIMIT 1`,
  )
    .bind(conversationId, user.id)
    .first();

  if (!participant) {
    return forbidden("You are not part of this conversation", origin);
  }

  if (participant.accepted) {
    const summary = await getConversationSummary(env, conversationId, user.id);

    return jsonResponse(
      {
        status: "ok",
        conversation: summary,
        alreadyAccepted: true,
      },
      200,
      origin,
    );
  }

  await env.DB.prepare(
    `UPDATE conversation_participants
     SET accepted = 1
     WHERE conversation_id = ? AND user_id = ?`,
  )
    .bind(conversationId, user.id)
    .run();

  const summary = await getConversationSummary(env, conversationId, user.id);

  return jsonResponse(
    {
      status: "ok",
      conversation: summary,
      accepted: true,
    },
    200,
    origin,
  );
}

export async function handleConversationsRequest(request, env) {
  const origin = env.CORS_ORIGIN || "*";
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/conversations/, "") || "/";

  if (request.method === "GET" && path === "/") {
    return handleListConversations(request, env, origin);
  }

  if (request.method === "POST" && path === "/") {
    return handleCreateConversation(request, env, origin);
  }

  const acceptMatch = path.match(/^\/([^/]+)\/accept$/);

  if (request.method === "POST" && acceptMatch) {
    return handleAcceptConversation(request, env, origin, acceptMatch[1]);
  }

  return jsonResponse(
    {
      status: "error",
      message: `Unknown conversation route: ${path}`,
    },
    404,
    origin,
  );
}