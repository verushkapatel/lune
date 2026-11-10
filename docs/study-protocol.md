# Study protocol — does the letter row help students learn to read?

**Short title:** Lune reading study (labels-v1)
**Question:** When beginners practise note-reading with the letter name printed
under each note (as Lune does), do they learn to read the staff *better* — or do
they lean on the letters and learn *less* than students who practise without them?

Both outcomes are plausible, which is what makes the question worth asking:
labels give immediate, correct feedback (could speed learning), but they also
let a student answer without reading the staff at all (could slow it — the
"crutch" effect).

## Design

- **Between-subjects, randomised, pre-test / training / post-test.**
- **Conditions:** *labels* (letter shown under the note during training) vs
  *no-labels* (no letter; the right answer is shown after each response).
  Both conditions get the same feedback after every training answer — the only
  difference is whether the letter is visible *while* reading.
- **Assignment:** by participant code. `scripts/study_codes.py N` makes N codes,
  half of each condition, shuffled. The app derives the condition from the code,
  so neither student nor teacher chooses it, and the screen never names it.
- **Tests** (pre and post): 16 single notes, half treble, half bass, range
  C4–A5 (treble) and E2–C4 (bass), no accidentals, no labels, no feedback.
  Pre and post use different notes (seeded from the code).
- **Training:** 24 notes, same ranges, with feedback after each answer.

Everything runs at `https://verushkapatel.github.io/lune/#/study` (≈10 minutes).

## Measures

Per participant and phase (pre, post):
- **Accuracy:** proportion correct.
- **Speed:** median response time on correct answers.

Primary outcome: post-test accuracy. Secondary: post-test median time, and
gain (post − pre).

## Hypotheses (state before collecting data)

- **H1 (crutch):** controlling for pre-test accuracy, the *no-labels* group
  scores higher on the post-test than the *labels* group.
- **H0:** no difference.
(Pre-register which you expect, e.g. on OSF, before the first session.)

## Participants and size

Students who are beginning to read music (roughly ages 8–16, under two years of
lessons), recruited through piano teachers or a school music department.
For a large effect (d ≈ 0.8) a two-group comparison needs about 26 per group
(α = .05, power .80); using the pre-test as a covariate (if pre/post correlate
r ≈ .6) cuts that to roughly 17–20 per group. **Aim for 40+ in total**; with
fewer, report the result as a pilot and the effect size with its confidence
interval rather than a yes/no answer.

## Procedure

1. Teacher generates codes (`python3 scripts/study_codes.py 40 > codes.csv`),
   keeps the CSV privately, and gives each student a code on a slip of paper.
2. Student opens the study page on a laptop or tablet, enters the code, ticks
   consent (after the paper consent below is collected) and follows the screens.
3. Results upload anonymously to the study table (or, if accounts are not set
   up, the device keeps them — press *Download results (CSV)* at the end).
4. Optional: repeat training on 3 different days and run the post-test a week
   later, to test retention rather than just immediate effects.

## Analysis

1. Export `study_results` (Supabase → Table editor → Export CSV) or collect the
   CSVs from devices.
2. Per participant: pre accuracy, post accuracy, post median RT.
3. **ANCOVA:** `post_accuracy ~ condition + pre_accuracy` (in Python:
   `statsmodels.formula.api.ols`). Report the condition effect, its 95% CI and
   Cohen's d. Same for median RT (log-transformed).
4. Robustness: a mixed-effects logistic model on trial-level correctness
   (`correct ~ condition * phase + (1 | participant)`).
5. Exclude participants who did not finish both tests; report how many.

## Ethics, consent, data

- **Consent:** written consent from a parent/guardian for every under-18
  participant, plus the student's own assent (they tick the box on screen and
  may stop at any time). If you are running this through a school, follow the
  school's research policy and get the headteacher's permission; for a
  competition or publication, check whether your school or a teacher can act as
  an ethics reviewer.
- **What is recorded:** participant code, phase, condition, item number,
  answer letter, correct/incorrect, response time. No names, emails, audio,
  device IDs or IP addresses are stored by Lune (Supabase keeps standard
  server logs).
- **Linking codes to people:** only the teacher's private code sheet does
  this; destroy it once results are analysed.
- **Withdrawal:** a participant can ask to be removed by giving their code
  before the code sheet is destroyed; delete those rows in the dashboard.

### Parent/guardian consent (template)

> My child is invited to take part in a short study about learning to read
> music, run by **[name]** with **[teacher/school]**. Your child will name
> notes on a screen for about 10 minutes, using the free Lune app. They will
> use a code, not their name. We record only their answers and how long each
> took. Taking part is voluntary, has no effect on lessons or grades, and your
> child can stop at any time. Results will be reported only as group
> averages. Questions: **[contact]**.
>
> ☐ I agree that my child may take part. Name of child: ______
> Parent/guardian signature: ______ Date: ______

## Limitations to report

Single short session; single notes rather than real music; condition hidden
from students but not from the researcher; self-selected teachers and
students. A follow-up could measure sight-reading of short melodies, and use
Lune's *Play along* to score real playing.
