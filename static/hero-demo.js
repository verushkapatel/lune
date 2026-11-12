/* Lune — the landing hero's live moment: Lune AI answering about bar 15 of
 * Clair de lune, written word by word, then its two practice steps. The words
 * and fingering are Lune's own reading of that bar. Plays once when the hero is
 * on screen; with reduced motion everything simply shows. */
(function () {
  const card = document.querySelector(".hero-demo");
  if (!card) return;
  const answer = card.querySelector("[data-hd2-answer]");
  const full = answer.textContent.trim();
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    card.classList.add("is-done");
    return;
  }
  let played = false;
  const play = () => {
    if (played) return;
    played = true;
    card.classList.add("is-asking");
    answer.textContent = "";
    const words = full.split(" ");
    let i = 0;
    setTimeout(() => {
      card.classList.add("is-answering");
      const tick = () => {
        if (i >= words.length) {
          card.classList.add("is-done");
          return;
        }
        answer.textContent = words.slice(0, ++i).join(" ");
        setTimeout(tick, 55 + Math.random() * 45);
      };
      tick();
    }, 900);
  };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        play();
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(card);
  } else play();
})();
