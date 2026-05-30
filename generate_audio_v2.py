#!/usr/bin/env python3
"""
generate_audio_v2.py — Medical English PocketBook TTS generator
- Engine   : edge-tts (Microsoft Neural TTS, free, no API key)
- Strategy : seeded-random voice per section → stable across re-runs
- Output   : audio/pb1/*.mp3  +  audio/pb2/*.mp3
- Manifest : audio/manifest.json  (clip_id → voice + text, for debugging)
"""

import asyncio
import json
import os
import random
import subprocess
import sys

# ─── Auto-install edge-tts if missing ────────────────────────────────────────
try:
    import edge_tts
except ImportError:
    print("📦 edge-tts not found — installing...")
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "edge-tts",
        "--quiet", "--break-system-packages"
    ])
    import edge_tts

# ─── Voice pool ───────────────────────────────────────────────────────────────
VOICE_POOL = [
    "en-GB-SoniaNeural",        # F · British
    "en-GB-RyanNeural",         # M · British      (replaces OllieMultilingual)
    "en-GB-LibbyNeural",        # F · British      (replaces AdaMultilingual)
    "en-CA-LiamNeural",         # M · Canadian
    "en-IE-EmilyNeural",        # F · Irish
    "en-US-MichelleNeural",     # F · American
    "en-US-GuyNeural",          # M · American     (replaces RyanMultilingual)
    "en-US-JennyNeural",        # F · American     (replaces LewisMultilingual)
    "en-AU-NatashaNeural",      # F · Australian   (replaces JoanneNeural — safer)
    "en-AU-WilliamNeural",      # M · Australian   (replaces KenNeural — safer)
]

def voice_for(section_id: str) -> str:
    """Pick a voice deterministically from the pool, seeded by section_id.
    Same section_id → always same voice, regardless of run order."""
    rng = random.Random(hash(section_id) & 0xFFFFFFFF)
    return rng.choice(VOICE_POOL)


# ─── Clip builders ────────────────────────────────────────────────────────────
def build_clips_from_lesson(lesson_id: str, situations: list, quiz: list) -> list:
    """
    Returns a flat list of dicts:
      { id, text, voice, path }

    Naming convention
    ─────────────────
    pb1_s1_pt      ← patient prompt, situation 1
    pb1_s1_p0      ← phrase 0 of situation 1
    pb1_s1_v0      ← vocab chip 0 of situation 1
    pb1_q0         ← quiz question 0  (quiz gets its own seed: "<id>_quiz")
    """
    clips = []

    for sit in situations:
        sid   = sit["id"]                          # 1, 2, 3, 4
        sec   = f"{lesson_id}_s{sid}"              # seed key
        voice = voice_for(sec)

        # Patient prompt
        pt_text = sit.get("pt", "").strip()
        if pt_text and not pt_text.startswith("("):   # skip stage-direction lines
            clips.append({
                "id"   : f"{sec}_pt",
                "text" : pt_text,
                "voice": voice,
                "path" : f"audio/{lesson_id}/{sec}_pt.mp3",
            })

        # Doctor / staff phrases
        for i, ph in enumerate(sit.get("phrases", [])):
            clips.append({
                "id"   : f"{sec}_p{i}",
                "text" : ph["en"],
                "voice": voice,
                "path" : f"audio/{lesson_id}/{sec}_p{i}.mp3",
            })

        # Vocab chips  (isolated words → same voice, natural for the section)
        for i, vc in enumerate(sit.get("vocab", [])):
            clips.append({
                "id"   : f"{sec}_v{i}",
                "text" : vc["en"],
                "voice": voice,
                "path" : f"audio/{lesson_id}/{sec}_v{i}.mp3",
            })

    # Quiz questions — own seed so voice is independent of any situation
    quiz_voice = voice_for(f"{lesson_id}_quiz")
    for i, q in enumerate(quiz):
        clips.append({
            "id"   : f"{lesson_id}_q{i}",
            "text" : q["en"],
            "voice": quiz_voice,
            "path" : f"audio/{lesson_id}/{lesson_id}_q{i}.mp3",
        })

    return clips


# ─── PB1 data  (inline — no external file needed) ────────────────────────────
def load_pb1() -> tuple[list, list]:
    # Try file first (allows override), fall back to inline
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pb1.json")
    if os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        return data["situations"], data["quiz"]

    # ── Inline data ───────────────────────────────────────────────────────────
    situations = [
        {
            "id": 1,
            "pt": "Excuse me, where is the X-ray room?",
            "phrases": [
                {"en": "The X-ray room is on the second floor."},
                {"en": "Go straight, then turn left."},
                {"en": "Follow me, please."},
                {"en": "I'm not sure — let me find someone to help."},
            ],
            "vocab": [
                {"en": "elevator"},
                {"en": "corridor"},
                {"en": "waiting room"},
                {"en": "reception"},
                {"en": "ward"},
                {"en": "restroom"},
                {"en": "outpatient clinic"},
            ],
        },
        {
            "id": 2,
            "pt": "How long is the wait?",
            "phrases": [
                {"en": "The wait is approximately 20 minutes."},
                {"en": "The doctor is with another patient right now."},
                {"en": "We're running a little behind schedule today."},
                {"en": "Please have a seat — we'll call your name."},
                {"en": "Let me check for you."},
            ],
            "vocab": [
                {"en": "appointment"},
                {"en": "queue"},
                {"en": "registration desk"},
                {"en": "consultation room"},
                {"en": "schedule"},
                {"en": "check-in"},
            ],
        },
        {
            "id": 3,
            "pt": "(Patient standing still — not asking anything)",
            "phrases": [
                {"en": "Excuse me, can I help you?"},
                {"en": "Are you okay?"},
                {"en": "Are you looking for something?"},
                {"en": "Please come with me — I'll help you."},
                {"en": "Let me get a nurse for you right away."},
            ],
            "vocab": [
                {"en": "nurse station"},
                {"en": "wheelchair"},
                {"en": "distressed"},
                {"en": "first aid"},
                {"en": "emergency room"},
                {"en": "escort"},
            ],
        },
        {
            "id": 4,
            "pt": "What is this medication for?",
            "phrases": [
                {"en": "Let me find the pharmacist for you."},
                {"en": "I'd suggest asking the doctor directly."},
                {"en": "Let me check your records."},
                {"en": "Your appointment is on Monday — let me confirm."},
            ],
            "vocab": [
                {"en": "prescription"},
                {"en": "dosage"},
                {"en": "pharmacist"},
                {"en": "refill"},
                {"en": "follow-up"},
                {"en": "discharge"},
            ],
        },
    ]
    quiz = [
        {"en": 'Patient: "Where is the elevator?" — Best response:'},
        {"en": '"We\'re running a little behind schedule today" means:'},
        {"en": "You see a patient in the hallway, looking worried. What should you say first?"},
        {"en": "Patient asks about their appointment but you're not managing their case. What do you say?"},
        {"en": "Which phrase do you use when you physically walk WITH the patient to show them the way?"},
    ]
    return situations, quiz


# ─── PB2 data  (inline — no pb2.json yet) ────────────────────────────────────
def load_pb2() -> tuple[list, list]:
    situations = [
        {
            "id": 1,
            "pt": '"Gastritis" — what does this actually mean?',
            "phrases": [
                {"en": 'The suffix "-itis" means inflammation.'},
                {"en": "Gastritis means inflammation of the stomach."},
                {"en": "You may have heard of hepatitis — that's inflammation of the liver."},
                {"en": 'Any word ending in "-itis" describes a type of inflammation.'},
            ],
            "vocab": [
                {"en": "gastritis"},
                {"en": "appendicitis"},
                {"en": "hepatitis"},
                {"en": "bronchitis"},
                {"en": "arthritis"},
                {"en": "dermatitis"},
                {"en": "tonsillitis"},
            ],
        },
        {
            "id": 2,
            "pt": '"Tachycardia" — what does that actually mean?',
            "phrases": [
                {"en": 'The root "cardio-" or "-cardia" refers to the heart.'},
                {"en": 'Tachycardia means a fast heart rate — "tachy-" means fast.'},
                {"en": "Bradycardia is the opposite — a slow heart rate."},
                {"en": "Cardiac arrest means the heart has stopped completely."},
            ],
            "vocab": [
                {"en": "cardiac"},
                {"en": "tachycardia"},
                {"en": "bradycardia"},
                {"en": "cardiomegaly"},
                {"en": "cardiologist"},
                {"en": "myocardial"},
                {"en": "palpitation"},
            ],
        },
        {
            "id": 3,
            "pt": '"Appendectomy" — can you tell what will happen just from the name?',
            "phrases": [
                {"en": 'The suffix "-ectomy" means surgical removal.'},
                {"en": "An appendectomy is the removal of the appendix."},
                {"en": 'A cholecystectomy removes the gallbladder — "chole" = bile, "cyst" = sac.'},
                {"en": "Know the root, and you know exactly what is being removed."},
            ],
            "vocab": [
                {"en": "appendectomy"},
                {"en": "cholecystectomy"},
                {"en": "mastectomy"},
                {"en": "tonsillectomy"},
                {"en": "hysterectomy"},
                {"en": "nephrectomy"},
                {"en": "gastrectomy"},
            ],
        },
        {
            "id": 4,
            "pt": '"Referred to a gastroenterologist" — who exactly is that?',
            "phrases": [
                {"en": '"-ology" means the study of — and "-ologist" is the specialist.'},
                {"en": "A gastroenterologist specializes in the digestive system."},
                {"en": '"Gastro-" means stomach, and "entero-" means intestine.'},
                {"en": "Know the root, and you know exactly which organ that specialist treats."},
            ],
            "vocab": [
                {"en": "cardiologist"},
                {"en": "neurologist"},
                {"en": "gastroenterologist"},
                {"en": "hepatologist"},
                {"en": "pulmonologist"},
                {"en": "dermatologist"},
                {"en": "oncologist"},
            ],
        },
    ]
    quiz = [
        {"en": 'What does the suffix "-itis" mean in medical English?'},
        {"en": '"Tachy-" as in "tachycardia" means:'},
        {"en": 'A patient is scheduled for a "nephrectomy." Which organ is involved?'},
        {"en": 'Which of these words means "inflammation of the liver"?'},
        {"en": 'A referral says "see a pulmonologist." This doctor specializes in:'},
    ]
    return situations, quiz


# ─── TTS generator ────────────────────────────────────────────────────────────
async def generate_clip(clip: dict, overwrite: bool = False) -> bool:
    path = clip["path"]
    if not overwrite and os.path.exists(path):
        print(f"   ⏭  skip   {clip['id']}  (exists)")
        return False

    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        communicate = edge_tts.Communicate(clip["text"], clip["voice"])
        await communicate.save(path)
        print(f"   ✅ done   {clip['id']}  [{clip['voice']}]")
        return True
    except Exception as e:
        print(f"   ❌ error  {clip['id']}  → {e}")
        return False


async def run_all(all_clips: list, overwrite: bool = False):
    tasks = [generate_clip(c, overwrite) for c in all_clips]
    results = await asyncio.gather(*tasks)
    generated = sum(1 for r in results if r)
    skipped   = len(results) - generated
    return generated, skipped


# ─── Manifest writer ─────────────────────────────────────────────────────────
def write_manifest(all_clips: list):
    manifest = {
        c["id"]: {"voice": c["voice"], "text": c["text"], "path": c["path"]}
        for c in all_clips
    }
    os.makedirs("audio", exist_ok=True)
    with open("audio/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\n📋 Manifest written → audio/manifest.json  ({len(manifest)} entries)")


# ─── Voice preview ────────────────────────────────────────────────────────────
def print_voice_preview(all_clips: list):
    from collections import defaultdict
    by_voice = defaultdict(list)
    for c in all_clips:
        by_voice[c["voice"]].append(c["id"])
    print("\n🎙  Voice assignment preview:")
    for v, ids in sorted(by_voice.items()):
        sections = sorted({i.rsplit("_", 1)[0] for i in ids})
        print(f"   {v:<38} → {', '.join(sections)}")


# ─── GitHub push ─────────────────────────────────────────────────────────────
def maybe_push_github():
    ans = input("\n📤 Push audio/ + manifest to GitHub? [y/N] ").strip().lower()
    if ans != "y":
        print("   Skipped. Run manually when ready.")
        return
    cmds = [
        ["git", "add", "audio/"],
        ["git", "commit", "-m", "feat: add pre-generated multi-voice TTS clips"],
        ["git", "push"],
    ]
    for cmd in cmds:
        print(f"   $ {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"   ⚠️  {result.stderr.strip()}")
            return
    print("   ✅ Pushed to GitHub.")


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(description="Medical English TTS Generator")
    parser.add_argument("--ci", action="store_true",
                        help="Non-interactive mode for GitHub Actions (no prompts)")
    args = parser.parse_args()
    ci = args.ci

    print("=" * 60)
    print("  Medical English — TTS Clip Generator  (multi-voice)")
    if ci:
        print("  Mode: CI (non-interactive, skip-existing)")
    print("=" * 60)

    # Build clip lists
    pb1_sits, pb1_quiz = load_pb1()
    pb2_sits, pb2_quiz = load_pb2()

    all_clips = []
    if pb1_sits:
        pb1_clips = build_clips_from_lesson("pb1", pb1_sits, pb1_quiz)
        all_clips += pb1_clips
        print(f"\n📗 PB1: {len(pb1_clips)} clips")

    pb2_clips = build_clips_from_lesson("pb2", pb2_sits, pb2_quiz)
    all_clips += pb2_clips
    print(f"📘 PB2: {len(pb2_clips)} clips")
    print(f"📦 Total: {len(all_clips)} clips")

    print_voice_preview(all_clips)

    # Overwrite option
    if ci:
        overwrite = False      # CI: always skip existing clips
    else:
        overwrite_ans = input("\n♻️  Overwrite existing MP3s? [y/N] ").strip().lower()
        overwrite = overwrite_ans == "y"

    # Generate
    print(f"\n🔊 Generating clips (overwrite={overwrite})...\n")
    generated, skipped = asyncio.run(run_all(all_clips, overwrite=overwrite))

    print(f"\n{'='*60}")
    print(f"  Done.  Generated: {generated}  |  Skipped: {skipped}")
    print(f"{'='*60}")

    write_manifest(all_clips)

    if not ci:
        maybe_push_github()


if __name__ == "__main__":
    main()
