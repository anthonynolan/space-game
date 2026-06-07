const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const scoreEl = document.querySelector("#score");
const overlay = document.querySelector("#overlay");
const messageEl = document.querySelector("#message");
const startButton = document.querySelector("#start");
const pauseButton = document.querySelector("#pause");
const fireButton = document.querySelector("#fire");

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
  shotCooldown: 0,
  endTimer: null,
  ship: {
    x: 110,
    y: 0,
    radius: 16,
    velocity: 0,
  },
  stars: [],
  terrain: [],
  lasers: [],
  aliens: [],
  particles: [],
};

const segmentWidth = 34;
const terrainBuffer = 10;
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
  state.shotCooldown = 0;
  state.ship.y = state.height * 0.5;
  state.ship.velocity = 0;
  state.targetY = state.ship.y;
  state.lasers = [];
  state.aliens = [];
  state.particles = [];
  scoreEl.textContent = "0";
  overlay.hidden = true;
  buildTerrain(true);
  updatePauseIcon();
}

function finishGame() {
  messageEl.textContent = `Score ${Math.floor(state.score)}. Tap Start to fly again.`;
  startButton.textContent = "Restart";
  overlay.hidden = false;
}

function crashShip() {
  if (state.ended) return;
  state.running = false;
  state.ended = true;
  state.exploding = true;
  state.lasers = [];
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
        state.score += 100;
        scoreEl.textContent = Math.floor(state.score).toString();
        createExplosion(alien.x, alien.y, 0.75, false);
        break;
      }
    }
  }
}

function update(delta) {
  updateParticles(delta);
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
  updateAliens(delta);
  handleCombatCollisions();
  updateAudio();

  if (collidesWithTerrain()) {
    crashShip();
  }
}

function render(delta) {
  drawBackground(delta);
  drawTerrain();
  drawLasers();
  drawAliens();
  drawShip();
  drawParticles();
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

pauseButton.addEventListener("click", togglePause);
fireButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  fireLaser();
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
  if (event.code === "Space") {
    event.preventDefault();
    unlockAudio();
    if (state.running) togglePause();
    else if (!state.exploding) resetGame();
  }
  if (event.key === "ArrowUp") {
    unlockAudio();
    state.targetY -= 45;
  }
  if (event.key === "ArrowDown") {
    unlockAudio();
    state.targetY += 45;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    unlockAudio();
    nudgeSpeed(1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    unlockAudio();
    nudgeSpeed(-1);
  }
  if (event.key === "x" || event.key === "X" || event.code === "Enter") {
    event.preventDefault();
    fireLaser();
  }
  state.targetY = clamp(state.targetY, 42, state.height - 42);
});

resize();
requestAnimationFrame(loop);
