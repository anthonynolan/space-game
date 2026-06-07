const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const scoreEl = document.querySelector("#score");
const overlay = document.querySelector("#overlay");
const messageEl = document.querySelector("#message");
const startButton = document.querySelector("#start");
const pauseButton = document.querySelector("#pause");
const fireButton = document.querySelector("#fire");
const bombButton = document.querySelector("#bomb");
const playerListEl = document.querySelector("#player-list");
const leaderboardListEl = document.querySelector("#leaderboard-list");
const currentPlayerEl = document.querySelector("#current-player");
const nameForm = document.querySelector("#name-form");
const playerNameInput = document.querySelector("#player-name");
const keyBindingsEl = document.querySelector("#key-bindings");
const resetKeysButton = document.querySelector("#reset-keys");

const state = {
  running: false,
  paused: false,
  ended: false,
  exploding: false,
  width: 0,
  height: 0,
  dpr: 1,
  elapsed: 0,
  score: 0,
  speed: 210,
  speedBoost: 0,
  steerAmount: 0,
  camera: 0,
  targetY: 0,
  pointerDown: false,
  nextAlienIn: 1.1,
  nextBaseIn: 2.1,
  shotCooldown: 0,
  bombCooldown: 0,
  endTimer: null,
  selectedPlayer: "",
  players: [],
  leaderboard: [],
  ship: {
    x: 110,
    y: 0,
    radius: 16,
    velocity: 0,
  },
  stars: [],
  terrain: [],
  lasers: [],
  bombs: [],
  aliens: [],
  bases: [],
  enemyShots: [],
  particles: [],
  scorePopups: [],
  awaitingKeyAction: "",
};

const leaderboardKey = "starline-run-leaderboard";
const playersKey = "starline-run-players";
const controlsKey = "starline-run-key-bindings";
const segmentWidth = 34;
const terrainBuffer = 10;
const gravity = 680;
const defaultKeyBindings = {
  up: "ArrowUp",
  down: "ArrowDown",
  speedUp: "ArrowRight",
  speedDown: "ArrowLeft",
  fire: "KeyX",
  bomb: "KeyZ",
  pause: "Space",
};
const keyActions = [
  { action: "up", label: "Steer up" },
  { action: "down", label: "Steer down" },
  { action: "speedUp", label: "Speed up" },
  { action: "speedDown", label: "Slow down" },
  { action: "fire", label: "Fire laser" },
  { action: "bomb", label: "Drop bomb" },
  { action: "pause", label: "Pause / resume" },
];
let keyBindings = { ...defaultKeyBindings };
const audio = {
  context: null,
  master: null,
  engine: null,
  engineGain: null,
  swooshGain: null,
  filter: null,
  noise: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b, c, d) {
  return Math.hypot(a - c, b - d);
}

function noise(x) {
  return (
    Math.sin(x * 0.017) * 0.48 +
    Math.sin(x * 0.043 + 2.2) * 0.32 +
    Math.sin(x * 0.091 + 4.8) * 0.2
  );
}

function formatKey(code) {
  const names = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    Enter: "Enter",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
  };
  if (names[code]) return names[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function loadKeyBindings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(controlsKey) || "{}");
    if (!parsed || typeof parsed !== "object") return { ...defaultKeyBindings };
    const loaded = { ...defaultKeyBindings };
    for (const action of Object.keys(defaultKeyBindings)) {
      if (typeof parsed[action] === "string" && parsed[action]) {
        loaded[action] = parsed[action];
      }
    }
    return loaded;
  } catch {
    return { ...defaultKeyBindings };
  }
}

function saveKeyBindings() {
  try {
    localStorage.setItem(controlsKey, JSON.stringify(keyBindings));
  } catch {
    // The game still works if private browsing blocks local storage.
  }
}

function renderKeyBindings() {
  if (!keyBindingsEl) return;
  keyBindingsEl.innerHTML = "";
  for (const { action, label } of keyActions) {
    const row = document.createElement("div");
    row.className = `key-row${state.awaitingKeyAction === action ? " listening" : ""}`;

    const name = document.createElement("span");
    name.textContent = label;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = state.awaitingKeyAction === action ? "Press a key…" : formatKey(keyBindings[action]);
    button.addEventListener("click", () => {
      state.awaitingKeyAction = action;
      renderKeyBindings();
    });

    row.append(name, button);
    keyBindingsEl.append(row);
  }
}

function isTextEntryTarget(target) {
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function actionForKey(code) {
  return Object.keys(keyBindings).find((action) => keyBindings[action] === code) || "";
}

function loadLeaderboard() {
  try {
    const parsed = JSON.parse(localStorage.getItem(leaderboardKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string")
      .map((entry) => ({
        name: entry.name.slice(0, 18),
        score: Number.isFinite(entry.score) ? Math.max(0, Math.floor(entry.score)) : 0,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function loadPlayers(leaderboard) {
  const names = new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(playersKey) || "[]");
    if (Array.isArray(parsed)) {
      for (const name of parsed) {
        if (typeof name === "string" && name.trim()) {
          names.add(name.trim().replace(/\s+/g, " ").slice(0, 18));
        }
      }
    }
  } catch {
    // Ignore unreadable player storage.
  }
  try {
    const oldScores = JSON.parse(localStorage.getItem(leaderboardKey) || "[]");
    if (Array.isArray(oldScores)) {
      for (const entry of oldScores) {
        if (entry && typeof entry.name === "string" && entry.name.trim()) {
          names.add(entry.name.trim().replace(/\s+/g, " ").slice(0, 18));
        }
      }
    }
  } catch {
    // Ignore unreadable legacy score storage.
  }
  for (const entry of leaderboard) {
    names.add(entry.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function saveLeaderboard() {
  try {
    localStorage.setItem(leaderboardKey, JSON.stringify(state.leaderboard));
    localStorage.setItem(playersKey, JSON.stringify(state.players));
  } catch {
    // The game still works if private browsing blocks local storage.
  }
}

function setSelectedPlayer(name) {
  state.selectedPlayer = name;
  currentPlayerEl.textContent = name || "No player selected";
  startButton.disabled = !name;
  renderPlayers();
}

function renderPlayers() {
  playerListEl.innerHTML = "";
  for (const name of state.players) {
    const button = document.createElement("button");
    button.className = `player-choice${name === state.selectedPlayer ? " active" : ""}`;
    button.type = "button";
    button.textContent = name;
    button.addEventListener("click", () => setSelectedPlayer(name));
    playerListEl.append(button);
  }
}

function renderLeaderboard() {
  leaderboardListEl.innerHTML = "";
  if (state.leaderboard.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-board";
    empty.textContent = "No scores yet";
    leaderboardListEl.append(empty);
    return;
  }

  for (const [index, entry] of state.leaderboard.slice(0, 10).entries()) {
    const row = document.createElement("li");
    row.innerHTML = `<span>${index + 1}</span><span class="name"></span><span class="score">${entry.score}</span>`;
    row.querySelector(".name").textContent = entry.name;
    leaderboardListEl.append(row);
  }
}

function refreshLeaderboardUI() {
  renderPlayers();
  renderLeaderboard();
  currentPlayerEl.textContent = state.selectedPlayer || "No player selected";
  startButton.disabled = !state.selectedPlayer;
}

function addPlayer(name) {
  const cleanName = name.trim().replace(/\s+/g, " ").slice(0, 18);
  if (!cleanName) return;
  const existing = state.players.find((player) => player.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    setSelectedPlayer(existing);
    return;
  }
  state.players.push(cleanName);
  state.players.sort((a, b) => a.localeCompare(b));
  saveLeaderboard();
  setSelectedPlayer(cleanName);
  renderLeaderboard();
}

function saveScore() {
  if (!state.selectedPlayer) return;
  const finalScore = Math.floor(state.score);
  if (finalScore <= 0) return;
  if (!state.players.includes(state.selectedPlayer)) {
    state.players.push(state.selectedPlayer);
    state.players.sort((a, b) => a.localeCompare(b));
  }
  state.leaderboard.push({ name: state.selectedPlayer, score: finalScore });
  state.leaderboard = state.leaderboard
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);
  saveLeaderboard();
  refreshLeaderboardUI();
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.ship.x = clamp(state.width * 0.2, 72, 130);
  if (!state.running) {
    state.ship.y = state.height * 0.5;
    state.targetY = state.ship.y;
  }
  buildTerrain(true);
  buildStars();
}

function terrainAt(worldX) {
  const t = Math.max(0, worldX);
  const gapCenter = state.height * (0.5 + noise(t + 780) * 0.18);
  const gapSize = clamp(state.height * (0.44 + noise(t * 0.72 + 90) * 0.11), 170, state.height * 0.62);
  const rough = noise(t * 1.8 + 310) * 18;
  const top = clamp(gapCenter - gapSize / 2 + rough, 58, state.height - 230);
  const bottom = clamp(gapCenter + gapSize / 2 + rough * 0.35, top + 150, state.height - 46);
  return { top, bottom };
}

function buildTerrain(force = false) {
  const needed = Math.ceil(state.width / segmentWidth) + terrainBuffer;
  const firstIndex = Math.floor(state.camera / segmentWidth) - 2;

  if (force || state.terrain.length === 0 || state.terrain[0].index > firstIndex) {
    state.terrain = [];
    for (let i = 0; i < needed; i += 1) {
      const index = firstIndex + i;
      state.terrain.push({ index, ...terrainAt(index * segmentWidth) });
    }
    return;
  }

  while (state.terrain.length && state.terrain[0].index < firstIndex) {
    state.terrain.shift();
  }
  while (state.terrain.length < needed) {
    const index = state.terrain[state.terrain.length - 1].index + 1;
    state.terrain.push({ index, ...terrainAt(index * segmentWidth) });
  }
}

function buildStars() {
  const count = Math.floor((state.width * state.height) / 11000);
  state.stars = Array.from({ length: count }, () => ({
    x: Math.random() * state.width,
    y: Math.random() * state.height,
    size: Math.random() * 1.8 + 0.5,
    speed: Math.random() * 34 + 18,
    alpha: Math.random() * 0.5 + 0.35,
  }));
}

function createNoiseBuffer(context, seconds = 2) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function setupAudio() {
  if (audio.context) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = new AudioContext();
  const master = context.createGain();
  const engineGain = context.createGain();
  const swooshGain = context.createGain();
  const filter = context.createBiquadFilter();
  const engine = context.createOscillator();
  const noiseSource = context.createBufferSource();

  master.gain.value = 0.42;
  engine.type = "sawtooth";
  engine.frequency.value = 72;
  engineGain.gain.value = 0;
  filter.type = "bandpass";
  filter.frequency.value = 760;
  filter.Q.value = 0.8;
  swooshGain.gain.value = 0;

  noiseSource.buffer = createNoiseBuffer(context);
  noiseSource.loop = true;
  engine.connect(engineGain).connect(master);
  noiseSource.connect(filter).connect(swooshGain).connect(master);
  master.connect(context.destination);
  engine.start();
  noiseSource.start();

  audio.context = context;
  audio.master = master;
  audio.engine = engine;
  audio.engineGain = engineGain;
  audio.swooshGain = swooshGain;
  audio.filter = filter;
  audio.noise = noiseSource;
}

function unlockAudio() {
  setupAudio();
  if (audio.context && audio.context.state === "suspended") {
    audio.context.resume();
  }
}

function updateAudio() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const active = state.running && !state.paused && !state.ended;
  const steer = active ? clamp(Math.abs(state.steerAmount), 0, 1) : 0;
  const engineLevel = active ? 0.035 + Math.max(0, state.speedBoost) / 5200 : 0;
  const swooshLevel = steer * 0.16;
  const pitch = 68 + steer * 54 + Math.max(0, state.speedBoost) * 0.06;

  audio.engine.frequency.setTargetAtTime(pitch, now, 0.05);
  audio.engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);
  audio.filter.frequency.setTargetAtTime(540 + steer * 1900 + Math.max(0, state.speedBoost) * 1.4, now, 0.04);
  audio.swooshGain.gain.setTargetAtTime(swooshLevel, now, 0.035);
}

function playLaserSound() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(860, now);
  osc.frequency.exponentialRampToValueAtTime(360, now + 0.08);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(gain).connect(audio.master);
  osc.start(now);
  osc.stop(now + 0.1);
}

function playExplosionSound() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const boom = audio.context.createBufferSource();
  const boomFilter = audio.context.createBiquadFilter();
  const boomGain = audio.context.createGain();
  const drop = audio.context.createOscillator();
  const dropGain = audio.context.createGain();

  boom.buffer = createNoiseBuffer(audio.context, 0.5);
  boomFilter.type = "lowpass";
  boomFilter.frequency.setValueAtTime(1800, now);
  boomFilter.frequency.exponentialRampToValueAtTime(90, now + 0.42);
  boomGain.gain.setValueAtTime(0.42, now);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

  drop.type = "sawtooth";
  drop.frequency.setValueAtTime(160, now);
  drop.frequency.exponentialRampToValueAtTime(38, now + 0.35);
  dropGain.gain.setValueAtTime(0.16, now);
  dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  boom.connect(boomFilter).connect(boomGain).connect(audio.master);
  drop.connect(dropGain).connect(audio.master);
  boom.start(now);
  boom.stop(now + 0.5);
  drop.start(now);
  drop.stop(now + 0.4);
}

function playBombExplosionSound() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const blast = audio.context.createBufferSource();
  const blastFilter = audio.context.createBiquadFilter();
  const blastGain = audio.context.createGain();
  const punch = audio.context.createOscillator();
  const punchGain = audio.context.createGain();

  blast.buffer = createNoiseBuffer(audio.context, 0.7);
  blastFilter.type = "lowpass";
  blastFilter.frequency.setValueAtTime(2400, now);
  blastFilter.frequency.exponentialRampToValueAtTime(120, now + 0.55);
  blastGain.gain.setValueAtTime(0.52, now);
  blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);

  punch.type = "triangle";
  punch.frequency.setValueAtTime(92, now);
  punch.frequency.exponentialRampToValueAtTime(30, now + 0.28);
  punchGain.gain.setValueAtTime(0.28, now);
  punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

  blast.connect(blastFilter).connect(blastGain).connect(audio.master);
  punch.connect(punchGain).connect(audio.master);
  blast.start(now);
  blast.stop(now + 0.7);
  punch.start(now);
  punch.stop(now + 0.34);
}

function playBaseExplosionSound() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const profiles = [
    { filterStart: 2800, filterEnd: 95, noiseGain: 0.58, toneStart: 74, toneEnd: 26, toneType: "sawtooth", duration: 0.68 },
    { filterStart: 1700, filterEnd: 70, noiseGain: 0.46, toneStart: 118, toneEnd: 34, toneType: "triangle", duration: 0.52 },
    { filterStart: 3400, filterEnd: 140, noiseGain: 0.5, toneStart: 58, toneEnd: 22, toneType: "square", duration: 0.76 },
  ];
  const profile = profiles[Math.floor(Math.random() * profiles.length)];
  const blast = audio.context.createBufferSource();
  const blastFilter = audio.context.createBiquadFilter();
  const blastGain = audio.context.createGain();
  const tone = audio.context.createOscillator();
  const toneGain = audio.context.createGain();

  blast.buffer = createNoiseBuffer(audio.context, profile.duration);
  blastFilter.type = profile.toneType === "triangle" ? "bandpass" : "lowpass";
  blastFilter.frequency.setValueAtTime(profile.filterStart, now);
  blastFilter.frequency.exponentialRampToValueAtTime(profile.filterEnd, now + profile.duration * 0.82);
  blastGain.gain.setValueAtTime(profile.noiseGain, now);
  blastGain.gain.exponentialRampToValueAtTime(0.001, now + profile.duration);

  tone.type = profile.toneType;
  tone.frequency.setValueAtTime(profile.toneStart, now);
  tone.frequency.exponentialRampToValueAtTime(profile.toneEnd, now + profile.duration * 0.55);
  toneGain.gain.setValueAtTime(0.26, now);
  toneGain.gain.exponentialRampToValueAtTime(0.001, now + profile.duration * 0.62);

  blast.connect(blastFilter).connect(blastGain).connect(audio.master);
  tone.connect(toneGain).connect(audio.master);
  blast.start(now);
  blast.stop(now + profile.duration);
  tone.start(now);
  tone.stop(now + profile.duration * 0.68);
}

function playBaseShotSound() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.12);
  gain.gain.setValueAtTime(0.07, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.connect(gain).connect(audio.master);
  osc.start(now);
  osc.stop(now + 0.15);
}

function createScorePopup(x, y, amount) {
  state.scorePopups.push({
    x: x + 18,
    y: y - 10,
    vy: -22,
    life: 1.2,
    maxLife: 1.2,
    amount,
  });
}

function awardPoints(amount, x, y) {
  state.score += amount;
  scoreEl.textContent = Math.floor(state.score).toString();
  createScorePopup(x, y, amount);
}

function createExplosion(x, y, size = 1, shipBlast = false) {
  const count = shipBlast ? 56 : 22;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (shipBlast ? 90 : 60) + Math.random() * (shipBlast ? 260 : 150);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + Math.random() * 0.55,
      maxLife: 0.7,
      size: (2 + Math.random() * 5) * size,
      color: Math.random() > 0.45 ? "#ffb84c" : "#7ce7ff",
    });
  }
}

function nudgeSpeed(direction) {
  state.speedBoost = clamp(state.speedBoost + direction * 35, -90, 150);
}

function resetGame() {
  unlockAudio();
  if (!state.selectedPlayer) {
    messageEl.textContent = "Choose a player or add your name first.";
    return;
  }
  if (state.endTimer) {
    window.clearTimeout(state.endTimer);
    state.endTimer = null;
  }
  state.running = true;
  state.paused = false;
  state.ended = false;
  state.exploding = false;
  state.elapsed = 0;
  state.score = 0;
  state.speed = 210;
  state.speedBoost = 0;
  state.steerAmount = 0;
  state.camera = 0;
  state.nextAlienIn = 1;
  state.nextBaseIn = 2.1;
  state.shotCooldown = 0;
  state.bombCooldown = 0;
  state.ship.y = state.height * 0.5;
  state.ship.velocity = 0;
  state.targetY = state.ship.y;
  state.lasers = [];
  state.bombs = [];
  state.aliens = [];
  state.bases = [];
  state.enemyShots = [];
  state.particles = [];
  state.scorePopups = [];
  scoreEl.textContent = "0";
  overlay.hidden = true;
  buildTerrain(true);
  updatePauseIcon();
}

function finishGame() {
  saveScore();
  messageEl.textContent = `${state.selectedPlayer}: ${Math.floor(state.score)} points. Tap Start to fly again.`;
  startButton.textContent = "Restart";
  overlay.hidden = false;
}

function crashShip() {
  if (state.ended) return;
  state.running = false;
  state.ended = true;
  state.exploding = true;
  state.lasers = [];
  state.bombs = [];
  createExplosion(state.ship.x, state.ship.y, 1.35, true);
  playExplosionSound();
  updateAudio();
  state.endTimer = window.setTimeout(() => {
    state.endTimer = null;
    finishGame();
  }, 850);
}

function togglePause() {
  if (!state.running || state.ended) return;
  state.paused = !state.paused;
  overlay.hidden = !state.paused;
  messageEl.textContent = state.paused ? "Paused" : "";
  startButton.textContent = state.paused ? "Resume" : "Start";
  updatePauseIcon();
}

function updatePauseIcon() {
  pauseButton.setAttribute("aria-label", state.paused ? "Resume" : "Pause");
  pauseButton.innerHTML = state.paused
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
}

function setTargetFromEvent(event) {
  const point = event.touches ? event.touches[0] : event;
  state.targetY = clamp(point.clientY, 42, state.height - 42);
  unlockAudio();
}

function fireLaser() {
  unlockAudio();
  if (!state.running || state.paused || state.ended || state.shotCooldown > 0) return;
  state.lasers.push({
    x: state.ship.x + 25,
    y: state.ship.y,
    length: 34,
    speed: 760,
    radius: 4,
  });
  state.shotCooldown = 0.18;
  playLaserSound();
}

function dropBomb() {
  unlockAudio();
  if (!state.running || state.paused || state.ended || state.bombCooldown > 0) return;
  state.bombs.push({
    x: state.ship.x + 8,
    y: state.ship.y + 14,
    vx: 165 + state.speed * 0.18,
    vy: -65 + clamp(state.ship.velocity * 0.12, -90, 120),
    radius: 6,
    rotation: 0,
  });
  state.bombCooldown = 0.42;
}

function spawnAlien() {
  const x = state.width + 48;
  const sample = terrainAt(state.camera + state.width + 80);
  const margin = 34;
  const minY = sample.top + margin;
  const maxY = sample.bottom - margin;
  if (maxY <= minY) return;
  const baseY = minY + Math.random() * (maxY - minY);
  state.aliens.push({
    x,
    y: baseY,
    baseY,
    radius: 17,
    speed: 68 + Math.random() * 46,
    phase: Math.random() * Math.PI * 2,
    weave: 2.3 + Math.random() * 1.6,
    amplitude: 18 + Math.random() * 32,
  });
}

function spawnBase() {
  const x = state.width + 70;
  const ground = terrainAt(state.camera + x).bottom;
  state.bases.push({
    x,
    y: ground - 16,
    radius: 19,
    cooldown: 0.55 + Math.random() * 0.8,
  });
}

function drawBackground(delta) {
  const sky = ctx.createLinearGradient(0, 0, 0, state.height);
  sky.addColorStop(0, "#071832");
  sky.addColorStop(0.48, "#091120");
  sky.addColorStop(1, "#15131c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const star of state.stars) {
    star.x -= star.speed * delta;
    if (star.x < -4) {
      star.x = state.width + Math.random() * 40;
      star.y = Math.random() * state.height;
    }
    ctx.globalAlpha = star.alpha;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
}

function drawTerrain() {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const point of state.terrain) {
    ctx.lineTo(point.index * segmentWidth - state.camera, point.top);
  }
  ctx.lineTo(state.width + 80, 0);
  ctx.closePath();
  const ceiling = ctx.createLinearGradient(0, 0, 0, state.height * 0.45);
  ceiling.addColorStop(0, "#6f778f");
  ceiling.addColorStop(1, "#2d3849");
  ctx.fillStyle = ceiling;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, state.height);
  for (const point of state.terrain) {
    ctx.lineTo(point.index * segmentWidth - state.camera, point.bottom);
  }
  ctx.lineTo(state.width + 80, state.height);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, state.height * 0.48, 0, state.height);
  ground.addColorStop(0, "#324856");
  ground.addColorStop(1, "#0f1f27");
  ctx.fillStyle = ground;
  ctx.fill();

  ctx.strokeStyle = "rgba(124, 231, 255, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const point of state.terrain) {
    ctx.lineTo(point.index * segmentWidth - state.camera, point.top + 1);
  }
  ctx.stroke();
  ctx.beginPath();
  for (const point of state.terrain) {
    ctx.lineTo(point.index * segmentWidth - state.camera, point.bottom - 1);
  }
  ctx.stroke();
}

function drawShip() {
  if (state.exploding) return;
  const ship = state.ship;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(clamp(ship.velocity / 900, -0.45, 0.45));

  ctx.fillStyle = "rgba(124, 231, 255, 0.22)";
  ctx.beginPath();
  ctx.ellipse(-10, 0, 38, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#eaf7ff";
  ctx.strokeStyle = "#74d9f1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(23, 0);
  ctx.lineTo(-17, -13);
  ctx.lineTo(-9, 0);
  ctx.lineTo(-17, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1d6d86";
  ctx.beginPath();
  ctx.ellipse(2, -2, 8, 5, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffb84c";
  ctx.beginPath();
  ctx.moveTo(-17, -7);
  ctx.lineTo(-35 - Math.random() * 10, 0);
  ctx.lineTo(-17, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLasers() {
  ctx.lineCap = "round";
  for (const laser of state.lasers) {
    const beam = ctx.createLinearGradient(laser.x - laser.length, laser.y, laser.x + laser.length, laser.y);
    beam.addColorStop(0, "rgba(124,231,255,0)");
    beam.addColorStop(0.35, "#7ce7ff");
    beam.addColorStop(1, "#ffffff");
    ctx.strokeStyle = beam;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(laser.x - laser.length, laser.y);
    ctx.lineTo(laser.x + laser.length, laser.y);
    ctx.stroke();
  }
}

function drawBombs() {
  for (const bomb of state.bombs) {
    ctx.save();
    ctx.translate(bomb.x, bomb.y);
    ctx.rotate(bomb.rotation);
    ctx.fillStyle = "#2b3442";
    ctx.strokeStyle = "#ffb84c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffb84c";
    ctx.fillRect(-2, -13, 4, 5);
    ctx.restore();
  }
}

function drawAliens() {
  for (const alien of state.aliens) {
    ctx.save();
    ctx.translate(alien.x, alien.y);
    ctx.fillStyle = "rgba(142, 255, 127, 0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8dff7f";
    ctx.strokeStyle = "#173d24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#06120a";
    ctx.beginPath();
    ctx.arc(6, -3, 3, 0, Math.PI * 2);
    ctx.arc(6, 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8dff7f";
    ctx.beginPath();
    ctx.moveTo(-9, -9);
    ctx.lineTo(-19, -18);
    ctx.moveTo(-9, 9);
    ctx.lineTo(-19, 18);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBases() {
  for (const base of state.bases) {
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.fillStyle = "rgba(255, 85, 94, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 34, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4b5668";
    ctx.strokeStyle = "#ff555e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, -1);
    ctx.lineTo(16, -1);
    ctx.quadraticCurveTo(21, -1, 21, 4);
    ctx.lineTo(21, 16);
    ctx.lineTo(-21, 16);
    ctx.lineTo(-21, 4);
    ctx.quadraticCurveTo(-21, -1, -16, -1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ff555e";
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -24);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemyShots() {
  ctx.lineCap = "round";
  for (const shot of state.enemyShots) {
    ctx.strokeStyle = "#ff555e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(shot.x - shot.vx * 0.035, shot.y - shot.vy * 0.035);
    ctx.stroke();
    ctx.fillStyle = "#ffd0d3";
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScorePopups() {
  ctx.save();
  ctx.font = "800 18px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  for (const popup of state.scorePopups) {
    const alpha = clamp(popup.life / popup.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(5, 9, 21, 0.8)";
    ctx.fillStyle = "#fff2a8";
    const label = `+${popup.amount}`;
    ctx.strokeText(label, popup.x, popup.y);
    ctx.fillText(label, popup.x, popup.y);
  }
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (1.2 - alpha * 0.25), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function collidesWithTerrain() {
  const shipWorldX = state.camera + state.ship.x;
  const sample = terrainAt(shipWorldX);
  return (
    state.ship.y - state.ship.radius < sample.top ||
    state.ship.y + state.ship.radius > sample.bottom
  );
}

function updateScorePopups(delta) {
  state.scorePopups = state.scorePopups.filter((popup) => {
    popup.life -= delta;
    popup.y += popup.vy * delta;
    popup.vy *= 1 - delta * 0.6;
    return popup.life > 0;
  });
}

function updateParticles(delta) {
  state.particles = state.particles.filter((particle) => {
    particle.life -= delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vx *= 1 - delta * 1.4;
    particle.vy *= 1 - delta * 1.4;
    return particle.life > 0;
  });
}

function updateLasers(delta) {
  state.shotCooldown = Math.max(0, state.shotCooldown - delta);
  for (const laser of state.lasers) {
    laser.x += laser.speed * delta;
  }
  state.lasers = state.lasers.filter((laser) => laser.x - laser.length < state.width + 80);
}

function updateBombs(delta) {
  state.bombCooldown = Math.max(0, state.bombCooldown - delta);
  for (const bomb of state.bombs) {
    bomb.vy += gravity * delta;
    bomb.x += bomb.vx * delta;
    bomb.y += bomb.vy * delta;
    bomb.rotation += delta * 8;
  }
  state.bombs = state.bombs.filter((bomb) => bomb.x < state.width + 80 && bomb.y < state.height + 80);
}

function updateAliens(delta) {
  state.nextAlienIn -= delta;
  if (state.nextAlienIn <= 0) {
    spawnAlien();
    state.nextAlienIn = clamp(1.35 - state.elapsed * 0.015, 0.55, 1.35) + Math.random() * 0.45;
  }

  for (const alien of state.aliens) {
    alien.x -= (state.speed + alien.speed) * delta;
    alien.y = alien.baseY + Math.sin(state.elapsed * alien.weave + alien.phase) * alien.amplitude;
    const terrain = terrainAt(state.camera + alien.x);
    alien.y = clamp(alien.y, terrain.top + 28, terrain.bottom - 28);
  }

  state.aliens = state.aliens.filter((alien) => alien.x > -70);
}

function fireBaseShot(base) {
  const dx = state.ship.x - base.x;
  const dy = state.ship.y - base.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const speed = 260 + Math.min(110, state.elapsed * 3);
  state.enemyShots.push({
    x: base.x,
    y: base.y - 23,
    vx: (dx / length) * speed,
    vy: (dy / length) * speed,
    radius: 5,
  });
  playBaseShotSound();
}

function updateBases(delta) {
  state.nextBaseIn -= delta;
  if (state.nextBaseIn <= 0) {
    spawnBase();
    state.nextBaseIn = clamp(2.4 - state.elapsed * 0.018, 0.95, 2.4) + Math.random() * 0.7;
  }

  for (const base of state.bases) {
    base.x -= state.speed * delta;
    base.y = terrainAt(state.camera + base.x).bottom - 16;
    base.cooldown -= delta;
    if (base.cooldown <= 0 && base.x > state.ship.x + 35 && base.x < state.width - 10) {
      fireBaseShot(base);
      base.cooldown = 1.05 + Math.random() * 0.85;
    }
  }

  state.bases = state.bases.filter((base) => base.x > -80);
}

function updateEnemyShots(delta) {
  for (const shot of state.enemyShots) {
    shot.x += shot.vx * delta;
    shot.y += shot.vy * delta;
  }
  state.enemyShots = state.enemyShots.filter(
    (shot) => shot.x > -60 && shot.x < state.width + 60 && shot.y > -80 && shot.y < state.height + 80,
  );
}

function handleCombatCollisions() {
  for (let alienIndex = state.aliens.length - 1; alienIndex >= 0; alienIndex -= 1) {
    const alien = state.aliens[alienIndex];
    if (distance(state.ship.x, state.ship.y, alien.x, alien.y) < state.ship.radius + alien.radius) {
      crashShip();
      return;
    }

    for (let laserIndex = state.lasers.length - 1; laserIndex >= 0; laserIndex -= 1) {
      const laser = state.lasers[laserIndex];
      if (Math.abs(laser.y - alien.y) < alien.radius && laser.x + laser.length > alien.x - alien.radius && laser.x - laser.length < alien.x + alien.radius) {
        state.aliens.splice(alienIndex, 1);
        state.lasers.splice(laserIndex, 1);
        awardPoints(100, alien.x, alien.y);
        createExplosion(alien.x, alien.y, 0.75, false);
        break;
      }
    }
  }

  for (let baseIndex = state.bases.length - 1; baseIndex >= 0; baseIndex -= 1) {
    const base = state.bases[baseIndex];
    if (distance(state.ship.x, state.ship.y, base.x, base.y) < state.ship.radius + base.radius) {
      crashShip();
      return;
    }

    for (let bombIndex = state.bombs.length - 1; bombIndex >= 0; bombIndex -= 1) {
      const bomb = state.bombs[bombIndex];
      if (distance(bomb.x, bomb.y, base.x, base.y) < base.radius + bomb.radius + 6) {
        state.bases.splice(baseIndex, 1);
        state.bombs.splice(bombIndex, 1);
        awardPoints(150, base.x, base.y);
        createExplosion(base.x, base.y, 1.05, false);
        playBaseExplosionSound();
        break;
      }
    }
  }

  for (let shotIndex = state.enemyShots.length - 1; shotIndex >= 0; shotIndex -= 1) {
    const shot = state.enemyShots[shotIndex];
    if (distance(state.ship.x, state.ship.y, shot.x, shot.y) < state.ship.radius + shot.radius) {
      crashShip();
      return;
    }
  }

  for (let bombIndex = state.bombs.length - 1; bombIndex >= 0; bombIndex -= 1) {
    const bomb = state.bombs[bombIndex];
    const ground = terrainAt(state.camera + bomb.x).bottom;
    if (bomb.y + bomb.radius >= ground) {
      state.bombs.splice(bombIndex, 1);
      createExplosion(bomb.x, ground, 0.85, false);
      playBombExplosionSound();
    }
  }
}

function update(delta) {
  updateParticles(delta);
  updateScorePopups(delta);
  if (!state.running || state.paused) {
    updateAudio();
    return;
  }

  state.elapsed += delta;
  state.speed = 210 + Math.min(170, state.elapsed * 8) + state.speedBoost;
  state.camera += state.speed * delta;
  state.score += delta * state.speed * 0.07;
  scoreEl.textContent = Math.floor(state.score).toString();
  buildTerrain();

  const previousY = state.ship.y;
  state.ship.y = lerp(state.ship.y, state.targetY, 1 - Math.pow(0.001, delta));
  state.ship.velocity = (state.ship.y - previousY) / Math.max(delta, 0.001);
  state.steerAmount = lerp(
    state.steerAmount,
    clamp(Math.abs(state.targetY - state.ship.y) / 120 + Math.abs(state.ship.velocity) / 780, 0, 1),
    0.18,
  );

  updateLasers(delta);
  updateBombs(delta);
  updateAliens(delta);
  updateBases(delta);
  updateEnemyShots(delta);
  handleCombatCollisions();
  updateAudio();

  if (collidesWithTerrain()) {
    crashShip();
  }
}

function render(delta) {
  drawBackground(delta);
  drawTerrain();
  drawBombs();
  drawLasers();
  drawEnemyShots();
  drawBases();
  drawAliens();
  drawShip();
  drawParticles();
  drawScorePopups();
}

let lastTime = performance.now();
function loop(time) {
  const delta = Math.min(0.033, (time - lastTime) / 1000);
  lastTime = time;
  update(delta);
  render(delta);
  requestAnimationFrame(loop);
}

startButton.addEventListener("click", () => {
  unlockAudio();
  if (state.paused) {
    state.paused = false;
    overlay.hidden = true;
    updatePauseIcon();
    return;
  }
  resetGame();
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addPlayer(playerNameInput.value);
  playerNameInput.value = "";
  playerNameInput.blur();
});

pauseButton.addEventListener("click", togglePause);
fireButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  fireLaser();
});
bombButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  dropBomb();
});
resetKeysButton.addEventListener("click", () => {
  keyBindings = { ...defaultKeyBindings };
  state.awaitingKeyAction = "";
  saveKeyBindings();
  renderKeyBindings();
});
window.addEventListener("resize", resize);

window.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  state.pointerDown = true;
  unlockAudio();
  setTargetFromEvent(event);
  if (!state.running && overlay.hidden && !state.ended) resetGame();
});

window.addEventListener("pointermove", (event) => {
  if (state.pointerDown) {
    unlockAudio();
    setTargetFromEvent(event);
  }
});

window.addEventListener("pointerup", () => {
  state.pointerDown = false;
});

window.addEventListener("keydown", (event) => {
  if (state.awaitingKeyAction) {
    event.preventDefault();
    const action = state.awaitingKeyAction;
    const previousCode = keyBindings[action];
    const conflictingAction = Object.keys(keyBindings).find(
      (otherAction) => otherAction !== action && keyBindings[otherAction] === event.code,
    );
    keyBindings[action] = event.code;
    if (conflictingAction) keyBindings[conflictingAction] = previousCode;
    state.awaitingKeyAction = "";
    saveKeyBindings();
    renderKeyBindings();
    return;
  }

  if (isTextEntryTarget(event.target)) return;

  const action = actionForKey(event.code);
  if (!action) return;

  event.preventDefault();
  unlockAudio();

  if (action === "pause") {
    if (state.running) togglePause();
    else if (!state.exploding && state.selectedPlayer) resetGame();
  } else if (action === "up") {
    state.targetY -= 45;
  } else if (action === "down") {
    state.targetY += 45;
  } else if (action === "speedUp") {
    nudgeSpeed(1);
  } else if (action === "speedDown") {
    nudgeSpeed(-1);
  } else if (action === "fire") {
    fireLaser();
  } else if (action === "bomb") {
    dropBomb();
  }

  state.targetY = clamp(state.targetY, 42, state.height - 42);
});

keyBindings = loadKeyBindings();
renderKeyBindings();
state.leaderboard = loadLeaderboard();
state.players = loadPlayers(state.leaderboard);
refreshLeaderboardUI();
resize();
requestAnimationFrame(loop);
