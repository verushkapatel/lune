"""Every screen and dialog in Lune, with how to reach it in a browser.

Shared by scripts/light_theme_tour.py (screenshots) and
scripts/contrast_audit.py (colour contrast). Serve the site on 8137 first.
"""
BASE = "http://127.0.0.1:8137/lune/"
PIECE = BASE + "#/beethoven-fur-elise/score"
READY = "() => typeof state !== 'undefined' && state.piece && Object.keys(state.piece.debriefs || {}).length > 0"

# name: (url, setup js, wait ms)
SCREENS = {
    "landing": (BASE, "", 800),
    # the "Now superpowered with Lune AI" card, as it shows once Lune AI's server is set
    "landing-ai": (BASE, "() => { document.querySelectorAll('.ai-scene, .ai-intro, .ai-truth').forEach(e => e.classList.add('is-in')); document.getElementById('ai').scrollIntoView({block: 'start'}); }", 1500),
    "app-home": (BASE, "() => { document.querySelector('[data-enter-app]').click(); }", 900),
    "chat": (BASE, "() => LuneAsk.openChat()", 700),
    "landing-how": (BASE, "() => document.querySelector('[data-lp-sim]')?.click()", 1200),
    "member-home": (BASE, "() => { document.getElementById('home-guest').hidden = true; document.getElementById('home-member').hidden = false; document.body.classList.add('is-signed-in'); LunePractice.renderNextCard(); }", 2500),
    "search": (BASE, "() => { const q = document.getElementById('q'); document.body.classList.add('studio-search-open'); q.value = 'chopin'; q.dispatchEvent(new Event('input', {bubbles: true})); }", 900),
    "explain": (BASE + "#/beethoven-fur-elise/explain", "", 1500),
    "score": (PIECE, "", 1500),
    "bar-panel": (PIECE, "() => setBarSelection([5])", 1200),
    "ask-lune": (PIECE, "() => { setBarSelection([5]); LuneAsk.open({bar: 5}); }", 1200),
    "piano": (BASE + "#/beethoven-fur-elise/piano", "", 1500),
    "repertoire": (BASE, "() => { LuneStore.setPref('onboarded', true); LunePractice.showRepertoire(); }", 900),
    "settings": (BASE, "() => document.getElementById('btn-settings').click()", 800),
    "install": (BASE, "() => LuneInstall.openInstructions()", 500),
    "onboarding": (BASE, "() => LuneOnboard.showOnboard()", 900),
    "create-account": (BASE, "() => LuneOnboard.openCreateAccount()", 800),
    "weekly-review": (BASE, "() => LuneImpact.openWeeklyReview()", 900),
    "share-week": (BASE, "() => LuneImpact.openShareWeek()", 900),
    "example-week": (BASE, "() => { document.getElementById('btn-settings').click(); document.querySelector('[data-set=example-week]').click(); }", 900),
    "work-on-piece": (BASE, "async () => { await LuneStore.addPiece?.({piece_key: 'tour-fur-elise', title: 'Für Elise', composer: 'Ludwig van Beethoven', status: 'learning'}); LuneStore.setPref('onboarded', true); LunePractice.showRepertoire(); await new Promise(r => setTimeout(r, 700)); document.querySelector('[data-work]')?.click(); }", 1000),
    # the public page a teacher opens; the share row is a test fixture, since accounts live on Supabase
    "share-week-page": (BASE + "#share/tour", "async () => { LuneStore.fetchShareByToken = async () => ({payload: {displayName: 'Test pianist', week: '2026-W40', weekLabel: 'Sep 28 – Oct 4', days: 4, goalDays: 5, sessions: 6, mins: 140, pieces: [{title: 'Für Elise'}], hardBars: [{title: 'Für Elise', bar: 12}]}}); await LuneImpact.handleRoute(); }", 900),
    "feedback": (BASE, "() => LuneFeedback.open()", 700),
    "credits": (BASE, "() => document.querySelector('[data-open-credits]').click()", 700),
    "access": (BASE, "() => [...document.querySelectorAll('button')].find(b => /Reading & access/.test(b.textContent))?.click()", 700),
}
