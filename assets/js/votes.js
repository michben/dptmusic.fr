/* ==========================================================================
   DPT — Votes du public
   - Pouces haut / bas sous chaque morceau (sans inscription, avec captcha).
   - Page « Vote » : duels « Quelle version tu préfères ? » réservés aux
     inscrits, avec résultats en direct et compte à rebours.

   Les votes sont enregistrés par le service « dpt-votes » (Cloudflare).
   Son adresse et la clé du captcha sont dans assets/data/site.json, rubrique
   "votes" : elles y sont écrites automatiquement au déploiement (README.md).
   Tant qu'elles sont vides, les pouces sont masqués.
   ========================================================================== */

(function () {
  "use strict";

  var SITE_URL = "assets/data/site.json";
  var DUELS_URL = "assets/data/duels.json";
  var TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var POLL_MS = 10000; // résultats des duels rafraîchis toutes les 10 secondes

  var KEYS = { voter: "dpt-voter", likes: "dpt-likes", session: "dpt-session", pseudo: "dpt-pseudo" };

  var config = { api: "", siteKey: "" };

  /* ---------------------------------------------------------------------- */
  /* Utilitaires                                                             */
  /* ---------------------------------------------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function isFilled(v) { return typeof v === "string" && v.trim() !== ""; }

  function store(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) { /* navigation privée : rien n'est gardé */ }
  }

  function load(key, asJSON) {
    try {
      var v = localStorage.getItem(key);
      return asJSON ? (v ? JSON.parse(v) : {}) : v;
    } catch (e) { return asJSON ? {} : null; }
  }

  function randomId() {
    var bytes = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function voterId() {
    var id = load(KEYS.voter);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) { id = randomId(); store(KEYS.voter, id); }
    return id;
  }

  function call(path, options) {
    options = options || {};
    var headers = {};
    if (options.body) headers["Content-Type"] = "application/json";
    var session = load(KEYS.session);
    if (session) headers.Authorization = "Bearer " + session;
    return fetch(config.api + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Le service des votes ne répond pas. Réessayez dans un instant.");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error("Connexion impossible au service des votes. Vérifiez votre connexion internet.");
    });
  }

  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }

  /* ---------------------------------------------------------------------- */
  /* Captcha (Cloudflare Turnstile)                                          */
  /* ---------------------------------------------------------------------- */

  var turnstileReady = null;

  function loadTurnstile() {
    if (!turnstileReady) {
      turnstileReady = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = TURNSTILE_URL;
        s.async = true;
        s.onload = function () { resolve(window.turnstile); };
        s.onerror = function () { turnstileReady = null; reject(new Error("Le captcha n’a pas pu se charger. Désactivez le bloqueur de publicité pour ce site, puis réessayez.")); };
        document.head.appendChild(s);
      });
    }
    return turnstileReady;
  }

  /* Captcha « invisible » pour les pouces : il ne s'affiche que si Cloudflare
     a un doute (dans une petite fenêtre en bas de l'écran). */
  function quickCaptcha() {
    return loadTurnstile().then(function (turnstile) {
      return new Promise(function (resolve, reject) {
        var box = el("div", { "class": "captcha-float", role: "dialog", "aria-label": "Vérification anti-robot" });
        document.body.appendChild(box);
        var id = turnstile.render(box, {
          sitekey: config.siteKey,
          appearance: "interaction-only",
          language: "fr",
          callback: function (token) { cleanup(); resolve(token); },
          "error-callback": function () { cleanup(); reject(new Error("La vérification anti-robot a échoué. Réessayez.")); },
          "timeout-callback": function () { cleanup(); reject(new Error("La vérification anti-robot a expiré. Réessayez.")); },
          "before-interactive-callback": function () { box.classList.add("is-visible"); }
        });
        function cleanup() {
          setTimeout(function () { try { turnstile.remove(id); } catch (e) { /* déjà retiré */ } box.remove(); }, 0);
        }
      });
    });
  }

  /* Captcha visible dans un formulaire (inscription, connexion). */
  function formCaptcha(container) {
    var state = { token: "", id: null };
    loadTurnstile().then(function (turnstile) {
      state.id = turnstile.render(container, {
        sitekey: config.siteKey,
        language: "fr",
        theme: "dark",
        callback: function (token) { state.token = token; },
        "expired-callback": function () { state.token = ""; },
        "error-callback": function () { state.token = ""; }
      });
    }).catch(function (err) { container.textContent = err.message; });
    state.reset = function () {
      state.token = "";
      if (window.turnstile && state.id !== null) window.turnstile.reset(state.id);
    };
    return state;
  }

  /* ---------------------------------------------------------------------- */
  /* Pouces haut / bas sur les morceaux                                      */
  /* ---------------------------------------------------------------------- */

  var THUMB_UP = "M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84A2.34 2.34 0 0 0 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z";

  var likes = { counts: {}, mine: load(KEYS.likes, true), pending: {} };

  function thumbIcon(down) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (down) svg.setAttribute("class", "is-down");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", THUMB_UP);
    svg.appendChild(p);
    return svg;
  }

  function renderThumbs(bar) {
    var id = bar.getAttribute("data-track");
    var c = likes.counts[id] || { up: 0, down: 0 };
    var mine = likes.mine[id] || 0;
    var busy = !!likes.pending[id];
    $$("button", bar).forEach(function (b) {
      var v = Number(b.getAttribute("data-value"));
      b.setAttribute("aria-pressed", String(mine === v));
      b.disabled = busy;
      $(".thumb-count", b).textContent = v === 1 ? c.up : c.down;
    });
  }

  function refreshThumbs(id) {
    $$(".track-votes[data-track='" + id + "']").forEach(renderThumbs);
  }

  function vote(id, value, bar) {
    var previous = likes.mine[id] || 0;
    var next = previous === value ? 0 : value; // recliquer annule le vote
    var status = $(".thumb-status", bar);
    likes.pending[id] = true;
    refreshThumbs(id);
    status.textContent = "";
    quickCaptcha().then(function (token) {
      return call("/likes", { method: "POST", body: { track: id, value: next, voter: voterId(), captcha: token } });
    }).then(function (data) {
      likes.counts[id] = data.counts;
      if (next) likes.mine[id] = next; else delete likes.mine[id];
      store(KEYS.likes, likes.mine);
    }).catch(function (err) {
      status.textContent = err.message;
    }).then(function () {
      delete likes.pending[id];
      refreshThumbs(id);
    });
  }

  function thumbsBar(card) {
    var id = card.getAttribute("data-id");
    var title = ($(".track-title", card) || {}).textContent || "ce morceau";
    var bar = el("div", { "class": "track-votes", "data-track": id, role: "group", "aria-label": "Votre avis sur « " + title + " »" });
    [[1, "J’aime"], [-1, "Je n’aime pas"]].forEach(function (pair) {
      var b = el("button", { type: "button", "class": "thumb-btn", "data-value": String(pair[0]), "aria-pressed": "false", title: pair[1] }, [
        thumbIcon(pair[0] === -1),
        el("span", { "class": "visually-hidden", text: pair[1] + " — " }),
        el("span", { "class": "thumb-count", text: "0" })
      ]);
      b.addEventListener("click", function () { vote(id, pair[0], bar); });
      bar.appendChild(b);
    });
    bar.appendChild(el("p", { "class": "thumb-status", role: "status", "aria-live": "polite" }));
    renderThumbs(bar);
    return bar;
  }

  function decorate(root) {
    var fresh = [];
    $$(".track-card[data-id]", root).forEach(function (card) {
      if ($(".track-votes", card)) return;
      var body = $(".track-body", card);
      var actions = $(".track-actions", card);
      if (!body) return;
      body.insertBefore(thumbsBar(card), actions || null);
      fresh.push(card.getAttribute("data-id"));
    });
    var missing = fresh.filter(function (id) { return !(id in likes.counts); });
    if (!missing.length) return;
    call("/likes?ids=" + encodeURIComponent(missing.join(","))).then(function (data) {
      missing.forEach(function (id) {
        likes.counts[id] = (data.counts && data.counts[id]) || { up: 0, down: 0 };
        refreshThumbs(id);
      });
    }).catch(function (err) { console.error(err); });
  }

  function initThumbs() {
    var boxes = $$("[data-latest], [data-discography]");
    if (!boxes.length) return;
    boxes.forEach(function (box) {
      decorate(box);
      new MutationObserver(function () { decorate(box); }).observe(box, { childList: true });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Compte du public (pour les duels)                                       */
  /* ---------------------------------------------------------------------- */

  var account = { pseudo: load(KEYS.pseudo) || "", listeners: [] };

  function isLoggedIn() { return !!load(KEYS.session); }

  function setAccount(session, pseudo) {
    store(KEYS.session, session);
    store(KEYS.pseudo, pseudo);
    account.pseudo = pseudo || "";
    account.listeners.forEach(function (fn) { fn(); });
  }

  function renderAccount(box) {
    box.innerHTML = "";
    if (isLoggedIn()) {
      var out = el("button", { type: "button", "class": "btn btn-ghost btn-sm" }, ["Se déconnecter"]);
      out.addEventListener("click", function () {
        call("/auth/logout", { method: "POST" }).catch(function () { /* déjà déconnecté */ });
        setAccount(null, null);
      });
      box.appendChild(el("div", { "class": "account-bar" }, [
        el("p", {}, ["Connecté en tant que ", el("strong", { text: account.pseudo || "inscrit" }), ". Tu peux voter et changer d’avis jusqu’à la fin du vote."]),
        out
      ]));
      return;
    }

    var mode = box.getAttribute("data-mode") || "signup";
    var signup = mode === "signup";
    var form = el("form", { "class": "form account-form", novalidate: "" });
    form.appendChild(el("h2", { text: signup ? "Inscris-toi pour voter" : "Connexion" }));
    form.appendChild(el("p", { "class": "hint", text: signup
      ? "Une inscription gratuite = une voix par vote. Ton e-mail n’est jamais affiché ni partagé."
      : "Content de te revoir !" }));
    if (signup) {
      form.appendChild(el("div", {}, [el("label", { "for": "acc-pseudo", text: "Pseudo" }),
        el("input", { id: "acc-pseudo", name: "pseudo", type: "text", required: "", minlength: "2", maxlength: "30", autocomplete: "nickname" })]));
    }
    form.appendChild(el("div", {}, [el("label", { "for": "acc-email", text: "E-mail" }),
      el("input", { id: "acc-email", name: "email", type: "email", required: "", autocomplete: "email" })]));
    form.appendChild(el("div", {}, [el("label", { "for": "acc-password", text: "Mot de passe" + (signup ? " (8 caractères minimum)" : "") }),
      el("input", { id: "acc-password", name: "password", type: "password", required: "", minlength: signup ? "8" : null, autocomplete: signup ? "new-password" : "current-password" })]));
    var captchaBox = el("div", { "class": "captcha-box" });
    form.appendChild(captchaBox);
    form.appendChild(el("button", { "class": "btn btn-primary", type: "submit" }, [signup ? "Créer mon compte" : "Se connecter"]));
    var status = el("p", { "class": "form-status", role: "status", "aria-live": "polite" });
    form.appendChild(status);
    var swap = el("button", { type: "button", "class": "link-btn" }, [signup ? "Déjà inscrit ? Se connecter" : "Pas encore de compte ? S’inscrire"]);
    swap.addEventListener("click", function () { box.setAttribute("data-mode", signup ? "login" : "signup"); renderAccount(box); });
    form.appendChild(swap);
    if (signup) {
      form.appendChild(el("p", { "class": "hint", text: "En t’inscrivant, tu acceptes que ton pseudo, ton e-mail et tes votes soient enregistrés uniquement pour ces votes. Pour supprimer ton compte, écris via la page Contact." }));
    }

    var captcha = formCaptcha(captchaBox);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      if (!captcha.token) { status.textContent = "Coche d’abord la vérification anti-robot."; return; }
      var body = { email: form.email.value.trim(), password: form.password.value, captcha: captcha.token };
      if (signup) body.pseudo = form.pseudo.value.trim();
      var button = $("button[type='submit']", form);
      button.disabled = true;
      status.textContent = signup ? "Création du compte…" : "Connexion…";
      call(signup ? "/auth/signup" : "/auth/login", { method: "POST", body: body }).then(function (data) {
        setAccount(data.session, data.user && data.user.pseudo);
      }).catch(function (err) {
        status.textContent = err.message;
        captcha.reset();
        button.disabled = false;
      });
    });
    box.appendChild(form);
  }

  /* ---------------------------------------------------------------------- */
  /* Duels « Quelle version tu préfères ? »                                  */
  /* ---------------------------------------------------------------------- */

  function countdownText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return (d ? d + " j " : "") + two(h) + " h " + two(m) + " min " + two(sec) + " s";
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }

  function duelStatus(duel, now) {
    var start = Date.parse(duel.startDate || ""), end = Date.parse(duel.endDate);
    if (!isNaN(start) && now < start) return "soon";
    if (isNaN(end) || now >= end) return "closed";
    return "open";
  }

  function versionMedia(v) {
    var box = el("div", { "class": "duel-media" });
    if (isFilled(v.audio)) {
      box.appendChild(el("audio", { controls: "", preload: "none", src: v.audio }, ["Votre navigateur ne lit pas l’audio."]));
    }
    if (isFilled(v.link)) {
      box.appendChild(el("a", { "class": "btn btn-ghost btn-sm", href: v.link, target: "_blank", rel: "noopener noreferrer" }, ["Écouter cette version"]));
    }
    return box;
  }

  function duelCard(duel) {
    var versions = (duel.versions || []).slice(0, 4);
    var card = el("article", { "class": "duel-card", id: "vote-" + duel.id });
    var head = el("div", { "class": "duel-head" }, [
      isFilled(duel.cover) ? el("img", { "class": "duel-cover", src: duel.cover, alt: "", width: "160", height: "160", loading: "lazy" }) : null,
      el("div", {}, [
        el("span", { "class": "duel-badge" }),
        el("h2", { "class": "duel-title", text: duel.title || "Quelle version tu préfères ?" }),
        isFilled(duel.description) ? el("p", { "class": "duel-desc", text: duel.description }) : null,
        el("p", { "class": "duel-timer", "aria-live": "off" }),
        el("p", { "class": "duel-total" })
      ])
    ]);
    card.appendChild(head);

    var grid = el("div", { "class": "duel-versions" });
    versions.forEach(function (v) {
      var btn = el("button", { type: "button", "class": "btn btn-primary duel-vote", "data-version": v.id }, ["Je vote pour ", v.label || v.id, el("span", { "class": "duel-mine" })]);
      var item = el("div", { "class": "duel-version", "data-version": v.id }, [
        el("h3", { text: v.label || v.id }),
        isFilled(v.description) ? el("p", { "class": "duel-desc", text: v.description }) : null,
        versionMedia(v),
        el("div", { "class": "duel-bar", "aria-hidden": "true" }, [el("span")]),
        el("p", { "class": "duel-score" }),
        btn
      ]);
      btn.addEventListener("click", function () { voteDuel(duel, v.id, card); });
      grid.appendChild(item);
    });
    card.appendChild(grid);
    card.appendChild(el("p", { "class": "form-status duel-status", role: "status", "aria-live": "polite" }));
    return card;
  }

  function paintDuel(duel, card, results) {
    var now = Date.now();
    var status = duelStatus(duel, now);
    var badge = $(".duel-badge", card);
    var timer = $(".duel-timer", card);
    var r = results || card._results || { counts: {}, total: 0 };
    card._results = r;
    var total = r.total || 0;
    var max = Math.max.apply(null, (duel.versions || []).map(function (v) { return r.counts[v.id] || 0; }).concat(0));
    var winners = (duel.versions || []).filter(function (v) { return total && (r.counts[v.id] || 0) === max; });

    card.setAttribute("data-status", status);
    if (status === "soon") {
      badge.textContent = "Bientôt";
      timer.textContent = "Le vote commence dans " + countdownText(Date.parse(duel.startDate) - now);
    } else if (status === "open") {
      badge.textContent = "Vote en cours";
      timer.textContent = "Fin du vote dans " + countdownText(Date.parse(duel.endDate) - now);
    } else {
      badge.textContent = "Vote terminé";
      var chosen = isFilled(duel.winner) ? (duel.versions || []).filter(function (v) { return v.id === duel.winner; }) : winners;
      timer.textContent = chosen.length === 1
        ? "Gagnante : " + (chosen[0].label || chosen[0].id) + ". C’est cette version qui sortira !"
        : (total ? "Égalité parfaite !" : "Vote terminé le " + formatDate(duel.endDate) + ".");
    }
    $(".duel-total", card).textContent = status === "soon" ? "" : plural(total, "vote", "votes") + (status === "open" ? " · résultats en direct" : "");

    $$(".duel-version", card).forEach(function (item) {
      var id = item.getAttribute("data-version");
      var n = r.counts[id] || 0;
      var pct = total ? Math.round(n * 100 / total) : 0;
      $(".duel-bar span", item).style.width = pct + "%";
      $(".duel-score", item).textContent = pct + " % · " + plural(n, "vote", "votes");
      item.classList.toggle("is-mine", r.mine === id);
      item.classList.toggle("is-leading", total > 0 && n === max);
      var btn = $(".duel-vote", item);
      btn.hidden = status !== "open";
      btn.disabled = !!card._busy;
      $(".duel-mine", btn).textContent = r.mine === id ? " ✓ ton vote" : "";
    });
  }

  function fetchDuel(duel, card) {
    return call("/duels/" + encodeURIComponent(duel.id)).then(function (r) {
      paintDuel(duel, card, r);
    }).catch(function (err) {
      if (err.status !== 404) console.error(err);
    });
  }

  function voteDuel(duel, version, card) {
    var status = $(".duel-status", card);
    if (!isLoggedIn()) {
      status.textContent = "Inscris-toi (ou connecte-toi) juste en dessous pour voter : une personne = une voix.";
      var acc = $("[data-account]");
      if (acc) { acc.scrollIntoView({ behavior: "smooth", block: "center" }); var f = $("input", acc); if (f) f.focus({ preventScroll: true }); }
      return;
    }
    card._busy = true;
    paintDuel(duel, card);
    status.textContent = "Enregistrement du vote…";
    call("/duels/" + encodeURIComponent(duel.id) + "/vote", { method: "POST", body: { version: version } }).then(function (r) {
      status.textContent = "Merci, ton vote est enregistré !";
      paintDuel(duel, card, r);
    }).catch(function (err) {
      if (err.status === 401) setAccount(null, null);
      status.textContent = err.message;
    }).then(function () { card._busy = false; paintDuel(duel, card); });
  }

  function initDuels() {
    var box = $("[data-duels]");
    if (!box) return;
    var accountBox = $("[data-account]");

    fetch(DUELS_URL, { cache: "no-cache" }).then(function (res) { return res.ok ? res.json() : []; }).then(function (duels) {
      duels = (Array.isArray(duels) ? duels : []).filter(function (d) { return d && d.id && d.endDate; });
      var now = Date.now();
      var rank = { open: 0, soon: 1, closed: 2 };
      duels.sort(function (a, b) {
        var sa = duelStatus(a, now), sb = duelStatus(b, now);
        if (sa !== sb) return rank[sa] - rank[sb];
        return sa === "closed" ? Date.parse(b.endDate) - Date.parse(a.endDate) : Date.parse(a.endDate) - Date.parse(b.endDate);
      });

      box.innerHTML = "";
      if (!duels.length) {
        box.appendChild(el("p", { "class": "empty-state", text: "Aucun vote pour le moment. Reviens bientôt : DPT te fera choisir entre deux versions d’un prochain morceau !" }));
        if (accountBox) accountBox.hidden = true;
        return;
      }

      var cards = duels.map(function (d) { var c = duelCard(d); box.appendChild(c); return { duel: d, card: c }; });
      cards.forEach(function (x) { paintDuel(x.duel, x.card); });

      if (!config.api) {
        cards.forEach(function (x) { $(".duel-status", x.card).textContent = "Le vote ouvre très bientôt."; $$(".duel-vote", x.card).forEach(function (b) { b.hidden = true; }); });
        if (accountBox) accountBox.hidden = true;
        return;
      }

      var anyOpen = cards.some(function (x) { return duelStatus(x.duel, Date.now()) !== "closed"; });
      if (accountBox) {
        accountBox.hidden = !anyOpen;
        renderAccount(accountBox);
        account.listeners.push(function () {
          renderAccount(accountBox);
          cards.forEach(function (x) { fetchDuel(x.duel, x.card); });
        });
      }

      function refreshAll() { cards.forEach(function (x) { fetchDuel(x.duel, x.card); }); }
      refreshAll();
      setInterval(function () {
        if (document.hidden) return;
        if (cards.some(function (x) { return duelStatus(x.duel, Date.now()) === "open"; })) refreshAll();
      }, POLL_MS);
      // Compte à rebours, chaque seconde ; à la fin du vote, on récupère le résultat final.
      setInterval(function () {
        cards.forEach(function (x) {
          var before = x.card.getAttribute("data-status");
          paintDuel(x.duel, x.card);
          if (before !== x.card.getAttribute("data-status")) fetchDuel(x.duel, x.card);
        });
      }, 1000);
    }).catch(function (err) {
      console.error(err);
      box.innerHTML = "";
      box.appendChild(el("p", { "class": "empty-state", text: "Impossible de charger les votes pour le moment." }));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                               */
  /* ---------------------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", function () {
    fetch(SITE_URL, { cache: "no-cache" }).then(function (res) { return res.ok ? res.json() : {}; }).catch(function () { return {}; })
      .then(function (site) {
        var v = (site && site.votes) || {};
        if (isFilled(v.api) && isFilled(v.turnstileSiteKey)) {
          config.api = v.api.trim().replace(/\/+$/, "");
          config.siteKey = v.turnstileSiteKey.trim();
          initThumbs();
        }
        initDuels();
      });
  });
})();
