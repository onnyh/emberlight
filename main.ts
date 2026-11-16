// Emberlight's hand-in program for make.fun's best-game-01 bounty.
//
// Run it and it assembles the entry in the output directory: a clean copy of
// game/ (the static game itself), a clean copy of screenshots/, and
// dossier.json — the summary the judges read — produced by the kit's own
// buildDossier from vendor/makefun-game.ts, so what is handed in is exactly
// what the gate rebuilds and compares.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// With no MAKEFUN_OUTPUT_DIR it writes to /output, as the grader expects.
// Node 22+, standard library only, no network. Running it twice over the
// same repository writes the same bytes: the two output folders are emptied
// first so nothing stale can ride along.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's caps, as the competition states them: the dossier's source
// text, the screenshot count and size, and the game tree's size.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

function stageFolder(name: string): void {
  const from = join(repoRoot, name);
  const to = join(outputDir, name);
  rmSync(to, { recursive: true, force: true });
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true });
  } else {
    mkdirSync(to, { recursive: true });
  }
}

mkdirSync(outputDir, { recursive: true });
stageFolder('game');
stageFolder('screenshots');

const dossier = buildDossier(outputDir, DOSSIER_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`emberlight: game/ and screenshots/ staged in ${outputDir}`);
console.log(`emberlight: dossier.json written (${dossier.byteLength} bytes)`);
