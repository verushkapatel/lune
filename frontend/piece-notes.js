/* Lune — written notes for the pieces Lune features.
 *
 * Only well-established history goes here (dates, sources, who it was for,
 * where the title came from). Key, metre, tempo, markings and the bars that
 * ask the most are never written by hand: the Explain page reads them from the
 * score itself (score-facts.js) and from Lune's own bar analysis, so they
 * always match the edition on screen, arrangements included.
 */
window.LunePieceNotes = (function () {
  const NOTES = [
    {
      test: /clair de lune/i,
      composer: /debussy/i,
      hook: "The third movement of Debussy's Suite bergamasque, and the piece Lune is named after.",
      history:
        "Debussy began the Suite bergamasque around 1890 and only published it in 1905, much revised. Clair de lune is the third of its four movements, after a Prélude and a Menuet and before a closing Passepied. In early drafts it was called Promenade sentimentale; the final title comes from Paul Verlaine's poem Clair de lune (1869), whose moonlit, masked figures also gave the suite its name. It is quiet music almost all the way through, and most of its colour comes from the pedal, the soft pedal and very even touch rather than from loud climaxes.",
      highlights: [
        "Published in 1905 as the third of four movements in the Suite bergamasque.",
        "The title comes from Verlaine's poem, not from a story Debussy wrote down.",
        "Much of the piece sits at pianissimo; the one big swell arrives in the middle section and falls back again.",
      ],
    },
    {
      test: /f(u|ü)r elise/i,
      composer: /beethoven/i,
      hook: "A short rondo Beethoven never published, found and printed forty years after his death.",
      history:
        "Für Elise is the Bagatelle No. 25 in A minor, WoO 59. Beethoven wrote it in 1810, but it was not published until 1867, when the scholar Ludwig Nohl printed it from a manuscript that has since been lost. Nobody knows for certain who Elise was; Therese Malfatti, a pupil Beethoven hoped to marry, and the singer Elisabeth Röckel are the two names most often suggested. The piece is a rondo: the famous opening tune comes back three times, with two contrasting episodes in between.",
      highlights: [
        "Written in 1810, published in 1867.",
        "The opening theme returns three times; each return should sound like coming home, not a restart.",
        "Who Elise was is still debated.",
      ],
    },
    {
      test: /gymnop[eé]die\W*(no\.?\s*)?1\b/i,
      composer: /satie/i,
      hook: "Satie's slow, spare waltz from 1888, the first of three Gymnopédies.",
      history:
        "Erik Satie wrote his three Gymnopédies in 1888, when he was 21 and playing piano in Montmartre cafés. The title refers to dances performed at festivals in ancient Sparta, and Satie marks the first one Lent et douloureux, slow and sorrowful. The left hand rocks between a low bass note and a chord on every bar while a plain melody floats above it. Debussy, a friend of Satie's, orchestrated the first and third in 1896, which helped make them famous.",
      highlights: [
        "Written in 1888, the first of three.",
        "Satie's marking means slow and sorrowful.",
        "The left hand's bass-then-chord pattern carries the whole piece; keep it steady and quiet.",
      ],
    },
    {
      test: /prelude in c major.*846|bwv 846|prelude in c major$/i,
      composer: /bach/i,
      hook: "The prelude that opens Bach's Well-Tempered Clavier, built from one broken-chord pattern.",
      history:
        "This prelude opens Book I of The Well-Tempered Clavier, which Bach completed in 1722: a prelude and fugue in every major and minor key. An earlier, shorter version appears in the little keyboard book Bach wrote for his eldest son, Wilhelm Friedemann, in 1720. Almost every bar is one chord broken into the same figure, so the music lives in the harmony moving from bar to bar. In 1853 Charles Gounod wrote a melody over it, which became the well-known Ave Maria.",
      highlights: [
        "Completed in 1722 as the first piece in Book I of The Well-Tempered Clavier.",
        "Nearly every bar repeats one pattern; listen to how each new chord changes the colour.",
        "Gounod's Ave Maria is this prelude with a tune added on top.",
      ],
    },
    {
      test: /moonlight|sonata no\.? 14.*(op\.? 27|c.sharp minor)|op\.? 27,? no\.? 2/i,
      composer: /beethoven/i,
      movement: true,
      hook: (mv) =>
        mv === 3
          ? "The stormy finale of Beethoven's Sonata quasi una fantasia, Op. 27 No. 2."
          : mv === 2
            ? "The short, light middle movement of Beethoven's Sonata quasi una fantasia, Op. 27 No. 2."
            : "The first movement of Beethoven's Sonata quasi una fantasia, Op. 27 No. 2.",
      history: (mv) =>
        "Beethoven wrote the Piano Sonata No. 14 in C♯ minor, Op. 27 No. 2, in 1801 and dedicated it to his pupil Countess Giulietta Guicciardi. He called it Sonata quasi una fantasia, a sonata in the manner of a fantasy, because it begins with a slow movement instead of a fast one. The name Moonlight came later, from the critic Ludwig Rellstab, who compared the first movement to moonlight on Lake Lucerne. " +
        (mv === 3
          ? "The finale reverses the mood completely: fast rising arpeggios, sharp accents and sudden loud chords make it the stormiest of the three movements."
          : mv === 2
            ? "The middle movement is a brief, graceful Allegretto that sits between the slow opening and the stormy finale."
            : "Beethoven asked for the whole movement to be played very delicately and without dampers, so the pedal is part of the sound from the first bar."),
      highlights: (mv) =>
        mv === 3
          ? ["Written in 1801; the nickname was added after Beethoven's death.", "The rising arpeggios need even fingers before speed.", "Count the rests between the loud chords; the silences are part of the drama."]
          : mv === 2
            ? ["Written in 1801; the nickname was added after Beethoven's death.", "Keep it light: this movement is a breath between two intense ones."]
            : [
                "Written in 1801; the nickname was added after Beethoven's death.",
                "Three layers to balance: the bass octaves, the steady triplets and the quiet melody on top.",
                "Beethoven's instruction to play without dampers means the pedal is part of the writing.",
              ],
    },
    {
      test: /nocturne.*op\W*9\W*no\W*2\b/i,
      composer: /chopin/i,
      hook: "Chopin's best-loved nocturne: a singing melody that comes back more ornamented each time.",
      history:
        "Chopin wrote his three Nocturnes Op. 9 around 1830 to 1831, in his early twenties, and published them in 1832 with a dedication to Marie Pleyel. The Irish composer John Field had invented the piano nocturne; Chopin took the idea further, writing melodies that imitate the long lines and decorations of opera singers. In the E♭ major nocturne the main tune returns several times, each time with more ornaments, and ends with a short cadenza before the final chords.",
      highlights: [
        "Published in 1832, the second of three nocturnes in Op. 9.",
        "The right hand sings like a voice; the left hand's wide broken chords should stay soft underneath.",
        "Each return of the theme is more decorated: keep the melody notes clear inside the ornaments.",
      ],
    },
    {
      test: /liebestraum/i,
      composer: /liszt/i,
      hook: "Liszt's piano version of his own love song, the third of three Liebesträume.",
      history:
        "Liszt published the three Liebesträume (dreams of love) in 1850 as piano versions of songs he had written earlier. The third sets Ferdinand Freiligrath's poem O lieb, so lang du lieben kannst, which urges the reader to love while they still can. The melody passes between the hands and is interrupted twice by flowing cadenzas, so much of the work is keeping the tune singing while the accompaniment moves around it.",
      highlights: [
        "Published in 1850, originally a song.",
        "The tune moves between the hands; follow it, not the busiest notes.",
        "Two cadenzas link the sections; they should sound free but not rushed.",
      ],
    },
    {
      test: /minuet in g/i,
      composer: /bach|petzold/i,
      hook: "The minuet from the 1725 notebook for Anna Magdalena Bach, now credited to Christian Petzold.",
      history:
        "This minuet comes from the second notebook Bach put together for his wife, Anna Magdalena, in 1725, a collection of pieces by several composers for the family to play. For a long time it was thought to be by Bach; scholars now credit it to the Dresden organist Christian Petzold. It is a dance in three with two halves, each repeated, and it pairs naturally with the Minuet in G minor that follows it in the notebook.",
      highlights: [
        "From the 1725 notebook for Anna Magdalena Bach.",
        "Now credited to Christian Petzold.",
        "Feel one strong beat per bar, as in a danced minuet.",
      ],
    },
  ];

  function forPiece(piece) {
    if (!piece) return null;
    const o = piece.overview || {};
    const title = `${o.title || piece.title || ""} ${piece.id || ""} ${piece.file || ""}`.replace(/[-_]+/g, " ");
    const composer = o.composer || piece.composer || "";
    const n = NOTES.find((x) => x.test.test(title) && x.composer.test(composer));
    if (!n) return null;
    // which movement: from the title ("Movement 3") or the file name ("3rd_movement")
    const where = `${title} ${piece.filename || ""}`;
    const mv = Number((where.match(/movement\D{0,3}(\d)|(\d)(?:st|nd|rd|th)[ _]mov|mvt\D?(\d)|sonata14\W(\d)/i) || []).slice(1).find(Boolean)) || 1;
    const pick = (v) => (typeof v === "function" ? v(mv) : v);
    return { hook: pick(n.hook), history: pick(n.history), highlights: pick(n.highlights) };
  }

  // Template text that older catalogue entries carry instead of real notes.
  const FILLER = /is ready to explore on Lune|It is associated with|belongs to the .+ era\s+[—-]\s+music by|Open the piece to read|Place every phrase in the|Read the biography slowly/i;
  const isFiller = (s) => !s || FILLER.test(String(s));

  return { forPiece, isFiller };
})();
