'use strict';
/*
 * Emberlight enemies: the gloom that comes for the flame.
 * Five kinds live here — shadow moths, gloom beetles, dusk sprites, spitters
 * and the Gloom Herald — with their movement, attacks and canvas artwork,
 * plus the spawner that thickens the night as dawn approaches.
 */

const ENEMY_DEFS = {
  moth:   { hp: 18,  speed: 63,  radius: 14, damage: 8,  xp: 1 },
  beetle: { hp: 68,  speed: 34,  radius: 20, damage: 14, xp: 3 },
  sprite: { hp: 10,  speed: 120, radius: 10, damage: 6,  xp: 1 },
  spitter:{ hp: 27,  speed: 49,  radius: 16, damage: 6,  xp: 2 },
  herald: { hp: 950, speed: 31,  radius: 46, damage: 20, xp: 30 },
};

let enemySerial = 0;

function makeEnemy(kind, x, y, hpScale, elite) {
  const def = ENEMY_DEFS[kind];
  const hp = Math.round(def.hp * hpScale * (elite ? 2.6 : 1));
  enemySerial += 1;
  return {
    id: enemySerial,
    kind,
    x, y, vx: 0, vy: 0,
    hp, maxHp: hp,
    radius: def.radius * (elite ? 1.25 : 1),
    speed: def.speed * (0.9 + Math.random() * 0.2),
    damage: def.damage,
    xp: def.xp * (elite ? 3 : 1),
    elite: !!elite,
    age: Math.random() * 10,
    flash: 0,
    fireTimer: 1.2 + Math.random() * 1.4,
    burstTimer: 3.5,
    summonTimer: 6,
    chargeTimer: 5,
    chargeState: 0,
    chargeTime: 0,
    seed: Math.random() * Math.PI * 2,
    bladeHitAt: 0,
  };
}

/** Hit-point growth over the night: the last hour is five times as tough as the first. */
function enemyHpScale(gameTime) {
  return 1 + gameTime / 78;
}

/** Which kinds may appear by this point of the night, and their weights. */
function spawnWeights(gameTime) {
  const w = [['moth', 10]];
  if (gameTime > 22) w.push(['sprite', 3 + gameTime / 60]);
  if (gameTime > 40) w.push(['beetle', 2 + gameTime / 90]);
  if (gameTime > 70) w.push(['spitter', 1.6 + gameTime / 120]);
  return w;
}

function pickSpawnKind(gameTime) {
  const w = spawnWeights(gameTime);
  let total = 0;
  for (const [, weight] of w) total += weight;
  let roll = Math.random() * total;
  for (const [kind, weight] of w) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'moth';
}

function makeSpawner() {
  return { timer: 0.8, flockTimer: 14 };
}

/** Seconds between single spawns: the night thickens from a trickle to a press. */
function spawnInterval(gameTime) {
  const k = Math.min(1, gameTime / 300);
  return 1.32 - 0.95 * k;
}

function spawnerStep(spawner, dt, gameTime, aliveCount, emit) {
  spawner.timer -= dt;
  spawner.flockTimer -= dt;
  if (spawner.timer <= 0 && aliveCount < 110) {
    spawner.timer = spawnInterval(gameTime) * (0.7 + Math.random() * 0.6);
    emit(pickSpawnKind(gameTime), false);
  }
  if (spawner.flockTimer <= 0 && aliveCount < 100) {
    spawner.flockTimer = 16 + Math.random() * 10;
    const kind = Math.random() < 0.5 ? 'sprite' : 'moth';
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i += 1) emit(kind, true);
  }
}

/* ---------------- movement & attacks ----------------
 * ctx: { player:{x,y}, onGlob(enemy), onSummon(enemy), burstAt(x,y) }
 */

function steer(e, dt, tx, ty, speed) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx += (dx / d * speed - e.vx) * Math.min(1, dt * 3.2);
  e.vy += (dy / d * speed - e.vy) * Math.min(1, dt * 3.2);
}

function updateEnemy(e, dt, ctx) {
  e.age += dt;
  if (e.flash > 0) e.flash -= dt;
  const p = ctx.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;

  if (e.kind === 'moth') {
    // Chases, fluttering side to side on its approach.
    const sway = Math.sin(e.age * 5.1 + e.seed) * 34;
    steer(e, dt, p.x - (dy / dist) * sway, p.y + (dx / dist) * sway, e.speed);
  } else if (e.kind === 'beetle') {
    steer(e, dt, p.x, p.y, e.speed);
  } else if (e.kind === 'sprite') {
    // Darts in bursts: a pause, a lunge, a pause.
    const cycle = (e.age + e.seed) % 1.5;
    const burst = cycle < 0.55 ? 1.85 : 0.35;
    steer(e, dt, p.x, p.y, e.speed * burst);
  } else if (e.kind === 'spitter') {
    // Keeps its distance and lobs gloom at the keeper.
    const want = 265;
    const tx = dist > want + 24 ? p.x : dist < want - 24 ? e.x - dx : p.x + (-dy / dist) * 40;
    const ty = dist > want + 24 ? p.y : dist < want - 24 ? e.y - dy : p.y + (dx / dist) * 40;
    steer(e, dt, tx, ty, e.speed);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && dist < 430) {
      e.fireTimer = 2.1 + Math.random() * 0.7;
      ctx.onGlob(e);
    }
  } else if (e.kind === 'herald') {
    updateHerald(e, dt, ctx, dist);
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

function updateHerald(e, dt, ctx, dist) {
  const p = ctx.player;
  if (e.chargeState === 1) {
    // Telegraph: shudders in place before the charge.
    e.chargeTime -= dt;
    e.vx *= 0.86;
    e.vy *= 0.86;
    if (e.chargeTime <= 0) {
      e.chargeState = 2;
      e.chargeTime = 0.62;
      const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      e.vx = (p.x - e.x) / d * 335;
      e.vy = (p.y - e.y) / d * 335;
    }
  } else if (e.chargeState === 2) {
    e.chargeTime -= dt;
    if (e.chargeTime <= 0) e.chargeState = 0;
  } else {
    steer(e, dt, p.x, p.y, e.speed);
    e.chargeTimer -= dt;
    if (e.chargeTimer <= 0 && dist < 520) {
      e.chargeTimer = 6.5;
      e.chargeState = 1;
      e.chargeTime = 0.55;
    }
  }
  e.burstTimer -= dt;
  if (e.burstTimer <= 0) {
    e.burstTimer = 5.2;
    ctx.onBurst(e);
  }
  e.summonTimer -= dt;
  if (e.summonTimer <= 0) {
    e.summonTimer = 8.5;
    ctx.onSummon(e);
  }
}

/* ---------------- artwork ---------------- */

function flashMix(e, normal, flash) {
  return e.flash > 0 ? flash : normal;
}

function drawMoth(c, e) {
  const flap = Math.sin(e.age * 16 + e.seed) * 0.45;
  const body = flashMix(e, '#4d4470', '#f4f1ff');
  const wing = flashMix(e, 'rgba(126,112,178,0.85)', '#ffffff');
  c.save();
  c.translate(e.x, e.y);
  c.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
  for (const side of [-1, 1]) {
    c.save();
    c.scale(side, 1);
    c.rotate(flap * side * 0.6);
    c.beginPath();
    c.ellipse(e.radius * 0.85, -e.radius * 0.25, e.radius * 0.95, e.radius * 0.5, -0.5, 0, Math.PI * 2);
    c.fillStyle = wing;
    c.fill();
    c.beginPath();
    c.ellipse(e.radius * 0.7, e.radius * 0.45, e.radius * 0.62, e.radius * 0.36, 0.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.beginPath();
  c.ellipse(0, 0, e.radius * 0.34, e.radius * 0.62, 0, 0, Math.PI * 2);
  c.fillStyle = body;
  c.fill();
  c.fillStyle = '#bfe9ff';
  c.beginPath();
  c.arc(-e.radius * 0.14, -e.radius * 0.42, 2.1, 0, Math.PI * 2);
  c.arc(e.radius * 0.14, -e.radius * 0.42, 2.1, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawBeetle(c, e) {
  const shell = flashMix(e, '#233d3a', '#eafffa');
  const rim = flashMix(e, '#3f6a5e', '#ffffff');
  c.save();
  c.translate(e.x, e.y);
  c.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
  c.strokeStyle = rim;
  c.lineWidth = 2;
  for (const side of [-1, 1]) {
    for (let leg = 0; leg < 3; leg += 1) {
      const ly = -e.radius * 0.5 + leg * e.radius * 0.5;
      const kick = Math.sin(e.age * 7 + leg * 1.7 + (side > 0 ? 1.5 : 0)) * 3;
      c.beginPath();
      c.moveTo(side * e.radius * 0.8, ly);
      c.lineTo(side * e.radius * 1.25, ly + kick);
      c.stroke();
    }
  }
  c.beginPath();
  c.ellipse(0, 0, e.radius * 0.82, e.radius, 0, 0, Math.PI * 2);
  c.fillStyle = shell;
  c.fill();
  c.strokeStyle = rim;
  c.beginPath();
  c.moveTo(0, -e.radius * 0.95);
  c.lineTo(0, e.radius * 0.9);
  c.stroke();
  for (const off of [-0.45, 0, 0.45]) {
    c.beginPath();
    c.ellipse(0, e.radius * off, e.radius * 0.72, e.radius * 0.2, 0, 0, Math.PI);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(-e.radius * 0.3, -e.radius * 0.9);
  c.quadraticCurveTo(-e.radius * 0.55, -e.radius * 1.35, -e.radius * 0.2, -e.radius * 1.5);
  c.moveTo(e.radius * 0.3, -e.radius * 0.9);
  c.quadraticCurveTo(e.radius * 0.55, -e.radius * 1.35, e.radius * 0.2, -e.radius * 1.5);
  c.stroke();
  c.restore();
}

function drawSprite(c, e) {
  const core = flashMix(e, '#a8c8e8', '#ffffff');
  const edge = flashMix(e, '#5d7ba6', '#ffffff');
  c.save();
  c.translate(e.x, e.y);
  c.rotate(e.age * 2.4 + e.seed);
  const r = e.radius * (1 + Math.sin(e.age * 11) * 0.12);
  c.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  c.fillStyle = edge;
  c.fill();
  c.beginPath();
  c.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  c.fillStyle = core;
  c.fill();
  c.restore();
}

function drawSpitter(c, e) {
  const skin = flashMix(e, '#4a3a5e', '#fdf4ff');
  const belly = flashMix(e, '#6e5583', '#ffffff');
  const swell = e.fireTimer < 0.45 ? 1 + (0.45 - e.fireTimer) * 0.55 : 1;
  c.save();
  c.translate(e.x, e.y);
  c.beginPath();
  c.ellipse(0, 0, e.radius * 0.95, e.radius * 0.85, 0, 0, Math.PI * 2);
  c.fillStyle = skin;
  c.fill();
  c.beginPath();
  c.ellipse(0, e.radius * 0.28, e.radius * 0.55 * swell, e.radius * 0.4 * swell, 0, 0, Math.PI * 2);
  c.fillStyle = belly;
  c.fill();
  const look = Math.atan2(e.vy, e.vx);
  for (const off of [-0.35, 0.35]) {
    const ex = Math.cos(look + off) * e.radius * 0.45;
    const ey = Math.sin(look + off) * e.radius * 0.45 - e.radius * 0.3;
    c.beginPath();
    c.arc(ex, ey, 3.1, 0, Math.PI * 2);
    c.fillStyle = '#ffd9ec';
    c.fill();
  }
  c.beginPath();
  c.arc(0, e.radius * 0.3, e.radius * 0.2 * swell, 0, Math.PI * 2);
  c.fillStyle = '#2a1e3a';
  c.fill();
  c.restore();
}

function drawHerald(c, e) {
  const flap = Math.sin(e.age * 6.5) * 0.28;
  const body = flashMix(e, '#382c58', '#f4f1ff');
  const wing = flashMix(e, 'rgba(94,78,150,0.92)', '#ffffff');
  c.save();
  c.translate(e.x, e.y);
  if (e.chargeState === 1) c.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
  c.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
  for (const side of [-1, 1]) {
    c.save();
    c.scale(side, 1);
    c.rotate(flap * side);
    c.beginPath();
    c.ellipse(e.radius * 1.05, -e.radius * 0.3, e.radius * 1.25, e.radius * 0.62, -0.45, 0, Math.PI * 2);
    c.fillStyle = wing;
    c.fill();
    c.beginPath();
    c.ellipse(e.radius * 0.85, e.radius * 0.55, e.radius * 0.8, e.radius * 0.44, 0.45, 0, Math.PI * 2);
    c.fill();
    // The pale eye-spot that gives the Herald its stare.
    c.beginPath();
    c.ellipse(e.radius * 1.15, -e.radius * 0.35, e.radius * 0.3, e.radius * 0.2, -0.45, 0, Math.PI * 2);
    c.fillStyle = flashMix(e, 'rgba(191,233,255,0.75)', '#ffffff');
    c.fill();
    c.restore();
  }
  c.beginPath();
  c.ellipse(0, 0, e.radius * 0.4, e.radius * 0.72, 0, 0, Math.PI * 2);
  c.fillStyle = body;
  c.fill();
  // Crown of horns.
  c.strokeStyle = body;
  c.lineWidth = 4;
  for (const off of [-0.42, -0.15, 0.15, 0.42]) {
    c.beginPath();
    c.moveTo(off * e.radius, -e.radius * 0.6);
    c.quadraticCurveTo(off * e.radius * 1.5, -e.radius * 1.05, off * e.radius * 1.15, -e.radius * 1.3);
    c.stroke();
  }
  const pulse = 0.75 + Math.sin(e.age * 4) * 0.25;
  const glow = c.createRadialGradient(0, e.radius * 0.1, 1, 0, e.radius * 0.1, e.radius * 0.5);
  glow.addColorStop(0, `rgba(150,220,255,${0.75 * pulse})`);
  glow.addColorStop(1, 'rgba(150,220,255,0)');
  c.beginPath();
  c.arc(0, e.radius * 0.1, e.radius * 0.5, 0, Math.PI * 2);
  c.fillStyle = glow;
  c.fill();
  c.restore();
}

function drawEnemy(c, e) {
  if (e.elite) {
    c.save();
    c.beginPath();
    c.arc(e.x, e.y, e.radius + 4 + Math.sin(e.age * 5) * 1.5, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(240,201,107,0.65)';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
  }
  if (e.kind === 'moth') drawMoth(c, e);
  else if (e.kind === 'beetle') drawBeetle(c, e);
  else if (e.kind === 'sprite') drawSprite(c, e);
  else if (e.kind === 'spitter') drawSpitter(c, e);
  else drawHerald(c, e);
  // A sliver of health over anything that has been hurt but is not a boss.
  if (e.kind !== 'herald' && e.hp < e.maxHp) {
    const w = e.radius * 1.7;
    c.fillStyle = 'rgba(6,8,20,0.65)';
    c.fillRect(e.x - w / 2, e.y - e.radius - 10, w, 4);
    c.fillStyle = '#e86a5e';
    c.fillRect(e.x - w / 2, e.y - e.radius - 10, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}
