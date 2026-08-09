# Dance Vision Multiplayer Protocol Specification

Status: Stage 1 approved  
Protocol version: `1`  
Chart identity version: `dance-vision-runtime-chart-v1`

This document defines the multiplayer MVP before transport, server, or UI code
is introduced. The server is authoritative for room membership, selection,
readiness, start time, phase changes, and shared results. Each browser remains
authoritative for its own audio playback, input, judgments, rendering, and
reported score.

## MVP scope

Included:

- one host and up to three guests
- six-character room codes
- host-controlled song and chart selection
- exact local chart matching by a versioned SHA-256 hash
- player availability and readiness
- server-scheduled countdown and start timestamp
- live score summaries beside the local playfield
- multiplayer standings, replay, and return to selection
- temporary disconnect recovery and host transfer

Excluded from the first multiplayer release:

- streaming or uploading imported songs
- spectator mode
- chat and voice
- mid-song joining
- synchronized pause or restart
- server-authoritative note judgments or anti-cheat
- database-backed rooms and horizontal server scaling
- required audio-file hashing

Imported song files remain on each player's device. Every participant must
possess a locally imported chart whose runtime chart hash matches the host's
selection.

## Fixed MVP decisions

| Decision | MVP policy |
| --- | --- |
| Maximum room size | 4 players total |
| Room code | 6 uppercase characters, case-insensitive; omit ambiguous `0`, `O`, `1`, and `I` |
| Room storage | In memory on one server process |
| Countdown | Server chooses a start time 5 seconds in the future |
| Minimum scheduling lead | 1 second after conversion to a local monotonic deadline |
| Online pause/restart | Disabled during countdown and play |
| Required content check | Exact runtime chart hash |
| Audio hash | Not required in MVP; UI identifies it as unverified |
| Spectators | Not supported |
| Join during countdown/play/results | Rejected |
| Disconnect grace | 20 seconds |
| Host loss | Cancel countdown; transfer host after grace to the earliest joined connected player |
| Empty room | Close immediately |
| Inactive selecting room | Expire after 30 minutes without players or accepted commands |
| Results timeout | 15 seconds after the first finisher or 5 seconds after expected chart end, whichever occurs later |
| Duplicate names | Allowed; UI adds a display suffix while IDs remain distinct |
| Live score rate | At most 10 changed snapshots per second, plus a 1 Hz heartbeat |

The numeric timings are protocol defaults and may later become server
configuration without changing room semantics.

## Ownership boundaries

### Server owns

- room creation, expiration, and closure
- canonical room revision
- player IDs, reconnect tokens, membership, and connection state
- host role and transfer
- room phase and legal transitions
- canonical selection and selection revision
- readiness and availability accepted for that selection
- canonical future start timestamp
- accepted live-score summaries and final results
- replay and return-to-selection decisions

### Client session owns

- the newest accepted room snapshot
- local connection state
- local player identity and reconnect credentials
- command acknowledgements, timeouts, and typed errors
- rejection of stale snapshots
- conversion of protocol data into controller-friendly state

### Local gameplay owns

- imported `File` objects and object URLs
- local chart/audio preparation
- input and camera inference
- audio playback and chart time after start
- note judgments, score, combo, and final result calculation
- the local canvas and game loop

No `File`, object URL, MediaPipe landmark, webcam frame, or raw foot position is
part of room state.

## Connection state and room phase

Connection state is local and must not be combined with the canonical room
phase.

```text
offline | connecting | connected | reconnecting | disconnected
```

The canonical room phase is:

```text
selecting | ready-check | countdown | playing | results | closed
```

### Phase transitions

| Current phase | Event | Requirements | Next phase | Server side effects |
| --- | --- | --- | --- | --- |
| `selecting` | Host sets selection | Valid host command | `selecting` | Increment selection and room revisions; clear readiness, availability, schedule, scores, and results |
| `selecting` | Host begins ready check | Selection exists | `ready-check` | Clear all readiness; retain current availability only when it matches the current selection revision |
| `ready-check` | Host changes selection | Valid selection | `selecting` | Replace selection and invalidate all readiness/availability |
| `ready-check` | Host cancels ready check | Host command | `selecting` | Clear readiness |
| `ready-check` | Host requests countdown | Every connected player has an exact match, is ready, and has usable clock sync | `countdown` | Store a start time 5 seconds ahead and reset gameplay summaries |
| `countdown` | Server reaches start time | Every required player remains connected and scheduled | `playing` | Retain immutable selection and start schedule |
| `countdown` | Host cancels or required player disconnects/fails scheduling | Valid cancellation condition | `ready-check` | Clear start schedule and readiness |
| `playing` | Completion rule is met | All active players finished or results timeout elapsed | `results` | Freeze final standings and reject further live-score updates |
| `results` | Host requests replay | Selection remains valid | `ready-check` | Retain selection; clear readiness, scores, results, and start schedule |
| `results` | Host returns to selection | Host command | `selecting` | Retain selection for display; clear readiness, scores, results, and schedule |
| Any non-closed phase | Last player leaves | Room empty | `closed` | Destroy room |
| Any non-closed phase | Host closes room or room expires | Valid close condition | `closed` | Broadcast close reason and reject later commands |

The server increments `revision` once for every accepted command or lifecycle
event that changes canonical room state. Clients ignore snapshots whose
revision is lower than their latest accepted revision.

## Canonical state model

The names below specify the Stage 2 type model; they are not yet runtime code.

```text
RoomState
  protocolVersion
  roomId
  roomCode
  revision
  selectionRevision
  phase
  hostPlayerId
  players[]
  selection | null
  startSchedule | null
  results[]
  resultsDeadlineAtServerMs | null
  createdAtServerMs
  lastActivityAtServerMs
  expiresAtServerMs
  closeReason | null

RoomPlayer
  playerId
  displayName
  displayLabel
  joinedAtServerMs
  connectionStatus
  disconnectedAtServerMs | null
  availability
  ready
  clockQuality
  scheduleStatus
  liveScore | null
  finalResult | null

RoomSelection
  selectionRevision
  songId
  chartId
  chartHash
  identityVersion
  title
  subtitle
  artist
  stepType
  difficulty
  meter
  tapCount
  durationSeconds
  selectedByPlayerId
  selectedAtServerMs

StartSchedule
  selectionRevision
  startAtServerMs
  issuedAtServerMs

RoomResult
  playerId
  result
```

Reconnect tokens are secret credentials and must never appear in a room
snapshot. A client receives its own token only in a create/join/resume response
and stores it in `sessionStorage`.

## Player availability

Availability is scoped to a selection revision:

```text
unchecked | checking | matching-chart | song-missing | chart-missing |
chart-mismatch | error
```

An availability report contains both `selectionRevision` and `chartHash`.
Reports for an older revision are rejected. `ready: true` is accepted only when:

- the room is in `ready-check`
- the reported selection revision is current
- availability is `matching-chart`
- the reported hash equals the canonical chart hash
- the player has acknowledged locally usable audio

Any accepted selection change atomically clears every player's readiness and
invalidates availability from the previous selection revision.

## Command envelope

All messages crossing the network boundary are runtime-validated. Client
commands use a discriminated union with this common envelope:

```text
protocolVersion
type
commandId
roomId or roomCode, when applicable
expectedRoomRevision, when the command changes canonical state
payload
```

Authentication of room commands is associated with the socket's resumed
player session. The display name is never an identity credential.

### Client-to-server commands

| Command | Allowed sender and phase | Purpose |
| --- | --- | --- |
| `room.create` | Unjoined client | Create a room and become host |
| `room.join` | Unjoined client; room in `selecting` or `ready-check` | Join by room code |
| `room.resume` | Disconnected member within grace | Resume with player ID and reconnect token |
| `room.leave` | Any member outside `closed` | Leave intentionally |
| `room.close` | Host outside `closed` | Close the room |
| `player.rename` | Any member in `selecting` or `ready-check` | Change validated display name |
| `player.availability` | Any member in `selecting` or `ready-check` | Report local chart-match state |
| `player.ready` | Any member in `ready-check` | Set ready or unready |
| `selection.set` | Host in `selecting` or `ready-check` | Propose canonical chart selection |
| `selection.clear` | Host in `selecting` or `ready-check` | Clear canonical selection |
| `readyCheck.begin` | Host in `selecting` | Enter ready check |
| `readyCheck.cancel` | Host in `ready-check` | Return to selecting |
| `countdown.request` | Host in `ready-check` | Ask server to validate and schedule start |
| `countdown.cancel` | Host in `countdown` | Cancel scheduled start |
| `countdown.scheduled` | Any member in `countdown` | Acknowledge successful local scheduling |
| `countdown.failed` | Any member in `countdown` | Report inability to prepare or schedule |
| `game.score` | Any active member in `playing` | Submit bounded live-score snapshot |
| `game.finished` | Any active member in `playing` | Submit one final result |
| `results.replay` | Host in `results` | Return to ready check with same selection |
| `results.returnToSelection` | Host in `results` | Return room to selection |
| `clock.ping` | Connected member at any non-closed phase | Measure clock offset and round trip |

The server responds to every command with `command.accepted` or
`command.rejected`. Canonical changes are delivered as room snapshots; clients
must not assume an acknowledged proposal is canonical until they accept the
corresponding revision.

### Server-to-client messages

- `command.accepted`
- `command.rejected`
- `room.created`
- `room.joined`
- `room.resumed`
- `room.snapshot`
- `room.closed`
- `clock.pong`
- `server.error`

Critical room state is sent as complete snapshots. Compact score updates may be
broadcast between snapshots, but a periodic/current snapshot remains the
recovery source of truth.

## Typed rejection codes

```text
invalid-command
invalid-payload
invalid-room-code
room-not-found
room-expired
room-full
game-in-progress
not-a-member
not-host
invalid-phase
stale-room-revision
stale-selection-revision
selection-required
chart-not-matched
audio-not-ready
players-not-ready
clock-not-synchronized
start-schedule-failed
display-name-invalid
protocol-version-mismatch
already-finished
score-regressed
rate-limited
reconnect-token-invalid
reconnect-grace-expired
```

A rejection includes the command ID, code, a safe user-facing message, and the
current room revision when available. Unknown protocol versions are rejected
before command processing.

## Song and chart identity

Display metadata helps players find content but never proves compatibility.
Identity is computed from the parser's normalized data, not original `.sm`
text or local filenames.

### Normalization rules

All strings are Unicode NFC-normalized and trimmed. Fields used only for
display are not part of `chartHash`. Numbers are finite decimal values encoded
using one canonical JSON number formatter; negative zero is encoded as zero.
Arrays are sorted as stated below and object keys have a fixed order.

`songId` is a SHA-256 digest of:

```text
identity version
normalized title, subtitle, and artist
normalized song offset
sorted BPM segments: beat and BPM
```

`chartId` is a SHA-256 digest of:

```text
songId
normalized step type
normalized chart description
normalized difficulty
meter
```

`chartHash` is the authoritative SHA-256 digest of this canonical runtime
payload:

```text
identityVersion = dance-vision-runtime-chart-v1
offsetSeconds
BPM segments sorted by beat, then BPM
stepType = dance-single
runtime notes sorted by hitTimeSeconds, then beat, then lane:
  lane
  beat
  hitTimeSeconds
```

The hash is displayed/stored as:

```text
dance-vision-runtime-chart-v1:<lowercase SHA-256 hex>
```

This definition deliberately follows what `SimfileParser`, `TimingMap`, and
`RuntimeChartBuilder` currently play. Whitespace, comments, line endings,
filenames, artwork, chart description, difficulty label, meter, and radar
values do not change `chartHash`. Changes to supported tap lanes, beats, BPM
segments, offset, or computed hit times do.

Unsupported holds, rolls, mines, stops, delays, warps, and fake notes are not
represented by version 1 because the current runtime does not play them. When
their runtime semantics are added, Dance Vision must introduce a new identity
version rather than silently changing version 1.

Raw audio hashing is optional and separate. The lobby must state that audio is
unverified until a future `audioHash` policy is introduced.

## Clock synchronization and start scheduling

The protocol uses server milliseconds for shared timestamps. Clients never
schedule audio directly from `Date.now()`.

For a clock sample:

```text
t0 = client performance.now() before clock.ping
t1 = server receive time
t2 = server send time
t3 = client performance.now() after clock.pong

roundTrip = (t3 - t0) - (t2 - t1)
offset = ((t1 - t0) + (t2 - t3)) / 2
```

The client collects at least five samples, discards invalid samples, and uses
the lowest-round-trip sample from the most recent sample window. Clock quality
is usable for the MVP when:

- at least three valid samples exist
- the selected sample is no older than 30 seconds
- selected round trip is at most 500 ms

These thresholds determine eligibility, not audio correction. After the
server's timestamp is converted to a local `performance.now()` deadline, the
client maps that deadline to `AudioContext.currentTime` and schedules
`AudioBufferSourceNode.start()` once. `AudioClock` remains authoritative for
chart position after playback starts.

If any required player cannot prepare audio/chart, unlock audio, or schedule
with at least one second of lead time, that player sends `countdown.failed` and
the server returns the room to `ready-check`.

## Live score and result policy

The score publisher observes local game state and never blocks `GameLoop`.

- Send immediately when score data changes, but no more than once per 100 ms.
- Coalesce multiple changes inside the 100 ms window into the newest snapshot.
- Send a heartbeat at least once per second while playing.
- Send the final result immediately and only once.
- After reconnecting during play, send the newest current snapshot rather than
  replaying queued updates.

A live score contains:

```text
selectionRevision
sequence
score
combo
maxCombo
perfectCount
greatCount
goodCount
missCount
gameTimeSeconds
```

The server validates integer, nonnegative counters; increasing sequence;
nondecreasing score and maximum combo; the current selection revision; a
reasonable message rate; and a score no greater than `tapCount * 1000`.
Current combo may decrease after a miss. A final score may not be below the
last accepted live score.

Scores are client-reported and therefore unverified. The server's validation
protects room state from malformed data but is not anti-cheat.

## Disconnect and reconnect policy

Transport disconnect does not stop local gameplay.

- Mark the player disconnected and keep the slot for 20 seconds.
- During `ready-check`, make a disconnected player unready.
- During `countdown`, cancel immediately and return to `ready-check`.
- During `playing`, local audio/gameplay continue and the sidebar shows the
  connection state.
- A valid `room.resume` restores the same player ID and latest room snapshot.
- On resume during play, the client sends one current score snapshot.
- After grace expiry, remove a guest from the required player set.
- After host grace expiry, transfer host to the earliest joined connected
  player. Close the room if none remains.

`sessionStorage` retains `roomId`, `playerId`, reconnect token, and protocol
version for refresh recovery. Intentional leave invalidates the token. Delivery
of `beforeunload` messages is never required for correctness.

## Security and operational limits

- Validate every network message at runtime and cap payload sizes.
- Rate-limit room creation, code guesses, commands, clock pings, and scores.
- Bind player commands to the authenticated socket session.
- Never log reconnect tokens or full command payloads containing credentials.
- Restrict production origins and require HTTPS/WSS.
- Room codes are locators, not authentication secrets.
- A server restart closes every MVP room.
- Single-player must remain available when the room server is unreachable.

## Stage 2 acceptance contract

The shared types, runtime schemas, and pure room reducer preserve these
invariants:

1. The server is the sole authority for canonical room state.
2. Only the host can select, start, replay, return, or close.
3. Every state-changing command is phase-checked and revision-aware.
4. A selection change invalidates readiness and stale availability atomically.
5. Exact chart compatibility uses the versioned runtime chart hash.
6. Countdown cannot begin without every required player matched, ready,
   schedulable, and acceptably clock-synchronized.
7. Network loss never blocks or pauses local gameplay.
8. Old snapshots, availability reports, and score sequences cannot overwrite
   newer state.
9. Single-player gameplay code has no transport dependency.
10. All illegal transitions return typed rejection codes and leave state
    unchanged.

Stage 2 tests must cover every transition in the table, host/guest authority,
revision conflicts, stale selection reports, readiness invalidation, score
regression, disconnect expiry, and host transfer.

## Stage 2 implementation

Stage 2 implements this contract in:

```text
shared/constants.ts
shared/schemas.ts
server/domain/roomStateMachine.ts
```

The shared boundary contains strict Zod schemas for every client command, every
server message category, canonical room snapshots, selections, availability,
scores, results, session credentials, and typed rejections. The server-domain
module is a pure state transition function with no socket, timer, browser,
database, or UI dependencies.

Vitest coverage lives beside the shared schemas and room state machine. Stage 2
is implementation-complete when its tests, TypeScript check, production build,
and the existing single-player browser regression all pass.

## Stage 3 implementation

Stage 3 implements import-time chart identity and local compatibility lookup:

```text
LibraryBuilder
  -> ChartIdentityService
       -> songId
       -> chartId
       -> runtime chartHash
  -> SongEntry.chartIdentities
  -> ChartAvailabilityIndex
       -> matching-chart
       -> chart-mismatch
       -> chart-missing
       -> song-missing
```

`ChartIdentityService` hashes canonical parsed/runtime data with Web Crypto
SHA-256. It records `unindexed`, `hashing`, `available`, and `failed` identity
states without converting browser-local files or object URLs into network
state. `ChartAvailabilityIndex` is rebuilt whenever a new local library is
accepted and cleared during application cleanup.

The runtime hash deliberately ignores source whitespace, comments, line
endings, filenames, difficulty labels, and other display-only metadata. It
changes when supported note lanes/beats, BPM timing, song offset, or calculated
hit times change. Unsupported empty charts receive a failed identity record
without aborting the rest of the library import.

## Stage 4 implementation

Stage 4 adds a standalone Node.js and Socket.IO room process:

```text
HTTP /health
Socket.IO command event
  -> strict shared schema validation
  -> RoomRegistry
  -> pure roomStateMachine
  -> command acknowledgement
  -> canonical room.snapshot broadcast
```

`RoomRegistry` owns the in-memory room map, room-code lookup, socket membership,
player IDs, reconnect tokens, and periodic lifecycle ticks. It delegates every
room rule to the Stage 2 reducer. Raw network messages never enter the reducer
until they pass the shared Zod command schema.

Implemented transport behavior includes:

- room creation with host credentials
- case-insensitive room-code joining
- typed command acknowledgements and rejections
- canonical snapshot broadcasts
- intentional leave and host-controlled close
- disconnect marking and reconnect-token resume
- reconnection-grace cleanup and host transfer through lifecycle ticks
- clock ping/pong transport for the later synchronization stage
- configurable client origins and port
- an independently bundled production server

The server remains intentionally stateless across process restarts and supports
one process instance. No frontend connection code or multiplayer UI is added in
Stage 4.

## Stage 5 implementation

Stage 5 adds three browser-side boundaries without changing the visible
single-player flow:

- `MultiplayerClient` owns Socket.IO connection state, schema validation,
  acknowledgements, command timeouts, reconnect transitions, and listener
  cleanup.
- `RoomSession` owns the latest canonical room snapshot, ignores stale room
  revisions, persists the current player identity, resumes stored sessions,
  and translates typed rejections into application errors.
- `SessionManager` selects either `LocalSession` or the online `RoomSession` as
  the active gameplay policy.

`GameplayController` now consults the active session policy before immediate
start, pause, restart, or replay. `LocalSession` enables all existing controls,
so normal offline play remains unchanged. `RoomSession` disables those local
authorities in preparation for the server-scheduled commands added in later
stages.

Reconnect credentials contain `roomId`, `playerId`, and `reconnectToken`, plus
the stored protocol version. They are kept in `sessionStorage`, rejected when
malformed or version-incompatible, and cleared after leave, room closure, or a
terminal resume rejection. The transport is constructed at application startup
but does not open a connection until a future host/join action asks it to.

## Stage 6 implementation

Stage 6 exposes the session boundary through framework-free application views:

- mode selection for Single Player, Host Session, and Join Session
- display-name and six-character room-code forms
- progress and typed server rejection messages
- a canonical lobby player list with host and connection badges
- duplicate-name disambiguation through the server's `displayLabel`
- intentional leave followed by transport disconnect and local-session restore
- a Session navigation button that returns to the active lobby

`MultiplayerView` owns DOM input and rendering only. It emits semantic intents
to `MultiplayerController`, which calls `RoomSession`, selects the active policy
through `SessionManager`, and changes application views. Neither the view nor
the existing gameplay, camera, audio, and rendering modules import Socket.IO or
parse protocol messages.

The browser still does not automatically resume a room after a full refresh;
that user-facing recovery flow remains assigned to Stage 13. The stored Stage 5
credentials and transport resume command are already available for it.

## Stage 7 implementation

Stage 7 connects the host's existing local-library workflow to canonical room
selection without serializing browser-local `File` objects or object URLs.

The host chooses **Choose a song** from the lobby, browses the normal imported
library, and selects a difficulty. `MultiplayerController` resolves the
import-time identity record and publishes only:

- `songId`, `chartId`, and the runtime-compatible `chartHash`
- the explicit chart identity version
- title, subtitle, artist, difficulty, meter, tap count, and duration metadata

Selection intents are debounced for 250 ms. The command carries the latest
known room revision, and only the server may assign `selectionRevision`,
`selectedByPlayerId`, and `selectedAtServerMs`. Every client renders the result
from the canonical room snapshot. Guests have no selection UI, and the server
continues rejecting direct guest `selection.set` commands with `not-host`.

The existing room reducer atomically increments `selectionRevision`, clears all
readiness and availability state, cancels countdown/gameplay state, and returns
the phase to `selecting` for every accepted change. Stage 8 will consume this
selection to perform exact local chart availability checks.

Stage 7 also fixes keyboard input ownership for forms. `KeyboardInput` no longer
captures `A`, `D`, or arrow movement keys while an input, textarea, select, or
editable element has focus, so multiplayer names and room codes receive normal
text entry.

## Stage 8 implementation

Stage 8 turns the canonical selection into a local compatibility and readiness
workflow. On every new `selectionRevision`, each client synchronously checks its
`ChartAvailabilityIndex` and reports only serializable availability state:

- `matching-chart` with the exact runtime chart hash
- `song-missing`
- `chart-missing`
- `chart-mismatch`
- whether the matching song has local audio

Availability reports carry the canonical selection revision. A result is not
sent again when the server already holds the same status, hash, revision, and
audio state. Reimporting a library triggers a fresh check for the current
selection. Stale room-revision collisions are retried after the newer snapshot
has time to arrive; old selection revisions remain rejected by the server.

The lobby now renders availability and Ready badges for every player. All
players may open the local import view without changing the host's canonical
selection. The host's **Begin ready check** control remains disabled until every
player is connected with an exact hash match and local audio.

During `ready-check`, each client may toggle Ready. Both the UI and server
require an exact current chart match with audio, while the server remains the
final authority. A new host selection atomically returns the room to selecting,
increments the selection revision, and clears every player's availability and
readiness. Stage 8 intentionally stops after everyone is ready; Stage 9 adds
the clock-quality requirement needed before countdown scheduling.

## Approved host-asset relay revision

The previous Stage 8 assumption that every player imports a matching library is
now transitional. The approved target model requires only the host to import
song files. Guests receive temporary assets through a reliable HTTPS server
relay, then select their own difficulty from the host's normalized chart
package.

The first migration checkpoint adds strict schemas in
`shared/relaySchemas.ts` for:

- artwork, preview audio, full song audio, and chart-package assets
- byte limits, MIME types, SHA-256 values, and expiry
- revisioned room previews
- one song package containing multiple chart descriptors
- normalized gameplay data without local file references
- per-player chart choices
- download, verification, preparation, and failure states
- the future relay-related Socket.IO command envelope

The currently implemented room schema is not replaced in this checkpoint. This
keeps the tested lobby usable until the R2 relay server and R3/R4 clients can
complete an end-to-end transfer. The full migration, relay endpoint contract,
storage lifecycle, and content-sharing boundary are specified in
[`HOST_ASSET_RELAY.md`](HOST_ASSET_RELAY.md).

## R2 temporary asset relay implementation

The room server now supports two authenticated Socket.IO requests:

```text
asset.upload.request    host only
asset.download.request  any current room member
```

Successful acknowledgements return opaque asset metadata, a short-lived bearer
ticket, and a relative relay path. The HTTP layer accepts streaming `PUT` and
`GET` requests at that path. Upload tickets are one-use; download tickets may
be reused briefly for a full or ranged request. Reconnect credentials are not
used as transfer tokens.

The upload pipeline verifies the reservation, host role, room quota, MIME type,
declared byte length, actual streamed byte count, and incremental SHA-256 before
atomically committing a temporary file. Failed or partial uploads are removed.
Downloads require current room membership at ticket issuance and support byte
ranges for resumable client work.

Files are stored beneath a hashed room directory with server-generated asset
names. Startup clears abandoned data because rooms are already non-durable;
periodic cleanup expires assets and tickets, and room closure revokes tickets
and deletes the room directory. R3 will use these endpoints to make shared
modal previews visible for the first time.
