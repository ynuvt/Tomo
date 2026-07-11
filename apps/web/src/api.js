const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(data?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function getCurrentUser() {
  return request("/auth/me");
}

export function registerUser(payload) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifyOtp(email, otp) {
  return request("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp }),
  });
}

export function loginUser(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logoutUser() {
  return request("/auth/logout", {
    method: "POST",
  });
}

export function searchUserByTag(tag) {
  const query = new URLSearchParams({ tag });
  return request(`/users/search?${query.toString()}`);
}

export function listConversations() {
  return request('/conversations');
}

export function createConversation(userId) {
  return request('/conversations', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function acceptConversation(conversationId) {
  return request(`/conversations/${conversationId}/accept`, {
    method: 'POST',
  });
}