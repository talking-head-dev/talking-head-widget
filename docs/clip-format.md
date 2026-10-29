# The clip format: `talking-head-clip`, version 1

One studio segment as the widget plays it: a JSON manifest that bundles what the studio pipeline already writes for the
segment, unchanged, with the audio in files beside it. The reader is `src/clip.ts` (`parseClip`, `loadClip`); the
writer is talking-head-server's `studio/clips.py` (`GET /api/v1/projects/{id}/segments/{sid}/clip/` and the project
export). A cross-repo interface: the workspace CLAUDE.md lists it, and the server's `test_sync.py` checks the format
name, the version and the audio kinds against `src/clip.ts`.

```json
{
  "format": "talking-head-clip",
  "version": 1,
  "id": "segment-04",
  "duration": 24.211,
  "audio": { "webm": "segment-04.webm", "mp3": "segment-04.mp3" },
  "timeline": { "format": "talking-head-timeline", "version": 1, "fps": 60, "names": ["jawOpen", "…"], "frames": [[0.0, "…"]],
                "start": 0, "method": "phonemes", "meta": { "profile": "Default", "duration": 24.2107 } },
  "schedule": { "emotion": "happy:0.2",
                "emotes": [{ "t": 3.36, "emotion": "surprised", "strength": 1.0, "hold": 0.88 }],
                "looks": [{ "t": 16.52, "yaw": 18, "pitch": 0, "hold": 0.8 }] },
  "words": [{ "word": "Studio", "start": 0.0, "end": 0.82 }, { "word": "mode", "start": 0.82, "end": 1.12 }],
  "text": "Studio mode takes a minute. …",
  "meta": { "project": "eb646993-…", "project_name": "Test 1", "segment": "9918464c-…", "position": 4,
            "profile": "Default", "exported": "2026-10-29T11:30:45+00:00" }
}
```

| Field | Required | What |
|---|---|---|
| `format`, `version` | yes | `"talking-head-clip"`, `1` |
| `id` | yes | the clip's name (the server uses `segment-NN`) |
| `duration` | yes | seconds of audio |
| `audio` | yes | the audio, relative to the manifest's URL (or absolute): an object with `webm` (Opus in WebM) and/or `mp3`, or one URL string (its kind from the extension). The widget plays the first kind the browser can (`CLIP_AUDIO` order: webm, then mp3; Safari before 17 has no WebM). |
| `timeline` | yes | the segment's `lipsync.json`: a `talking-head-timeline` v1 object, read by `parseTimelineFile` as is (the web app's `docs/lipsync/timeline-format.md`). Its own `audio` field is dropped on export. |
| `schedule` | no | the segment's `schedule.json` (`Performer.loadSchedule`): the base mood, emotes and looks with times on the audio's clock. The export drops the labeler's `quote` / `reason` and `skipped`. Missing or null: no emotions. |
| `words` | no | each word's start and end (the segment's `words.json`, other fields dropped): the captions |
| `text` | no | the segment's text: the accessible transcript (default: the words joined) |
| `meta` | no | anything else, kept as is |

**Rules** (the timeline format's): readers ignore unknown top-level fields; a new required field or a changed meaning
is version 2. All times are seconds on the audio's clock, from its start.

**The audio**, as the server encodes it from the segment's 24 kHz `speech.wav` with `/usr/bin/ffmpeg`: Opus at
32 kbps in WebM, mono; MP3 at 48 kbps, mono. A 24 s segment: 99 KB WebM, 146 KB MP3 (the WAV: 1.16 MB).

**Sizes** (that segment): the manifest is 100 KB, 13 KB gzipped (the timeline is 60 frames a second of 14 values).
A web server should send JSON gzipped; the project export's zip deflates it.

**The export's layout** (`GET /api/v1/projects/{id}/export/`):

```text
head.glb                 the head's web GLB (docs/web-head.md); missing when the project has no 3D head
clips/segment-01.clip.json, segment-01.webm, segment-01.mp3, …   every segment with speech and lip sync
README.txt               what's there and the embed snippet with these clips
```
