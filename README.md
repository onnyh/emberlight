# Emberlight — keep the flame until dawn

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/onnyh/emberlight/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/onnyh/emberlight/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

An entry to make.fun's [Make the best game](https://make.fun/bounty/best-game-01) bounty.

## The game

You are the Keeper, a wisp of ember light, and the lighthouse flame behind
you is the last light on the coast. For one long night — five minutes — the
gloom sends its shadow moths, gloom beetles, dusk sprites and spitters to
snuff it out, and twice the Gloom Herald itself comes for the flame.

Burn the dark back with ember bolts, gather the light shards your enemies
drop, and choose a blessing at every level: split flames, orbiting brands,
piercing light, a second wind. Stand in the dashed ring beside the flame
and it will mend you. Still be burning when dawn breaks and you win — then,
if you like, keep the watch into an endless night.

Everything is drawn and sounded in code: no image or audio files, no
libraries, no network. The music and effects are synthesised live with
WebAudio.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move the keeper |
| Mouse | Aim |
| Hold mouse button / Space | Fire ember bolts |
| Click / 1 · 2 · 3 | Choose a level-up blessing |
| P / Esc | Pause |
| M | Mute |
| Enter | Start / new night |
| E (on the dawn screen) | Keep the watch — endless mode |

Score is the moths you banish plus the seconds you keep the flame. Your
best score is kept in the browser.

## Run it

The game is plain static files under `game/` — serve that folder with any
static server and open `index.html` in a desktop browser. With Node 22+:

```sh
node serve.ts            # then open http://localhost:8080
```

For screenshots, the game carries an attract mode: `?demo=<seconds>`
starts a staged run at that point of the night flown by an autopilot,
`&draft=1` opens a level-up draft over it, and `?demo=win` stages the dawn
screen. `shots.json` lists the four shots in `screenshots/` and the exact
query each was taken with.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That copies `game/` and `screenshots/` into `out/` and writes
`out/dossier.json` with the kit's `buildDossier`
(`vendor/makefun-game.ts`, the kit's own file, unchanged).

## License

MIT — see `LICENSE`.
