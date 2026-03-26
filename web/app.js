/** @typedef {{ branch: string, changed_files: number }} Status */
/** @typedef {{ hash: string, subject: string, author: string }} Commit */
/** @typedef {{ label: string, type?: string }} Action */
/** @typedef {{ status: Status, diff: string, commits: Commit[], actions: Action[] }} Snapshot */
/** @typedef {{ type: 'update', status: Status, diff?: string | null } | { type: 'error', message: string }} WsMessage */

/** @param {string} id */
function mustEl(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element: ${id}`);
  return node;
}

const branchEl = mustEl('branch');
const diffEl = mustEl('diff');
const commitsEl = mustEl('commits');
const actionsEl = mustEl('actions');

let currentDiff = '';
let reconnectDelay = 500;

/** @param {string} diff */
function renderDiff(diff) {
  currentDiff = diff;
  const escaped = diff
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .split('\n')
    .map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++'))
        return `<span class="add">${line}</span>`;
      if (line.startsWith('-') && !line.startsWith('---'))
        return `<span class="del">${line}</span>`;
      if (line.startsWith('@@') || line.startsWith('diff --git'))
        return `<span class="meta">${line}</span>`;
      return line;
    })
    .join('\n');
  diffEl.innerHTML = escaped;
}

/** @param {Status} status */
function renderStatus(status) {
  branchEl.textContent = `Branch: ${status.branch} (${status.changed_files} changed)`;
}

async function loadInitial() {
  /** @type {Snapshot} */
  const state = await fetch('/api/state').then((r) => r.json());
  renderStatus(state.status);
  renderDiff(state.diff || 'No diff');
  commitsEl.innerHTML = state.commits
    .map(
      (c) =>
        `<li><code>${c.hash.slice(0, 8)}</code> ${c.subject}<br/><small>${c.author}</small></li>`,
    )
    .join('');
  actionsEl.innerHTML = state.actions
    .map((a) => `<button title="${a.type || 'action'}">${a.label}</button>`)
    .join('');
}

function connectWs() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelay = 500;
  };

  ws.onmessage = (event) => {
    /** @type {WsMessage} */
    const message = JSON.parse(event.data);
    if (message.type === 'update') {
      renderStatus(message.status);
      if (
        message.diff !== null &&
        message.diff !== undefined &&
        message.diff !== currentDiff
      ) {
        renderDiff(message.diff || 'No diff');
      }
    }
  };

  ws.onclose = () => {
    setTimeout(connectWs, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  };
}

loadInitial().catch((err) => {
  diffEl.textContent = `Failed to load: ${err.message}`;
});
connectWs();
