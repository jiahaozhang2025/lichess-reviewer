const state = {
  username: localStorage.getItem('lichess-review-username') || '',
  games: [],
  currentGame: null,
  lastSyncedAt: null,
};

const elements = {
  syncForm: document.querySelector('#sync-form'),
  username: document.querySelector('#username'),
  maxGames: document.querySelector('#max-games'),
  syncButton: document.querySelector('#sync-button'),
  workspace: document.querySelector('#workspace'),
  totalCount: document.querySelector('#total-count'),
  readyCount: document.querySelector('#ready-count'),
  reviewedCount: document.querySelector('#reviewed-count'),
  drawButton: document.querySelector('#draw-button'),
  anotherButton: document.querySelector('#another-button'),
  emptyDraw: document.querySelector('#empty-draw'),
  gameCard: document.querySelector('#game-card'),
  statusFilter: document.querySelector('#status-filter'),
  resultFilter: document.querySelector('#result-filter'),
  speedFilter: document.querySelector('#speed-filter'),
  gameSpeed: document.querySelector('#game-speed'),
  gameResult: document.querySelector('#game-result'),
  gameAnalysis: document.querySelector('#game-analysis'),
  gameDate: document.querySelector('#game-date'),
  userColor: document.querySelector('#user-color'),
  userName: document.querySelector('#user-name'),
  userRating: document.querySelector('#user-rating'),
  opponentColor: document.querySelector('#opponent-color'),
  opponentName: document.querySelector('#opponent-name'),
  opponentRating: document.querySelector('#opponent-rating'),
  gameOpening: document.querySelector('#game-opening'),
  openGame: document.querySelector('#open-game'),
  reviewedButton: document.querySelector('#reviewed-button'),
  historyList: document.querySelector('#history-list'),
  lastSynced: document.querySelector('#last-synced'),
  notice: document.querySelector('#notice'),
};

elements.username.value = state.username;

function isCompleted(game) {
  return Boolean(game.tracking?.reviewedAt || game.lichessAnalyzed);
}

function filteredGames() {
  const status = elements.statusFilter.value;
  const result = elements.resultFilter.value;
  const speed = elements.speedFilter.value;
  return state.games.filter((game) => {
    const completed = isCompleted(game);
    if (status === 'unreviewed' && completed) return false;
    if (status === 'reviewed' && !completed) return false;
    if (result !== 'all' && game.result !== result) return false;
    if (speed !== 'all' && game.speed !== speed && game.perf !== speed) return false;
    return true;
  });
}

function formatDate(timestamp, includeTime = false) {
  if (!timestamp) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(timestamp));
}

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('error', error);
  elements.notice.classList.remove('hidden');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => elements.notice.classList.add('hidden'), 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function updateSummary() {
  const completed = state.games.filter(isCompleted).length;
  elements.totalCount.textContent = state.games.length.toLocaleString();
  elements.reviewedCount.textContent = completed.toLocaleString();
  elements.readyCount.textContent = filteredGames().length.toLocaleString();
  elements.lastSynced.textContent = state.lastSyncedAt
    ? `Last synced ${formatDate(state.lastSyncedAt, true)}`
    : '';
}

function renderHistory() {
  const activity = state.games
    .filter((game) => game.tracking?.reviewedAt || game.tracking?.openedAt || game.lichessAnalyzed)
    .sort((a, b) => {
      const aTime = a.tracking?.reviewedAt || a.tracking?.openedAt || a.createdAt || 0;
      const bTime = b.tracking?.reviewedAt || b.tracking?.openedAt || b.createdAt || 0;
      return bTime - aTime;
    })
    .slice(0, 8);

  if (!activity.length) {
    elements.historyList.innerHTML = '<p class="history-empty">Games you open or review will appear here.</p>';
    return;
  }

  elements.historyList.innerHTML = activity.map((game) => {
    const status = game.tracking?.reviewedAt
      ? 'Reviewed'
      : game.lichessAnalyzed
        ? 'Lichess analyzed'
        : 'Opened';
    return `
      <div class="history-row">
        <a href="${game.url}" target="_blank" rel="noopener">vs ${escapeHtml(game.opponent.name)}</a>
        <span>${escapeHtml(game.speed)} · ${escapeHtml(game.result)}</span>
        <span>${formatDate(game.createdAt)}</span>
        <span class="history-state">${status}</span>
      </div>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderCurrentGame() {
  const game = state.currentGame;
  if (!game) {
    elements.gameCard.classList.add('hidden');
    elements.emptyDraw.classList.remove('hidden');
    return;
  }

  const user = game[game.userColor];
  const opponentColor = game.userColor === 'white' ? 'black' : 'white';
  elements.gameSpeed.textContent = game.speed;
  elements.gameResult.textContent = game.result;
  elements.gameResult.className = `badge result-${game.result}`;
  elements.gameAnalysis.textContent = game.lichessAnalyzed ? 'Lichess analyzed' : 'No server analysis';
  elements.gameDate.textContent = formatDate(game.createdAt);
  elements.gameDate.dateTime = new Date(game.createdAt).toISOString();
  elements.userColor.className = `piece-dot ${game.userColor}`;
  elements.userName.textContent = user.name;
  elements.userRating.textContent = user.rating ? `(${user.rating})` : '';
  elements.opponentColor.className = `piece-dot ${opponentColor}`;
  elements.opponentName.textContent = game.opponent.name;
  elements.opponentRating.textContent = game.opponent.rating ? `(${game.opponent.rating})` : '';
  elements.gameOpening.textContent = game.opening || 'Opening not identified';
  elements.openGame.href = game.url;
  elements.reviewedButton.textContent = game.tracking?.reviewedAt ? 'Mark not reviewed' : 'Mark reviewed';
  elements.emptyDraw.classList.add('hidden');
  elements.gameCard.classList.remove('hidden');
}

function setProfile(payload) {
  state.username = payload.username || state.username;
  state.games = payload.games || [];
  state.lastSyncedAt = payload.lastSyncedAt;
  if (state.currentGame) {
    state.currentGame = state.games.find((game) => game.id === state.currentGame.id) || null;
  }
  elements.workspace.classList.toggle('hidden', state.games.length === 0);
  updateSummary();
  renderHistory();
  renderCurrentGame();
}

function drawRandomGame() {
  const pool = filteredGames();
  if (!pool.length) {
    state.currentGame = null;
    renderCurrentGame();
    showNotice('No games match these filters. Try widening the pool.', true);
    return;
  }
  const alternatives = state.currentGame && pool.length > 1
    ? pool.filter((game) => game.id !== state.currentGame.id)
    : pool;
  state.currentGame = alternatives[Math.floor(Math.random() * alternatives.length)];
  renderCurrentGame();
}

async function track(action) {
  if (!state.currentGame) return;
  const payload = await api(`/api/games/${state.currentGame.id}/tracking`, {
    method: 'POST',
    body: JSON.stringify({ username: state.username, action }),
  });
  state.currentGame.tracking = payload.tracking;
  const stored = state.games.find((game) => game.id === state.currentGame.id);
  if (stored) stored.tracking = payload.tracking;
  updateSummary();
  renderHistory();
  renderCurrentGame();
}

elements.syncForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = elements.username.value.trim();
  if (!username) return;
  elements.syncButton.disabled = true;
  elements.syncButton.textContent = 'Syncing…';
  try {
    const payload = await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ username, maxGames: Number(elements.maxGames.value) }),
    });
    localStorage.setItem('lichess-review-username', username);
    setProfile(payload);
    showNotice(`Synced ${payload.games.length.toLocaleString()} games for ${payload.username}.`);
    elements.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    elements.syncButton.disabled = false;
    elements.syncButton.textContent = 'Sync games';
  }
});

elements.drawButton.addEventListener('click', drawRandomGame);
elements.anotherButton.addEventListener('click', drawRandomGame);
elements.openGame.addEventListener('click', () => track('opened').catch((error) => showNotice(error.message, true)));
elements.reviewedButton.addEventListener('click', async () => {
  try {
    const action = state.currentGame?.tracking?.reviewedAt ? 'unreviewed' : 'reviewed';
    await track(action);
    showNotice(action === 'reviewed' ? 'Marked as reviewed.' : 'Returned to the review pool.');
  } catch (error) {
    showNotice(error.message, true);
  }
});

[elements.statusFilter, elements.resultFilter, elements.speedFilter].forEach((filter) => {
  filter.addEventListener('change', updateSummary);
});

async function loadSavedProfile() {
  if (!state.username) return;
  try {
    const payload = await api(`/api/state?username=${encodeURIComponent(state.username)}`);
    setProfile(payload);
  } catch {
    // A first-time profile has nothing to load yet.
  }
}

loadSavedProfile();

