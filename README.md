# Pfandjäger — Berlin Pfand-bottle endless runner

A 3D lane-runner set in a Berlin U-Bahn night world: collect Pfand bottles, dodge obstacles, chain combos and near-misses for the high score. Gameplay quality is scored against a fixed Subway-Surfers benchmark rubric ([QUALITY.md](QUALITY.md)).

**Play in the browser:** https://ravidvr.github.io/pfandjager/

## Repo layout

| Branch | Contents |
|---|---|
| `main` | Three.js prototype (`index.html`, `src/game.js`) |
| `gh-pages` | Unity 6 LTS + URP WebGL build — what the Play link serves |

The full Unity project source is maintained outside this repo.

## Quality bar

- [QUALITY.md](QUALITY.md) — fixed rubric scored on every iteration: 3-lane switching with eased tween, parabolic jump, slide under beams, survivable obstacle patterns, crash feel, combo/near-miss feedback, stylized visuals, U-Bahn night world, particle feedback.
- [REFS.md](REFS.md) — art-direction reference study (documentary Pfand-collector sources, style notes only; the shipped character is original art).

## Tech

Unity 6 LTS · URP · WebGL · three.js (prototype)
