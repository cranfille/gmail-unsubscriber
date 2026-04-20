// ============================================================
// Gmail Unsubscriber - Background Service Worker
// ============================================================

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
];

// ── Auth ─────────────────────────────────────────────────────

function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: SCOPES }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('No token returned'));
      } else {
        resolve(token);
      }
    });
  });
}

function revokeToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ── Gmail API helpers ─────────────────────────────────────────

async function gmailFetch(token, path, options = {}) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    // Token expired — remove and let caller retry
    await revokeToken(token);
    throw new Error('AUTH_EXPIRED');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function findLatestMessage(token, sender) {
  const query = encodeURIComponent(`from:${sender}`);
  const data = await gmailFetch(token, `/messages?q=${query}&maxResults=1`);
  return data.messages?.[0]?.id || null;
}

async function getFullMessage(token, messageId) {
  return gmailFetch(token, `/messages/${messageId}?format=full`);
}

// ── Message parsing ───────────────────────────────────────────

function getHeader(message, name) {
  const headers = message.payload?.headers || [];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
}

function parseListUnsubscribeHeader(value) {
  if (!value) return { https: null, mailto: null };
  const httpsMatch = value.match(/<(https?:\/\/[^>]+)>/i);
  const mailtoMatch = value.match(/<mailto:([^>]+)>/i);
  return {
    https: httpsMatch?.[1]?.trim() || null,
    mailto: mailtoMatch?.[1]?.trim() || null,
  };
}

function decodeBase64Url(data) {
  try {
    return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

function extractBody(payload, mimeType) {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part, mimeType);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Finds the best unsubscribe URL in raw HTML using regex scoring.
 * Safe to run in a service worker (no DOM access).
 */
function findUnsubUrlInHtml(html) {
  const anchorRe = /<a[^>]+?href=["']([^"'#][^"']*?)["'][^>]*?>([\s\S]*?)<\/a>/gi;
  const candidates = [];
  let m;

  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!href.startsWith('http')) continue;

    let score = 0;
    if (/unsubscribe/i.test(href))            score += 12;
    if (/optout|opt[-_]out/i.test(href))      score +=  9;
    if (/remove/i.test(href))                 score +=  5;
    if (/unsubscribe from all/i.test(text))   score += 11;
    if (/unsubscribe/i.test(text))            score +=  8;
    if (/opt.?out/i.test(text))               score +=  6;
    if (/remove me/i.test(text))              score +=  4;

    if (score > 0) candidates.push({ href, text, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.href || null;
}

// ── One-click POST unsubscribe ────────────────────────────────

async function tryOneClickPost(url) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Browser automation (injected functions) ───────────────────

/** Injected into the unsubscribe landing page to find & click the button. */
function injected_findAndClickUnsubscribe() {
  const BUTTON_PATTERNS = [
    /unsubscribe from all communications/i,
    /unsubscribe from all/i,
    /unsubscribe all emails/i,
    /yes[,\s]+unsubscribe me/i,
    /yes[,\s]+unsubscribe/i,
    /confirm unsubscribe/i,
    /unsubscribe me/i,
    /remove me from/i,
    /^unsubscribe$/i,
    /opt[\s-]?out/i,
  ];

  const CONFIRM_PATTERNS = [
    /successfully unsubscribed/i,
    /you('ve| have) been unsubscribed/i,
    /you('ve| have) been removed/i,
    /unsubscribed successfully/i,
    /no longer (subscribed|receive)/i,
    /opted out/i,
    /removed from/i,
    /inactive/i,
  ];

  // Already unsubscribed?
  const bodyText = document.body?.innerText || '';
  if (CONFIRM_PATTERNS.some(p => p.test(bodyText))) {
    return { status: 'already_unsubscribed' };
  }

  // Find interactive elements
  const candidates = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
    ...document.querySelectorAll('a[href]'),
  ];

  for (const pattern of BUTTON_PATTERNS) {
    for (const el of candidates) {
      const label = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
      if (pattern.test(label)) {
        el.click();
        return { status: 'clicked', label: label.substring(0, 80) };
      }
    }
  }

  return { status: 'not_found', pageText: bodyText.substring(0, 300) };
}

/** Checks for success confirmation after clicking. */
function injected_checkConfirmation() {
  const CONFIRM_PATTERNS = [
    /successfully unsubscribed/i,
    /you('ve| have) been unsubscribed/i,
    /unsubscribed successfully/i,
    /you('ve| have) been removed/i,
    /no longer (subscribed|receive)/i,
    /opted out/i,
    /inactive/i,
    /removed from/i,
  ];

  const SECOND_STEP_PATTERNS = [/^confirm$/i, /^yes$/i, /^ok$/i, /continue/i];

  const bodyText = document.body?.innerText || '';
  const confirmed = CONFIRM_PATTERNS.some(p => p.test(bodyText));

  const buttons = [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')];
  const secondStep = buttons.find(b =>
    SECOND_STEP_PATTERNS.some(p => p.test((b.textContent || b.value || '').trim()))
  );

  if (secondStep && !confirmed) {
    secondStep.click();
    return { confirmed: false, clickedSecondStep: true };
  }

  return { confirmed, pageText: bodyText.substring(0, 200) };
}

// ── Tab-based unsubscribe flow ────────────────────────────────

async function navigateAndUnsubscribe(url) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });

    // Wait for load (max 20s)
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 20000);
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Extra wait for JS-heavy pages
    await delay(1800);

    // Try to find & click unsubscribe button
    let result = await execInTab(tab.id, injected_findAndClickUnsubscribe);

    if (result?.status === 'already_unsubscribed') {
      return { success: true, method: 'already_unsubscribed' };
    }

    if (result?.status === 'clicked') {
      await delay(2500);
      const confirm = await execInTab(tab.id, injected_checkConfirmation);
      if (confirm?.clickedSecondStep) {
        await delay(2000);
        const confirm2 = await execInTab(tab.id, injected_checkConfirmation);
        return { success: confirm2?.confirmed ?? true, method: 'click_two_step' };
      }
      return { success: confirm?.confirmed ?? true, method: 'click', label: result.label };
    }

    return { success: false, error: 'No unsubscribe button found on page' };

  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (tab) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

async function execInTab(tabId, func) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    });
    return results?.[0]?.result || null;
  } catch (err) {
    return { error: err.message };
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Core unsubscribe logic ────────────────────────────────────

async function unsubscribeOne(token, sender) {
  // 1. Find most recent email from sender
  const messageId = await findLatestMessage(token, sender);
  if (!messageId) {
    return { success: false, error: 'No emails found from this sender' };
  }

  // 2. Fetch full message
  const message = await getFullMessage(token, messageId);

  // 3. Check List-Unsubscribe header first (most reliable)
  const listUnsub = getHeader(message, 'List-Unsubscribe');
  const listUnsubPost = getHeader(message, 'List-Unsubscribe-Post');
  const { https: headerUrl } = parseListUnsubscribeHeader(listUnsub);

  if (headerUrl) {
    // 3a. Try RFC 8058 one-click POST (no UI required)
    if (listUnsubPost && /one-click/i.test(listUnsubPost)) {
      const ok = await tryOneClickPost(headerUrl);
      if (ok) return { success: true, method: 'one_click_post' };
    }

    // 3b. Navigate and click
    const result = await navigateAndUnsubscribe(headerUrl);
    if (result.success) return result;
  }

  // 4. Fall back to parsing HTML body
  const html = extractBody(message.payload, 'text/html');
  if (html) {
    const bodyUrl = findUnsubUrlInHtml(html);
    if (bodyUrl) {
      const result = await navigateAndUnsubscribe(bodyUrl);
      if (result.success) return result;
    }
  }

  // 5. Try plain text body
  const text = extractBody(message.payload, 'text/plain');
  if (text) {
    const urlMatch = text.match(/https?:\/\/[^\s<>"]+unsubscribe[^\s<>"]+/i) ||
                     text.match(/https?:\/\/[^\s<>"]+optout[^\s<>"]+/i);
    if (urlMatch) {
      const result = await navigateAndUnsubscribe(urlMatch[0]);
      if (result.success) return result;
    }
  }

  return { success: false, error: 'Could not find a valid unsubscribe link' };
}

// ── Job orchestration ─────────────────────────────────────────

async function runJob(senders) {
  let token;

  try {
    token = await getToken(true);
  } catch (err) {
    broadcast({ type: 'error', message: `Authentication failed: ${err.message}` });
    return;
  }

  broadcast({ type: 'started', total: senders.length });

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < senders.length; i++) {
    const sender = senders[i].trim();
    if (!sender) continue;

    broadcast({ type: 'processing', sender, index: i, total: senders.length });

    try {
      // Refresh token if needed (service workers can be terminated)
      if (i > 0 && i % 10 === 0) {
        try { token = await getToken(false); } catch {}
      }

      const result = await unsubscribeOne(token, sender);

      if (result.success) succeeded++;
      else failed++;

      broadcast({ type: 'result', sender, index: i, total: senders.length, ...result });

    } catch (err) {
      failed++;
      broadcast({ type: 'result', sender, index: i, total: senders.length, success: false, error: err.message });
    }

    // Polite delay between senders
    await delay(600);
  }

  broadcast({ type: 'complete', total: senders.length, succeeded, failed });

  // Persist final summary
  await chrome.storage.local.set({
    lastRun: { timestamp: Date.now(), total: senders.length, succeeded, failed }
  });
}

function broadcast(data) {
  chrome.runtime.sendMessage(data).catch(() => {
    // Popup is closed — save state so it can restore on reopen
    chrome.storage.local.set({ pendingUpdate: data });
  });
}

// ── Message listener ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'start') {
    runJob(message.senders);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'auth_check') {
    getToken(false)
      .then(() => sendResponse({ authenticated: true }))
      .catch(() => sendResponse({ authenticated: false }));
    return true; // async
  }

  if (message.type === 'auth_login') {
    getToken(true)
      .then(() => sendResponse({ authenticated: true }))
      .catch(err => sendResponse({ authenticated: false, error: err.message }));
    return true;
  }

  if (message.type === 'auth_logout') {
    getToken(false)
      .then(token => revokeToken(token))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }
});
