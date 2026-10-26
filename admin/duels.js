/* ==========================================================================
   DPT — Espace admin, onglet « Votes »
   Gère assets/data/duels.json : les duels « Quelle version tu préfères ? »
   affichés sur la page vote.html. Les fichiers audio des versions sont
   enregistrés dans assets/audio/. Les votes eux-mêmes sont comptés par le
   service « dpt-votes » (Cloudflare), dont on affiche ici les résultats.
   ========================================================================== */

(function () {
  "use strict";

  var DUELS_PATH = "assets/data/duels.json";
  var AUDIO_DIR = "assets/audio/";
  var IMG_DIR = "assets/img/votes/";
  var MAX_AUDIO_MB = 20;
  var VERSIONS = [{ id: "a", label: "Version 1" }, { id: "b", label: "Version 2" }];

  var duels = { list: [], sha: null, editing: -1, cover: null, audio: {}, results: {} };

  function $(id) { return document.getElementById(id); }
  function A() { return window.DPTAdmin; }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  function votesApi() {
    var v = (A().state.site && A().state.site.votes) || {};
    return typeof v.api === "string" ? v.api.trim().replace(/\/+$/, "") : "";
  }

  /* --- Dates ---------------------------------------------------------------- */

  function toLocalInput(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    var off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  }

  function fromLocalInput(value) {
    if (!value) return "";
    var d = new Date(value);
    return isNaN(d) ? "" : d.toISOString();
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "?" : d.toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function status(duel) {
    var now = Date.now(), start = Date.parse(duel.startDate || ""), end = Date.parse(duel.endDate);
    if (!isNaN(start) && now < start) return "À venir";
    if (isNaN(end) || now >= end) return "Terminé";
    return "En cours";
  }

  /* --- Liste ---------------------------------------------------------------- */

  function load() {
    return A().getFile(DUELS_PATH, true).then(function (file) {
      if (!file) { duels.list = []; duels.sha = null; return; }
      return A().readJSON(DUELS_PATH).then(function (f) {
        duels.list = Array.isArray(f.data) ? f.data : [];
        duels.sha = f.sha;
      });
    }).then(function () {
      render();
      fetchResults();
    });
  }

  function fetchResults() {
    var api = votesApi();
    if (!api) return;
    duels.list.forEach(function (d) {
      fetch(api + "/duels/" + encodeURIComponent(d.id), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) { if (r) { duels.results[d.id] = r; render(); } })
        .catch(function () { /* service injoignable : les résultats restent masqués */ });
    });
  }

  function resultsText(duel) {
    var r = duels.results[duel.id];
    if (!r) return "";
    return (duel.versions || []).map(function (v) {
      var n = r.counts[v.id] || 0;
      return (v.label || v.id) + " : " + n + " (" + (r.total ? Math.round(n * 100 / r.total) : 0) + " %)";
    }).join(" · ") + " — " + r.total + " vote" + (r.total > 1 ? "s" : "");
  }

  function render() {
    var notice = $("votes-service");
    notice.hidden = !!votesApi();
    notice.textContent = "Le service des votes n’est pas encore en ligne : vous pouvez déjà préparer un vote, mais personne ne pourra voter tant qu’il n’est pas installé (une seule fois, voir le README du dépôt, rubrique « Votes »). Les pouces sous les morceaux apparaîtront en même temps.";

    var list = $("duel-list");
    list.innerHTML = "";
    if (!duels.list.length) {
      list.appendChild(el("li", { "class": "empty-state" }, "Aucun vote pour l’instant. Cliquez sur « Nouveau vote » pour proposer deux versions d’un morceau."));
      return;
    }
    duels.list.forEach(function (duel, i) {
      var li = el("li", { "class": "admin-item" });
      var img = el("img", { src: duel.cover ? "../" + duel.cover : "../assets/img/covers/placeholder.jpg", alt: "", width: "64", height: "64" });
      if (duels.cover && duels.cover.id === duel.id) img.src = duels.cover.data;
      var info = el("div", { "class": "admin-item-info" });
      info.appendChild(el("strong", {}, duel.title || "Sans titre"));
      info.appendChild(el("span", {}, status(duel) + " · fin le " + formatDate(duel.endDate)));
      var res = resultsText(duel);
      if (res) info.appendChild(el("span", { "class": "duel-results" }, res));

      var actions = el("div", { "class": "admin-item-actions" });
      var name = duel.title || "ce vote";
      actions.appendChild(button("Voir", "Voir « " + name + " » sur le site", function () { window.open("../vote.html#vote-" + duel.id, "_blank", "noopener"); }));
      actions.appendChild(button("Modifier", "Modifier « " + name + " »", function () { openForm(i); }));
      actions.appendChild(button("Supprimer", "Supprimer « " + name + " »", function () { remove(i); }, "danger"));

      li.appendChild(img);
      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function button(label, title, onClick, extraClass) {
    var b = el("button", { type: "button", "class": "icon-btn" + (extraClass ? " " + extraClass : ""), title: title, "aria-label": title }, label);
    b.addEventListener("click", onClick);
    return b;
  }

  function save(list, message) {
    return A().writeJSON(DUELS_PATH, list, duels.sha, message).then(function (sha) {
      duels.list = list;
      duels.sha = sha;
      render();
    });
  }

  function remove(i) {
    var duel = duels.list[i];
    if (!window.confirm("Supprimer le vote « " + (duel.title || "") + " » du site ? Les votes déjà reçus ne seront plus affichés.")) return;
    var copy = duels.list.slice();
    copy.splice(i, 1);
    A().setBusy(true);
    save(copy, "Admin : suppression du vote « " + duel.title + " »")
      .then(function () { A().flash("Vote supprimé. Le site sera à jour d’ici 1 à 2 minutes."); })
      .catch(function (err) { A().flash(A().explain(err), true); })
      .then(function () { A().setBusy(false); });
  }

  /* --- Formulaire ------------------------------------------------------------ */

  function buildVersionFields() {
    var box = $("d-versions");
    box.innerHTML = "";
    box.appendChild(el("legend", {}, "Les deux versions"));
    VERSIONS.forEach(function (v) {
      var wrap = el("div", { "class": "version-field" });
      wrap.appendChild(el("h3", {}, v.label));
      var name = el("div");
      name.appendChild(el("label", { "for": "d-" + v.id + "-label" }, "Nom affiché *"));
      var input = el("input", { id: "d-" + v.id + "-label", type: "text", required: "", placeholder: "ex. " + v.label + " (acoustique)" });
      name.appendChild(input);
      wrap.appendChild(name);

      var audio = el("div");
      audio.appendChild(el("label", { "for": "d-" + v.id + "-audio" }, "Fichier audio (MP3 conseillé, " + MAX_AUDIO_MB + " Mo maximum)"));
      var file = el("input", { id: "d-" + v.id + "-audio", type: "file", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" });
      audio.appendChild(file);
      var player = el("audio", { id: "d-" + v.id + "-player", controls: "", preload: "none" });
      player.hidden = true;
      audio.appendChild(player);
      wrap.appendChild(audio);
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > MAX_AUDIO_MB * 1024 * 1024) {
          $("duel-status").textContent = "Le fichier « " + f.name + " » fait plus de " + MAX_AUDIO_MB + " Mo : exportez-le en MP3 (192 kbit/s suffit).";
          file.value = "";
          return;
        }
        duels.audio[v.id] = f;
        player.src = URL.createObjectURL(f);
        player.hidden = false;
      });

      var link = el("div");
      link.appendChild(el("label", { "for": "d-" + v.id + "-link" }, "Ou un lien d’écoute (facultatif)"));
      link.appendChild(el("input", { id: "d-" + v.id + "-link", type: "url", placeholder: "https://soundcloud.com/… (lien privé possible)" }));
      wrap.appendChild(link);
      box.appendChild(wrap);
    });
  }

  function openForm(i) {
    var duel = i >= 0 ? duels.list[i] : null;
    duels.editing = i;
    duels.cover = null;
    duels.audio = {};
    $("duel-form").reset();
    $("duel-status").textContent = "";
    $("duel-dialog-title").textContent = duel ? "Modifier « " + duel.title + " »" : "Nouveau vote";
    $("d-title").value = duel ? duel.title || "" : "";
    $("d-description").value = duel ? duel.description || "" : "";
    $("d-start").value = duel ? toLocalInput(duel.startDate) : "";
    $("d-end").value = duel ? toLocalInput(duel.endDate) : toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString());
    $("d-cover-preview").src = duel && duel.cover ? "../" + duel.cover : "../assets/img/covers/placeholder.jpg";

    VERSIONS.forEach(function (v) {
      var current = duel ? (duel.versions || []).filter(function (x) { return x.id === v.id; })[0] : null;
      $("d-" + v.id + "-label").value = current ? current.label || "" : v.label;
      $("d-" + v.id + "-link").value = current ? current.link || "" : "";
      var player = $("d-" + v.id + "-player");
      if (current && current.audio) { player.src = "../" + current.audio; player.hidden = false; }
      else { player.removeAttribute("src"); player.hidden = true; }
    });

    var winner = $("d-winner");
    winner.innerHTML = "";
    winner.appendChild(el("option", { value: "" }, "Celle qui a le plus de votes"));
    VERSIONS.forEach(function (v) { winner.appendChild(el("option", { value: v.id }, $("d-" + v.id + "-label").value)); });
    winner.value = duel && duel.winner ? duel.winner : "";
    $("d-winner-field").hidden = !duel || status(duel) !== "Terminé";

    A().openDialog($("duel-dialog"));
    $("d-title").focus();
  }

  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = function () { reject(new Error("Lecture du fichier « " + file.name + " » impossible.")); };
      r.readAsDataURL(file);
    });
  }

  function upload(path, base64, message) {
    return A().getFile(path, true).then(function (existing) {
      // Fichier déjà présent : l'API renvoie son identifiant (sha), nécessaire pour le remplacer.
      return A().putFile(path, base64, existing && existing.sha, message);
    }).then(function () { return path + "?v=" + Date.now().toString(36); });
  }

  function extension(file) {
    var m = String(file.name).toLowerCase().match(/\.(mp3|m4a|aac|wav|ogg)$/);
    return m ? m[1] : "mp3";
  }

  function uniqueId(base) {
    var id = base, n = 2;
    var taken = function (x) { return duels.list.some(function (d) { return d.id === x; }); };
    while (taken(id)) id = base + "-" + n++;
    return id;
  }

  function submit(e) {
    e.preventDefault();
    var form = $("duel-form");
    if (!form.reportValidity()) return;
    var editing = duels.editing >= 0;
    var old = editing ? duels.list[duels.editing] : null;
    var title = $("d-title").value.trim();
    var id = editing ? old.id : uniqueId(A().slugify(title));
    var start = fromLocalInput($("d-start").value);
    var end = fromLocalInput($("d-end").value);
    var statusBox = $("duel-status");
    if (start && Date.parse(start) >= Date.parse(end)) { statusBox.textContent = "La fin du vote doit être après le début."; return; }

    var duel = {
      id: id,
      title: title,
      description: $("d-description").value.trim(),
      cover: old ? old.cover || "" : "",
      startDate: start,
      endDate: end,
      winner: $("d-winner-field").hidden ? (old && old.winner) || "" : $("d-winner").value,
      versions: VERSIONS.map(function (v) {
        var prev = old ? (old.versions || []).filter(function (x) { return x.id === v.id; })[0] : null;
        return {
          id: v.id,
          label: $("d-" + v.id + "-label").value.trim() || v.label,
          audio: prev ? prev.audio || "" : "",
          link: $("d-" + v.id + "-link").value.trim()
        };
      })
    };
    if (!duel.versions.every(function (v) { return v.audio || v.link || duels.audio[v.id]; })) {
      statusBox.textContent = "Ajoutez un fichier audio (ou un lien) pour chacune des deux versions.";
      return;
    }

    var saveBtn = $("duel-form").querySelector("button[type='submit']");
    saveBtn.disabled = true;
    A().setBusy(true);
    var step = Promise.resolve();
    if (duels.cover) {
      var cover = duels.cover.data;
      step = step.then(function () {
        statusBox.textContent = "Envoi de l’image…";
        return upload(IMG_DIR + id + ".jpg", cover.split(",")[1], "Admin : image du vote « " + title + " »");
      }).then(function (path) { duel.cover = path; duels.cover = { id: id, data: cover }; });
    }
    duel.versions.forEach(function (v) {
      var file = duels.audio[v.id];
      if (!file) return;
      step = step.then(function () {
        statusBox.textContent = "Envoi de « " + v.label + " »… (cela peut prendre une minute)";
        return readBase64(file);
      }).then(function (b64) {
        return upload(AUDIO_DIR + id + "-" + v.id + "." + extension(file), b64, "Admin : audio « " + v.label + " » du vote « " + title + " »");
      }).then(function (path) { v.audio = path; });
    });

    step.then(function () {
      statusBox.textContent = "Publication…";
      var copy = duels.list.slice();
      if (editing) copy[duels.editing] = duel; else copy.unshift(duel);
      return save(copy, (editing ? "Admin : modification du vote « " : "Admin : nouveau vote « ") + title + " »");
    }).then(function () {
      A().closeDialog($("duel-dialog"));
      A().flash("Le vote « " + title + " » est enregistré. Il sera visible sur la page Vote d’ici 1 à 2 minutes.");
    }).catch(function (err) {
      if (err.status === 409 || err.status === 422) {
        load();
        statusBox.textContent = "La liste des votes venait d’être modifiée ailleurs : elle a été rechargée. Recommencez l’enregistrement.";
      } else {
        statusBox.textContent = A().explain(err);
      }
    }).then(function () { A().setBusy(false); saveBtn.disabled = false; });
  }

  /* --- Démarrage ------------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("duels-view")) return;
    buildVersionFields();
    $("tab-duels").addEventListener("click", function () { A().selectTab("duels"); fetchResults(); });
    $("new-duel").addEventListener("click", function () { openForm(-1); });
    $("duel-cancel").addEventListener("click", function () { A().closeDialog($("duel-dialog")); });
    $("duel-form").addEventListener("submit", submit);
    $("d-cover").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      A().processCover(f).then(function (data) {
        duels.cover = { id: null, data: data };
        $("d-cover-preview").src = data;
      }).catch(function (err) { $("duel-status").textContent = err.message; });
    });
  });

  document.addEventListener("dpt-admin:ready", function () {
    load().catch(function (err) { A().flash(A().explain(err), true); });
  });
})();
