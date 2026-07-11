import './styles.css';
import { acceptConversation, createConversation, getCurrentUser, listConversations, searchUserByTag } from './api.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="desktop-shell">
    <section class="window chrome sample-shell">
      <header class="titlebar">
        <div>
          <strong>Tomo</strong>
          <span>Cloudflare backend first, sample UI only</span>
        </div>
        <div class="status-pills">
          <span class="pill">Backend-first</span>
          <span class="pill">Sample UI</span>
          <span class="pill">Free-tier stack</span>
        </div>
      </header>

      <div class="sample-grid">
        <aside class="panel hero-panel">
          <h1>Backend first.</h1>
          <p>
            We are building the backend, Cloudflare connections, D1, auth,
            and R2 first. The full UI will come later.
          </p>

          <ul class="hero-list">
            <li>Cloudflare Workers API</li>
            <li>D1 database bindings</li>
            <li>JWT auth flow with cookies</li>
            <li>R2 placeholder for images and stickers</li>
          </ul>
        </aside>

        <section class="panel sample-panel">
          <h2>Connection checks</h2>
          <div class="status-stack">
            <div class="notice info" id="health-status">Health: pending</div>
            <div class="notice info" id="db-status">Database: pending</div>
            <div class="notice info" id="auth-status">Auth: pending</div>
          </div>

          <div class="search-block">
            <label class="field-label" for="tag-search">User tag search</label>
            <input id="tag-search" class="field" type="text" placeholder="ansh#4291" />
            <div class="notice info" id="search-result">Search: pending</div>
          </div>

          <div class="button-row">
            <button class="send-button" id="check-health" type="button">Check health</button>
            <button class="send-button" id="check-db" type="button">Check DB</button>
            <button class="ghost-button" id="check-auth" type="button">Check auth</button>
            <button class="ghost-button" id="check-search" type="button">Search user</button>
            <button class="ghost-button" id="check-conversations" type="button">Load chats</button>
          </div>

          <div class="search-block">
            <label class="field-label" for="conversation-user-id">Create conversation</label>
            <input id="conversation-user-id" class="field" type="text" placeholder="paste a user id" />
            <button class="ghost-button" id="create-conversation" type="button">Create / get chat</button>
            <div class="notice info" id="conversation-result">Conversation: pending</div>
          </div>

          <p class="hint">
            This screen is intentionally simple. It exists only so we can focus on backend and Cloudflare connections first.
          </p>
        </section>
      </div>
    </section>
  </main>
`;

const healthStatus = document.querySelector('#health-status');
const dbStatus = document.querySelector('#db-status');
const authStatus = document.querySelector('#auth-status');
const searchResult = document.querySelector('#search-result');
const tagSearch = document.querySelector('#tag-search');
const conversationResult = document.querySelector('#conversation-result');
const conversationUserId = document.querySelector('#conversation-user-id');
const healthButton = document.querySelector('#check-health');
const dbButton = document.querySelector('#check-db');
const authButton = document.querySelector('#check-auth');
const searchButton = document.querySelector('#check-search');
const conversationsButton = document.querySelector('#check-conversations');
const createConversationButton = document.querySelector('#create-conversation');

function setStatus(element, label, value, kind = 'info') {
  element.className = `notice ${kind}`;
  element.textContent = `${label}: ${value}`;
}

async function checkHealth() {
  try {
    const response = await fetch('/health');
    const data = await response.json();
    setStatus(healthStatus, 'Health', data.status || 'ok', 'success');
  } catch (error) {
    setStatus(healthStatus, 'Health', error.message || 'failed', 'error');
  }
}

async function checkDatabase() {
  try {
    const response = await fetch('/health/db');
    const data = await response.json();
    setStatus(dbStatus, 'Database', data.database || 'connected', 'success');
  } catch (error) {
    setStatus(dbStatus, 'Database', error.message || 'failed', 'error');
  }
}

async function checkAuth() {
  try {
    const result = await getCurrentUser();
    setStatus(authStatus, 'Auth', result.user?.email || 'session active', 'success');
  } catch (error) {
    setStatus(authStatus, 'Auth', error.message || 'not logged in yet', 'info');
  }
}

async function checkSearch() {
  const tag = String(tagSearch?.value || '').trim();

  if (!tag) {
    setStatus(searchResult, 'Search', 'enter a user tag first', 'error');
    return;
  }

  try {
    const result = await searchUserByTag(tag);
    setStatus(searchResult, 'Search', `${result.user.displayName} (${result.user.userTag})`, 'success');
  } catch (error) {
    setStatus(searchResult, 'Search', error.message || 'not found', 'info');
  }
}

async function loadConversations() {
  try {
    const result = await listConversations();
    setStatus(conversationResult, 'Conversation', `${result.conversations.length} loaded`, 'success');
  } catch (error) {
    setStatus(conversationResult, 'Conversation', error.message || 'failed', 'error');
  }
}

async function createOrGetConversation() {
  const userId = String(conversationUserId?.value || '').trim();

  if (!userId) {
    setStatus(conversationResult, 'Conversation', 'enter a user id first', 'error');
    return;
  }

  try {
    const result = await createConversation(userId);
    setStatus(conversationResult, 'Conversation', `${result.created ? 'created' : 'loaded'}: ${result.conversation.id}`, 'success');
  } catch (error) {
    setStatus(conversationResult, 'Conversation', error.message || 'failed', 'error');
  }
}

healthButton?.addEventListener('click', checkHealth);
dbButton?.addEventListener('click', checkDatabase);
authButton?.addEventListener('click', checkAuth);
searchButton?.addEventListener('click', checkSearch);
conversationsButton?.addEventListener('click', loadConversations);
createConversationButton?.addEventListener('click', createOrGetConversation);

checkHealth();
checkDatabase();
checkAuth();
