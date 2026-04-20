// ============================================================
// Gmail Unsubscriber — Popup Script
// ============================================================

const $ = id => document.getElementById(id);

// ── State ─────────────────────────────────────────────────────

let isRunning = false;
let processedCount = 0;
let totalCount = 0;

// ── DOM refs ──────────────────────────────────────────────────

const authStatus    = $('auth-status');
const authLabel     = $('auth-label');
const screenAuth    = $('screen-auth');
const screenInput   = $('screen-input');
const screenProgress = $('screen-progress');
const senderList    = $('sender-list');
const senderCount   = $('sender-count');
const btnStart      = $('btn-start');
const btnPaste      = $('btn-paste');
const btnClear      = $('btn-clear');
const btnLogout     = $('btn-logout');
const btnLogin      = $('btn-login');
const btnNewRun     = $('btn-new-run');
const progressBar   = $('progress-bar');
const statDone      = $('stat-done');
const statTotal     = $('stat-total');
const log           = $('log');

// ── Auth ──────────────────────────────────────────────────────

function setAuthState(connected) {
  authStatus.className = `auth-badge ${connected ? 'auth-connected' : 'auth-disconnected'}`;
  authLabel.textContent = connected ? 'Connected' : 'Signed out';

  if (connected) {
    showScreen('input');
  } else {
    showScreen('auth');
  }
}

async function checkAuth() {
  authStatus.className = 'auth-badge auth-unknown';
  authLabel.textContent = 'Checking...';
  const res = await msg({ type: 'auth_check' });
  setAuthState(res?.authenticated === true);
}

// ── Navigation ────────────────────────────────────────────────

function showScreen(name) {
  screenAuth.style.display    = name === 'auth'     ? '' : 'none';
  screenInput.style.display   = name === 'input'    ? '' : 'none';
  screenProgress.style.display = name === 'progress' ? '' : 'none';
}

// ── Sender list helpers ───────────────────────────────────────

function getSenders() {
  return senderList.value
    .split('\n')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.includes('@'));
}

function updateCount() {
  const n = getSenders().length;
  senderCount.textContent = n;
  btnStart.disabled = n === 0 || isRunning;
}

// ── Log helpers ───────────────────────────────────────────────

function logRow(type, icon, sender, statusText) {
  const row = document.createElement('div');
  row.className = `log-row ${type}`;
  row.innerHTML = `
    <span class="log-icon">${icon}</span>
    <span class="log-sender" title="${escHtml(sender)}">${escHtml(truncate(sender, 36))}</span>
    <span class="log-status">${escHtml(statusText)}</span>
  `;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

function logSummary(succeeded, failed, total) {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `
    <div class="log-summary">
      Done &mdash; <strong style="color:var(--green)">${succeeded} succeeded</strong>,
      <strong style="color:var(--red)">${failed} failed</strong>
      out of <strong>${total}</strong>
    </div>
  `;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

const processingRows = {};

function methodLabel(method) {
  const map = {
    one_click_post:   'one-click',
    click:            'clicked',
    click_two_step:   'two-step',
    already_unsubscribed: 'already done',
  };
  return map[method] || 'ok';
}

// ── Progress update handler ───────────────────────────────────

function handleUpdate(data) {
  switch (data.type) {
    case 'started':
      totalCount = data.total;
      processedCount = 0;
      statTotal.textContent = data.total;
      statDone.textContent = '0';
      progressBar.style.width = '0%';
      log.innerHTML = '';
      break;

    case 'processing':
      processingRows[data.sender] = logRow('processing', '◌', data.sender, 'working…');
      break;

    case 'result': {
      processedCount++;
      const prev = processingRows[data.sender];
      if (prev) prev.remove();
      delete processingRows[data.sender];

      if (data.success) {
        logRow('success', '✓', data.sender, methodLabel(data.method));
      } else {
        logRow('error', '✗', data.sender, data.error?.substring(0, 30) || 'failed');
      }

      statDone.textContent = processedCount;
      progressBar.style.width = `${Math.round((processedCount / totalCount) * 100)}%`;
      break;
    }

    case 'complete':
      isRunning = false;
      logSummary(data.succeeded, data.failed, data.total);
      btnNewRun.style.display = '';
      break;

    case 'error':
      logRow('error', '!', 'Error', data.message);
      isRunning = false;
      btnNewRun.style.display = '';
      break;
  }
}

// ── Message passing ───────────────────────────────────────────

function msg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (res) => {
      resolve(res);
    });
  });
}

chrome.runtime.onMessage.addListener((data) => {
  if (screenProgress.style.display !== 'none') {
    handleUpdate(data);
  }
});

// ── Event handlers ────────────────────────────────────────────

btnLogin.addEventListener('click', async () => {
  btnLogin.disabled = true;
  btnLogin.textContent = 'Signing in…';
  const res = await msg({ type: 'auth_login' });
  if (res?.authenticated) {
    setAuthState(true);
  } else {
    btnLogin.disabled = false;
    btnLogin.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"/></svg>
      Sign in with Google`;
    alert('Sign-in failed. Make sure a valid Client ID is set in manifest.json.');
  }
});

btnLogout.addEventListener('click', async () => {
  await msg({ type: 'auth_logout' });
  setAuthState(false);
});

btnPaste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    senderList.value = text;
    updateCount();
  } catch {
    senderList.focus();
    document.execCommand('paste');
    updateCount();
  }
});

btnClear.addEventListener('click', () => {
  senderList.value = '';
  updateCount();
});

senderList.addEventListener('input', updateCount);

btnStart.addEventListener('click', async () => {
  const senders = getSenders();
  if (!senders.length) return;

  isRunning = true;
  btnStart.disabled = true;
  btnNewRun.style.display = 'none';
  showScreen('progress');

  await msg({ type: 'start', senders });
});

btnNewRun.addEventListener('click', () => {
  isRunning = false;
  showScreen('input');
  updateCount();
});

// ── Utils ─────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.substring(0, n - 1) + '…' : str;
}

// ── Init ──────────────────────────────────────────────────────

checkAuth();
updateCount();
