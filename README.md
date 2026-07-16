# Dance Vision

A browser-based rhythm game inspired by DanceRush and StepMania that replaces the physical dance pad with webcam-based foot tracking.

The current version uses keyboard-controlled feet for testing, but the long-term goal is to use MediaPipe Pose Landmarker to track the player's feet directly through a webcam.

---

# Current Status

## Implemented

### Core Engine
- Four-lane StepMania-compatible playfield
- Responsive HTML canvas renderer
- Fixed-timestep game loop
- Keyboard-controlled left and right feet
- Falling notes
- Timing judgments
- Score and combo tracking
- Pause / resume / restart support
- Audio synchronization using Web Audio API

### StepMania Support
- `.sm` file parsing
- BPM parsing
- Offset parsing
- Difficulty parsing
- Runtime chart generation
- Multiple difficulties
- Chords (multiple simultaneous notes)
- Beat-to-time conversion
- Runtime note scheduling

### Song Library
- Import entire StepMania `Songs` directory
- Automatic pack detection
- Automatic song detection
- Banner detection
- Audio detection
- Pack selection view
- Song selection view
- Song preview playback
- Difficulty selection dialog

### UI
- Multiple application views
- Pack browser
- Song browser
- Song modal dialog
- Gameplay view
- Results screen

---

# Long-Term Goal

Eventually the game should support:

```text
Camera
    ↓
MediaPipe Pose
    ↓
Foot Tracking
    ↓
Judgment System
    ↓
Scoring
```

This would allow users to play existing StepMania charts without requiring a physical dance pad.

---

# Project Architecture

The project intentionally separates:

```text
Input
Game Logic
Rendering
Audio
Chart Parsing
Library Management
UI
```

This makes it possible to swap keyboard input for camera input later without changing the rhythm engine.

---

# Overall Architecture

```text
StepMania Song Folder
            │
            ▼
      FolderImporter
            │
            ▼
      LibraryBuilder
            │
            ▼
       Song Library
            │
            ▼
        LibraryView
            │
            ▼
     Song Selection
            │
            ▼
      Runtime Builder
            │
            ▼
        Game Engine
            │
            ▼
      Canvas Renderer
```

---

# Folder Structure

```text
src/
│
├── app/
│   └── ViewManager.ts
│
├── audio/
│   ├── AudioClock.ts
│   └── SongPreviewPlayer.ts
│
├── game/
│   ├── Game.ts
│   ├── GameState.ts
│   ├── JudgmentSystem.ts
│   ├── NoteManager.ts
│   └── ScoringSystem.ts
│
├── input/
│   ├── InputSource.ts
│   └── KeyboardInput.ts
│
├── library/
│   ├── FolderImporter.ts
│   ├── LibraryBuilder.ts
│   └── RuntimeChartBuilder.ts
│
├── rendering/
│   └── CanvasRenderer.ts
│
├── stepmania/
│   ├── RuntimeChartBuilder.ts
│   ├── SimfileParser.ts
│   └── TimingMap.ts
│
├── types/
│   ├── Chart.ts
│   ├── FootState.ts
│   ├── GameState.ts
│   ├── Library.ts
│   └── Note.ts
│
├── ui/
│   └── LibraryView.ts
│
├── main.ts
└── style.css
```

---

# View Architecture

The application uses multiple independent views:

```text
Library Import View
        ↓
Pack Selection View
        ↓
Song Selection View
        ↓
Song Dialog
        ↓
Gameplay View
        ↓
Results View
```

---

# Current Input Architecture

Current implementation:

```text
Keyboard
    ↓
KeyboardInput
    ↓
FootState
    ↓
Game
```

Future implementation:

```text
Camera
    ↓
MediaPipe Pose
    ↓
FootTracker
    ↓
FootState
    ↓
Game
```

Because the game only depends on `FootState`, the rhythm engine will not need modification when webcam support is added.

---

# Current Controls

## Left Foot

| Key | Action |
|-----|--------|
| A | Move left |
| D | Move right |

## Right Foot

| Key | Action |
|-----|--------|
| Left Arrow | Move left |
| Right Arrow | Move right |

---

# StepMania Compatibility

Supported:

- `.sm`
- `dance-single`
- BPM changes
- Offsets
- Multiple difficulties
- Simultaneous notes

Not yet supported:

- Holds
- Rolls
- Mines
- Stops
- Delays
- Warps
- Fake notes
- `.ssc`

---

# Song Folder Format

Expected structure:

```text
Songs/
│
├── DDR Extreme/
│   ├── Butterfly/
│   │   ├── butterfly.sm
│   │   ├── butterfly.mp3
│   │   ├── banner.png
│   │   └── background.png
│   │
│   └── ...
│
├── ITG/
│   └── ...
│
└── Custom Pack/
    └── ...
```

---

# Running The Project

## Install dependencies

```bash
npm install
```

## Start development server

```bash
npm run dev
```

Default Vite URL:

```text
http://localhost:5173
```

---

## Production build

```bash
npm run build
```

---

## Preview production build

```bash
npm run preview
```

---

# Current Gameplay Flow

```text
Import Songs Directory
        ↓
Select Pack
        ↓
Select Song
        ↓
Song Preview Dialog
        ↓
Select Difficulty
        ↓
Play
        ↓
Gameplay
        ↓
Results Screen
```

---

# Remaining Work

---

## Phase 1: Finish StepMania Support

### High Priority

- [ ] Stops
- [ ] Delays
- [ ] Holds
- [ ] Rolls
- [ ] Mines
- [ ] `.ssc` support
- [ ] Unsupported feature warnings

---

## Phase 2: Gameplay Improvements

- [ ] Better judgment visuals
- [ ] Health bar
- [ ] Life system
- [ ] Grade calculation
- [ ] Accuracy percentage
- [ ] Timing graph
- [ ] Combo explosions
- [ ] Lane effects
- [ ] Arrow skins

---

## Phase 3: Camera Support

- [ ] Webcam access
- [ ] Camera selection
- [ ] MediaPipe Pose integration
- [ ] Foot landmark extraction
- [ ] Foot visibility tracking
- [ ] Camera calibration
- [ ] Lane calibration
- [ ] Input smoothing
- [ ] Tracking diagnostics

---

## Phase 4: Camera Timing

- [ ] Camera latency measurement
- [ ] Input offset calibration
- [ ] Visual offset calibration
- [ ] Timing calibration screen

---

## Phase 5: Advanced Gameplay

- [ ] Chord foot assignment
- [ ] Crossovers
- [ ] Holds
- [ ] Double mode
- [ ] DanceRush-specific chart types

---

## Phase 6: Deployment

- [ ] HTTPS deployment
- [ ] PWA support
- [ ] Offline caching
- [ ] Asset caching
- [ ] Browser compatibility testing

---

# Future Architecture

Eventually:

```text
Video
    ↓
MediaPipe Pose Landmarker
    ↓
Foot Position Estimator
    ↓
Calibration
    ↓
FootState
    ↓
Judgment System
    ↓
Scoring
```

---

# Design Philosophy

The project follows several principles:

1. Keep gameplay deterministic.
2. Keep rendering independent from logic.
3. Keep audio as the authoritative clock.
4. Keep camera tracking separate from gameplay.
5. Remain compatible with existing StepMania content.
6. Prefer maintainability over optimization.

---

# Current Milestone

Current milestone:

> Play existing StepMania songs using keyboard-controlled feet with synchronized audio.

The next major milestone is:

> Replace keyboard input with webcam foot tracking.

---

# Inspiration

- DanceRush Stardom
- Dance Dance Revolution
- StepMania
- In The Groove
- Pump It Up
- MediaPipe Pose

---

# License

TBD