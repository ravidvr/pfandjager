# PFANDJÄGER 3D — Quality Rubric (Subway Surfers benchmark)

Goal: match the core gameplay style and visual quality of Subway Surfers.
Method: score every iteration against this fixed rubric. Gaps are listed, not hidden.

## Rubric

### A. Gameplay core (SS = lane-runner mechanics)
| # | Standard | Target |
|---|---|---|
| A1 | 3-lane switching, smooth eased tween + body tilt | 100% |
| A2 | Jump: parabolic arc, clears hurdles, instant input | 100% |
| A3 | Slide under overhead beams | 100% |
| A4 | Speed curve: slow start, long ramp, never unfair | 100% |
| A5 | Obstacle patterns guarantee a survivable path at all times | 100% (hard invariant) |
| A6 | Crash: slow-mo, tumble, dramatic camera, quick restart | 100% |
| A7 | Pickups, combo multiplier, near-miss bonus | 100% |
| A8 | Persistent best score | 100% |

### B. Visuals
| # | Standard | Target |
|---|---|---|
| B1 | Stylized 3D character with real run-cycle animation | 100% |
| B2 | Continuous themed world (U-Bahn/Berlin night) | 100% |
| B3 | AI-generated 3D assets (Modly) for props | 100% |
| B4 | Cohesive lighting/mood | 100% |
| B5 | Particles + floating score feedback | 100% |
| B6 | Obstacles readable at spawn distance | 100% |

### C. Feel / juice
| # | Standard | Target |
|---|---|---|
| C1 | Screen shake (crash, near events) | 100% |
| C2 | SFX for every interaction + music loop | 100% |
| C3 | HUD polish: score, combo, pause, DE/EN | 100% |

### D. iPhone
| # | Standard | Target |
|---|---|---|
| D1 | All 4 swipe gestures reliable | 100% |
| D2 | 60fps target, draw calls < 350 | 100% |
| D3 | PWA: home-screen install, safe-area, no scroll/bounce | 100% |
| D4 | Portrait fullscreen, crisp on DPR 3 | 100% |

## Iteration 1 score (2026-08-20, engine + placeholders + bottle asset)

A1 90 · A2 85 · A3 80 · A4 75 · A5 90 (invariant tested: 120 rows, 0 violations) · A6 70 · A7 80 · A8 90
B1 55 · B2 60 · B3 40 (bottle live; crate/kiosk/ticket machine pending) · B4 60 · B5 70 · B6 70
C1 70 · C2 65 (SFX yes, music no) · C3 70
D1 85 (iPhone-emulated swipes verified) · D2 75 (60fps desktop, 302 calls; iPhone GPU unproven) · D3 70 · D4 85

Overall: ~72%

## Gaps vs Subway Surfers (what "100%" still costs)
1. Character animation: real run/jump/slide poses + follow-through (biggest visual gap)
2. World density: props, graffiti, stations, variety across distance
3. Art coherence pass once all Modly assets land
4. Music + richer SFX
5. iPhone GPU perf proof (desktop ≠ A-series GPU)
6. Death camera drama, obstacle variety (moving trains, side walls)
7. Meta layer (daily run, challenges) — out of scope for v1

## Next iteration targets
- Integrate crate, kiosk, ticket machine (Modly → decimate → GLB)
- Character animation pass
- World density pass
- iPhone perf measure on emulated DPR3 viewport
- Re-score
