'use strict';
/*
 * Emberlight upgrades: the keeper's build. Level-ups draft three of these
 * cards; each one mutates the build object the game keeps for the player.
 * A card leaves the pool when its stacks run out, and a plain tonic fills
 * any draft the pool cannot.
 */

function freshBuild() {
  return {
    damage: 12,
    shotsPerSecond: 3.4,
    projectiles: 1,
    moveSpeed: 238,
    magnetRadius: 74,
    blades: 0,
    pierce: 0,
    beaconBlessing: 0,
    secondWind: false,
    taken: {},
  };
}

const UPGRADE_POOL = [
  {
    id: 'emberheart', badge: 'HP', title: 'Emberheart',
    text: '+24 max health, and mend 24 now.',
    max: 5,
    apply(build) { build.maxHpBonus = (build.maxHpBonus || 0) + 24; return { heal: 24 }; },
  },
  {
    id: 'rapid', badge: 'FR', title: 'Rapid Kindling',
    text: 'Fire 18% faster.',
    max: 6,
    apply(build) { build.shotsPerSecond *= 1.18; return {}; },
  },
  {
    id: 'heavy', badge: 'DM', title: 'Heavy Sparks',
    text: 'Bolts hit 25% harder.',
    max: 6,
    apply(build) { build.damage *= 1.25; return {}; },
  },
  {
    id: 'split', badge: 'x2', title: 'Split Flame',
    text: '+1 bolt with every shot.',
    max: 4,
    apply(build) { build.projectiles += 1; return {}; },
  },
  {
    id: 'swift', badge: 'SP', title: 'Swift Wisps',
    text: 'Move 12% faster.',
    max: 5,
    apply(build) { build.moveSpeed *= 1.12; return {}; },
  },
  {
    id: 'magnet', badge: 'MG', title: 'Kindled Magnet',
    text: 'Shards fly to you from 55% farther.',
    max: 4,
    apply(build) { build.magnetRadius *= 1.55; return {}; },
  },
  {
    id: 'brands', badge: 'OR', title: 'Orbiting Brands',
    text: '+1 ember brand circling you, searing what it touches.',
    max: 4,
    apply(build) { build.blades += 1; return {}; },
  },
  {
    id: 'pierce', badge: 'PR', title: 'Piercing Light',
    text: 'Bolts pass through +1 enemy.',
    max: 3,
    apply(build) { build.pierce += 1; return {}; },
  },
  {
    id: 'beacon', badge: 'BC', title: "Beacon's Blessing",
    text: 'The lighthouse flame mends you three times as fast nearby.',
    max: 2,
    apply(build) { build.beaconBlessing += 1; return {}; },
  },
  {
    id: 'secondwind', badge: 'SW', title: 'Second Wind',
    text: 'Once, when your light would go out, flare back at half health.',
    max: 1,
    apply(build) { build.secondWind = true; return {}; },
  },
];

const TONIC = {
  id: 'tonic', badge: '+', title: 'Stardust Tonic',
  text: 'Mend 35 health and gather your breath.',
  max: Infinity,
  apply() { return { heal: 35 }; },
};

function upgradeById(id) {
  if (id === TONIC.id) return TONIC;
  return UPGRADE_POOL.find((u) => u.id === id) || TONIC;
}

function stacksOf(build, id) {
  return build.taken[id] || 0;
}

function offerableUpgrades(build) {
  return UPGRADE_POOL.filter((u) => stacksOf(build, u.id) < u.max);
}

/** Draw up to `count` distinct cards for a level-up draft. */
function rollDraft(build, count) {
  const pool = offerableUpgrades(build).slice();
  const picks = [];
  while (picks.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  while (picks.length < count) picks.push(TONIC);
  return picks;
}

/** Take a card: record the stack, mutate the build, report side effects. */
function applyUpgrade(build, id) {
  const def = upgradeById(id);
  build.taken[id] = stacksOf(build, id) + 1;
  return def.apply(build);
}
