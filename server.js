const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'review-data.json');
const MAX_BODY_BYTES = 64 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function emptyStore() {
  return { version: 1, profiles: {} };
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, DATA_FILE);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function cleanUsername(value) {
  const username = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    throw new Error('Enter a valid Lichess username.');
  }
  return username;
}

function playerName(player) {
  return player?.user?.name || player?.name || 'Anonymous';
}

function normalizeGame(game, username) {
  const whiteName = playerName(game.players?.white);
  const blackName = playerName(game.players?.black);
  const normalizedUsername = username.toLowerCase();
  const userColor = whiteName.toLowerCase() === normalizedUsername
    ? 'white'
    : blackName.toLowerCase() === normalizedUsername
      ? 'black'
      : null;
  const opponentColor = userColor === 'white' ? 'black' : 'white';
  const opponent = opponentColor ? game.players?.[opponentColor] : null;
  const result = game.winner
    ? game.winner === userColor ? 'win' : 'loss'
    : ['draw', 'stalemate'].includes(game.status) ? 'draw' : 'other';
  const lichessAnalyzed = Array.isArray(game.analysis)
    || Boolean(game.players?.white?.analysis)
    || Boolean(game.players?.black?.analysis);

  return {
    id: game.id,
    createdAt: game.createdAt,
    lastMoveAt: game.lastMoveAt,
    rated: Boolean(game.rated),
    variant: game.variant || 'standard',
    speed: game.speed || game.perf || 'unknown',
    perf: game.perf || game.speed || 'unknown',
    status: game.status || 'unknown',
    winner: game.winner || null,
    userColor,
    result,
    white: {
      name: whiteName,
      rating: game.players?.white?.rating ?? null,
    },
    black: {
      name: blackName,
      rating: game.players?.black?.rating ?? null,
    },
    opponent: {
      name: playerName(opponent),
      rating: opponent?.rating ?? null,
    },
    opening: game.opening?.name || null,
    eco: game.opening?.eco || null,
    lichessAnalyzed,
    url: `https://lichess.org/${game.id}`,
  };
}

function profilePayload(profile) {
  if (!profile) {
    return { games: [], lastSyncedAt: null, username: null };
  }
  return {
    username: profile.username,
    lastSyncedAt: profile.lastSyncedAt || null,
    games: Object.values(profile.games || {})
      .map((game) => ({ ...game, tracking: profile.tracking?.[game.id] || {} }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  };
}

async function syncGames(username, maxGames) {
  async function fetchNdjson(extraParams = {}) {
    const params = new URLSearchParams({
      max: String(maxGames),
      moves: 'false',
      clocks: 'false',
      evals: 'false',
      opening: 'true',
      ...extraParams,
    });
    const apiUrl = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/x-ndjson',
        'User-Agent': 'LichessRandomReview/0.1 (local personal review tool)',
      },
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 404) throw new Error(`Lichess user “${username}” was not found.`);
      if (response.status === 429) throw new Error('Lichess is rate-limiting requests. Wait one minute and try again.');
      throw new Error(`Lichess sync failed (${response.status}). ${detail}`.trim());
    }
    return (await response.text()).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }

  // Two compact sequential requests avoid downloading the full engine evaluation
  // for every move. The second response provides only the IDs with server analysis.
  const rawGames = await fetchNdjson();
  const analyzedIds = new Set((await fetchNdjson({ analysed: 'true', opening: 'false' })).map((game) => game.id));
  const games = rawGames
    .map((game) => normalizeGame(game, username))
    .map((game) => ({ ...game, lichessAnalyzed: analyzedIds.has(game.id) }))
    .filter((game) => game.userColor);
  return games;
}

function serveStatic(requestPath, response) {
  const requested = requestPath === '/' ? '/index.html' : requestPath;
  const relativePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'File not found.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const username = cleanUsername(url.searchParams.get('username'));
      const store = readStore();
      return sendJson(response, 200, profilePayload(store.profiles[username.toLowerCase()]));
    }

    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const body = await readJson(request);
      const username = cleanUsername(body.username);
      const maxGames = Math.min(Math.max(Number(body.maxGames) || 500, 10), 3000);
      const games = await syncGames(username, maxGames);
      const store = readStore();
      const key = username.toLowerCase();
      const existing = store.profiles[key] || { games: {}, tracking: {} };
      for (const game of games) existing.games[game.id] = game;
      existing.username = username;
      existing.lastSyncedAt = Date.now();
      existing.tracking ||= {};
      store.profiles[key] = existing;
      writeStore(store);
      return sendJson(response, 200, profilePayload(existing));
    }

    const trackingMatch = url.pathname.match(/^\/api\/games\/([a-zA-Z0-9]{8,12})\/tracking$/);
    if (request.method === 'POST' && trackingMatch) {
      const body = await readJson(request);
      const username = cleanUsername(body.username);
      const store = readStore();
      const profile = store.profiles[username.toLowerCase()];
      const gameId = trackingMatch[1];
      if (!profile?.games?.[gameId]) return sendJson(response, 404, { error: 'Game is not in the synced history.' });

      profile.tracking ||= {};
      const current = profile.tracking[gameId] || {};
      const action = String(body.action || '');
      if (action === 'opened') current.openedAt = Date.now();
      else if (action === 'reviewed') current.reviewedAt = Date.now();
      else if (action === 'unreviewed') delete current.reviewedAt;
      else if (action === 'note') current.note = String(body.note || '').slice(0, 1000);
      else throw new Error('Unknown tracking action.');
      profile.tracking[gameId] = current;
      writeStore(store);
      return sendJson(response, 200, { tracking: current });
    }

    if (request.method === 'GET') return serveStatic(url.pathname, response);
    return sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 400, { error: error.message || 'Something went wrong.' });
  }
});

server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(`Lichess Review Queue is running at ${address}`);
  if (process.env.NO_OPEN !== '1' && process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', address], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
});
