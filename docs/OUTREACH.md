# Reaching the people Lune is for

Three groups, in the order they matter for the portfolio: blind and low-vision
musicians, piano teachers, ABRSM candidates. The target is real words and real
numbers from about ten pianists and two teachers. One honest paragraph from a
blind pianist who used the braille file or the read-aloud bars is worth more
than a download count.

Nothing in this file is sent automatically. Every message goes from you, to a
person you chose, and every quote needs the permission the form records.

## The two links to send

| Link | Opens |
|------|-------|
| `https://lune.page/#/debussy-clair-de-lune/score` | Clair de lune, straight on the score, no sign-in |
| `https://lune.page/#feedback` | The feedback form (add `/teacher` to preselect "I teach") |

Ask for one sitting: open the piece, practise one hard bar for ten minutes,
then fill in the form. People answer a small ask.

## What the form collects

Role, how they read music (print, large print, screen reader, braille), what
changed, what is missing, a 1 to 5 "how much did it help", weeks of use, and a
quote permission: private, anonymous, or first name. No email is stored.

Read answers at **More → Feedback received** (owner sign-in). It shows progress
against the goal of 10 pianists and 2 teachers, and **Copy quotable lines**
leaves out every answer marked private.

Before it works on the live site: paste `supabase/schema.sql` into the Supabase
SQL editor and run it (it adds the `feedback` table and `owner_feedback`).
Until then the form offers the person an email draft with their answers in it.

## Who to write to

Check each organisation's own site for the right contact before sending. I have
not verified addresses, and a named person (head of music, access officer)
answers far more often than a general inbox.

Blind and low-vision musicians, through the places that already serve them:

- RNIB (UK), which runs a music advisory service
- New College Worcester and the Royal National College for the Blind (UK schools and colleges)
- Perkins School for the Blind (US)
- Filomen M. D'Agostino Greenberg Music School at Lighthouse Guild (New York)
- National Resource Center for Blind Musicians (US)
- Your local sensory support or visual impairment service, through your own school

Piano teachers:

- Your own teacher first, then teachers at your school and local music service
- EPTA UK and the Incorporated Society of Musicians (UK), MTNA (US)
- Teachers who prepare ABRSM candidates in your area

ABRSM candidates:

- Classmates and friends working on Grades 4 to 8
- Your school's music department noticeboard or newsletter

Start with people who know you. Five warm messages will beat fifty cold ones.

## Drafts

Change anything that doesn't sound like you.

### To a school or organisation for blind and low-vision musicians

> Subject: A free piano practice tool with braille music and spoken bars. Would one of your musicians try it?
>
> Hello,
>
> I'm Verushka Patel. I'm fifteen and I'm working towards ABRSM Grade 7 piano. I built a free practice site called Lune (lune.page). It has no ads and no payments.
>
> Some of it was made for musicians who don't read standard print: each bar can be described aloud (the notes, the chord, the fingering), the arrow keys move from bar to bar, there is large print and high contrast, and library pieces come with a braille music file (.brf) for an embosser or a refreshable display.
>
> I don't know yet whether any of that is right. I'm sighted, and I've tested it with VoiceOver but not with a musician who depends on it. Would one of your students or members be willing to try it for ten minutes and tell me what is wrong with it? This link opens Debussy's Clair de lune with no sign-in: https://lune.page/#/debussy-clair-de-lune/score
>
> The feedback form is at https://lune.page/#feedback. It doesn't ask for an email address.
>
> Thank you for reading this.
>
> Verushka Patel

Only keep the VoiceOver sentence if you have done that testing. If you haven't,
say so. They will respect it.

### To a piano teacher

> Subject: Could you try a teacher link with one student this week?
>
> Hello [name],
>
> I've built a free practice site called Lune (lune.page). The part I'd like your opinion on: you select the bars a student should work on, write the instruction, and send one link. The student opens the piece at those bars. Neither of you needs an account.
>
> Would you try it with one student before their next lesson and tell me whether they came back better prepared? Clair de lune opens here without signing in: https://lune.page/#/debussy-clair-de-lune/score
>
> Two minutes of feedback afterwards would help me a lot: https://lune.page/#feedback/teacher
>
> Thank you,
> Verushka

### To a pianist friend or classmate

> I made a practice site. Can you try it on one bar you're stuck on, ten minutes, and tell me honestly if it helped? https://lune.page then https://lune.page/#feedback after. It doesn't ask for your email.

## Numbers worth recording

Ask each person for one before and one after, in their own terms. Examples:

- Bars of the piece they could play at tempo before and after a week
- Wrong notes or hesitations in Play along on the same passage, first run and last run
- For a teacher: how many of the assigned bars the student had worked on at the next lesson
- For a braille or screen-reader user: whether they could find and learn a bar without sighted help, and how long it took

Write down the date and what they actually said. Don't round up, and don't
combine two people into one story.

## Tracking

Keep this table in a private note, not in the repository.

| # | Who (first name or initials) | Group | Asked on | Tried it | Form sent | Quote permission | Number |
|---|---|---|---|---|---|---|---|
| 1 | | pianist | | | | | |
| … | | | | | | | |
| 10 | | pianist | | | | | |
| T1 | | teacher | | | | | |
| T2 | | teacher | | | | | |

## Rules

- A quote is published only with the permission recorded on the form, in the words the person wrote.
- First names only. No surnames, schools, or emails anywhere public.
- Anyone under 18 checks with a parent or guardian before allowing a quote.
- If someone says it didn't help, that goes in the record too. A fix you made because a blind pianist told you something was broken is a stronger story than praise.
