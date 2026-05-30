# Medical English — PocketBook app shell

Refactor of the PB1 monolith into **shell + data**. The UI engine is written once;
each lesson is a JSON file. Verified byte-for-byte against PB1 v6 across all 42 screen states.

## Files

```
med-eng-app/
├── index.html            ← app shell (head + CSS + loader). Serve this.
├── engine.js             ← the render/logic engine (reads window.LESSON)
├── lessons/
│   └── pb1.json          ← lesson data (extracted from PB1)
├── build.js              ← bundles a lesson into one standalone .html (Node)
└── pb1.standalone.html   ← prebuilt standalone — open directly to preview
```

## Two ways to run

**1. Hosted (Cloudflare Pages / GitHub Pages):** serve the folder. The shell reads
`?lesson=<id>` and fetches `lessons/<id>.json`. One `index.html` serves every lesson:
- `index.html?lesson=pb1`
- `index.html?lesson=2b-03`

Locally: `cd med-eng-app && python -m http.server 8080` → open `localhost:8080/?lesson=pb1`.
(Opening `index.html` directly via `file://` won't work — browsers block `fetch()` there.
Use the standalone build for offline/file:// instead.)

**2. Standalone (offline / webview / Capacitor / Tauri):**
```
node build.js lessons/pb1.json pb1.standalone.html
```
Inlines the JSON + engine into one self-contained file. Opens from `file://`, works in any webview.

## Authoring a new lesson

Write a JSON file matching `lessons/pb1.json`. Top-level blocks:

- `meta` — id, title_en/vi, level, stage, cefr, hero_emoji, complete_en/vi
- `config.next` — the "next lesson" button (url, label, label_vi, free)
- `welcome` — scenario lines, can_do items, badges
- `done` — achievement recap items
- `situations[]` — flat shape: `tag, en_tag, emoji, en, vi, ctx_en/vi, pt, pt_vi,
  phrases[{en,vi,gl}], vocab[{en,ipa,vi}], pq_en/vi, opts[{t,ok,gl}], tip_en/vi`
- `quiz[]` — `en, vi, opts[{t,ok,gl}], exp_en/vi`

The `med-eng-lesson-author` skill generates this JSON automatically.

## One intentional deviation from PB1

PB1's done-screen hard-coded **"28 vocab words"**, but the lesson actually contains **25**.
The shell now derives the count from the data (correct = 25) instead of a literal, so it
stays right for every lesson. If you want the literal PB1 text back, say so.

## What's preserved (verified identical)

Every screen, every interaction: welcome, all 4 situations (learn + practice, both
answer states, review-phrases back-nav), 5-question quiz (correct + wrong feedback
branches), done screen + grade tiers, flashcards (front/back/again/got-it/complete),
auto-generated revision quiz, and restart. Neo-brutalist styling, theme cycling per
situation, TTS speed toggle, bilingual glosses/annotations — all intact.

## Next steps (not done here)

- Reconcile the `med-eng-lesson-author` skill schema to this **flat** shape (the skill
  currently specs a nested `practice_q` block; the real format is flat).
- Add persistence (IndexedDB) + FSRS scheduler — this shell is the foundation for it.
