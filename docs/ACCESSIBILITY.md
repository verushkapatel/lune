# Accessibility

What Lune does for people who read, see or move differently, and how each part
is checked. Everything here is tested in a real browser; nothing is claimed
that a test doesn't cover.

## Reading the score

- Letter names sit in their own lane under the staff, never on the noteheads.
  A chord's letters read top note first, on a phone too (a crowded chord moves
  down a line as a whole rather than splitting).
- Easy read switches the lane to Atkinson Hyperlegible. Large print engraves
  the score larger. Both are in Reading & access and on the Score toolbar.
- Braille music (.brf, 40 cells a line) for every piece the translator can
  handle, offered on Overview and Score. It is made automatically with
  music21 and says so.
- Screen readers: the bar panel can describe a bar aloud (hands, notes,
  fingers, a tip). Lune relies on the device's own screen reader rather than
  building its own audio navigation.

## Keyboard and screen readers

- A "Skip to content" link is first in tab order and moves focus into the
  view on screen (the app routes on the URL hash, so it moves focus instead of
  following a link).
- Messages that appear briefly (toasts) are also written to a live region
  that is always present, so screen readers announce them.
- Open pieces are a navigation list with the current one marked
  (`aria-current`); each has its own close button.
- Arrow keys move between bars and through search results; Enter opens.

## Touch

- On a phone, controls needed to practise have a 44 px hit area where the
  layout allows. Header tools grow in height only, so the header still fits a
  390 px screen. The tempo and position sliders keep their drawn size.

## Motion and colour

- `prefers-reduced-motion` turns off transitions and the score's fades.
- Light and dark themes; contrast is measured on every visible control and
  line of text in both.

## Checks

| Script | What it checks |
| --- | --- |
| `scripts/a11y_audit.py` | axe-core on home, score, bar panel, explain, piano, repertoire, study and settings, dark and light: no serious or critical issues. Plus: Tab reaches the skip link first, it moves focus into the score view, toasts reach the live region. |
| `scripts/contrast_audit.py` | Every visible control and text line, both themes; nothing under 3:1. Understands the CSS filter that draws the light theme, which axe can't, so axe's contrast rule is off. |
| `scripts/lune_flow_test.py` | Names, labels, dialogs, headings, keyboard and reduced motion inside the main flows. |
| `scripts/claude_pages_test.py` | Chord letters read top note first at 390 and 1280 px. |

Run them against a served build (see the top of each script). CI runs all of
them on every push (`.github/workflows/site.yml`).

## Known gaps

- A few labels still touch notation on a phone, and a few keys have no letter:
  across a 40-piece sample at 390 and 1280 px, 10 of about 90,000 labels touch
  ink and 40 struck keys are unlabelled. (The sweep used to report 230
  unlabelled notes; most were unisons, the same key in two voices, which get
  one label by design and are now counted once.) The worst case is beams and
  stems from the system below reaching up into a letter lane (Mozart, Sonata
  no. 10, III). `scripts/claude_lane_sweep.py --sample N` measures this.
- A bar too wide for a phone screen, such as the long run in bar 10 of the
  Pathétique (I), runs off the left edge: the engraver can't break a bar
  across lines.
- Voice notes and spoken questions understand English only.
