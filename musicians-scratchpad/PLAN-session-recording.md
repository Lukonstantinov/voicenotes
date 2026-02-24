# Session Recording & Note Map — Implementation Plan

## Summary
Add session recording with a live piano-roll timeline, post-recording analysis
(quantization + pitch correction), multiple notation systems (presets + custom),
and persistent session storage.

---

## 1. Data Model & Types (`src/utils/sessionTypes.ts`)

```ts
// A single detected note event (after merging raw polls into one sustained note)
interface RecordedNote {
  id: string;                  // uuid
  noteName: string;            // English name: "C", "C#", "D", ...
  octave: number;
  frequency: number;           // average freq during this note
  cents: number;               // average cent deviation
  confidence: number;          // average confidence
  startMs: number;             // ms from session start
  endMs: number;               // ms from session start
}

// Corrected version of a note after analysis
interface CorrectedNote extends RecordedNote {
  originalNoteName: string;    // what was actually detected
  originalStartMs: number;
  originalEndMs: number;
  wasQuantized: boolean;
  wasPitchCorrected: boolean;
}

interface Session {
  id: string;
  name: string;
  createdAt: number;           // epoch ms
  durationMs: number;
  notes: RecordedNote[];
  correctedNotes: CorrectedNote[] | null;  // null until user runs correction
  bpm: number | null;          // detected or user-set BPM (for quantization)
  key: string | null;          // user-set key (for pitch correction)
}

// Notation system
interface NotationPreset {
  id: string;
  name: string;                // "English", "Solfege", "German", "Custom"
  isBuiltIn: boolean;
  noteMap: Record<string, string>;  // { "C": "Do", "D": "Re", ... }
}
```

## 2. Notation System (`src/utils/notationSystems.ts`)

Built-in presets:
| English | Solfege      | German |
|---------|-------------|--------|
| C       | Do          | C      |
| C#      | Do#         | Cis    |
| D       | Re          | D      |
| D#      | Re#         | Dis    |
| E       | Mi          | E      |
| F       | Fa          | F      |
| F#      | Fa#         | Fis    |
| G       | Sol         | G      |
| G#      | Sol#        | Gis    |
| A       | La          | A      |
| A#      | La#         | Ais    |
| B       | Si          | H      |

- `translateNote(noteName: string, preset: NotationPreset): string`
- Custom presets: user edits a mapping for all 12 notes, saved to storage.

## 3. Session Recorder Hook (`src/ui/hooks/useSessionRecorder.ts`)

Responsibilities:
- Wraps `usePitchPolling` — when recording is active, accumulates raw pitch
  results into `RecordedNote[]`.
- **Note merging logic**: consecutive polls of the same note (same name + octave)
  within a tolerance window are merged into a single `RecordedNote` with
  averaged frequency/cents/confidence and a combined time span.
- **Gap handling**: if no pitch is detected for >150ms, close the current note.
- Exposes: `{ isRecording, startRecording, stopRecording, elapsedMs, notes }`.

## 4. Live Piano-Roll Timeline (`src/ui/components/PianoRollTimeline.tsx`)

- Horizontal `ScrollView` that auto-scrolls to the right edge during recording.
- Y-axis: MIDI note number (pitch), rendered as rows.
  Only show the range of notes actually appearing (auto-zoom to used range + 2 semitone padding).
- X-axis: time in seconds.
- Each note is a colored rounded rectangle.
  - Width = duration, position = start time.
  - Color coding by note name (12-color palette) or by octave.
- During recording: new notes appear in real-time on the right edge.
- After recording: full session visible, pinch-to-zoom / scroll freely.
- After correction: toggle button shows corrected notes overlaid in a
  different opacity/outline style (original = solid, corrected = outlined or vice versa).

## 5. Post-Recording Analysis (`src/utils/sessionAnalysis.ts`)

### 5a. BPM Detection
- Analyze note onset times to estimate BPM (autocorrelation on onset intervals).
- User can override with manual BPM entry.

### 5b. Quantization (snap to grid)
- Given a BPM, compute grid positions for 16th-note subdivisions.
- For each note: snap `startMs` and `endMs` to the nearest grid line.
- Remove notes shorter than a 32nd note at the given BPM (noise).

### 5c. Pitch Correction
- Given a key (e.g., C major), define the 7 diatonic pitches.
- For each note: if it's not in the scale, snap to the nearest scale degree
  (prefer closest by semitone distance; break ties toward the note's cent deviation direction).

### 5d. Non-Destructive
- `analyzeSession(session, bpm, key) => CorrectedNote[]`
- Original `notes[]` is never mutated.
- `correctedNotes[]` stored alongside.
- UI toggle: "Show Original" / "Show Corrected".

## 6. Session Persistence (`src/utils/sessionStorage.ts`)

- Use `AsyncStorage` (already part of React Native) to store sessions.
- Key: `sessions_index` → array of `{ id, name, createdAt, durationMs }`.
- Key per session: `session_{id}` → full `Session` object (JSON).
- Functions: `saveSession`, `loadSession`, `listSessions`, `deleteSession`,
  `renameSession`.

## 7. Navigation & Screens

Add simple state-based navigation (no react-navigation dependency to stay lightweight):

| Screen | Purpose |
|--------|---------|
| **TunerScreen** | Current live tuner (existing UI) with added "Record" button |
| **RecordingScreen** | Live pitch display + live piano-roll timeline during recording |
| **SessionReviewScreen** | Full piano-roll, BPM/key selectors, "Correct" button, toggle original/corrected |
| **SessionListScreen** | List of saved sessions with name, date, duration; tap to review |
| **SettingsScreen** | Notation system picker, custom notation editor |

Navigation model:
```
AppNavigator (state-based)
├── TunerScreen (default)
│     └── [Record] → RecordingScreen
│           └── [Stop] → SessionReviewScreen
├── SessionListScreen
│     └── [Tap session] → SessionReviewScreen
└── SettingsScreen
```

Bottom tab bar or simple header buttons for Tuner / History / Settings.

## 8. Settings & Notation Persistence (`src/utils/settingsStorage.ts`)

- Store active notation preset ID and custom presets in AsyncStorage.
- `getNotationPreset`, `setNotationPreset`, `saveCustomPreset`, `listPresets`.

## 9. Implementation Phases

### Phase A: Core Data Layer
1. Create `src/utils/sessionTypes.ts` — all type definitions
2. Create `src/utils/notationSystems.ts` — presets + translate function
3. Create `src/utils/sessionStorage.ts` — AsyncStorage CRUD
4. Create `src/utils/settingsStorage.ts` — notation preferences
5. Unit tests for notation translation and session serialization

### Phase B: Recording Hook & Note Merging
1. Create `src/ui/hooks/useSessionRecorder.ts`
2. Note merging logic with gap detection
3. Unit tests for note merging (mock pitch data → expected RecordedNote[])

### Phase C: Live Piano-Roll Component
1. Create `src/ui/components/PianoRollTimeline.tsx`
2. Render recorded notes as colored blocks
3. Auto-scroll during recording
4. Time axis labels

### Phase D: Navigation & Screens
1. Create `src/ui/navigation/AppNavigator.tsx` — screen state machine
2. Create `src/ui/screens/TunerScreen.tsx` — extract from current App.tsx
3. Create `src/ui/screens/RecordingScreen.tsx` — pitch display + live timeline
4. Create `src/ui/screens/SessionReviewScreen.tsx` — review + correction UI
5. Create `src/ui/screens/SessionListScreen.tsx` — history browser
6. Create `src/ui/screens/SettingsScreen.tsx` — notation picker + editor
7. Update `src/ui/App.tsx` to mount AppNavigator

### Phase E: Post-Recording Analysis
1. Create `src/utils/sessionAnalysis.ts` — BPM detection, quantization, pitch correction
2. Wire into SessionReviewScreen — BPM/key selectors, "Correct" button
3. Toggle original/corrected on timeline
4. Unit tests for quantization and pitch correction

### Phase F: Polish
1. Session naming (auto-generate from date, editable)
2. Delete/rename sessions
3. Empty states (no sessions yet, no notes detected)
4. Verify all existing tests still pass
5. Final commit and push

---

## Architecture Notes
- All analysis code lives in `src/utils/` — pure functions, no side effects.
- Recording hook lives in `src/ui/hooks/` — follows existing pattern.
- Navigation is state-based (no external dependency) — follows "no redux" rule.
- AsyncStorage is part of `@react-native-async-storage/async-storage`
  (needs install, but it's the standard RN storage solution — no heavy deps).
- The piano-roll uses only RN `View`s and `ScrollView` — no canvas/SVG dependency.
