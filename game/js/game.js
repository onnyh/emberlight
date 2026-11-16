'use strict';
/*
 * EMBERLIGHT — keep the flame until dawn.
 * You are the Keeper, a wisp of ember light, holding the last lighthouse
 * flame against the gloom for one long night: five minutes until sunrise.
 * Survive and you win; let your light go out and the dark takes the coast.
 *
 * This file runs the game: input, the player, bolts and shards, combat,
 * the HUD and the screens. Enemies live in enemies.js, upgrades in
 * upgrades.js, and every sound is synthesised in audio.js.
 */

const NIGHT_SECONDS = 300;
const BOSS_TIMES = [150, 270];
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const spoken = document.getElementById('spoken');

let viewW = 1280;
let viewH = 800;

function resizeStage() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeStage);
resizeStage();

/* ---------------- input ---------------- */

const keysDown = {};
const mouse = { x: viewW / 2, y: viewH / 3, down: false };

window.addEventListener('keydown', (ev) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
  if (!ev.repeat) keysDown[ev.code] = true;
  onKeyPress(ev.code);
});
window.addEventListener('keyup', (ev) => { keysDown[ev.code] = false; });
canvas.addEventListener('mousemove', (ev) => { mouse.x = ev.clientX; mouse.y = ev.clientY; });
canvas.addEventListener('mousedown', (ev) => {
  EmberAudio.ensure();
  mouse.down = true;
  onTap(ev.clientX, ev.clientY);
});
window.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('touchstart', (ev) => {
  const t = ev.changedTouches[0];
  mouse.x = t.clientX; mouse.y = t.clientY; mouse.down = true;
  onTap(t.clientX, t.clientY);
}, { passive: true });
canvas.addEventListener('touchmove', (ev) => {
  const t = ev.changedTouches[0];
  mouse.x = t.clientX; mouse.y = t.clientY;
}, { passive: true });
canvas.addEventListener('touchend', () => { mouse.down = false; });

function moveInput() {
  let x = 0;
  let y = 0;
  if (keysDown.KeyA || keysDown.ArrowLeft) x -= 1;
  if (keysDown.KeyD || keysDown.ArrowRight) x += 1;
  if (keysDown.KeyW || keysDown.ArrowUp) y -= 1;
  if (keysDown.KeyS || keysDown.ArrowDown) y += 1;
  const d = Math.hypot(x, y);
  if (d > 0) { x /= d; y /= d; }
  return { x, y };
}

function firingInput() {
  return mouse.down || !!keysDown.Space;
}

/* ---------------- run state ---------------- */

const G = {
  screen: 'title', // title | play | draft | pause | over | won
  time: 0,
  kills: 0,
  build: freshBuild(),
  player: null,
  enemies: [],
  bolts: [],
  globs: [],
  shards: [],
  parts: [],
  texts: [],
  spawner: makeSpawner(),
  bossFlags: [false, false],
  boss: null,
  shake: 0,
  flashRed: 0,
  pendingLevels: 0,
  draftCards: [],
  draftRects: [],
  buttons: [],
  endless: false,
  wonOnce: false,
  demo: false,
  pickupCombo: 0,
  pickupComboTimer: 0,
  best: Number(localStorage.getItem('emberlight_best') || 0),
  announce: '',
};

function scoreNow() {
  return G.kills + Math.floor(Math.min(G.time, 99999));
}

function xpForLevel(level) {
  return Math.round(6 + (level - 1) * 5 + Math.pow(level - 1, 1.65) * 2);
}

function lighthousePos() {
  return { x: viewW / 2, y: viewH * 0.54 };
}

function flamePos() {
  const l = lighthousePos();
  return { x: l.x, y: l.y - 118 };
}

function newPlayer() {
  return {
    x: viewW / 2, y: viewH * 0.78,
    vx: 0, vy: 0,
    radius: 13,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, xpNext: xpForLevel(1),
    fireCd: 0,
    hurtCd: 0,
    aim: -Math.PI / 2,
    trail: [],
    secondWindUsed: false,
  };
}

function syncMaxHp(healToFull) {
  const p = G.player;
  const target = 100 + (G.build.maxHpBonus || 0);
  if (healToFull) p.hp = target;
  p.maxHp = target;
  p.hp = Math.min(p.hp, p.maxHp);
}

function startRun() {
  G.build = freshBuild();
  G.player = newPlayer();
  syncMaxHp(true);
  G.enemies = [];
  G.bolts = [];
  G.globs = [];
  G.shards = [];
  G.parts = [];
  G.texts = [];
  G.spawner = makeSpawner();
  G.bossFlags = [false, false];
  G.boss = null;
  G.time = 0;
  G.kills = 0;
  G.shake = 0;
  G.flashRed = 0;
  G.pendingLevels = 0;
  G.endless = false;
  G.wonOnce = false;
  G.screen = 'play';
  announce('The night begins. Keep the flame until dawn.');
}

function announce(text) {
  G.announce = text;
  if (spoken) spoken.textContent = text;
}

/* ---------------- demo / attract mode ----------------
 * ?demo=<seconds> starts a staged run at that point of the night, flown by
 * the autopilot, so screenshots (see shots.json) show the real game mid-run.
 * ?demo=<seconds>&draft=1 stages a level-up draft over the action, and
 * ?demo=win stages the victory screen at dawn.
 */

const DEMO_ROTATION = [
  'heavy', 'rapid', 'split', 'brands', 'magnet', 'pierce', 'swift', 'emberheart',
  'rapid', 'heavy', 'split', 'brands', 'swift', 'magnet', 'pierce', 'emberheart',
  'rapid', 'heavy', 'split', 'brands', 'swift', 'magnet',
];

function stageDemo(seconds, opts) {
  startRun();
  G.demo = true;
  const p = G.player;
  G.time = seconds;
  const levels = Math.max(0, Math.floor(seconds / 23));
  for (let i = 0; i < levels; i += 1) {
    applyUpgrade(G.build, DEMO_ROTATION[i % DEMO_ROTATION.length]);
    p.level += 1;
  }
  syncMaxHp(false);
  p.xpNext = xpForLevel(p.level);
  p.xp = Math.floor(p.xpNext * 0.45);
  p.hp = Math.round(p.maxHp * 0.72);
  G.kills = Math.round(seconds * 1.7);
  p.x = viewW * 0.38;
  p.y = viewH * 0.6;
  const count = Math.min(8 + seconds * 0.15, 40);
  for (let i = 0; i < count; i += 1) {
    const kind = pickSpawnKind(seconds);
    const a = Math.random() * Math.PI * 2;
    const d = 215 + Math.random() * 330;
    const x = clamp(p.x + Math.cos(a) * d, 30, viewW - 30);
    const y = clamp(p.y + Math.sin(a) * d, 30, viewH - 30);
    G.enemies.push(makeEnemy(kind, x, y, enemyHpScale(seconds), seconds > 190 && Math.random() < 0.12));
  }
  if (seconds >= BOSS_TIMES[0]) {
    G.bossFlags[0] = true;
    const strong = seconds >= BOSS_TIMES[1];
    if (strong) G.bossFlags[1] = true;
    const boss = makeEnemy('herald', clamp(p.x + 405, 80, viewW - 80), clamp(p.y - 235, 80, viewH - 80), strong ? 2.1 : 1.15, false);
    boss.hp = Math.round(boss.maxHp * 0.55);
    G.enemies.push(boss);
    G.boss = boss;
  }
  for (let i = 0; i < 14; i += 1) {
    dropShard(p.x + (Math.random() - 0.5) * 420, p.y + (Math.random() - 0.5) * 300, 1);
  }
  if (opts && opts.win) {
    G.time = NIGHT_SECONDS;
    G.wonOnce = true;
    G.screen = 'won';
    announce('Dawn breaks. The flame still burns.');
  } else if (opts && opts.draft) {
    openDraft();
  }
}

function autopilot(dt) {
  const p = G.player;
  let mx = 0;
  let my = 0;
  let nearest = null;
  let nearestD = Infinity;
  for (const e of G.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < nearestD) { nearestD = d; nearest = e; }
    if (d < 170) {
      const w = (170 - d) / 170 * (e.radius + 26);
      mx += (dx / d) * w;
      my += (dy / d) * w;
    }
  }
  let shard = null;
  let shardD = Infinity;
  for (const s of G.shards) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < shardD) { shardD = d; shard = s; }
  }
  if (shard && shardD < 380) {
    mx += (shard.x - p.x) * 0.012;
    my += (shard.y - p.y) * 0.012;
  }
  const home = flamePos();
  mx += (home.x - p.x) * 0.0016;
  my += (home.y + 150 - p.y) * 0.0016;
  const d = Math.hypot(mx, my);
  if (d > 1) { mx /= d; my /= d; }
  if (nearest) {
    mouse.x = nearest.x;
    mouse.y = nearest.y;
  }
  return { x: mx, y: my };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---------------- spawning ---------------- */

function spawnPoint(flock) {
  const edge = Math.floor(Math.random() * 4);
  const m = flock ? 26 : 48;
  if (edge === 0) return { x: Math.random() * viewW, y: -m };
  if (edge === 1) return { x: viewW + m, y: Math.random() * viewH };
  if (edge === 2) return { x: Math.random() * viewW, y: viewH + m };
  return { x: -m, y: Math.random() * viewH };
}

function spawnEnemy(kind, flock) {
  const at = spawnPoint(flock);
  const elite = G.time > 185 && Math.random() < 0.12;
  const e = makeEnemy(kind, at.x, at.y, enemyHpScale(G.time), elite);
  G.enemies.push(e);
  return e;
}

function spawnBoss(which) {
  const at = spawnPoint(false);
  const boss = makeEnemy('herald', at.x, at.y, which === 2 ? 2.1 : 1.15, false);
  G.enemies.push(boss);
  G.boss = boss;
  EmberAudio.roar();
  G.shake = Math.max(G.shake, 9);
  announce(which === 2 ? 'The Gloom Herald returns, wreathed in dark.' : 'The Gloom Herald approaches.');
}

/* ---------------- pieces ---------------- */

function dropShard(x, y, value) {
  G.shards.push({
    x, y,
    vx: (Math.random() - 0.5) * 60,
    vy: (Math.random() - 0.5) * 60,
    value,
    age: Math.random() * 6,
  });
}

function burstParts(x, y, n, color, speed, size, life) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    G.parts.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: life * (0.6 + Math.random() * 0.7), maxLife: life,
      size: size * (0.6 + Math.random() * 0.8),
      color,
      drag: 2.6,
      rise: 0,
    });
  }
}

function emberParts(x, y, n) {
  for (let i = 0; i < n; i += 1) {
    G.parts.push({
      x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 24, vy: -22 - Math.random() * 30,
      life: 0.9 + Math.random() * 0.9, maxLife: 1.6,
      size: 1.4 + Math.random() * 2.2,
      color: Math.random() < 0.5 ? '#ffb45e' : '#ff8a3d',
      drag: 0.4,
      rise: 26,
    });
  }
}

function floatText(x, y, text, color, size) {
  G.texts.push({ x, y, text, color, size: size || 13, life: 0.85, maxLife: 0.85 });
}

/* ---------------- combat ---------------- */

function fireBolts() {
  const p = G.player;
  const b = G.build;
  const base = Math.atan2(mouse.y - p.y, mouse.x - p.x);
  p.aim = base;
  const n = b.projectiles;
  for (let i = 0; i < n; i += 1) {
    const off = (i - (n - 1) / 2) * 0.085;
    const a = base + off;
    G.bolts.push({
      x: p.x + Math.cos(base) * 16, y: p.y + Math.sin(base) * 16,
      vx: Math.cos(a) * 660, vy: Math.sin(a) * 660,
      life: 0.95, damage: b.damage, pierce: b.pierce, hits: [],
    });
  }
  emberParts(p.x + Math.cos(base) * 18, p.y + Math.sin(base) * 18, 1);
  EmberAudio.shoot();
}

function damageEnemy(e, amount, kx, ky) {
  e.hp -= amount;
  e.flash = 0.09;
  const mass = e.kind === 'beetle' ? 0.25 : e.kind === 'herald' ? 0.05 : 1;
  e.vx += kx * mass;
  e.vy += ky * mass;
  floatText(e.x + (Math.random() - 0.5) * 14, e.y - e.radius - 6, String(Math.round(amount)), '#ffd9a0', e.kind === 'herald' ? 15 : 12);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  G.kills += 1;
  const big = e.kind === 'herald' || e.kind === 'beetle';
  burstParts(e.x, e.y, e.kind === 'herald' ? 60 : big ? 22 : 12, e.kind === 'sprite' ? '#a8c8e8' : '#8f83c0', big ? 190 : 140, big ? 3.4 : 2.4, 0.7);
  burstParts(e.x, e.y, 6, '#ffb45e', 90, 2, 0.9);
  EmberAudio.die(e.kind === 'herald');
  const drops = e.kind === 'herald' ? 14 : e.elite ? 4 : 1;
  for (let i = 0; i < drops; i += 1) {
    dropShard(e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, e.kind === 'herald' ? 3 : e.xp);
  }
  if (e.kind === 'herald') {
    G.boss = null;
    G.shake = Math.max(G.shake, 12);
    floatText(e.x, e.y - 40, 'THE HERALD FALLS', '#ffe9b0', 22);
    announce('The Gloom Herald falls.');
  }
}

function hurtPlayer(amount) {
  const p = G.player;
  if (p.hurtCd > 0 || G.screen !== 'play') return;
  p.hurtCd = 0.7;
  p.hp -= amount;
  G.flashRed = 0.55;
  G.shake = Math.max(G.shake, 6);
  EmberAudio.hurt();
  burstParts(p.x, p.y, 10, '#ff7a5e', 130, 2.4, 0.5);
  if (p.hp <= 0) {
    if (G.build.secondWind && !p.secondWindUsed) {
      p.secondWindUsed = true;
      p.hp = Math.round(p.maxHp * 0.5);
      p.hurtCd = 1.6;
      G.shake = 12;
      burstParts(p.x, p.y, 46, '#ffcf7a', 240, 3, 0.9);
      floatText(p.x, p.y - 30, 'SECOND WIND', '#ffe9b0', 20);
      announce('Second wind! Your light flares back.');
      return;
    }
    if (G.demo) {
      p.hp = Math.round(p.maxHp * 0.4);
      return;
    }
    p.hp = 0;
    finishRun(false);
  }
}

function finishRun(wonGame) {
  const score = scoreNow();
  if (score > G.best) {
    G.best = score;
    localStorage.setItem('emberlight_best', String(score));
  }
  if (wonGame) {
    G.screen = 'won';
    G.wonOnce = true;
    EmberAudio.winJingle();
    announce('Dawn breaks. The flame still burns.');
  } else {
    G.screen = 'over';
    EmberAudio.loseTone();
    announce('Your light has gone out.');
  }
}

function addXp(value) {
  const p = G.player;
  p.xp += value;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level += 1;
    p.xpNext = xpForLevel(p.level);
    G.pendingLevels += 1;
  }
  if (G.pendingLevels > 0 && G.screen === 'play') openDraft();
}

function openDraft() {
  G.draftCards = rollDraft(G.build, 3);
  G.screen = 'draft';
  EmberAudio.draft();
  announce('Level up. Choose a blessing.');
}

function chooseCard(index) {
  const card = G.draftCards[index];
  if (!card) return;
  const fx = applyUpgrade(G.build, card.id);
  syncMaxHp(false);
  if (fx.heal) G.player.hp = Math.min(G.player.maxHp, G.player.hp + fx.heal);
  G.pendingLevels -= 1;
  EmberAudio.levelup();
  burstParts(G.player.x, G.player.y, 26, '#ffcf7a', 170, 2.6, 0.8);
  if (G.pendingLevels > 0) {
    G.draftCards = rollDraft(G.build, 3);
  } else {
    G.screen = 'play';
  }
}

/* ---------------- the world step ---------------- */

function updatePlay(dt) {
  const p = G.player;
  const b = G.build;
  G.time += dt;

  // Dawn, and what comes after.
  if (!G.endless && G.time >= NIGHT_SECONDS) {
    G.time = NIGHT_SECONDS;
    finishRun(true);
    return;
  }
  for (let i = 0; i < BOSS_TIMES.length; i += 1) {
    if (!G.bossFlags[i] && G.time >= BOSS_TIMES[i]) {
      G.bossFlags[i] = true;
      spawnBoss(i + 1);
    }
  }

  spawnerStep(G.spawner, dt, G.time, G.enemies.length, (kind, flock) => spawnEnemy(kind, flock));

  // The keeper.
  const move = G.demo ? autopilot(dt) : moveInput();
  const accel = 1500;
  p.vx += move.x * accel * dt;
  p.vy += move.y * accel * dt;
  const damp = Math.pow(0.0016, dt);
  p.vx *= damp;
  p.vy *= damp;
  const spd = Math.hypot(p.vx, p.vy);
  const maxSpd = b.moveSpeed;
  if (spd > maxSpd) { p.vx = p.vx / spd * maxSpd; p.vy = p.vy / spd * maxSpd; }
  p.x = clamp(p.x + p.vx * dt, p.radius, viewW - p.radius);
  p.y = clamp(p.y + p.vy * dt, p.radius, viewH - p.radius);
  if (p.hurtCd > 0) p.hurtCd -= dt;
  p.trail.unshift({ x: p.x, y: p.y });
  if (p.trail.length > 14) p.trail.pop();
  emberParts(p.x, p.y + 6, Math.random() < 0.5 ? 1 : 0);

  // The flame mends its keeper, close by.
  const fp = flamePos();
  if (Math.hypot(p.x - fp.x, p.y - fp.y) < 128 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 2.2 * (1 + 2 * b.beaconBlessing) * dt);
  }

  // Firing.
  p.fireCd -= dt;
  const wantFire = G.demo ? true : firingInput();
  if (wantFire && p.fireCd <= 0 && G.enemies.length > 0) {
    fireBolts();
    p.fireCd = 1 / b.shotsPerSecond;
  }
  if (!G.demo) p.aim = Math.atan2(mouse.y - p.y, mouse.x - p.x);

  updateBolts(dt);
  updateGlobs(dt);
  updateEnemies(dt);
  updateShards(dt);
  updateParts(dt);
  updateTexts(dt);
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 26);
  if (G.flashRed > 0) G.flashRed = Math.max(0, G.flashRed - dt * 1.6);
  if (G.pickupComboTimer > 0) {
    G.pickupComboTimer -= dt;
    if (G.pickupComboTimer <= 0) G.pickupCombo = 0;
  }
}

function updateBolts(dt) {
  for (const bolt of G.bolts) {
    bolt.x += bolt.vx * dt;
    bolt.y += bolt.vy * dt;
    bolt.life -= dt;
    for (const e of G.enemies) {
      if (e.dead || bolt.hits.includes(e.id)) continue;
      const d = Math.hypot(e.x - bolt.x, e.y - bolt.y);
      if (d < e.radius + 6) {
        bolt.hits.push(e.id);
        damageEnemy(e, bolt.damage, bolt.vx * 0.14, bolt.vy * 0.14);
        EmberAudio.hit();
        burstParts(bolt.x, bolt.y, 3, '#ffcf7a', 90, 1.8, 0.35);
        if (bolt.hits.length > bolt.pierce) { bolt.life = 0; break; }
      }
    }
  }
  G.bolts = G.bolts.filter((bolt) => bolt.life > 0 && bolt.x > -30 && bolt.x < viewW + 30 && bolt.y > -30 && bolt.y < viewH + 30);
}

function updateGlobs(dt) {
  const p = G.player;
  for (const g of G.globs) {
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.life -= dt;
    if (Math.hypot(g.x - p.x, g.y - p.y) < g.radius + p.radius - 2) {
      g.life = 0;
      hurtPlayer(g.damage);
    }
  }
  G.globs = G.globs.filter((g) => g.life > 0);
}

const enemyCtx = {
  player: null,
  onGlob(e) {
    const p = G.player;
    const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    G.globs.push({ x: e.x, y: e.y, vx: (p.x - e.x) / d * 235, vy: (p.y - e.y) / d * 235, radius: 6, damage: 9, life: 3.6 });
  },
  onBurst(e) {
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2 + e.age;
      G.globs.push({ x: e.x, y: e.y, vx: Math.cos(a) * 175, vy: Math.sin(a) * 175, radius: 6, damage: 12, life: 3.2 });
    }
    EmberAudio.roar();
  },
  onSummon(e) {
    for (let i = 0; i < 4; i += 1) {
      const a = Math.random() * Math.PI * 2;
      G.enemies.push(makeEnemy('moth', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, enemyHpScale(G.time), false));
    }
  },
};

function updateEnemies(dt) {
  const p = G.player;
  enemyCtx.player = p;
  const now = G.time;
  for (const e of G.enemies) {
    if (!e.dead) updateEnemy(e, dt, enemyCtx);
  }
  // Keep the press from stacking into one knot.
  const list = G.enemies;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.dead) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      const o = list[j];
      if (o.dead) continue;
      const dx = o.x - a.x;
      const dy = o.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = (a.radius + o.radius) * 0.82;
      if (d > 0.01 && d < min) {
        const push = (min - d) / d * 0.5;
        a.x -= dx * push * 0.5;
        a.y -= dy * push * 0.5;
        o.x += dx * push * 0.5;
        o.y += dy * push * 0.5;
      }
    }
  }
  // Orbiting brands.
  const b = G.build;
  if (b.blades > 0) {
    for (let i = 0; i < b.blades; i += 1) {
      const a = now * 2.6 + (i / b.blades) * Math.PI * 2;
      const bx = p.x + Math.cos(a) * 58;
      const by = p.y + Math.sin(a) * 58;
      for (const e of list) {
        if (e.dead || now - e.bladeHitAt < 0.38) continue;
        if (Math.hypot(e.x - bx, e.y - by) < e.radius + 12) {
          e.bladeHitAt = now;
          damageEnemy(e, b.damage * 0.9, (e.x - p.x) * 2.2, (e.y - p.y) * 2.2);
        }
      }
    }
  }
  // Contact with the keeper.
  for (const e of list) {
    if (e.dead) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + p.radius - 3) {
      hurtPlayer(e.damage);
      const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      p.vx += (p.x - e.x) / d * 190;
      p.vy += (p.y - e.y) / d * 190;
    }
  }
  G.enemies = list.filter((e) => !e.dead);
  if (G.boss && G.boss.dead) G.boss = null;
}

function updateShards(dt) {
  const p = G.player;
  const magnet = G.build.magnetRadius;
  for (const s of G.shards) {
    s.age += dt;
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < magnet) {
      const pull = 640 * (1 - d / magnet) + 130;
      s.vx += (dx / d) * pull * dt * 4;
      s.vy += (dy / d) * pull * dt * 4;
    }
    s.vx *= Math.pow(0.02, dt);
    s.vy *= Math.pow(0.02, dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (d < p.radius + 12) {
      s.taken = true;
      G.pickupCombo += 1;
      G.pickupComboTimer = 1.1;
      EmberAudio.pickup(G.pickupCombo);
      addXp(s.value);
    }
  }
  G.shards = G.shards.filter((s) => !s.taken);
}

function updateParts(dt) {
  for (const pt of G.parts) {
    pt.life -= dt;
    pt.vx *= Math.pow(0.5, dt * pt.drag);
    pt.vy = pt.vy * Math.pow(0.5, dt * pt.drag) - pt.rise * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
  G.parts = G.parts.filter((pt) => pt.life > 0);
  if (G.parts.length > 700) G.parts.splice(0, G.parts.length - 700);
}

function updateTexts(dt) {
  for (const t of G.texts) {
    t.life -= dt;
    t.y -= 34 * dt;
  }
  G.texts = G.texts.filter((t) => t.life > 0);
}

/* ---------------- drawing helpers ---------------- */

let uiTime = 0;
const STARS = [];
for (let i = 0; i < 130; i += 1) {
  STARS.push({ x: Math.random(), y: Math.random() * 0.72, r: Math.random() * 1.3 + 0.4, tw: Math.random() * 6 });
}

function lerp(a, b, k) { return a + (b - a) * k; }

function mixRgb(c1, c2, k) {
  return [Math.round(lerp(c1[0], c2[0], k)), Math.round(lerp(c1[1], c2[1], k)), Math.round(lerp(c1[2], c2[2], k))];
}

function rgb(c, a) {
  return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function dawnAmount() {
  if (G.wonOnce) return 1;
  return clamp(G.time / NIGHT_SECONDS, 0, 1);
}

function text(str, x, y, size, color, align, weight) {
  ctx.font = `${weight || 600} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function wrapLines(str, size, maxWidth) {
  ctx.font = `600 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------- the scene ---------------- */

function drawBackground() {
  const k = dawnAmount();
  const top = mixRgb([7, 10, 36], [61, 74, 125], k);
  const mid = mixRgb([19, 26, 63], [125, 90, 126], k);
  const hor = mixRgb([42, 35, 80], [232, 151, 90], k);
  const grad = ctx.createLinearGradient(0, 0, 0, viewH);
  grad.addColorStop(0, rgb(top));
  grad.addColorStop(0.55, rgb(mid));
  grad.addColorStop(1, rgb(hor));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH);

  // Stars, thinning as the sky pales.
  for (const s of STARS) {
    const tw = 0.55 + Math.sin(uiTime * 1.7 + s.tw) * 0.45;
    ctx.globalAlpha = (1 - k * 0.92) * tw * 0.9;
    ctx.fillStyle = '#dfe8ff';
    ctx.beginPath();
    ctx.arc(s.x * viewW, s.y * viewH, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The moon early, the sun's first glow late.
  if (k < 0.75) {
    const mx = viewW * 0.84;
    const my = viewH * 0.16;
    ctx.globalAlpha = 1 - k / 0.75;
    ctx.fillStyle = '#e8ecf7';
    ctx.beginPath();
    ctx.arc(mx, my, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(top);
    ctx.beginPath();
    ctx.arc(mx + 10, my - 7, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (k > 0.55) {
    const sg = ctx.createRadialGradient(viewW / 2, viewH * 1.02, 10, viewW / 2, viewH * 1.02, viewW * 0.55);
    sg.addColorStop(0, `rgba(255,196,110,${(k - 0.55) * 0.85})`);
    sg.addColorStop(1, 'rgba(255,196,110,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  // The sea, a dark band with a path of light under the flame.
  const seaY = viewH * 0.84;
  ctx.fillStyle = rgb(mixRgb([8, 13, 38], [38, 44, 84], k));
  ctx.fillRect(0, seaY, viewW, viewH - seaY);
  ctx.strokeStyle = `rgba(255,190,110,${0.05 + k * 0.12})`;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 22; i += 1) {
    const y = seaY + 6 + i * ((viewH - seaY) / 22);
    const cx = viewW / 2 + Math.sin(uiTime * 0.7 + i * 1.9) * 14;
    const wdt = 26 + ((i * 53) % 60) + k * 60;
    ctx.beginPath();
    ctx.moveTo(cx - wdt / 2, y);
    ctx.lineTo(cx + wdt / 2, y);
    ctx.stroke();
  }
}

function drawLighthouse() {
  const base = lighthousePos();
  const fp = flamePos();
  const k = dawnAmount();

  // The rotating beam, two soft cones turning through the night.
  const beamA = uiTime * 0.45;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const flip of [0, Math.PI]) {
    const a = beamA + flip;
    const g = ctx.createRadialGradient(fp.x, fp.y, 4, fp.x, fp.y, 330);
    g.addColorStop(0, `rgba(255,205,120,${0.13 + k * 0.05})`);
    g.addColorStop(1, 'rgba(255,205,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fp.x, fp.y);
    ctx.arc(fp.x, fp.y, 330, a - 0.16, a + 0.16);
    ctx.closePath();
    ctx.fill();
  }
  // The flame's own halo.
  const halo = ctx.createRadialGradient(fp.x, fp.y, 2, fp.x, fp.y, 120);
  halo.addColorStop(0, 'rgba(255,214,140,0.5)');
  halo.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(fp.x, fp.y, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The mending ring: stand here to heal.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,205,120,0.16)';
  ctx.setLineDash([5, 9]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(fp.x, fp.y, 128, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rocky islet.
  ctx.fillStyle = '#131126';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y + 26, 118, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1836';
  ctx.beginPath();
  ctx.ellipse(base.x - 20, base.y + 18, 84, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tower: a tapering stack of cream and rust bands.
  const topW = 21;
  const botW = 34;
  const topY = fp.y + 16;
  const botY = base.y + 22;
  const bands = ['#d9c9a8', '#a34a38', '#d9c9a8', '#a34a38', '#d9c9a8'];
  const bandH = (botY - topY) / bands.length;
  for (let i = 0; i < bands.length; i += 1) {
    const y0 = topY + i * bandH;
    const y1 = y0 + bandH;
    const w0 = lerp(topW, botW, i / bands.length);
    const w1 = lerp(topW, botW, (i + 1) / bands.length);
    ctx.fillStyle = bands[i];
    ctx.beginPath();
    ctx.moveTo(base.x - w0, y0);
    ctx.lineTo(base.x + w0, y0);
    ctx.lineTo(base.x + w1, y1);
    ctx.lineTo(base.x - w1, y1);
    ctx.closePath();
    ctx.fill();
  }
  // Gallery and lamp room.
  ctx.fillStyle = '#241f3d';
  ctx.fillRect(base.x - 27, topY - 8, 54, 8);
  ctx.fillRect(base.x - 15, fp.y - 2, 30, topY - fp.y + 2);
  ctx.strokeStyle = '#0e0b20';
  ctx.lineWidth = 2;
  ctx.strokeRect(base.x - 15, fp.y - 2, 30, topY - fp.y + 2);
  ctx.beginPath();
  ctx.moveTo(base.x - 20, fp.y - 2);
  ctx.lineTo(base.x, fp.y - 20);
  ctx.lineTo(base.x + 20, fp.y - 2);
  ctx.closePath();
  ctx.fillStyle = '#33294f';
  ctx.fill();
  // The flame itself.
  const flick = 1 + Math.sin(uiTime * 11) * 0.07;
  ctx.save();
  ctx.translate(fp.x, fp.y + 4);
  ctx.scale(1, flick);
  const fg = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
  fg.addColorStop(0, '#fff6d8');
  fg.addColorStop(0.45, '#ffcf7a');
  fg.addColorStop(1, 'rgba(255,138,61,0)');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShard(s) {
  const pulse = 1 + Math.sin(s.age * 6) * 0.15;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.age * 2.2);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.4, 0);
  ctx.lineTo(0, 6);
  ctx.lineTo(-4.4, 0);
  ctx.closePath();
  ctx.fillStyle = '#ffcf7a';
  ctx.fill();
  ctx.fillStyle = '#fff3cf';
  ctx.beginPath();
  ctx.moveTo(0, -3.4);
  ctx.lineTo(2.4, 0);
  ctx.lineTo(0, 3.4);
  ctx.lineTo(-2.4, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const p = G.player;
  if (!p) return;
  // Trail of cooling sparks.
  for (let i = p.trail.length - 1; i >= 2; i -= 2) {
    const t = p.trail[i];
    const f = 1 - i / p.trail.length;
    ctx.globalAlpha = f * 0.16;
    ctx.fillStyle = '#ff9a3d';
    ctx.beginPath();
    ctx.arc(t.x, t.y, p.radius * f * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (p.hurtCd > 0.9 && Math.floor(uiTime * 16) % 2 === 0) return; // second-wind blink
  const flick = 1 + Math.sin(uiTime * 12) * 0.05;
  const glow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 44);
  glow.addColorStop(0, 'rgba(255,190,100,0.55)');
  glow.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(clamp(p.vx * 0.0006, -0.3, 0.3));
  ctx.scale(1, flick);
  const body = ctx.createLinearGradient(0, -16, 0, 14);
  body.addColorStop(0, '#ffe9ad');
  body.addColorStop(0.55, '#ffb45e');
  body.addColorStop(1, '#ff7a2f');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.quadraticCurveTo(10, -4, 9, 5);
  ctx.quadraticCurveTo(8, 14, 0, 15);
  ctx.quadraticCurveTo(-8, 14, -9, 5);
  ctx.quadraticCurveTo(-10, -4, 0, -17);
  ctx.fill();
  ctx.fillStyle = '#fff8e2';
  ctx.beginPath();
  ctx.ellipse(0, 5, 4.6, 6.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes toward the aim.
  const ex = Math.cos(p.aim) * 1.8;
  const ey = Math.sin(p.aim) * 1.4;
  ctx.fillStyle = '#40260f';
  ctx.beginPath();
  ctx.arc(-3.4 + ex, -2 + ey, 1.5, 0, Math.PI * 2);
  ctx.arc(3.4 + ex, -2 + ey, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Orbiting brands.
  const b = G.build;
  for (let i = 0; i < b.blades; i += 1) {
    const a = G.time * 2.6 + (i / b.blades) * Math.PI * 2;
    const bx = p.x + Math.cos(a) * 58;
    const by = p.y + Math.sin(a) * 58;
    const bg = ctx.createRadialGradient(bx, by, 1, bx, by, 13);
    bg.addColorStop(0, '#fff3cf');
    bg.addColorStop(0.4, '#ffb45e');
    bg.addColorStop(1, 'rgba(255,122,47,0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWorld() {
  ctx.save();
  if (G.shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  }
  drawBackground();
  drawLighthouse();
  for (const s of G.shards) drawShard(s);
  for (const g of G.globs) {
    ctx.fillStyle = '#3d2b57';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,160,255,0.8)';
    ctx.beginPath();
    ctx.arc(g.x - 2, g.y - 2, g.radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of G.enemies) drawEnemy(ctx, e);
  for (const bolt of G.bolts) {
    const grad = ctx.createLinearGradient(bolt.x - bolt.vx * 0.02, bolt.y - bolt.vy * 0.02, bolt.x, bolt.y);
    grad.addColorStop(0, 'rgba(255,150,60,0)');
    grad.addColorStop(1, '#ffcf7a');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bolt.x - bolt.vx * 0.02, bolt.y - bolt.vy * 0.02);
    ctx.lineTo(bolt.x, bolt.y);
    ctx.stroke();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(bolt.x, bolt.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  drawPlayer();
  for (const pt of G.parts) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const t of G.texts) {
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    text(t.text, t.x, t.y, t.size, t.color, 'center', 700);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (G.flashRed > 0) {
    ctx.fillStyle = `rgba(200,40,30,${G.flashRed * 0.13})`;
    ctx.fillRect(0, 0, viewW, viewH);
  }
}

/* ---------------- HUD ---------------- */

function bar(x, y, w, h, frac, fill, back) {
  ctx.fillStyle = back || 'rgba(8,10,26,0.66)';
  roundRect(x, y, w, h, h / 2);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = fill;
    roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
    ctx.fill();
  }
}

function drawHud() {
  const p = G.player;
  if (!p) return;
  // Health, top left.
  text('♥', 26, 30, 21, '#ff8a6b', 'left');
  bar(50, 22, 190, 15, p.hp / p.maxHp, p.hp / p.maxHp < 0.3 ? '#e84a3c' : '#ff9a3d');
  text(`${Math.ceil(p.hp)} / ${p.maxHp}`, 50, 52, 12.5, '#e9dfc9', 'left');

  // Dawn, top centre.
  const dw = Math.min(360, viewW * 0.4);
  const dx = viewW / 2 - dw / 2;
  const dawnFrac = G.endless ? 1 : clamp(G.time / NIGHT_SECONDS, 0, 1);
  ctx.fillStyle = 'rgba(8,10,26,0.55)';
  roundRect(dx - 8, 14, dw + 16, 34, 9);
  ctx.fill();
  bar(dx, 22, dw, 9, dawnFrac, '#ffcf7a', 'rgba(255,255,255,0.14)');
  const left = Math.max(0, NIGHT_SECONDS - G.time);
  const label = G.endless
    ? 'ENDLESS NIGHT — how long can you burn?'
    : `Dawn in ${Math.floor(left / 60)}:${String(Math.ceil(left % 60)).padStart(2, '0')}`;
  text(label, viewW / 2, 41, 12.5, '#f5ead9', 'center');

  // Score, top right.
  text(`SCORE ${scoreNow()}`, viewW - 24, 28, 19, '#ffe9b0', 'right', 800);
  text(`Banished ${G.kills} · Level ${p.level}`, viewW - 24, 52, 12.5, '#cfc4e8', 'right');

  // The Herald's health.
  if (G.boss && !G.boss.dead) {
    const bw = Math.min(430, viewW * 0.5);
    text('THE GLOOM HERALD', viewW / 2, 66, 12, '#bfa8ff', 'center', 800);
    bar(viewW / 2 - bw / 2, 76, bw, 8, G.boss.hp / G.boss.maxHp, '#7d5fd0', 'rgba(8,10,26,0.66)');
  }

  // Experience, along the bottom.
  bar(18, viewH - 24, viewW - 36, 10, p.xp / p.xpNext, '#ffd76e', 'rgba(8,10,26,0.66)');
  ctx.fillStyle = '#ff9a3d';
  ctx.beginPath();
  ctx.arc(30, viewH - 40, 13, 0, Math.PI * 2);
  ctx.fill();
  text(String(p.level), 30, viewH - 39, 13, '#2a1503', 'center', 800);
  text('WASD move · mouse aim · hold click / Space to fire · P pause · M mute', viewW / 2, viewH - 42, 11.5, 'rgba(233,223,201,0.6)', 'center', 500);

  // Low-health pulse.
  if (p.hp / p.maxHp < 0.3 && G.screen === 'play') {
    const a = 0.1 + Math.sin(uiTime * 5) * 0.05;
    const vg = ctx.createRadialGradient(viewW / 2, viewH / 2, viewH * 0.34, viewW / 2, viewH / 2, viewH * 0.75);
    vg.addColorStop(0, 'rgba(160,20,10,0)');
    vg.addColorStop(1, `rgba(160,20,10,${a + 0.12})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, viewW, viewH);
  }
}

/* ---------------- screens ---------------- */

function dimScreen(alpha) {
  ctx.fillStyle = `rgba(5,6,18,${alpha})`;
  ctx.fillRect(0, 0, viewW, viewH);
}

function button(x, y, w, h, label, action) {
  const hover = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
  ctx.fillStyle = hover ? '#ffb45e' : 'rgba(255,180,94,0.16)';
  roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = '#ffb45e';
  ctx.lineWidth = 1.4;
  roundRect(x, y, w, h, 10);
  ctx.stroke();
  text(label, x + w / 2, y + h / 2 + 1, 16, hover ? '#2a1503' : '#ffe9b0', 'center', 700);
  G.buttons.push({ x, y, w, h, action });
}

function statRows(rows, cx, y0) {
  rows.forEach(([k, v], i) => {
    text(k, cx - 16, y0 + i * 27, 15, '#b9aed6', 'right');
    text(v, cx + 16, y0 + i * 27, 15, '#f5ead9', 'left', 700);
  });
}

function drawTitle() {
  drawWorld();
  dimScreen(0.38);
  const cx = viewW / 2;
  // A soft panel behind the words, so they stay readable over the tower.
  const panelW = Math.min(680, viewW - 40);
  ctx.fillStyle = 'rgba(5,6,18,0.42)';
  roundRect(cx - panelW / 2, viewH * 0.345, panelW, viewH * 0.435, 18);
  ctx.fill();
  const flick = 1 + Math.sin(uiTime * 9) * 0.02;
  ctx.save();
  ctx.translate(cx, viewH * 0.24);
  ctx.scale(flick, flick);
  ctx.shadowColor = 'rgba(255,160,60,0.85)';
  ctx.shadowBlur = 42;
  text('EMBERLIGHT', 0, 0, Math.min(76, viewW * 0.09), '#ffcf7a', 'center', 800);
  ctx.restore();
  text('keep the flame until dawn', cx, viewH * 0.24 + 52, 19, '#e9dfc9', 'center', 500);
  const story = 'You are the Keeper, a wisp of ember light, and the lighthouse flame behind you is the last light on the coast. The gloom comes in moth, beetle and sprite to snuff it out. Burn them back, gather their light, grow stronger — and still be burning when the sun rises.';
  wrapLines(story, 15.5, Math.min(620, viewW - 80)).forEach((line, i) => {
    text(line, cx, viewH * 0.40 + i * 23, 15.5, '#cfc4e8', 'center', 500);
  });
  const controls = [
    'WASD / arrows — move',
    'Mouse — aim · hold click or Space — fire ember bolts',
    'Gather light shards to level up and choose a blessing',
    'Stand in the dashed ring by the flame to mend',
    'Survive 5:00 until dawn · P pause · M mute',
  ];
  controls.forEach((line, i) => text(line, cx, viewH * 0.60 + i * 22, 14.5, '#e9dfc9', 'center', 500));
  if (G.best > 0) text(`Best score ${G.best}`, cx, viewH * 0.60 + controls.length * 22 + 12, 14, '#ffcf7a', 'center', 700);
  if (Math.floor(uiTime * 1.6) % 2 === 0) {
    text('Click or press Enter to begin the night', cx, viewH * 0.85, 19, '#ffe9b0', 'center', 800);
  }
}

function drawDraft() {
  drawWorld();
  drawHud();
  dimScreen(0.48);
  const cx = viewW / 2;
  text('THE FLAME GROWS', cx, viewH * 0.16, 32, '#ffcf7a', 'center', 800);
  text(`Level ${G.player.level} — choose a blessing (click, or press 1 · 2 · 3)`, cx, viewH * 0.16 + 38, 15, '#e9dfc9', 'center', 500);
  const cardW = Math.min(248, (viewW - 90) / 3);
  const cardH = 272;
  const gap = 22;
  const totalW = cardW * 3 + gap * 2;
  const x0 = cx - totalW / 2;
  const y0 = viewH * 0.30;
  G.draftRects = [];
  G.draftCards.forEach((card, i) => {
    const x = x0 + i * (cardW + gap);
    const hover = mouse.x >= x && mouse.x <= x + cardW && mouse.y >= y0 && mouse.y <= y0 + cardH;
    ctx.fillStyle = hover ? 'rgba(52,38,20,0.96)' : 'rgba(16,14,34,0.96)';
    roundRect(x, y0, cardW, cardH, 14);
    ctx.fill();
    ctx.strokeStyle = hover ? '#ffcf7a' : 'rgba(255,180,94,0.45)';
    ctx.lineWidth = hover ? 2.4 : 1.4;
    roundRect(x, y0, cardW, cardH, 14);
    ctx.stroke();
    ctx.fillStyle = '#ff9a3d';
    ctx.beginPath();
    ctx.arc(x + cardW / 2, y0 + 56, 30, 0, Math.PI * 2);
    ctx.fill();
    text(card.badge, x + cardW / 2, y0 + 57, 19, '#2a1503', 'center', 800);
    text(card.title, x + cardW / 2, y0 + 112, 19, '#ffe9b0', 'center', 800);
    wrapLines(card.text, 14, cardW - 34).forEach((line, j) => {
      text(line, x + cardW / 2, y0 + 146 + j * 20, 14, '#cfc4e8', 'center', 500);
    });
    const stacks = stacksOf(G.build, card.id);
    if (stacks > 0) text(`Now level ${stacks} → ${stacks + 1}`, x + cardW / 2, y0 + cardH - 48, 12.5, '#ffb45e', 'center', 700);
    text(`[ ${i + 1} ]`, x + cardW / 2, y0 + cardH - 22, 13, '#8f83c0', 'center', 700);
    G.draftRects.push({ x, y: y0, w: cardW, h: cardH, index: i });
  });
}

function drawPause() {
  drawWorld();
  drawHud();
  dimScreen(0.6);
  text('PAUSED', viewW / 2, viewH * 0.4, 40, '#ffcf7a', 'center', 800);
  text('The night holds its breath.', viewW / 2, viewH * 0.4 + 42, 16, '#cfc4e8', 'center', 500);
  button(viewW / 2 - 110, viewH * 0.55, 220, 48, 'Resume  (P)', () => { G.screen = 'play'; });
  button(viewW / 2 - 110, viewH * 0.55 + 62, 220, 48, 'New night', () => beginNight());
}

function drawOver() {
  drawWorld();
  dimScreen(0.62);
  const cx = viewW / 2;
  text('THE LIGHT GOES OUT', cx, viewH * 0.22, Math.min(46, viewW * 0.06), '#e86a5e', 'center', 800);
  text(`The dark takes the coast at ${formatClock(G.time)}.`, cx, viewH * 0.22 + 44, 16, '#cfc4e8', 'center', 500);
  statRows([
    ['Score', String(scoreNow())],
    ['Best', String(G.best)],
    ['Banished', String(G.kills)],
    ['Level reached', String(G.player.level)],
    ['Time kept', formatClock(G.time)],
  ], cx, viewH * 0.42);
  button(cx - 110, viewH * 0.68, 220, 50, 'New night  (Enter)', () => beginNight());
}

function drawWon() {
  drawWorld();
  dimScreen(0.25);
  const cx = viewW / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(255,180,80,0.9)';
  ctx.shadowBlur = 30;
  text('DAWN BREAKS', cx, viewH * 0.22, Math.min(52, viewW * 0.065), '#ffe9b0', 'center', 800);
  ctx.restore();
  text('The flame still burns. The coast is safe — because you kept the watch.', cx, viewH * 0.22 + 46, 16, '#fff3d9', 'center', 500);
  statRows([
    ['Score', String(scoreNow())],
    ['Best', String(G.best)],
    ['Banished', String(G.kills)],
    ['Level reached', String(G.player.level)],
  ], cx, viewH * 0.42);
  button(cx - 232, viewH * 0.66, 220, 50, 'Keep the watch', () => {
    G.endless = true;
    G.screen = 'play';
    announce('Endless night. How long can you burn?');
  });
  button(cx + 12, viewH * 0.66, 220, 50, 'New night  (Enter)', () => beginNight());
}

function formatClock(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- taps & keys ---------------- */

function beginNight() {
  EmberAudio.ensure();
  EmberAudio.startMusic();
  startRun();
}

function onTap(x, y) {
  for (const b of G.buttons) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      EmberAudio.click();
      b.action();
      return;
    }
  }
  if (G.screen === 'draft') {
    for (const r of G.draftRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        chooseCard(r.index);
        return;
      }
    }
  }
  if (G.screen === 'title') beginNight();
}

function onKeyPress(code) {
  if (code === 'KeyM') {
    EmberAudio.ensure();
    EmberAudio.toggleMute();
    return;
  }
  if (G.screen === 'title' && (code === 'Enter' || code === 'Space')) beginNight();
  else if (G.screen === 'play' && (code === 'KeyP' || code === 'Escape')) G.screen = 'pause';
  else if (G.screen === 'pause' && (code === 'KeyP' || code === 'Escape' || code === 'Enter')) G.screen = 'play';
  else if (G.screen === 'draft' && ['Digit1', 'Digit2', 'Digit3'].includes(code)) chooseCard(Number(code.slice(-1)) - 1);
  else if (G.screen === 'over' && (code === 'Enter' || code === 'KeyR')) beginNight();
  else if (G.screen === 'won' && code === 'Enter') beginNight();
  else if (G.screen === 'won' && code === 'KeyE') {
    G.endless = true;
    G.screen = 'play';
  }
}

/* ---------------- the loop ---------------- */

let lastStamp = 0;

function frame(stamp) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, lastStamp ? (stamp - lastStamp) / 1000 : 0.016);
  lastStamp = stamp;
  uiTime += dt;
  G.buttons = [];
  if (G.screen === 'play') updatePlay(dt);
  else if (G.screen === 'draft' || G.screen === 'pause') {
    updateParts(dt);
    updateTexts(dt);
  }
  if (G.screen === 'title') drawTitle();
  else if (G.screen === 'draft') drawDraft();
  else if (G.screen === 'pause') drawPause();
  else if (G.screen === 'over') drawOver();
  else if (G.screen === 'won') drawWon();
  else {
    drawWorld();
    drawHud();
  }
}
requestAnimationFrame(frame);

/* ---------------- boot ---------------- */

(function boot() {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo');
  if (demo !== null) {
    if (demo === 'win') {
      stageDemo(NIGHT_SECONDS, { win: true });
    } else {
      const seconds = clamp(parseFloat(demo) || 0, 0, NIGHT_SECONDS - 1);
      stageDemo(seconds, { draft: params.get('draft') === '1' });
    }
  }
})();
