# CRUX — Technical Overview

A single-file PWA for bouldering gyms. Take a photo of a wall, AI detects the
colour-coded routes, and an animated skeleton ("hologram") shows you the beta
(hand/foot sequence) scaled to your height and wingspan.

Live: `inquisitive-kitsune-42a1bb.netlify.app`

---

## Stack

- **No framework.** Vanilla JS, single `index.html` (~5,600 lines, ~270KB).
- **Netlify Functions** for the API proxy (`netlify/functions/detect.js`) —
  keeps the Anthropic API key server-side.
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) for all detection calls.
  Was Opus until recently — switched for speed, detection doesn't need
  Opus-level reasoning, just careful visual reading.
- **Service worker** (`sw.js`) for offline PWA support. Network-first for
  HTML so users always get the latest deploy; cache-first for static assets.
- **localStorage** for all persistence — profile, saved routes, streak,
  session history. No backend database.

Why one file: it was easiest to deploy as a static Netlify site with zero
build step. This is now the single biggest liability for further dev — see
"Known pain points" below.

---

## How detection works

This is the core and most fragile part of the app. Flow:

1. **User uploads/takes a photo** (`loadPhoto` → `_doLoadPhoto`)
   - EXIF orientation correction happens here (phones often tag rotation
     instead of physically rotating pixels)
   - Image resized to max 1400px, JPEG quality 0.78
   - Auto-fires `detectWithClaude()` immediately on load

2. **Pass 1 — identify route colours** (inside `detectWithClaude`, ~line 2190)
   - Sends the photo + a prompt asking Claude to list every distinct hold
     colour, with example coordinates, confidence, and wall angle
   - Filtered to `confidence === 'high'` and `count >= 5`, capped to 4 colours
   - **This prompt is gym-dependent.** Different gyms style holds completely
     differently (some have plain white walls + coloured holds, some have
     large coloured wall *panels* that aren't holds at all). The current
     prompt assumes white/neutral walls. If you onboard a new gym, this is
     the first thing to revisit.

3. **Pass 2 — map every hold per colour** (`_pass2Single`, runs in `Promise.all`)
   - Fires one request **per colour, in parallel** (was sequential, caused
     timeouts — see git history if you need the old version)
   - Each request gets a grid-overlaid version of the image (yellow %
     grid drawn via canvas) so Claude can read coordinates more precisely
   - Returns hold x/y (%), radius (%), type (jug/crimp/sloper/etc), grade
     estimate

4. **Route building** — holds are deduped (`dedupeHolds`), outliers removed
   (`removeOutliers`), sorted bottom-to-top, and a route object is built per
   colour with `colorKey`, `hexColor`, `holds[]`, `grade`.

5. ~~Pass 3 (route sanity) and Pass 4 (per-hold visual verification)~~ — both
   **removed**. They were extra serial API calls that significantly slowed
   detection and became redundant once Pass 2 was restricted to
   high-confidence-only results. If false positives become a problem again,
   search git history for "Pass 4" to restore the crop-and-verify logic.

### Known failure modes (confirmed against real gym photos)

- **Angled/corner photos.** If a photo shows 2+ wall faces at an angle, the
  coordinate grid breaks completely — holds get mapped to wrong positions.
  No prompt fix solves this; it needs to be caught and rejected before
  scanning (not yet built — see "Next steps").
- **Gyms with coloured wall panels** (not just coloured holds) confuse Pass 1
  into treating the panel colour as a route colour. The current prompt is
  tuned for white-wall gyms. A future version should probably detect which
  style of gym it's looking at and adjust the prompt dynamically, or just
  ask the user.
- **Too many colours in one frame.** Busy walls with 8+ route colours
  produce noisy, slow results even with the 4-colour cap. The app now shows
  a toast suggesting the user crop closer to one route, but there's no
  enforcement.

### Test harness

A standalone HTML file (separate from the app) embeds real gym photos as
base64 and lets you fire the detection pipeline against them directly,
inspecting JSON output and hold overlays without needing to deploy. Useful
for prompt iteration. Ask the project owner for the latest version.

---

## Animation system ("the hologram")

Procedural 2D skeleton renderer on `<canvas>`, not sprites or pre-rendered
frames. Pose generated fresh every frame from the current/next hold
positions.

- `buildClimberSkeleton(LH, RH, LF, RF, FH)` — given four limb-end targets
  (in canvas px) and a body-scale factor, runs simple 2-bone IK
  (`calcJoint`) to find elbow/knee positions, then computes hip, shoulder,
  head, torso positions from anatomical ratios.
- `drawHoloHuman` draws one static pose; `drawHoloHumanInterp` blends two
  poses (current step → next step) for smooth movement.
- `tick()` is the requestAnimationFrame loop — handles timing, easing
  (`easeInOut`), and triggers `drawHoloHumanInterp` each frame at ~30fps.
- `buildSteps()` is the move-sequencing logic — given a route's holds, it
  decides which hand/foot goes on which hold and in what order. This is
  where climbing-specific logic lives: traverse detection, compression
  moves (both hands one hold), flagging (free leg counterbalance), start/
  finish handling.

Recent realism additions: hip sway toward the weight-bearing foot, head
tilt + tracking on overhangs, torso twist on cross-body reaches, flagging
direction correctness, finish-hold topout pose. All are heuristic — there's
no real biomechanics model, just hand-tuned ratios that looked right
against reference climbing footage.

**If you want to go further on animation realism**, the reference videos
used to tune the current heuristics showed: compression on slopers,
flagging, head-back on overhangs. There's room for more — weight-shift
pre-phase before a move, more torso rotation, varied grip styles per hold
type.

---

## Screens

Single-page app, screens are divs toggled via `goTo(screenName)`:

| Screen | Purpose |
|---|---|
| `home` | Stats, streak, quick actions |
| `scan` | Photo upload + auto-detection |
| `climb` | Route selection + animated beta |
| `history` | Saved routes / logbook |
| `coach` | Weekly focus areas, grade prediction |
| `profile` | Height/wingspan/grade setup |

`P` is the global profile object (persisted via `sv('crux_p', P)`).
`detectedRoutes` / `allRoutes` hold the current scan's routes.
`savedR` is the full logbook array.

---

## Multi-photo merge

Lets a user scan 2+ photos of the same wall and combine routes. State lives
in `_multiPhotos` (per-photo route results) and `_multiMerged` (combined).
`_mergeMultiPhotos()` groups by `colorKey`, dedupes holds within 3% of each
other.

**Known limitation:** this assumes both photos show the *same coordinate
space* — i.e. the same single wall face, just maybe different exposures or
times. It does **not** handle stitching two photos of different sections
(e.g. top half + bottom half of a tall route). That would need an overlap-
detection or manual-alignment step — not built yet.

---

## Known pain points / where to start

1. **Single 5,600-line HTML file.** Splitting into modules
   (`detection.js`, `animation.js`, `screens.js`, `storage.js`) would make
   this much easier to maintain, even without adopting a framework. No
   build step currently exists — introducing one (esbuild/vite) to allow
   splitting while still shipping a single bundle would be the highest-
   leverage refactor.

2. **Detection accuracy is unverified at scale.** Only tested against ~15
   real gym photos total. Needs systematic testing across more gyms, wall
   styles, and lighting conditions before it's reliable.

3. **No automated tests.** Everything has been verified by manual click-
   through and reading code. A JS syntax check (`node --check`) should be
   run before every deploy — there's been at least one shipped build with a
   syntax error that broke every button (a doubled template-literal
   backtick). Worth wiring up a pre-commit or CI check for this at minimum.

4. **Photo angle detection.** Should reject/warn on angled photos before
   even calling the API, saving a wasted round-trip and a confused user.

5. **Wall-stitching for multi-photo.** Current merge only works for same-
   angle re-shoots, not top/bottom photo pairs of one tall route.

6. **Route direction edge cases.** Diagonal routes (up-and-right, not pure
   vertical or pure horizontal) can get misclassified by the traverse-
   detection heuristic in `buildSteps()`, leading to wrong hand alternation.

---

## API cost note

Detection currently fires: 1 Pass-1 call + N Pass-2 calls (N = number of
colours found, max 4), all on Haiku. Roughly 5 calls per scan. Keep this in
mind if usage scales — Haiku is cheap but not free, and a popular gym day
could mean dozens of scans.

---

## Quick start for a new dev

```bash
# No build step. Just open index.html, or for full functionality
# (Netlify Functions, env vars):
npm install -g netlify-cli
netlify dev
```

Environment variable required: `ANTHROPIC_API_KEY` (set in Netlify
dashboard → Site configuration → Environment variables).

To verify a change didn't break the JS before deploying:
```bash
python3 -c "
import re
with open('index.html') as f:
    html = f.read()
js = '\n'.join(re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL))
open('/tmp/check.js','w').write(js)
"
node --check /tmp/check.js
```
