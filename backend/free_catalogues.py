"""Curated free/public-domain score catalogues for Lune.

Sources: musetrainer/library (PD MusicXML), craigsapp/scriabin (kern),
OpenScore/Lieder (CC0), KernScores Liszt (when reachable).
Never scrape commercial sheet-music sites.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import re

MUSETAINER_BASE = "https://raw.githubusercontent.com/musetrainer/library/master/scores/"
OPENSCORE_BASE = "https://raw.githubusercontent.com/OpenScore/Lieder/main/"
SCRIABIN_BASE = "https://raw.githubusercontent.com/craigsapp/scriabin/main/"
KERNSCORES_LISZT = (
    "https://kern.humdrum.org/cgi-bin/ksdata?"
    "file={file}&l=users/craig/classical/liszt&format=kern"
)

MUSETAINER_INDEX: List[Dict[str, Any]] = [
    {
        "file": 'La_Campanella_-_Grandes_Etudes_de_Paganini_No._3_-_Franz_Liszt.mxl',
        "title": 'Grandes études de Paganini no. 3 "La Campanella"',
        "composer": 'Franz Liszt',
        "keys": ['campanella', 'la campanella', 'paganini 3', 'etudes de paganini'],
    },
    {
        "file": 'Liebestraum_No._3_in_A_Major.mxl',
        "title": 'Liebestraum no. 3 in A-flat major, S.541/3',
        "composer": 'Franz Liszt',
        "keys": ['liebestraum', 'liebestraume', 'dream of love', 's 541'],
    },
    {
        "file": 'Schubert_Serenade_-_Standchen_-_By_Lizst.mxl',
        "title": 'Ständchen (Schubert) — Liszt transcription',
        "composer": 'Franz Liszt',
        "keys": ['standchen', 'ständchen', 'serenade schubert liszt', 'schubert serenade'],
    },
    {
        "file": 'Clair_de_lune_-_Claude_Debussy.mxl',
        "title": 'Suite bergamasque — Clair de lune',
        "composer": 'Claude Debussy',
        "keys": ['clair de lune', 'clair de luna', 'bergamasque'],
    },
    {
        "file": 'Arabesque_L._66_No._1_in_E_Major.mxl',
        "title": 'Arabesque no. 1 in E major, L.66',
        "composer": 'Claude Debussy',
        "keys": ['arabesque', 'arabesque 1', 'l 66'],
    },
    {
        "file": 'Erik_Satie_-_Gymnopedie_No.1.mxl',
        "title": 'Gymnopédie no. 1',
        "composer": 'Erik Satie',
        "keys": ['gymnopedie', 'gymnopédie', 'gymnopedie 1'],
    },
    {
        "file": 'Gnossienne_No._1.mxl',
        "title": 'Gnossienne no. 1',
        "composer": 'Erik Satie',
        "keys": ['gnossienne', 'gnossienne 1'],
    },
    {
        "file": 'Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl',
        "title": 'Ballade no. 1 in G minor, op. 23',
        "composer": 'Frédéric Chopin',
        "keys": ['ballade 1', 'ballade no 1', 'op 23'],
    },
    {
        "file": 'Chopin_-_Nocturne_Op._9_No._1.mxl',
        "title": 'Nocturne op. 9 no. 1',
        "composer": 'Frédéric Chopin',
        "keys": ['nocturne op 9 no 1', 'nocturne 9 1'],
    },
    {
        "file": 'Chopin_-_Nocturne_Op_9_No_2_E_Flat_Major.mxl',
        "title": 'Nocturne op. 9 no. 2 in E-flat major',
        "composer": 'Frédéric Chopin',
        "keys": ['nocturne op 9 no 2', 'nocturne 9 2', 'nocturne e flat'],
    },
    {
        "file": 'Nocturne_No._20_in_C_Minor.mxl',
        "title": 'Nocturne no. 20 in C-sharp minor, op. posth.',
        "composer": 'Frédéric Chopin',
        "keys": ['nocturne 20', 'nocturne c sharp', 'nocturne posthumous'],
    },
    {
        "file": 'Waltz_Opus_64_No._2_in_C_Minor.mxl',
        "title": 'Waltz op. 64 no. 2 in C-sharp minor',
        "composer": 'Frédéric Chopin',
        "keys": ['waltz op 64 no 2', 'waltz 64 2'],
    },
    {
        "file": 'Waltz_in_A_MinorChopin.mxl',
        "title": 'Waltz in A minor, B.150',
        "composer": 'Frédéric Chopin',
        "keys": ['waltz in a minor', 'waltz a minor', 'b 150'],
    },
    {
        "file": 'Prlude_Opus_28_No._4_in_E_Minor__Chopin.mxl',
        "title": 'Prelude op. 28 no. 4 in E minor',
        "composer": 'Frédéric Chopin',
        "keys": ['prelude 4', 'prelude op 28 no 4'],
    },
    {
        "file": 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl',
        "title": 'Minuet in G major, BWV Anh. 114',
        "composer": 'Johann Sebastian Bach',
        "keys": ['minuet in g', 'bwv anh 114', 'anna magdalena'],
    },
    {
        "file": 'Prelude_No._2_BWV_847_in_C_Minor.mxl',
        "title": 'Prelude in C minor, BWV 847',
        "composer": 'Johann Sebastian Bach',
        "keys": ['bwv 847', 'prelude c minor'],
    },
    {
        "file": 'moonlight_sonata_3rd_movement.mxl',
        "title": 'Piano Sonata no. 14 "Moonlight" — Movement 3',
        "composer": 'Ludwig van Beethoven',
        "keys": ['moonlight 3', 'moonlight movement 3', 'moonlight mvt 3'],
    },
    {
        "file": 'Sonate_No._8_Pathetique_2nd_Movement.mxl',
        "title": 'Piano Sonata no. 8 "Pathétique" — Movement 2',
        "composer": 'Ludwig van Beethoven',
        "keys": ['pathetique 2', 'pathétique movement 2', 'sonata 8 movement 2'],
    },
    {
        "file": 'Piano_Sonata_No._11_K._331_3rd_Movement_Rondo_alla_Turca.mxl',
        "title": 'Piano Sonata no. 11, K.331 — Rondo alla Turca',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['alla turca', 'turkish march', 'rondo alla turca', 'k 331'],
    },
    {
        "file": 'Ave_Maria_D839_-_Schubert_-_Solo_Piano_Arrg..mxl',
        "title": 'Ave Maria, D.839 (piano)',
        "composer": 'Franz Schubert',
        "keys": ['ave maria', 'd 839', 'ellens dritter gesang'],
    },
    {
        "file": 'Hungarian_Dance_No_5_in_G_Minor.mxl',
        "title": 'Hungarian Dance no. 5 in G minor',
        "composer": 'Johannes Brahms',
        "keys": ['hungarian dance', 'hungarian dance 5', 'brahms 5'],
    },
    {
        "file": 'Canon_in_D.mxl',
        "title": 'Canon in D',
        "composer": 'Johann Pachelbel',
        "keys": ['canon in d', 'pachelbel'],
    },
    {
        "file": 'Dance_of_the_sugar_plum_fairy.mxl',
        "title": 'Dance of the Sugar Plum Fairy',
        "composer": 'Pyotr Ilyich Tchaikovsky',
        "keys": ['sugar plum', 'sugar plum fairy'],
    },
    {
        "file": 'Flight_of_the_Bumblebee.mxl',
        "title": 'Flight of the Bumblebee (piano)',
        "composer": 'Nikolai Rimsky-Korsakov',
        "keys": ['bumblebee', 'flight of the bumblebee'],
    },
    # Additional public-domain encodings from musetrainer/library
    {
        "file": 'Prelude_I_in_C_major_BWV_846_-_Well_Tempered_Clavier_First_Book.mxl',
        "title": 'WTC I — Prelude in C major, BWV 846',
        "composer": 'Johann Sebastian Bach',
        "keys": ['bwv 846', 'wtc prelude 1', 'prelude in c major'],
    },
    {
        "file": 'Bach_Toccata_and_Fugue_in_D_Minor_Piano_solo.mxl',
        "title": 'Toccata and Fugue in D minor, BWV 565 (piano)',
        "composer": 'Johann Sebastian Bach',
        "keys": ['toccata and fugue', 'bwv 565', 'toccata d minor'],
    },
    {
        "file": 'J._S._Bach_-_Air_on_the_G_String_Piano_arrangement.mxl',
        "title": 'Air on the G String (piano)',
        "composer": 'Johann Sebastian Bach',
        "keys": ['air on the g string', 'air on g string', 'bwv 1068'],
    },
    {
        "file": 'Minuet_in_G_Major_Bach.mxl',
        "title": 'Minuet in G major (Anna Magdalena)',
        "composer": 'Johann Sebastian Bach',
        "keys": ['minuet in g major', 'minuet g'],
    },
    {
        "file": 'G_Minor_Bach_Original.mxl',
        "title": 'Little Prelude in G minor',
        "composer": 'Johann Sebastian Bach',
        "keys": ['little prelude g minor', 'g minor bach'],
    },
    {
        "file": 'Fur_Elise.mxl',
        "title": 'Für Elise (MusicXML)',
        "composer": 'Ludwig van Beethoven',
        "keys": ['fur elise mxl', 'für elise musicxml'],
    },
    {
        "file": 'Sonate_No._14_Moonlight_1st_Movement.mxl',
        "title": 'Piano Sonata no. 14 "Moonlight" — Movement 1',
        "composer": 'Ludwig van Beethoven',
        "keys": ['moonlight 1', 'moonlight movement 1', 'moonlight mvt 1'],
    },
    {
        "file": 'DANSE_VILLAGEOISE_Beethoven.mxl',
        "title": 'Danse villageoise',
        "composer": 'Ludwig van Beethoven',
        "keys": ['danse villageoise', 'village dance beethoven'],
    },
    {
        "file": 'Beethoven_Symphony_No._5_1st_movement_Piano_solo.mxl',
        "title": 'Symphony no. 5 — Movement 1 (piano)',
        "composer": 'Ludwig van Beethoven',
        "keys": ['symphony 5 piano', 'beethoven 5 piano', 'fate symphony piano'],
    },
    {
        "file": 'Ode_to_Joy_Easy_variation.mxl',
        "title": 'Ode to Joy (easy piano)',
        "composer": 'Ludwig van Beethoven',
        "keys": ['ode to joy', 'ode to joy easy'],
    },
    {
        "file": 'Sonata_No._16_1st_Movement_K._545.mxl',
        "title": 'Piano Sonata no. 16, K.545 — Movement 1',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['k 545 mxl', 'sonata facile mxl'],
    },
    {
        "file": 'Mozart_-_Piano_Sonata_No._16_-_Allegro.mxl',
        "title": 'Piano Sonata no. 16, K.545 — Allegro',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['k 545 allegro', 'mozart allegro 545'],
    },
    {
        "file": 'WA_Mozart_Marche_Turque_Turkish_March_fingered.mxl',
        "title": 'Rondo alla Turca (fingered)',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['turkish march fingered', 'marche turque'],
    },
    {
        "file": 'Lacrimosa_-_Requiem.mxl',
        "title": 'Requiem — Lacrimosa (piano)',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['lacrimosa', 'requiem lacrimosa'],
    },
    {
        "file": 'Nocturne_in_C_sharp_Minor.mxl',
        "title": 'Nocturne in C-sharp minor, op. posth. (alt.)',
        "composer": 'Frédéric Chopin',
        "keys": ['nocturne c sharp minor', 'nocturne posth'],
    },
    {
        "file": 'Maple_Leaf_Rag_Scott_Joplin.mxl',
        "title": 'Maple Leaf Rag (MusicXML)',
        "composer": 'Scott Joplin',
        "keys": ['maple leaf rag mxl', 'maple leaf musicxml'],
    },
    {
        "file": 'The_Entertainer_-_Scott_Joplin.mxl',
        "title": 'The Entertainer (MusicXML)',
        "composer": 'Scott Joplin',
        "keys": ['entertainer mxl', 'the entertainer musicxml'],
    },
    {
        "file": 'Swan_Lake.mxl',
        "title": 'Swan Lake (piano)',
        "composer": 'Pyotr Ilyich Tchaikovsky',
        "keys": ['swan lake', 'swan lake piano'],
    },
    {
        "file": 'Waltz_of_the_Flowers.mxl',
        "title": 'Waltz of the Flowers (piano)',
        "composer": 'Pyotr Ilyich Tchaikovsky',
        "keys": ['waltz of the flowers', 'nutcracker waltz'],
    },
    {
        "file": 'Canon_in_D_easy.mxl',
        "title": 'Canon in D (easy)',
        "composer": 'Johann Pachelbel',
        "keys": ['canon in d easy', 'pachelbel easy'],
    },
    {
        "file": 'Greensleeves_for_Piano_easy_and_beautiful.mxl',
        "title": 'Greensleeves (piano)',
        "composer": 'Traditional',
        "keys": ['greensleeves', 'green sleeves'],
    },
    {
        "file": 'Carol_of_the_Bells.mxl',
        "title": 'Carol of the Bells',
        "composer": 'Mykola Leontovych',
        "keys": ['carol of the bells', 'shchedryk'],
    },
    {
        "file": '12_Variations_of_Twinkle_Twinkle_Little_Star.mxl',
        "title": '12 Variations on Twinkle Twinkle Little Star',
        "composer": 'Wolfgang Amadeus Mozart',
        "keys": ['twinkle variations', 'ah vous dirai je maman', 'k 265'],
    },
]

# Known 20th-century composers whose piano works are typically still under
# copyright in the US/EU — Lune will not ship pirated editions. Used for
# honest empty-state messaging when a search finds zero free scores.
#
# Ginastera (Suite de danzas criollas, Op. 15, and other piano works):
# No verifiable CC0/CC-BY or composer/publisher-authorized free MusicXML
# was found in Mutopia, OpenScore, craigsapp/musicxml, or similar legal
# free catalogues (checked 2026-10). Do not add commercial/IMSLP
# in-copyright scans. Users who legally own a file can Upload it.
COPYRIGHT_ERA_COMPOSERS: Tuple[str, ...] = (
    "ginastera",
    "prokofiev",
    "shostakovich",
    "khachaturian",
    "kabalevsky",
    "barber",
    "copland",
    "bernstein",
    "britten",
    "messiaen",
    "boulez",
    "stockhausen",
    "cage",
    "ligeti",
    "penderecki",
    "piazzolla",
    "villa-lobos",
    "villalobos",
    "gershwin",  # many popular editions still restricted; we keep Joplin free instead
    "rachmaninoff",  # some late US renewals; no free MusicXML in our sources
    "ravel",  # catalogue incomplete; avoid implying we have copyrighted editions
    "bartok",
    "bartók",
    "stravinsky",
    "hindemith",
    "poulenc",
    "milhaud",
    "schnittke",
    "takemitsu",
    "glass",
    "reich",
    "adams",
)


def copyright_era_hint(query: str) -> Optional[str]:
    """If query looks like a still-copyright composer, return a polite note."""
    q = re.sub(r"[^a-z0-9]+", " ", (query or "").lower()).strip()
    if not q:
        return None
    for name in COPYRIGHT_ERA_COMPOSERS:
        needle = name.replace("á", "a").replace("ó", "o")
        if needle in q or name in q:
            pretty = name.replace("-", " ").title().replace("Bartok", "Bartók")
            if name == "ginastera":
                return (
                    "Alberto Ginastera’s works (including Suite de danzas criollas) "
                    "are still under copyright in the US/EU, so they are not in Lune’s "
                    "free public-domain library."
                )
            return (
                f"No free public-domain MusicXML for “{pretty}” in Lune’s library — "
                "many 20th-century works remain under copyright."
            )
    return None

OPENSCORE_INDEX: List[Dict[str, Any]] = [
    {
        "path": 'scores/Liszt,_Franz/3_sonetti_di_Petrarca,_S.270b/2_Pace_non_trovo/lc30065840.mxl',
        "title": '3 Sonetti di Petrarca, S.270b — Pace non trovo',
        "composer": 'Franz Liszt',
        "keys": ['pace non trovo', 'petrarca', 'sonetti di petrarca', 's 270'],
    },
]

KERNSCORES_LISZT_INDEX: List[Dict[str, Any]] = [
    {
        "file": 'ballade2.krn',
        "title": 'Ballade no. 2 in B minor, S.171',
        "composer": 'Franz Liszt',
        "keys": ['ballade 2', 'ballade no 2', 's 171', 'liszt ballade'],
    },
]

SCRIABIN_KERNS: Tuple[str, ...] = (
    'op01/scriabin-op01.krn',
    'op02/scriabin-op2_no02.krn',
    'op02/scriabin-op2_no03.krn',
    'op03/scriabin-op3_no01.krn',
    'op03/scriabin-op3_no02.krn',
    'op03/scriabin-op3_no03.krn',
    'op03/scriabin-op3_no04.krn',
    'op03/scriabin-op3_no05.krn',
    'op03/scriabin-op3_no06.krn',
    'op03/scriabin-op3_no07.krn',
    'op03/scriabin-op3_no08.krn',
    'op03/scriabin-op3_no09.krn',
    'op03/scriabin-op3_no10.krn',
    'op04/scriabin-op04.krn',
    'op05/scriabin-op05_no01.krn',
    'op05/scriabin-op05_no02.krn',
    'op06/scriabin-op6_no01.krn',
    'op06/scriabin-op6_no02.krn',
    'op06/scriabin-op6_no03.krn',
    'op06/scriabin-op6_no04.krn',
    'op07/scriabin-op7_no01.krn',
    'op07/scriabin-op7_no02.krn',
    'op08/scriabin-op8_no07.krn',
    'op08/scriabin-op8_no08.krn',
    'op08/scriabin-op8_no09.krn',
    'op08/scriabin-op8_no10.krn',
    'op08/scriabin-op8_no11.krn',
    'op08/scriabin-op8_no12.krn',
    'op09/scriabin-op9_no01.krn',
    'op09/scriabin-op9_no02.krn',
    'op10/scriabin-op10_no01.krn',
    'op10/scriabin-op10_no02.krn',
    'op11/scriabin-op11_no01.krn',
    'op11/scriabin-op11_no02.krn',
    'op11/scriabin-op11_no03.krn',
    'op11/scriabin-op11_no05.krn',
    'op11/scriabin-op11_no06.krn',
    'op11/scriabin-op11_no07.krn',
    'op11/scriabin-op11_no08.krn',
    'op11/scriabin-op11_no09.krn',
    'op11/scriabin-op11_no10.krn',
    'op11/scriabin-op11_no11.krn',
    'op11/scriabin-op11_no12.krn',
    'op11/scriabin-op11_no13.krn',
    'op11/scriabin-op11_no14.krn',
    'op11/scriabin-op11_no16.krn',
    'op11/scriabin-op11_no17.krn',
    'op11/scriabin-op11_no18.krn',
    'op11/scriabin-op11_no19.krn',
    'op11/scriabin-op11_no20.krn',
    'op11/scriabin-op11_no21.krn',
    'op11/scriabin-op11_no22.krn',
    'op11/scriabin-op11_no23.krn',
    'op11/scriabin-op11_no24.krn',
    'op12/scriabin-op12_no01.krn',
    'op12/scriabin-op12_no02.krn',
    'op13/scriabin-op13_no01.krn',
    'op13/scriabin-op13_no02.krn',
    'op13/scriabin-op13_no03.krn',
    'op13/scriabin-op13_no04.krn',
    'op13/scriabin-op13_no05.krn',
    'op13/scriabin-op13_no06.krn',
    'op14/scriabin-op14_no01.krn',
    'op14/scriabin-op14_no02.krn',
    'op15/scriabin-op15_no01.krn',
    'op15/scriabin-op15_no02.krn',
    'op15/scriabin-op15_no03.krn',
    'op15/scriabin-op15_no04.krn',
    'op15/scriabin-op15_no05.krn',
    'op16/scriabin-op16_no01.krn',
    'op16/scriabin-op16_no02.krn',
    'op16/scriabin-op16_no03.krn',
    'op16/scriabin-op16_no04.krn',
    'op16/scriabin-op16_no05.krn',
    'op17/scriabin-op17_no01.krn',
    'op17/scriabin-op17_no02.krn',
    'op17/scriabin-op17_no03.krn',
    'op17/scriabin-op17_no04.krn',
    'op17/scriabin-op17_no05.krn',
    'op17/scriabin-op17_no06.krn',
    'op17/scriabin-op17_no07.krn',
    'op18/scriabin-op18.krn',
    'op19/scriabin-op19_no01.krn',
    'op19/scriabin-op19_no02.krn',
    'op21/scriabin-op21.krn',
    'op22/scriabin-op22_no01.krn',
    'op22/scriabin-op22_no02.krn',
    'op22/scriabin-op22_no03.krn',
    'op22/scriabin-op22_no04.krn',
    'op23/scriabin-op23_no01.krn',
    'op23/scriabin-op23_no02.krn',
    'op23/scriabin-op23_no03.krn',
    'op23/scriabin-op23_no04.krn',
    'op25/scriabin-op25_no01.krn',
    'op25/scriabin-op25_no02.krn',
    'op25/scriabin-op25_no03.krn',
    'op25/scriabin-op25_no04.krn',
    'op25/scriabin-op25_no05.krn',
    'op25/scriabin-op25_no06.krn',
    'op25/scriabin-op25_no07.krn',
    'op25/scriabin-op25_no08.krn',
    'op25/scriabin-op25_no09.krn',
    'op27/scriabin-op27_no01.krn',
    'op27/scriabin-op27_no02.krn',
    'op28/scriabin-op28.krn',
    'op30/scriabin-op30_no01.krn',
    'op30/scriabin-op30_no02.krn',
    'op31/scriabin-op31_no01.krn',
    'op31/scriabin-op31_no02.krn',
    'op31/scriabin-op31_no03.krn',
    'op31/scriabin-op31_no04.krn',
    'op32/scriabin-op32_no01.krn',
    'op32/scriabin-op32_no02.krn',
    'op33/scriabin-op33_no01.krn',
    'op33/scriabin-op33_no02.krn',
    'op33/scriabin-op33_no03.krn',
    'op33/scriabin-op33_no04.krn',
    'op34/scriabin-op34.krn',
    'op35/scriabin-op35_no01.krn',
    'op35/scriabin-op35_no02.krn',
    'op35/scriabin-op35_no03.krn',
    'op36/scriabin-op36.krn',
    'op37/scriabin-op37_no01.krn',
    'op37/scriabin-op37_no02.krn',
    'op37/scriabin-op37_no03.krn',
    'op37/scriabin-op37_no04.krn',
    'op38/scriabin-op38.krn',
    'op39/scriabin-op39_no01.krn',
    'op39/scriabin-op39_no02.krn',
    'op39/scriabin-op39_no03.krn',
    'op39/scriabin-op39_no04.krn',
    'op40/scriabin-op40_no01.krn',
    'op40/scriabin-op40_no02.krn',
    'op41/scriabin-op41.krn',
    'op42/scriabin-op42_no01.krn',
    'op42/scriabin-op42_no02.krn',
    'op42/scriabin-op42_no03.krn',
    'op42/scriabin-op42_no04.krn',
    'op42/scriabin-op42_no05.krn',
    'op42/scriabin-op42_no06.krn',
    'op42/scriabin-op42_no07.krn',
    'op42/scriabin-op42_no08.krn',
    'op44/scriabin-op44_no01.krn',
    'op44/scriabin-op44_no02.krn',
    'op45/scriabin-op45_no01.krn',
    'op45/scriabin-op45_no02.krn',
    'op45/scriabin-op45_no03.krn',
    'op46/scriabin-op46.krn',
    'op47/scriabin-op47.krn',
    'op48/scriabin-op48_no01.krn',
    'op48/scriabin-op48_no02.krn',
    'op48/scriabin-op48_no03.krn',
    'op48/scriabin-op48_no04.krn',
    'op49/scriabin-op49_no01.krn',
    'op49/scriabin-op49_no02.krn',
    'op49/scriabin-op49_no03.krn',
    'op51/scriabin-op51_no01.krn',
    'op51/scriabin-op51_no02.krn',
    'op51/scriabin-op51_no03.krn',
    'op51/scriabin-op51_no04.krn',
    'op52/scriabin-op52_no01.krn',
    'op52/scriabin-op52_no02.krn',
    'op52/scriabin-op52_no03.krn',
    'op53/scriabin-op53.krn',
    'op56/scriabin-op56_no01.krn',
    'op56/scriabin-op56_no02.krn',
    'op56/scriabin-op56_no03.krn',
    'op56/scriabin-op56_no04.krn',
    'op57/scriabin-op57_no01.krn',
    'op57/scriabin-op57_no02.krn',
    'op58/scriabin-op58.krn',
    'op59/scriabin-op59_no01.krn',
    'op59/scriabin-op59_no02.krn',
    'op61/scriabin-op61.krn',
    'op62/scriabin-op62.krn',
    'op63/scriabin-op63_no01.krn',
    'op63/scriabin-op63_no02.krn',
    'op64/scriabin-op64.krn',
    'op65/scriabin-op65_no01.krn',
    'op66/scriabin-op66.krn',
    'op67/scriabin-op67_no01.krn',
    'op67/scriabin-op67_no02.krn',
    'op68/scriabin-op68.krn',
    'op69/scriabin-op69_no01.krn',
    'op69/scriabin-op69_no02.krn',
    'op70/scriabin-op70.krn',
    'op71/scriabin-op71_no01.krn',
    'op71/scriabin-op71_no02.krn',
    'op72/scriabin-op72.krn',
    'op73/scriabin-op73_no01.krn',
    'op73/scriabin-op73_no02.krn',
    'op74/scriabin-op74_no01.krn',
    'op74/scriabin-op74_no02.krn',
    'op74/scriabin-op74_no03.krn',
    'op74/scriabin-op74_no04.krn',
    'op74/scriabin-op74_no05.krn',
)


def scriabin_title(rel: str) -> str:
    name = rel.split("/")[-1].replace(".krn", "")
    m = re.match(r"scriabin-op(\d+)(?:_no(\d+))?", name, re.I)
    if not m:
        return name.replace("-", " ").title()
    op = int(m.group(1))
    no = int(m.group(2)) if m.group(2) else None
    nick = {
        (1, None): "Waltz, op. 1",
        (8, 12): 'Étude op. 8 no. 12 in D-sharp minor',
        (11, 1): "Prelude op. 11 no. 1",
        (11, 2): "Prelude op. 11 no. 2",
        (42, 5): "Étude op. 42 no. 5",
    }.get((op, no))
    if nick:
        return nick
    if no is None:
        return f"Op. {op}"
    return f"Op. {op} no. {no}"

