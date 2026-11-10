# Pitch checklist

What to check before showing Lune to investors, the demo to give, and
answers to the questions likely to come up. Live site: https://lune.page/

## Before the meeting (owner)

1. **Play on a real iPhone.** On the iPhone, open https://lune.page/ in Safari
   with the side switch off silent. Tap the Clair de lune button, then Play,
   and check you hear the piano. Then stop it, reload the page and press Play
   again. Do the same once from the home screen if Lune is installed. Never
   tested on a device: if it fails, demo from a laptop.
2. **Remove test rows from the live study.** In the Supabase SQL editor,
   look first, then delete:

   ```sql
   select participant, count(*) from public.study_results
   where participant = 'T-01' group by participant;

   delete from public.study_results where participant = 'T-01';
   ```
3. **Warm the phone.** Open the demo pieces once on the phone you'll use. A
   second visit draws each score once instead of three times.

## Demo (5 minutes)

1. Landing page: the opening bars of Clair de lune engraved live. Tap
   Notes / Fingers, then Play.
2. Open Clair de lune (no sign-in needed). Music appears in about half a
   second. Show the letter lane under the staff, Notes / Fingers / Off, and
   Listen.
3. Tap a bar: the bar panel with hands, notes, fingers and a tip.
4. Piano tab: falling notes in time with the score.
5. Settings: Easy read, large print, light and dark, Braille download.

Safe demo pieces: Clair de lune and the musetrainer and OpenScore pieces. On
a phone, avoid bar 10 of the Pathétique (I), which runs off the screen, and
Mozart's Sonata no. 10, III, where beams cross the letters.

## Likely questions

- **Can you sell the scores you show?** Everything Lune bundles, and the
  OpenScore and musetrainer catalogues, are public domain or openly licensed
  (CC0 for OpenScore). The 235 ASAP movements are CC BY-NC-SA, which is free
  use only. A paid build leaves them out with
  `LUNE_COMMERCIAL=1 scripts/build_site.sh` (or
  `scripts/commercial_catalog.py`), taking the catalogue from 1,957 to 1,722
  fetch-on-open scores.
- **Is Ask Lune AI?** It works without any model, using rules over the
  score's analysis. If the user runs a local model (Ollama), it uses that.
  The interface never calls the built-in answers AI (docs/AI.md).
- **Accessibility?** Zero serious axe issues on eight screens in both themes.
  Nothing on screen falls below 3:1 contrast. There's a skip link, a live
  region and 44 px touch targets, plus Braille music. See docs/ACCESSIBILITY.md.
- **Does it work offline?** After one visit, the app, opened scores, search
  and the piano sound all work offline (docs/OFFLINE.md).
- **How fast is it?** On a phone the home page scores 78 in Lighthouse. On a
  score page, music appears in 0.6 s (it was 3.6 s). Lighthouse still scores
  the score page 43, because engraving runs on the main thread. That's the
  next engineering step.

## Known gaps (be upfront if asked)

- Speed on a slow phone's first visit to a long score.
- The two notation cases above.
- Voice questions are English only.
- The bundled library comes from open editions. Each is credited, but each
  should be checked individually before a commercial launch.
