/* The Skyward Project: loader, demos and the field-notes story. */
(function () {
  "use strict";

  var doc = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Small seeded random, so every visitor sees the same "class".
  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  // Run fn once, the first time el is on screen.
  function onceVisible(el, fn, margin) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { io.disconnect(); fn(); }
    }, { rootMargin: margin || "0px 0px -15% 0px" });
    io.observe(el);
  }

  /* ---------- Loader ---------- */
  var loader = $("#loader");
  var ready = false;
  function reveal() {
    if (ready) return;
    ready = true;
    loader.classList.add("done");
    document.body.classList.remove("is-loading");
    doc.classList.add("is-ready");
    setTimeout(function () { loader.remove(); }, 1000);
    document.dispatchEvent(new Event("skyward:ready"));
  }
  if (loader) {
    document.body.classList.add("is-loading");
    var start = function () {
      if (loader.classList.contains("play")) return;
      loader.classList.add("play");
      setTimeout(reveal, reduce ? 300 : 2900);
    };
    var fonts = document.fonts && document.fonts.load
      ? Promise.all([
          document.fonts.load('900 100px "Playfair Display"'),
          document.fonts.load('300 40px "Oswald"')
        ])
      : Promise.resolve();
    fonts.then(start, start);
    setTimeout(start, 1200);
    loader.addEventListener("click", reveal);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") reveal(); });
  } else {
    doc.classList.add("is-ready");
  }
  function whenReady(fn) {
    if (ready || !loader) fn();
    else document.addEventListener("skyward:ready", fn, { once: true });
  }

  /* ---------- Starfield ---------- */
  (function stars() {
    var c = $("#stars");
    if (!c || !c.getContext) return;
    var ctx = c.getContext("2d");
    var pts = [], w = 0, h = 0, dpr = 1, mx = 0, my = 0, visible = true, raf = 0;
    var rand = rng(7);
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(220, (w * h) / 7000));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({ x: rand() * w, y: rand() * h, r: rand() * 1.1 + 0.2, z: rand() * 0.8 + 0.2, p: rand() * 6.28, s: rand() * 0.02 + 0.004 });
      }
    }
    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < pts.length; i++) {
        var s = pts[i];
        var a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.p + t * s.s * 0.06));
        var x = s.x + mx * s.z * 14, y = s.y + my * s.z * 14 - ((t * 0.004 * s.z) % h);
        if (y < 0) y += h;
        ctx.globalAlpha = a * s.z;
        ctx.fillStyle = s.z > 0.75 ? "#cfd9ff" : "#ffffff";
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.283); ctx.fill();
      }
      if (visible && !reduce) raf = requestAnimationFrame(draw);
    }
    size();
    draw(0);
    window.addEventListener("resize", function () { size(); if (reduce) draw(0); });
    window.addEventListener("pointermove", function (e) { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
    if ("IntersectionObserver" in window && !reduce) {
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        cancelAnimationFrame(raf);
        if (visible) raf = requestAnimationFrame(draw);
      }).observe(c);
    }
  })();

  /* ---------- Nav, progress, active section ---------- */
  var nav = $("#nav"), bar = $("#progress");
  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle("is-scrolled", y > 20);
    var max = doc.scrollHeight - innerHeight;
    if (bar) bar.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    scrub();
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  var links = $$(".nav__pill a");
  if ("IntersectionObserver" in window) {
    var secIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    links.forEach(function (a) { var s = $(a.getAttribute("href")); if (s) secIO.observe(s); });
  }

  var toggle = $("#navToggle"), sheet = $("#sheet");
  function setSheet(open) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    sheet.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }
  toggle.addEventListener("click", function () { setSheet(sheet.hidden); });
  $$("a", sheet).forEach(function (a) { a.addEventListener("click", function () { setSheet(false); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) setSheet(false); });

  /* ---------- Reveal + counters ---------- */
  var rvs = $$(".rv");
  if ("IntersectionObserver" in window) {
    var rvIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); rvIO.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    rvs.forEach(function (el, i) {
      var sib = el.parentElement ? $$(":scope > .rv", el.parentElement).indexOf(el) : 0;
      el.style.transitionDelay = Math.max(0, sib) * 90 + "ms";
      rvIO.observe(el);
    });
  } else {
    rvs.forEach(function (el) { el.classList.add("in"); });
  }

  $$("[data-count]").forEach(function (el) {
    var to = +el.getAttribute("data-count");
    onceVisible(el, function () {
      if (reduce) { el.textContent = to; return; }
      var t0 = performance.now(), dur = 1600;
      (function tick(t) {
        var k = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    });
  });

  /* ---------- Mission: words light up as you read ---------- */
  var scrubEl = $("#scrub"), words = [];
  if (scrubEl) {
    scrubEl.innerHTML = scrubEl.textContent.trim().split(/\s+/).map(function (w) {
      return '<span class="w">' + w + "</span>";
    }).join(" ");
    words = $$(".w", scrubEl);
  }
  function scrub() {
    if (!words.length) return;
    var r = scrubEl.getBoundingClientRect();
    var startY = innerHeight * 0.85, endY = innerHeight * 0.35;
    var k = (startY - r.top) / (r.height + startY - endY);
    k = Math.max(0, Math.min(1, k));
    var n = reduce ? words.length : Math.round(k * words.length);
    for (var i = 0; i < words.length; i++) words[i].classList.toggle("lit", i < n);
  }
  onScroll();

  /* ---------- Cursor light on cards ---------- */
  $$(".card, .pillar").forEach(function (el) {
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  /* ---------- Shared class data (illustrative) ---------- */
  var TOPICS = [
    { name: "Pay & tax", right: 28 },
    { name: "Budgeting", right: 25 },
    { name: "Saving", right: 23 },
    { name: "Rights", right: 21 },
    { name: "Scams", right: 17 },
    { name: "Borrowing", right: 13 }
  ];
  var CLASS = 32;
  function pct(t) { return Math.round((t.right / CLASS) * 100); }

  /* ---------- Hero console ---------- */
  (function consoleDemo() {
    var out = $("#consoleOut");
    if (!out) return;
    var timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function line(html, cls) {
      var d = document.createElement("div");
      d.className = "c-line" + (cls ? " " + cls : "");
      d.innerHTML = html;
      out.appendChild(d);
      return d;
    }
    function run() {
      out.innerHTML = "";
      var t = 300;
      var reading = line('<span>▸ reading 480 answers</span><span class="caret"></span>');
      t += 1100;
      later(function () { reading.innerHTML = "<span>▸ read 480 answers · 6 topics</span>"; }, t);
      TOPICS.forEach(function (tp, i) {
        later(function () {
          var p = pct(tp), gap = i >= 4;
          var d = line('<div class="c-row"><span>' + tp.name + '</span><span class="c-bar' + (gap ? " is-gap" : "") + '"><i></i></span><span>' + p + "%</span></div>");
          requestAnimationFrame(function () { requestAnimationFrame(function () { $("i", d).style.width = p + "%"; }); });
        }, t + 120 + i * 260);
      });
      t += 120 + TOPICS.length * 260 + 700;
      later(function () { line('<span class="c-gap">◆</span><span>widest gaps: <b>borrowing</b> and <b>scams</b></span>'); }, t);
      later(function () { line('<span class="c-ok">✓</span><span>plan: 50 of 80 minutes on the two widest gaps</span>'); }, t + 700);
      later(function () { line('<span class="c-ok">✓</span><span>Saath chapters: The loan app · The bank caller</span>'); }, t + 1400);
      later(run, t + 7000);
    }
    whenReady(function () { setTimeout(run, reduce ? 0 : 900); });
  })();

  /* ---------- 01 Quiz ---------- */
  (function quiz() {
    var q = $("#quiz");
    if (!q) return;
    var why = $("#quizWhy");
    $$("button", q).forEach(function (b) {
      b.addEventListener("click", function () {
        if (q.classList.contains("answered")) return;
        q.classList.add("answered");
        var right = b.hasAttribute("data-right");
        b.classList.add(right ? "is-right" : "is-wrong");
        $("[data-right]", q).classList.add("is-right");
        why.innerHTML = (right ? "<b>Right.</b> " : "<b>Not quite.</b> ") +
          "When money is short, pay first for the cost that cannot be undone. Missing Friday's deadline loses the college spot for good.";
      });
    });
  })();

  /* ---------- 02 Heat map ---------- */
  (function heat() {
    var grid = $("#heatGrid"), foot = $("#heatFoot");
    if (!grid) return;
    var rand = rng(42), cols = [];
    TOPICS.forEach(function (tp) {
      var col = document.createElement("div");
      col.className = "heat__col";
      var marks = shuffle(range(CLASS).map(function (i) { return i < tp.right; }), rand);
      var cells = marks.map(function (ok) {
        var c = document.createElement("span");
        c.className = "heat__cell";
        c._ok = ok;
        col.appendChild(c);
        return c;
      });
      var lab = document.createElement("span");
      lab.className = "heat__label";
      lab.innerHTML = "<b>–</b>" + tp.name;
      col.appendChild(lab);
      grid.appendChild(col);
      cols.push({ el: col, cells: cells, lab: lab, tp: tp });
    });
    onceVisible(grid, function () {
      var step = reduce ? 0 : 38;
      for (var r = 0; r < CLASS; r++) {
        (function (r) {
          setTimeout(function () {
            cols.forEach(function (c) { var cell = c.cells[r]; cell.classList.add(cell._ok ? "ok" : "no"); });
          }, r * step);
        })(r);
      }
      setTimeout(function () {
        cols.forEach(function (c, i) {
          $("b", c.lab).textContent = pct(c.tp) + "%";
          if (i >= 4) c.el.classList.add("is-gap");
        });
        foot.innerHTML = "Focus → <b>Borrowing " + pct(TOPICS[5]) + "%</b> · <b>Scams " + pct(TOPICS[4]) + "%</b>";
      }, CLASS * step + 300);
    });
  })();

  /* ---------- 03 Session plan ---------- */
  (function plan() {
    var barEl = $("#planBar"), key = $("#planKey");
    if (!barEl) return;
    var segs = [
      { n: "Results, privately", m: 20, c: "#1b2b5c" },
      { n: "Borrowing", m: 28, c: "#d8c08a", f: 1 },
      { n: "Scams", m: 22, c: "#b59d68", f: 1 },
      { n: "Rights", m: 12, c: "#3d63ff" },
      { n: "Saving", m: 10, c: "#5b7cff" },
      { n: "Budgeting", m: 8, c: "#7d97ff" },
      { n: "Handbook & Saath", m: 20, c: "#2a8a63" }
    ];
    var els = segs.map(function (s) {
      var d = document.createElement("div");
      d.className = "plan__seg";
      d.style.background = s.c;
      if (s.f) d.style.color = "#1a1407";
      d.textContent = s.m >= 12 ? s.m + "′" : "";
      d.title = s.n + " · " + s.m + " minutes";
      barEl.appendChild(d);
      var li = document.createElement("li");
      if (s.f) li.className = "focus";
      li.innerHTML = '<i style="background:' + s.c + '"></i><span>' + s.n + "</span><span>" + s.m + " min</span>";
      key.appendChild(li);
      return d;
    });
    onceVisible(barEl, function () {
      els.forEach(function (d, i) {
        setTimeout(function () { d.style.width = (segs[i].m / 120) * 100 + "%"; }, reduce ? 0 : i * 120);
      });
    });
  })();

  /* ---------- 04 Mini Saath ---------- */
  (function mini() {
    var ph = $("#mini");
    if (!ph) return;
    var res = $("#miniRes");
    $$(".phone__opts button", ph).forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".phone__opts button", ph).forEach(function (x) { x.classList.remove("is-picked"); });
        ph.classList.add("answered");
        b.classList.add("is-picked");
        res.innerHTML = b.getAttribute("data-r") +
          (b.hasAttribute("data-good") ? '<br><span class="pill pill--good">+30 XP</span>' : '<br><span class="muted">Try another choice.</span>');
      });
    });
  })();

  /* ---------- Verena's life ---------- */
  (function life() {
    var root = $("#life");
    if (!root) return;
    var L = [
      { a: 18, t: "Her first resume", s: "Saath AI asks her ten questions and hands back a clean PDF.", l: "Lead with what you did, not only what you studied." },
      { a: 19, t: "A month on her own", s: "It is the 18th. ₹350 left, twelve days to go.", l: "Plan per day, not per month. ₹29 a day gets her there." },
      { a: 19, t: "A bank account", s: "The KYC form asks for a nominee. She almost leaves it blank.", l: "Always name a nominee." },
      { a: 20, t: "The bank caller", s: "He knows her name and says he is from her bank. He needs an OTP.", l: "A bank never asks for an OTP. Hang up and call the number on the card." },
      { a: 21, t: "Her first pay slip", s: "The offer said ₹28,000. Less arrives in her account.", l: "Gross is not take-home. Provident fund and tax come out first." },
      { a: 21, t: "Renting a room", s: "The landlord wants cash and gives no receipt.", l: "Pay in a way that leaves a record. Keep proof of every rupee." },
      { a: 22, t: "The loan app", s: "₹10,000 in minutes. It only needs her contacts and photos.", l: "Borrow only from registered lenders. Never hand over your contacts." },
      { a: 23, t: "₹3,000 in ten days", s: "Her phone breaks the week before rent.", l: "Build an emergency fund before anything else." },
      { a: 24, t: "Her first credit card", s: "The bill says she can pay just the minimum due.", l: "Pay the full bill. The rest is charged interest of around 40% a year." },
      { a: 26, t: "A no-cost EMI", s: "A new laptop, twelve easy payments, “no cost”.", l: "Check the processing fee and the price you would pay upfront." },
      { a: 28, t: "Sign as guarantor?", s: "A relative asks her to sign for his loan.", l: "If he cannot pay, she owes all of it." },
      { a: 30, t: "Health cover", s: "Her claim is rejected over a line she never read.", l: "Read the exclusions before you buy, not after you claim." },
      { a: 32, t: "Her first SIP", s: "₹1,000 a month into a fund, automatically.", l: "Start small and start early. Time does the heavy lifting." },
      { a: 35, t: "Filing her taxes", s: "Old regime or new? The deadline is close.", l: "File on time, even when you owe nothing." },
      { a: 45, t: "A home loan", s: "Two banks, two EMIs that look almost the same.", l: "Compare the total cost, not the monthly payment." },
      { a: 60, t: "Retirement", s: "Her savings now pay her, the way her salary once did.", l: "Every choice from nineteen compounded into this one." }
    ];
    var range_ = $("#lifeRange"), card = $(".life__card", root), av = $("#avatar"), xp = $("#xp");
    var ageEl = $("#lifeAge"), tEl = $("#lifeTitle"), sEl = $("#lifeScene"), lEl = $("#lifeLesson");
    var ticks = $("#lifeTicks"), playBtn = $("#lifePlay");
    range_.max = L.length - 1;
    ticks.innerHTML = L.map(function (x) { return "<span>" + x.a + "</span>"; }).join("");
    var tickEls = $$("span", ticks);
    var cur = -1, timer = 0;

    function look(age) {
      if (age < 20) return { c: "#2c4bd6", h: "#1b1310" };       // school blue
      if (age < 30) return { c: "#6b4bd6", h: "#1b1310" };       // first jobs
      if (age < 45) return { c: "#1f6f74", h: "#241914" };
      if (age < 60) return { c: "#2b3550", h: "#4a4038", g: 1 };
      return { c: "#1c2236", h: "#c9ccd6", g: 1 };               // retired, in a suit
    }
    function show(i, quiet) {
      if (i === cur) return;
      var first = cur < 0;
      cur = i;
      var d = L[i];
      range_.value = i;
      range_.style.setProperty("--p", (i / (L.length - 1)) * 100 + "%");
      range_.setAttribute("aria-valuetext", d.a + " years old, " + d.t);
      tickEls.forEach(function (t, k) { t.classList.toggle("on", k === i); });
      var lk = look(d.a);
      av.style.setProperty("--av-cloth", lk.c);
      av.style.setProperty("--av-hair", lk.h);
      if (lk.g) av.setAttribute("data-glasses", ""); else av.removeAttribute("data-glasses");
      var fill = function () {
        ageEl.textContent = d.a; tEl.textContent = d.t; sEl.textContent = d.s; lEl.textContent = d.l;
        card.classList.remove("swap");
      };
      if (first || reduce) fill();
      else { card.classList.add("swap"); setTimeout(fill, 220); }
      if (!first && !quiet) { xp.classList.remove("pop"); void xp.offsetWidth; xp.classList.add("pop"); }
    }
    function stop() { clearInterval(timer); timer = 0; playBtn.classList.remove("is-playing"); playBtn.setAttribute("aria-label", "Play Verena's life"); }
    function play() {
      if (cur >= L.length - 1) show(0, true);
      playBtn.classList.add("is-playing");
      playBtn.setAttribute("aria-label", "Pause");
      timer = setInterval(function () {
        if (cur >= L.length - 1) { stop(); return; }
        show(cur + 1);
      }, 2600);
    }
    range_.addEventListener("input", function () { stop(); show(+range_.value); });
    playBtn.addEventListener("click", function () { timer ? stop() : play(); });
    show(0);
    if (!reduce) onceVisible(root, play, "0px 0px -35% 0px");
  })();

  /* ---------- Field notes: 102 dots ---------- */
  (function story() {
    var story = $(".story"), stage = $(".story__stage"), box = $("#dots"), labels = $("#barLabels"), legend = $("#legend");
    if (!story) return;
    var N = 102, rand = rng(2026);
    var dots = range(N).map(function (i) {
      var d = document.createElement("span");
      d.className = "dot";
      d.style.setProperty("--dl", (i % 17) * 14 + "ms");
      box.appendChild(d);
      return d;
    });
    var order = shuffle(range(N), rand);
    var bus = new Set(shuffle(range(N), rand).slice(0, 88));
    var dev = new Set(shuffle(range(N), rand).slice(0, 91));
    var strong = new Set(order.slice(0, 73));
    var dWeak = new Set(order.slice(0, 30));
    var BARS = [
      { n: "Part A", s: "Warm up", p: 89, k: 31 },
      { n: "Part B", s: "Everyday money", p: 78, k: 27 },
      { n: "Part C", s: "Read carefully", p: 81, k: 28 },
      { n: "Part D", s: "Market awareness", p: 49, k: 16, gap: 1 }
    ];
    var grid = [], bars = [], state = -1, ds = 14, barScale = 1;

    function layout() {
      var W = stage.clientWidth, H = stage.clientHeight;
      var wide = W > 820;
      var ax = wide ? W * 0.44 : 16, aw = wide ? W * 0.52 : W - 32;
      var ay = wide ? H * 0.16 : H * 0.1, ah = wide ? H * 0.68 : H * 0.48;
      var cols = wide ? 12 : 10, rows = Math.ceil(N / cols);
      var sp = Math.min(aw / cols, ah / rows);
      ds = Math.max(6, sp * 0.5);
      box.style.setProperty("--ds", ds + "px");
      var gx = ax + (aw - sp * cols) / 2 + sp / 2, gy = ay + (ah - sp * rows) / 2 + sp / 2;
      grid = range(N).map(function (i) { return [gx + (i % cols) * sp, gy + Math.floor(i / cols) * sp]; });

      // bars: dots stack five wide from a shared baseline
      var per = 5, bsp = Math.min(sp, (aw / 4) / (per + 2)), barW = bsp * per, gap = (aw - barW * 4) / 4;
      var base = ay + ah - bsp * 0.5;
      barScale = Math.min(1, (bsp * 0.82) / ds);
      bars = new Array(N);
      labels.innerHTML = "";
      var idx = 0;
      BARS.forEach(function (b, bi) {
        var x0 = ax + gap / 2 + bi * (barW + gap) + bsp / 2;
        for (var k = 0; k < b.k; k++, idx++) {
          bars[idx] = [x0 + (k % per) * bsp, base - Math.floor(k / per) * bsp];
        }
        var cx = x0 + (barW - bsp) / 2, topY = base - Math.ceil(b.k / per) * bsp;
        var top = document.createElement("div");
        top.className = "bl top" + (b.gap ? " is-gap" : "");
        top.style.left = cx + "px"; top.style.top = topY - 44 + "px";
        top.textContent = b.p + "%";
        var bot = document.createElement("div");
        bot.className = "bl bot";
        bot.style.left = cx + "px"; bot.style.top = base + bsp + "px";
        bot.innerHTML = "<b>" + b.n + "</b><span>" + b.s + "</span>";
        labels.appendChild(top); labels.appendChild(bot);
      });
      paint(true);
    }

    function paint(force) {
      var s = state;
      dots.forEach(function (d, i) {
        var pos, scale = 1, cls = "";
        if (s < 0) { pos = [stage.clientWidth * 0.7, stage.clientHeight * 0.5]; scale = 0; }
        else if (s === 3) {
          var bi = order.indexOf(i);
          pos = bars[bi];
          scale = barScale;
          cls = bi >= 86 ? "gap" : "hi";
        } else {
          pos = grid[i];
          if (s === 1 && bus.has(i)) cls = "hi";
          if (s === 2 && dev.has(i)) cls = "hi";
          if (s === 4 && strong.has(i)) cls = "hi";
          if (s === 5) cls = dWeak.has(i) ? "gap" : strong.has(i) ? "hi" : "";
          if (s === 6) cls = "dim";
        }
        d.style.transform = "translate3d(" + (pos[0] - ds / 2) + "px," + (pos[1] - ds / 2) + "px,0) scale(" + scale + ")";
        d.className = "dot" + (cls ? " " + cls : "");
      });
      story.setAttribute("data-state", s);
      var leg = {
        0: "● one student",
        1: '<span style="color:#7d97ff">●</span> travels by bus or private car',
        2: '<span style="color:#7d97ff">●</span> owns a laptop or tablet',
        3: "average score by part",
        4: '<span style="color:#7d97ff">●</span> 80%+ on Parts A–C',
        5: '<span style="color:#d8c08a">●</span> and half or less on Part D'
      };
      legend.innerHTML = leg[s] || "";
    }

    function setState(s) {
      if (s === state) return;
      state = s;
      paint();
    }

    layout();
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(layout, 150); });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) setState(+en.target.getAttribute("data-s"));
        });
      }, { rootMargin: "-48% 0px -48% 0px" });
      $$(".scene").forEach(function (el) { io.observe(el); });
      // collapse the dots again when the reader scrolls back above the story
      new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting && en[0].boundingClientRect.top > 0) setState(-1);
      }).observe(story);
    } else {
      setState(0);
    }
  })();

  /* ---------- Team bios ---------- */
  (function team() {
    var BIOS = {
      verushka: { n: "Verushka Patel", r: "Founder", t: "Verushka is a writer and tenth-grader with a growing interest in computer science, finance, and economics. She is the author of Aspiring for the Stars, has written two research papers on quantitative finance, and has completed over 30 certifications across AI, computer science and finance. More than anything, she's someone who can't sit still, and is always looking for the next venture." },
      prathmesh: { n: "Prathmesh Khurana", r: "Co-founder", t: "Prathmesh is a 12th grade student at the Dhirubhai Ambani International School. His project DhanSaaskhar, a comic he created and the sessions he ran with it, reached over 100 people. He has interned at Tata Mutual Fund under CIO Mr Rahul Singh and at the Entelechy Fund under co-founder Mrs Megha Sood, and wants to build a career in investments. His research on how much people know about money led him to start this project." },
      amaira: { n: "Amaira Shah", r: "Outreach Manager", t: "Amaira is a tenth-grader with a strong interest in medicine and a deep-rooted desire to help people. She is drawn to the human side of every problem, and to how knowledge and education can improve lives. That same belief, that access to knowledge is what empowers people, drew her to The Skyward Project. She believes a life well lived is one spent making a real difference to the people around you." }
    };
    var dlg = $("#bio");
    if (!dlg || !dlg.showModal) return;
    var last = null;
    $$("[data-bio]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-bio"), d = BIOS[key];
        last = b;
        $("#bioImg").src = $("img", b).getAttribute("src");
        $("#bioName").textContent = d.n;
        $("#bioRole").textContent = d.r;
        $("#bioText").textContent = d.t;
        dlg.showModal();
      });
      b.setAttribute("aria-label", BIOS[b.getAttribute("data-bio")].n + ", read bio");
    });
    $("#bioClose").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { if (last) last.focus(); });
  })();

  /* ---------- Contact form ---------- */
  (function form() {
    var f = $("#form");
    if (!f) return;
    var status = $("#formStatus"), btn = $("button[type=submit]", f);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      status.className = "form__status";
      status.textContent = "Sending…";
      fetch(f.action, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(f) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.success === false) throw new Error(); }); })
        .then(function () {
          f.reset();
          status.className = "form__status ok";
          status.textContent = "Thank you. We'll write back within a few days.";
        })
        .catch(function () {
          status.textContent = "That didn't send. Please try again, or email verushka@theskywardproject.com.";
        })
        .then(function () { btn.disabled = false; });
    });
  })();
})();
