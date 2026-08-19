# Dance Vision

Dance Vision is a browser-based rhythm game inspired by DanceRush, StepMania,
and other arcade dance games. It imports StepMania song packs and lets players
hit four-lane charts by moving their feet horizontally in front of a webcam.

The game also includes keyboard input for development, accessibility, and
testing without a camera.

## Current status

The core single-player game and the first performance/architecture refactor are
complete.

Implemented:

- StepMania `.sm` song-pack importing
- Pack, song, and difficulty selection
- Song previews and artwork
- Four-lane tap-note gameplay
- Keyboard and webcam input
- MediaPipe Pose Landmarker foot tracking
- Mirrored and unmirrored camera modes
- Configurable tracking confidence and inference FPS
- Web Audio synchronization
- Perfect, Great, Good, and Miss judgments
- Score and combo tracking
- Pause, resume, restart, replay, and results
- Responsive, horizontally resizable playfield
- Pose overlay and gameplay diagnostics
- Independent game, video, and pose-inference clocks
- Optimized note processing and canvas rendering
- Versioned SHA-256 song, chart-slot, and runtime-chart identities
- Exact local chart availability lookup for multiplayer matching
- Typed browser multiplayer transport and canonical room session state
- Protocol-versioned reconnect credentials stored in `sessionStorage`
- Local gameplay routed through an explicit single-player session policy
- Single Player / Host Session / Join Session mode selection
- Multiplayer lobby with canonical player, host, and connection status
- Typed create/join errors and leave-room behavior
- Host-controlled canonical song and chart selection
- Guest lobby display of the host's selected chart metadata
- Debounced selection publishing with revision-based server authority
- Automatic local chart matching for every canonical selection revision
- Per-player chart, audio, and readiness status in the lobby
- Server-validated ready check with stale-revision collision retries

The camera pipeline has been tested at 30 pose inferences per second while the
game continued rendering at 60 FPS.

Synchronous online multiplayer is now the active development track. Stages
1–8 provide the protocol, identity model, room server, browser transport,
session boundary, host/join lobby, host-controlled chart selection, exact local
matching, and the multiplayer ready check. Clock synchronization begins in
Stage 9.

The asset model is now being revised so only the host imports a library. The
working Stage 8 local-match flow remains as a migration fallback while the
server-relay implementation is built. See
[`docs/HOST_ASSET_RELAY.md`](docs/HOST_ASSET_RELAY.md) for the approved flow,
security boundary, limits, and replacement stages.

## Technology

- TypeScript
- Vite
- Zod runtime protocol validation
- Vitest
- Node.js HTTP server
- Socket.IO
- HTML Canvas 2D
- Web Audio API
- MediaDevices and `getUserMedia()`
- MediaPipe Pose Landmarker
- `requestAnimationFrame()`
- `HTMLVideoElement.requestVideoFrameCallback()` with a compatibility fallback

No frontend framework is currently used.

## Running the project

Requirements:

- A current desktop browser
- Node.js and npm
- A webcam for camera input
- HTTPS or localhost for camera permission

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Vite normally serves the application at:

```text
http://localhost:5173
```

Create a production build:

```bash
npm run build
```

Run the automated tests:

```bash
npm test
```

Preview the production build:

```bash
npm run preview
```

### Running the multiplayer room server

Start the room server in development mode:

```bash
npm run server:dev
```

The default server address is `http://localhost:3001`. Verify it with:

```text
http://localhost:3001/health
```

Build both the browser client and room server:

```bash
npm run build:all
```

Run the bundled room server after building:

```bash
npm run server:start
```

Server configuration uses environment variables:

```text
HOST=127.0.0.1
PORT=3001
CLIENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
RELAY_TEMP_DIR=/path/to/private/temporary-storage
RELAY_ROOM_QUOTA_MB=200
RELAY_ASSET_TTL_MINUTES=30
```

`HOST` defaults to `127.0.0.1`. Keep this value in production when Nginx is
proxying requests to the room server locally. Use `0.0.0.0` only when you
intentionally need the Node server reachable directly from another machine,
such as controlled LAN development.

`RELAY_TEMP_DIR` is optional and defaults to the operating system's temporary
directory. It must not be web-served directly. Relay files are accessible only
through short-lived room-scoped transfer tickets.

`RELAY_ROOM_QUOTA_MB` limits the total temporary relay assets reserved by one
room. The default is 200 MiB.

`RELAY_ASSET_TTL_MINUTES` controls how long temporary relay assets remain
available before expiry. The default is 30 minutes. Expired assets are cleaned
periodically by the server.

Production should set `RELAY_TEMP_DIR` to a private directory that is writable
by the Dance Vision service user and is not served directly by Nginx.

The browser client uses `http://localhost:3001` during Vite development.

In production, if `VITE_MULTIPLAYER_SERVER_URL` is not defined, the client uses
the page's current origin. This is the recommended deployment topology when
Nginx serves the Vite application and proxies Socket.IO and relay requests on
the same HTTPS domain.

For example:

https://dance.example.com/
https://dance.example.com/socket.io/
https://dance.example.com/relay/assets/

`VITE_MULTIPLAYER_SERVER_URL` remains available when the multiplayer server
intentionally uses a different public origin.

Rooms currently live only in server memory. Restarting the process closes all
rooms.

To test Stage 6, run `npm run server:dev` and `npm run dev` in separate
terminals. Open two browser windows, host from one, and join the displayed room
code from the other. The lobby should update both player lists immediately.

For Stage 7, select **Choose a song** as the host, import or open the normal
local library, and choose a difficulty. Both clients should return to the lobby
with identical song, artist, difficulty, meter, tap count, and selection
revision. Guests cannot open the host selection controls.

For Stage 8, each player imports their own local copy of the song library. The
lobby reports Chart matched, Song missing, Chart missing, Chart mismatch, or
Audio missing for each player. The host can begin the ready check only when
every connected player has the exact chart hash and local audio; the server
then validates each Ready action.

## Importing songs

Import a StepMania `Songs` directory from the Library view. Dance Vision scans
the selected directory locally and builds its in-memory song library.

Expected structure:

```text
Songs/
├── Pack Name/
│   ├── Song Name/
│   │   ├── song.sm
│   │   ├── song.mp3
│   │   ├── banner.png
│   │   └── background.png
│   └── Another Song/
└── Another Pack/
```

The imported files remain local to the browser. Object URLs created for audio
and artwork are released when the library is replaced or the application is
closed.

## Gameplay flow

```text
Import Songs directory
        ↓
Select pack
        ↓
Select song
        ↓
Preview song
        ↓
Select difficulty
        ↓
Play
        ↓
Gameplay
        ↓
Results
        ├── Replay
        └── Song selection
```

The developer controls also allow a standalone `.sm` file and audio file to be
loaded without importing a complete song pack.

## Controls

### Keyboard input

| Foot | Key | Action |
| --- | --- | --- |
| Left | `A` | Move left |
| Left | `D` | Move right |
| Right | Left Arrow | Move left |
| Right | Right Arrow | Move right |

### Camera input

1. Open Camera Setup.
2. Enable the camera and grant browser permission.
3. Select the desired camera device.
4. Stand far enough back for both ankles, heels, and foot tips to be visible.
5. Choose Camera as the input mode.
6. Adjust mirroring, visibility threshold, and inference FPS if necessary.

Only horizontal foot position currently affects gameplay. Each visible foot is
mapped into one of four lanes.

## StepMania compatibility

Supported:

- `.sm` files
- `dance-single` charts
- Multiple difficulties
- BPM changes
- Song offsets
- Tap notes
- Simultaneous notes/chords
- Beat-to-time conversion

Not currently supported:

- Holds and rolls
- Mines
- Stops and delays
- Warps
- Fake notes
- `.ssc` files
- Double charts

Unsupported note types are not yet intended to behave exactly like StepMania.

## Architecture

The application separates importing, selection, gameplay, input, tracking,
audio, rendering, and UI coordination. `main.ts` acts primarily as the
composition root: it mounts the application markup, constructs the modules, and
wires their callbacks together.

### Application flow

```text
FolderImporter
      ↓
LibraryBuilder
      ↓
SongLibrary
      ↓
LibraryView + SongSelectionController
      ↓
RuntimeChartBuilder
      ↓
GameplayController
      ├── Game
      ├── AudioClock
      └── GameLoop
              ↓
        CanvasRenderer
```

### Input boundary

Both input implementations produce the same `FootState` shape:

```text
KeyboardInput ──┐
                ├── InputManager ── FootState ── Game
CameraFootInput ┘
```

The game engine does not know whether positions came from keys, a webcam, or a
future input source.

### Camera pipeline

```text
CameraManager
      ↓
CameraFrameScheduler
      ↓
PoseTracker
      ↓
MediaPipe landmarks
      ├── CameraCoordinateMapper
      ├── FootPositionEstimator
      └── PoseOverlayRenderer
                    ↓
                 FootState
```

Responsibilities:

- `CameraManager` owns camera enumeration, streams, device switching, and the
  preview element.
- `CameraFrameScheduler` schedules work from decoded video frames when the
  browser supports `requestVideoFrameCallback()`.
- The compatibility path uses an independent animation-frame callback while
  retaining inference throttling and duplicate-frame protection.
- `PoseTracker` owns MediaPipe initialization and inference.
- `CameraCoordinateMapper` maps cropped/mirrored video coordinates into the
  displayed playfield coordinate space.
- `FootPositionEstimator` combines ankle, heel, and foot-index landmarks into
  left and right foot positions and visibility.
- `PoseOverlayRenderer` draws camera landmarks independently from the gameplay
  canvas.
- `CameraController` coordinates camera UI and input-mode changes.

Camera inference is active only while Camera is the selected input and both the
camera stream and pose model are ready. It is cancelled when camera input is
deselected, the camera stops, the device changes, an error occurs, or the
application is destroyed.

### Independent clocks

The runtime deliberately separates three clocks:

```text
Game/render clock
requestAnimationFrame()
typically 60–144 Hz

Camera video clock
requestVideoFrameCallback()
typically 30 Hz

Pose-inference clock
configurable 1–30 FPS
```

The audio clock remains authoritative for chart time. The game loop reads the
most recent `FootState`; it does not wait for MediaPipe. This prevents camera
inference from setting the game-render frame rate.

### Gameplay architecture

- `Game` owns runtime gameplay state and delegates note judgment and scoring.
- `JudgmentSystem` compares visible feet with actionable notes.
- `ScoringSystem` owns score, combo, and judgment totals.
- `NoteManager` creates sorted runtime notes and prunes completed notes.
- `AudioClock` owns decoded song audio and authoritative playback time.
- `GameLoop` updates input/game state, detects transitions, and requests
  rendering.
- `GameplayController` owns gameplay buttons, song launching, audio/game
  synchronization, exits, and results transitions.

### Rendering architecture

`CanvasRenderer` draws:

- falling notes
- foot-position dots
- score and combo
- current judgment

The static playfield layer—background, lanes, headings, dividers, and judgment
line—is cached and rebuilt only after resize. Lane geometry and note sizes are
also computed during resize rather than repeatedly per note.

While playing, the canvas renders continuously. While paused or idle, it renders
only when foot positions, visibility, game state, canvas size, or UI state
changes.

### UI architecture

- `ViewManager` switches application views.
- `LibraryView` renders packs and songs.
- `SongDialogView` owns selected-song dialog markup and events.
- `SongSelectionController` owns song/chart selection and preview playback.
- `GameplayController` owns gameplay and results orchestration.
- `CameraController` owns camera-control orchestration.
- `GameDebugPanel` and `CameraTrackingDebugPanel` expose runtime diagnostics.
- `renderAppShell()` mounts framework-free HTML partials before controllers
  query the DOM.

## Project structure

```text
src/
├── app/
│   ├── AppView.ts
│   └── ViewManager.ts
├── audio/
│   ├── AudioClock.ts
│   └── SongPreviewPlayer.ts
├── camera/
│   ├── CameraCoordinateMapper.ts
│   ├── CameraFootInput.ts
│   ├── CameraFrameScheduler.ts
│   ├── CameraManager.ts
│   ├── FootPositionEstimator.ts
│   ├── PoseOverlayRenderer.ts
│   └── PoseTracker.ts
├── controllers/
│   ├── CameraController.ts
│   ├── GameplayController.ts
│   └── SongSelectionController.ts
├── game/
│   ├── Game.ts
│   ├── GameState.ts
│   ├── JudgmentSystem.ts
│   ├── NoteManager.ts
│   └── ScoringSystem.ts
├── input/
│   ├── InputManager.ts
│   ├── InputSource.ts
│   └── KeyboardInput.ts
├── library/
│   ├── AssetMatcher.ts
│   ├── ChartAvailabilityIndex.ts
│   ├── ChartIdentityService.ts
│   ├── FileUtilities.ts
│   ├── FolderImporter.ts
│   └── LibraryBuilder.ts
├── loop/
│   └── GameLoop.ts
├── rendering/
│   └── CanvasRenderer.ts
├── stepmania/
│   ├── RuntimeChartBuilder.ts
│   ├── SimfileParser.ts
│   └── TimingMap.ts
├── styles/
│   └── feature-specific CSS files
├── types/
│   ├── Chart.ts
│   ├── FootState.ts
│   ├── Judgment.ts
│   ├── Library.ts
│   └── Note.ts
├── ui/
│   ├── templates/
│   │   └── framework-free HTML partials
│   ├── CameraTrackingDebugPanel.ts
│   ├── GameDebugPanel.ts
│   ├── LibraryView.ts
│   ├── SongDialogView.ts
│   └── renderAppShell.ts
├── main.ts
└── style.css

shared/
├── constants.ts
├── index.ts
├── schemas.test.ts
└── schemas.ts

server/
├── config.ts
├── createDanceVisionServer.ts
├── index.ts
├── roomRegistry.ts
└── domain/
    ├── roomStateMachine.test.ts
    └── roomStateMachine.ts
```

## Performance work completed

The initial 12-stage refactor is complete:

- [x] Stabilize and reduce `main.ts`
- [x] Extract debug UI
- [x] Extract `GameLoop`
- [x] Remove unnecessary per-frame DOM updates and idle rendering
- [x] Extract `CameraController`
- [x] Extract song-selection orchestration
- [x] Extract `GameplayController`
- [x] Split `index.html` into framework-free partials
- [x] Cache camera/display geometry per inference
- [x] Optimize sorted-note processing
- [x] Profile and cache canvas-renderer work
- [x] Decouple camera inference from the game/render loop

Runtime diagnostics include:

- game FPS
- canvas average, 95th-percentile, and maximum render time
- canvas renders exceeding 8 ms
- camera scheduling mode
- MediaPipe inference duration
- actual pose-inference FPS
- raw and mapped foot positions
- landmark confidence and visibility

## Known limitations

- Profiles and scores are not persisted after refresh.
- Song libraries must be imported again after refresh.
- Gameplay is single-player.
- Camera calibration and latency calibration are still basic.
- Foot positions are not yet calibrated to an individual player's movement
  range.
- Only tap-note gameplay is reliable.
- Multiplayer protocol and room-state tests are in place; existing gameplay,
  camera, and browser flows are not yet comprehensively automated.
- Browser and device performance can vary substantially.

## Future roadmap

Synchronous online gameplay is the current priority. Its protocol is specified
before implementation so room behavior remains server-authoritative without
coupling sockets to the working game, camera, audio, or rendering pipelines.

### Active multiplayer roadmap

- [x] Stage 1: protocol, room lifecycle, and identity specification
- [x] Stage 2: shared schemas and pure room state machine
- [x] Stage 3: chart identity and local availability index
- [x] Stage 4: minimal Node.js and Socket.IO room server
- [x] Stage 5: client transport and session abstraction
- [x] Stage 6: mode selection and host/join lobby
- [x] Stage 7: host-controlled selection synchronization
- [x] Stage 8: guest chart matching and ready check
- [x] R1: shared host-asset relay contract
- [x] R2: authenticated temporary asset relay server
- [x] R3: shared artwork and modal preview clips
- [x] R4: full audio and normalized chart-package transfer
- [x] R5: per-player difficulty selection and relay-based readiness
- [x] R6: clock synchronization
- [x] R7: prepared gameplay and synchronized start
- [x] R8: live score sidebar
- [x] R9: multiplayer results, replay, and selection return
- [ ] R10: disconnect, refresh, cleanup, and deployment hardening

See [`docs/MULTIPLAYER_PROTOCOL.md`](docs/MULTIPLAYER_PROTOCOL.md) for the
authoritative Stage 1 decisions and Stage 2 acceptance contract.

The longer-term profile, persistence, local co-op, and account work remains
valuable and can follow the multiplayer MVP.

### Phase 1: Profiles and saved scores

- [ ] Define stable song and chart identifiers
- [ ] Add local player profiles
- [ ] Store profile preferences and camera calibration
- [ ] Define a versioned score-result record
- [ ] Save score, accuracy, combo, judgments, chart, and timestamp
- [ ] Add per-song and per-chart high-score views
- [ ] Add profile selection and management
- [ ] Add import/export or migration support for local data

IndexedDB is a good initial persistence option because imported songs and early
profiles are browser-local. Storage should be accessed through repository
interfaces so a later online backend can replace or supplement it.

Suggested score identity:

```text
songId + chartId + chartHash + profileId
```

A chart hash matters because two files can share titles and difficulty names
while containing different notes.

### Phase 2: Player and gameplay-session model

- [ ] Replace the single global foot state with player-specific input state
- [ ] Add `Player`, `PlayerSlot`, and `GameplaySession` models
- [ ] Give each player independent score, combo, judgments, and results
- [ ] Define shared-versus-player-specific pause and restart rules
- [ ] Keep single-player as a one-player session
- [ ] Add deterministic session events suitable for networking

This is the key architectural bridge between the current game and both co-op
modes.

### Phase 3: Local co-op

- [ ] Add two local player slots
- [ ] Assign an input source to each player
- [ ] Decide between shared lanes and player-specific playfields
- [ ] Add two-player HUD and results
- [ ] Support keyboard plus camera combinations
- [ ] Evaluate multi-person pose tracking for one-camera play
- [ ] Add readiness, join/leave, and rematch flow

The safest first version is two independently assigned input sources. One-camera
multi-person tracking is possible later, but requires identity stability when
players cross or temporarily disappear.

### Phase 4: Accounts and backend persistence

- [ ] Select an authentication and backend platform
- [ ] Add online accounts without removing guest/local profiles
- [ ] Synchronize profile preferences
- [ ] Save score history and personal bests
- [ ] Add privacy and data-deletion controls
- [ ] Add server-side score validation strategy

Guest profiles should continue working offline even after accounts are added.

### Phase 5: Online rooms and host-controlled selection

- [ ] Add room creation and join codes
- [ ] Define host, guest, ready, disconnected, and reconnecting states
- [ ] Make the host authoritative for pack, song, chart, and difficulty selection
- [ ] Broadcast host selection changes to every guest in real time
- [ ] Show song metadata and each player's availability/readiness
- [ ] Allow host transfer or define behavior when the host disconnects
- [ ] Add chat/emotes only after the core room flow is stable

A WebSocket-style room channel is a natural fit for selection and readiness
updates:

```text
Host selects song/chart
        ↓
Server validates room event
        ↓
Room state is updated
        ↓
All guests receive the selection
        ↓
Each client confirms local song availability
```

Because current song packs are imported from local files, guests cannot
automatically play a host's local audio. Online play therefore needs one of
these policies:

1. Every player imports the same pack and the room matches songs by chart hash.
2. The project uses legally distributable, server-hosted songs.
3. The host shares only metadata while unavailable guests spectate.

The application should not upload or redistribute imported song audio without
the necessary rights.

### Phase 6: Synchronized online gameplay

- [ ] Add server-synchronized countdown/start timestamps
- [ ] Estimate client/server clock offset
- [ ] Start audio locally from the agreed timestamp
- [ ] Exchange compact player state or gameplay events
- [ ] Display remote scores, combo, and readiness
- [ ] Handle latency, jitter, temporary disconnection, and resynchronization
- [ ] Define authoritative results and anti-cheat expectations
- [ ] Add rematch and return-to-selection flows

Each client should keep local audio, pose inference, judgment, and rendering
responsive. Networking should synchronize room state and results rather than
streaming webcam video or blocking local gameplay on every remote update.

### Additional gameplay work

- [ ] Camera and audio latency calibration
- [ ] Per-player play-area calibration
- [ ] Accuracy percentage and grades
- [ ] Health/life system
- [ ] Timing graph
- [ ] Better judgment and lane effects
- [ ] Holds, rolls, mines, stops, delays, and `.ssc` support
- [ ] PWA and offline asset caching
- [ ] HTTPS deployment and broader browser testing
- [ ] Automated unit, integration, and browser tests

## Design principles

1. Keep audio authoritative for chart time.
2. Keep gameplay deterministic and independent from rendering.
3. Keep camera inference independent from the game frame rate.
4. Keep all input sources behind the same player-input boundary.
5. Preserve local/offline play when online features are added.
6. Identify songs and charts by content, not display names alone.
7. Avoid sending webcam video to the server for normal gameplay.
8. Remain compatible with existing StepMania content where practical.
9. Measure performance before adding complexity.

## Recommended next milestone

Continue with R10 resilience work: preserve player identity through refresh and
temporary disconnects, cancel unsafe countdowns, restore canonical room state,
and harden relay cleanup and deployment behavior.

## Inspiration

- DanceRush Stardom
- Dance Dance Revolution
- StepMania
- In The Groove
- Pump It Up
- MediaPipe Pose

## License

TBD
