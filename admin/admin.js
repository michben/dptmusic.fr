/* ==========================================================================
   DPT — Espace admin
   Modifie assets/data/tracks.json, assets/data/site.json et les pochettes
   directement dans le dépôt GitHub, via l'API GitHub et un jeton personnel.
   Chaque enregistrement crée un commit sur la branche publiée : GitHub Pages
   met ensuite le site à jour tout seul.
   ========================================================================== */

(function () {
  "use strict";

  /* --- Réglages du dépôt ---------------------------------------------------- */
  var CONFIG = {
    owner: "michben",
    repo: "dptmusic.fr",
    branch: "main",
    tracksPath: "assets/data/tracks.json",
    sitePath: "assets/data/site.json",
    coversDir: "assets/img/covers/",
    importRequestPath: "import/demande.json",  // lu par la GitHub Action d'import
    importResultPath: "import/resultat.json",
    importTimeout: 180000, // on attend la fin de l'import 3 minutes au plus
    coverSize: 800,      // pochettes enregistrées en 800 × 800 px
    coverQuality: 0.82,  // qualité JPEG
    artistPath: "assets/img/artist.jpg",  // photo officielle (accueil + à propos)
    artistSize: 1200,    // photo enregistrée en 1200 × 1200 px
    logoPath: "assets/img/logo.png",      // logo de l'en-tête
    logoWidth: 900,      // largeur maximale du logo, hauteur proportionnelle
    aboutPath: "assets/img/about.jpg",    // photo de la page « À propos » (facultative)
    iconPaths: {                          // icône du site (onglet du navigateur, écran d'accueil)
      svg: "assets/img/favicon.svg",
      png32: "assets/img/favicon-32.png",
      apple: "assets/img/apple-touch-icon.png"
    }
  };

  var TOKEN_KEY = "dpt-admin-token";
  var PLATFORMS = ["spotify", "appleMusic", "youtube", "youtubeMusic", "deezer", "soundcloud", "tidal", "amazonMusic"];
  var SOCIALS = {
    spotify: "Spotify",
    appleMusic: "Apple Music",
    youtube: "YouTube",
    deezer: "Deezer",
    instagram: "Instagram",
    tiktok: "TikTok",
    x: "X",
    facebook: "Facebook"
  };

  /* Textes de la page « À propos » et des mentions légales : identifiant du
     champ dans l'admin -> emplacement dans site.json. */
  var TEXTS = {
    "p-about-intro": ["about", "intro"],
    "p-about-bio": ["about", "bio"],
    "p-about-universe": ["about", "universe"],
    "p-about-influences": ["about", "influences"],
    "p-about-quote": ["about", "quote"],
    "p-legal-publisher": ["legal", "publisher"],
    "p-legal-manager": ["legal", "manager"],
    "p-legal-privacy": ["legal", "privacy"]
  };

  var state = {
    token: "",
    tracks: [],
    tracksSha: null,
    site: {},
    siteSha: null,
    editingIndex: -1,  // -1 = nouvelle sortie
    coverData: null,   // pochette choisie (data URL JPEG)
    artistData: null,  // photo officielle choisie (data URL JPEG)
    logoData: null,    // logo choisi (data URL PNG)
    aboutData: null,   // photo « À propos » choisie (data URL JPEG)
    iconFile: null,    // icône du site choisie (fichier d'origine, déclinée en plusieurs tailles)
    iconData: null,    // aperçu de l'icône choisie
    previews: {}       // id -> data URL, pour afficher une pochette avant la mise en ligne
  };

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------------- */
  /* Jeton                                                                   */
  /* ---------------------------------------------------------------------- */

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function storeToken(token, remember) {
    try {
      clearToken();
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch (e) { /* stockage indisponible : le jeton reste en mémoire */ }
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* rien */ }
  }

  /* ---------------------------------------------------------------------- */
  /* API GitHub                                                              */
  /* ---------------------------------------------------------------------- */

  function api(path, options) {
    options = options || {};
    var headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + state.token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (options.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    }).then(function (res) {
      if (res.status === 404 && options.allow404) return null;
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || ("Erreur " + res.status));
          err.status = res.status;
          err.write = (options.method || "GET") !== "GET";
          throw err;
        }
        return data;
      });
    });
  }

  function encodePath(path) { return path.split("/").map(encodeURIComponent).join("/"); }

  function getFile(path, allow404) {
    return api("/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(CONFIG.branch), { allow404: allow404 });
  }

  function putFile(path, base64, sha, message) {
    var body = { message: message, content: base64, branch: CONFIG.branch };
    if (sha) body.sha = sha;
    return api("/contents/" + encodePath(path), { method: "PUT", body: body });
  }

  function utf8ToBase64(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function readJSON(path) {
    return getFile(path).then(function (file) {
      return { data: JSON.parse(base64ToUtf8(file.content)), sha: file.sha };
    });
  }

  function writeJSON(path, data, sha, message) {
    return putFile(path, utf8ToBase64(JSON.stringify(data, null, 2) + "\n"), sha, message)
      .then(function (res) { return res.content.sha; });
  }

  function explain(err) {
    if (err.status === 401) return "Jeton refusé ou expiré. Déconnectez-vous et collez un nouveau jeton.";
    // Le dépôt est public : un jeton sans droit d'écriture peut tout lire, mais GitHub répond « Not Found » à l'enregistrement.
    if (err.status === 404 && err.write) return "GitHub refuse l’enregistrement (« Not Found ») : votre jeton n’a pas le droit d’écrire sur michben/dptmusic.fr. Créez un nouveau jeton en suivant l’aide « Comment obtenir un jeton ? » (Only select repositories → michben/dptmusic.fr, et Contents : Read and write), puis déconnectez-vous et collez-le.";
    if (err.status === 403) return "Ce jeton n’a pas le droit de modifier le dépôt (permission « Contents : Read and write » requise).";
    if (err.status === 409 || err.status === 422) return "Le fichier a changé entre-temps. Rechargez la page puis recommencez.";
    if (err instanceof SyntaxError) return "Un fichier de données contient une erreur de syntaxe : " + err.message;
    return err.message || "Erreur inconnue.";
  }

  /* ---------------------------------------------------------------------- */
  /* Écrans                                                                  */
  /* ---------------------------------------------------------------------- */

  function show(view) {
    $("loading").hidden = view !== "loading";
    $("login-view").hidden = view !== "login";
    $("app-view").hidden = view !== "app";
    $("logout").hidden = view !== "app";
  }

  function flash(message, isError) {
    var box = $("flash");
    box.textContent = message;
    box.classList.toggle("is-error", !!isError);
    box.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function login(token) {
    state.token = token;
    show("loading");
    return api("").then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        var e = new Error("no push"); e.status = 403; throw e;
      }
      return Promise.all([readJSON(CONFIG.tracksPath), readJSON(CONFIG.sitePath)]);
    }).then(function (files) {
      if (!Array.isArray(files[0].data)) throw new SyntaxError("tracks.json doit contenir une liste [ … ]");
      state.tracks = files[0].data;
      state.tracksSha = files[0].sha;
      state.site = files[1].data || {};
      state.siteSha = files[1].sha;
      renderTracks();
      fillSettings();
      show("app");
      document.dispatchEvent(new CustomEvent("dpt-admin:ready")); // onglet « Votes » (duels.js)
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Liste des sorties                                                       */
  /* ---------------------------------------------------------------------- */

  /* Même règle que le site : une date complète encore à venir = sortie à venir. */
  function isUpcoming(track) {
    var parts = String(track.releaseDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return false;
    var date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 0, 0, 0);
    return !isNaN(date.getTime()) && date.getTime() > Date.now();
  }

  function coverSrc(track) {
    if (state.previews[track.id]) return state.previews[track.id];
    return track.cover ? "../" + track.cover : "../assets/img/covers/placeholder.jpg";
  }

  function button(label, title, onClick, disabled, extraClass) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn" + (extraClass ? " " + extraClass : "");
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderTracks() {
    var list = $("track-list");
    list.innerHTML = "";
    if (!state.tracks.length) {
      var empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Aucune sortie pour l’instant. Cliquez sur « Nouvelle sortie ».";
      list.appendChild(empty);
      return;
    }
    state.tracks.forEach(function (track, i) {
      var li = document.createElement("li");
      li.className = "admin-item";

      var img = document.createElement("img");
      img.src = coverSrc(track);
      img.alt = "";
      img.width = 64;
      img.height = 64;
      img.addEventListener("error", function () { img.src = "../assets/img/covers/placeholder.jpg"; }, { once: true });

      var info = document.createElement("div");
      info.className = "admin-item-info";
      var title = document.createElement("strong");
      title.textContent = track.title || "Sans titre";
      var meta = document.createElement("span");
      meta.textContent = [track.type, track.releaseDate, isUpcoming(track) ? "À venir" : "En écoute"]
        .filter(Boolean).join(" · ");
      info.appendChild(title);
      info.appendChild(meta);

      var name = track.title || "cette sortie";
      var actions = document.createElement("div");
      actions.className = "admin-item-actions";
      actions.appendChild(button("↑", "Monter « " + name + " »", function () { move(i, -1); }, i === 0));
      actions.appendChild(button("↓", "Descendre « " + name + " »", function () { move(i, 1); }, i === state.tracks.length - 1));
      actions.appendChild(button("Modifier", "Modifier « " + name + " »", function () { openForm(i); }));
      actions.appendChild(button("Supprimer", "Supprimer « " + name + " »", function () { remove(i); }, false, "danger"));

      li.appendChild(img);
      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function saveTracks(newTracks, message) {
    return writeJSON(CONFIG.tracksPath, newTracks, state.tracksSha, message).then(function (sha) {
      state.tracks = newTracks;
      state.tracksSha = sha;
      renderTracks();
    }, function (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
      // Le fichier a changé sur GitHub (ex. un import ditto.fm) : on recharge la liste à jour.
      return readJSON(CONFIG.tracksPath).then(function (file) {
        state.tracks = file.data;
        state.tracksSha = file.sha;
        renderTracks();
        throw new Error("La liste venait d’être modifiée ailleurs : elle a été rechargée. Refaites simplement votre modification.");
      });
    });
  }

  /* <dialog> n'existe pas sur certains anciens navigateurs (ex. iPhone avant iOS 15.4). */
  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else { dialog.classList.add("is-fallback"); dialog.setAttribute("open", ""); }
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setBusy(busy) {
    document.querySelectorAll("#app-view button, #track-form button, #import-form input").forEach(function (b) {
      if (busy) { b.dataset.wasDisabled = b.disabled ? "1" : ""; b.disabled = true; }
      else { b.disabled = b.dataset.wasDisabled === "1"; }
    });
  }

  function move(index, delta) {
    var copy = state.tracks.slice();
    var item = copy.splice(index, 1)[0];
    copy.splice(index + delta, 0, item);
    setBusy(true);
    saveTracks(copy, "Admin : réorganisation des sorties")
      .then(function () { flash("Ordre enregistré. Le site sera à jour d’ici 1 à 2 minutes."); })
      .catch(function (err) { flash(explain(err), true); })
      .then(function () { setBusy(false); renderTracks(); });
  }

  function remove(index) {
    var track = state.tracks[index];
    if (!window.confirm("Supprimer « " + (track.title || "cette sortie") + " » du site ?")) return;
    var copy = state.tracks.slice();
    copy.splice(index, 1);
    setBusy(true);
    saveTracks(copy, "Admin : suppression de « " + track.title + " »")
      .then(function () { flash("« " + track.title + " » a été supprimée. Le site sera à jour d’ici 1 à 2 minutes."); })
      .catch(function (err) { flash(explain(err), true); })
      .then(function () { setBusy(false); renderTracks(); });
  }

  /* ---------------------------------------------------------------------- */
  /* Formulaire d'une sortie                                                 */
  /* ---------------------------------------------------------------------- */

  function slugify(text) {
    return String(text || "").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sortie";
  }

  function uniqueId(base) {
    var id = base, n = 2;
    var taken = function (x) { return state.tracks.some(function (t) { return t.id === x; }); };
    while (taken(id)) id = base + "-" + n++;
    return id;
  }

  function openForm(index) {
    var form = $("track-form");
    var track = index >= 0 ? state.tracks[index] : null;
    state.editingIndex = index;
    state.coverData = null;
    form.reset();
    $("track-status").textContent = "";
    $("track-dialog-title").textContent = track ? "Modifier « " + track.title + " »" : "Nouvelle sortie";

    $("t-title").value = track ? track.title || "" : "";
    $("t-type").value = track && track.type ? track.type : "Single";
    $("t-releaseDate").value = track ? track.releaseDate || "" : "";
    $("t-artist").value = track ? track.artist || "" : "DPT";
    $("t-mainLink").value = track ? track.mainLink || "" : "";
    PLATFORMS.forEach(function (key) {
      $("t-" + key).value = track && track.platforms ? track.platforms[key] || "" : "";
    });
    $("cover-preview").src = track ? coverSrc(track) : "../assets/img/covers/placeholder.jpg";

    openDialog($("track-dialog"));
    $("t-title").focus();
  }

  /* Prépare une image dans le navigateur avant de l'envoyer.
     - mode "square" : recadrée au centre en carré, enregistrée en JPEG (pochettes, photo) ;
     - mode "fit"    : forme d'origine conservée, enregistrée en PNG (logo transparent). */
  function processImage(file, options) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        var ctx;
        if (options.mode === "fit") {
          var scale = Math.min(1, options.maxWidth / img.naturalWidth);
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/png"));
          return;
        }
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        // L'icône du site doit faire exactement sa taille, même à partir d'une petite image.
        var size = options.exact ? options.size : Math.min(options.size, side);
        var png = options.format === "png";
        canvas.width = canvas.height = size;
        ctx = canvas.getContext("2d");
        if (!png) { // le JPEG n'a pas de transparence : fond sombre du site
          ctx.fillStyle = "#0b0b0d";
          ctx.fillRect(0, 0, size, size);
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", options.quality || CONFIG.coverQuality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Image illisible.")); };
      img.src = url;
    });
  }

  function processCover(file) {
    return processImage(file, { mode: "square", size: CONFIG.coverSize });
  }

  function uploadCover(id, dataUrl) {
    var path = CONFIG.coversDir + id + ".jpg";
    return getFile(path, true).then(function (existing) {
      return putFile(path, dataUrl.split(",")[1], existing && existing.sha, "Admin : pochette de « " + id + " »");
    }).then(function () {
      // Le paramètre ?v= force les navigateurs à afficher la nouvelle image.
      return path + "?v=" + Date.now().toString(36);
    });
  }

  function submitTrack(e) {
    e.preventDefault();
    var form = $("track-form");
    if (!form.reportValidity()) return;

    var editing = state.editingIndex >= 0;
    var old = editing ? state.tracks[state.editingIndex] : null;
    var title = $("t-title").value.trim();
    var id = editing ? old.id : uniqueId(slugify(title));

    var track = {
      id: id,
      title: title,
      artist: $("t-artist").value.trim() || "DPT",
      releaseDate: $("t-releaseDate").value.trim(),
      type: $("t-type").value,
      cover: old ? old.cover || "" : "",
      mainLink: $("t-mainLink").value.trim(),
      // On part des liens existants pour garder ceux que le formulaire n'affiche pas (ex. Anghami, importés de ditto.fm).
      platforms: Object.assign({}, old && old.platforms)
    };
    PLATFORMS.forEach(function (key) { track.platforms[key] = $("t-" + key).value.trim(); });

    var status = $("track-status");
    setBusy(true);

    var step = Promise.resolve();
    if (state.coverData) {
      status.textContent = "Envoi de la pochette…";
      var coverData = state.coverData;
      step = uploadCover(id, coverData).then(function (path) {
        track.cover = path;
        state.previews[id] = coverData;
      });
    }

    step.then(function () {
      status.textContent = "Publication…";
      var copy = state.tracks.slice();
      if (editing) copy[state.editingIndex] = track;
      else copy.unshift(track); // les nouvelles sorties arrivent en haut
      return saveTracks(copy, (editing ? "Admin : modification de « " : "Admin : nouvelle sortie « ") + title + " »");
    }).then(function () {
      closeDialog($("track-dialog"));
      flash("« " + title + " » est enregistrée. Le site sera à jour d’ici 1 à 2 minutes.");
    }).catch(function (err) {
      status.textContent = explain(err);
    }).then(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------------------- */
  /* Import depuis ditto.fm                                                  */
  /* ---------------------------------------------------------------------- */

  /* Le navigateur ne peut pas lire ditto.fm : l'admin dépose le lien dans
     import/demande.json, une GitHub Action lit la page, ajoute la sortie et
     écrit le compte rendu dans import/resultat.json, que l'on surveille ici. */

  function isDittoLink(value) {
    return /^https?:\/\/(www\.)?ditto\.fm\/[A-Za-z0-9._~-]+\/?$/.test(value);
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function waitForImport(requestId, startedAt) {
    return getFile(CONFIG.importResultPath, true).then(function (file) {
      var result = file ? JSON.parse(base64ToUtf8(file.content)) : null;
      if (result && result.requestId === requestId) return result;
      if (Date.now() - startedAt > CONFIG.importTimeout) {
        throw new Error("L’import prend plus de temps que prévu. Rechargez la page dans quelques minutes, ou regardez l’onglet « Actions » du dépôt GitHub.");
      }
      return wait(5000).then(function () { return waitForImport(requestId, startedAt); });
    });
  }

  /* Affiche la pochette importée tout de suite, sans attendre la mise à jour du site. */
  function loadCoverPreview(track) {
    if (!track || !track.cover) return Promise.resolve();
    return getFile(track.cover.split("?")[0], true).then(function (file) {
      if (file && file.content) state.previews[track.id] = "data:image/jpeg;base64," + file.content.replace(/\s/g, "");
    }).catch(function () { /* la pochette s'affichera après la mise à jour du site */ });
  }

  function submitImport(e) {
    e.preventDefault();
    var input = $("import-url");
    var status = $("import-status");
    var url = input.value.trim();
    if (!isDittoLink(url)) {
      status.textContent = "Collez un lien de la forme https://ditto.fm/nom-du-titre";
      input.focus();
      return;
    }

    var requestId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    var request = { url: url, requestId: requestId, requestedAt: new Date().toISOString() };
    setBusy(true);
    status.textContent = "Envoi du lien…";

    getFile(CONFIG.importRequestPath, true).then(function (existing) {
      return writeJSON(CONFIG.importRequestPath, request, existing && existing.sha, "Admin : import de " + url);
    }).then(function () {
      status.textContent = "Lecture de la page ditto.fm (titre, pochette, liens)… cela prend environ 30 secondes.";
      return waitForImport(requestId, Date.now());
    }).then(function (result) {
      if (result.status !== "ok") throw new Error("Import impossible : " + result.message);
      return readJSON(CONFIG.tracksPath).then(function (file) {
        state.tracks = file.data;
        state.tracksSha = file.sha;
        var track = state.tracks.filter(function (t) { return t.id === result.trackId; })[0];
        return loadCoverPreview(track);
      }).then(function () {
        renderTracks();
        input.value = "";
        status.textContent = "";
        flash(result.message + " Le site sera à jour d’ici 1 à 2 minutes. Vérifiez le type et la date avec « Modifier ».");
      });
    }).catch(function (err) {
      status.textContent = explain(err);
    }).then(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------------------- */
  /* Paramètres (site.json)                                                  */
  /* ---------------------------------------------------------------------- */

  function buildSocialFields() {
    var box = $("socials-fields");
    Object.keys(SOCIALS).forEach(function (key) {
      var wrap = document.createElement("div");
      var label = document.createElement("label");
      label.htmlFor = "s-social-" + key;
      label.textContent = SOCIALS[key];
      var input = document.createElement("input");
      input.id = "s-social-" + key;
      input.type = "url";
      input.placeholder = "https://…";
      wrap.appendChild(label);
      wrap.appendChild(input);
      box.appendChild(wrap);
    });
  }

  function fillSettings() {
    var s = state.site;
    ["tagline", "listenLink", "email", "formspreeId"].forEach(function (k) { $("s-" + k).value = s[k] || ""; });
    Object.keys(SOCIALS).forEach(function (k) { $("s-social-" + k).value = (s.socials && s.socials[k]) || ""; });
    Object.keys(TEXTS).forEach(function (id) {
      var place = TEXTS[id];
      $(id).value = (s[place[0]] && s[place[0]][place[1]]) || "";
    });
    fillImages();
  }

  /* Copie modifiable de site.json : les champs qu'on ne touche pas sont conservés. */
  function siteCopy() { return JSON.parse(JSON.stringify(state.site)); }

  function saveSite(site, message, status, done) {
    setBusy(true);
    if (status) status.textContent = "Publication…";
    return writeJSON(CONFIG.sitePath, site, state.siteSha, message)
      .then(function (sha) {
        state.site = site;
        state.siteSha = sha;
        if (status) status.textContent = "";
        flash(done);
      })
      .catch(function (err) {
        var text = explain(err);
        if (status) status.textContent = text; else flash(text, true);
      })
      .then(function () { setBusy(false); });
  }

  function submitSettings(e) {
    e.preventDefault();
    if (!$("settings-form").reportValidity()) return;
    var site = siteCopy();
    ["listenLink", "email", "formspreeId"].forEach(function (k) { site[k] = $("s-" + k).value.trim(); });
    site.socials = site.socials || {};
    Object.keys(SOCIALS).forEach(function (k) { site.socials[k] = $("s-social-" + k).value.trim(); });
    saveSite(site, "Admin : mise à jour des liens et du contact", null,
      "Liens et contact enregistrés. Le site sera à jour d’ici 1 à 2 minutes.");
  }

  /* ---------------------------------------------------------------------- */
  /* Textes du site (slogan, à propos, mentions légales)                     */
  /* ---------------------------------------------------------------------- */

  function submitTexts(e) {
    e.preventDefault();
    var site = siteCopy();
    site.tagline = $("s-tagline").value.trim();
    Object.keys(TEXTS).forEach(function (id) {
      var place = TEXTS[id];
      site[place[0]] = site[place[0]] || {};
      site[place[0]][place[1]] = $(id).value.trim();
    });
    saveSite(site, "Admin : mise à jour des textes du site", $("texts-status"),
      "Textes enregistrés. Le site sera à jour d’ici 1 à 2 minutes.");
  }

  /* ---------------------------------------------------------------------- */
  /* Images (photo officielle, logo, photo « À propos », icône du site)     */
  /* ---------------------------------------------------------------------- */

  /* Le ?v= change à chaque enregistrement : les visiteurs voient la nouvelle
     image tout de suite, sans vider le cache de leur navigateur. */
  function imagePath(path) { return path + "?v=" + Date.now().toString(36); }

  function currentImage(key, fallback) {
    var value = state.site.images && state.site.images[key];
    return "../" + (value || fallback);
  }

  function fillImages() {
    $("artist-preview").src = state.artistData || currentImage("artist", CONFIG.artistPath);
    $("logo-preview").src = state.logoData || currentImage("logo", CONFIG.logoPath);
    // Sans photo « À propos », la page utilise la photo officielle.
    var hasAbout = !!(state.site.images && state.site.images.about);
    $("about-preview").src = state.aboutData || (hasAbout ? currentImage("about", CONFIG.aboutPath) : currentImage("artist", CONFIG.artistPath));
    $("about-reset").hidden = !hasAbout;
    $("icon-preview").src = state.iconData || currentImage("icon", CONFIG.iconPaths.apple);
  }

  /* Envoie un ou plusieurs fichiers image dans le dépôt, l'un après l'autre. */
  function putImages(files) {
    return files.reduce(function (step, f) {
      return step.then(function () {
        return getFile(f.path, true).then(function (existing) {
          return putFile(f.path, f.base64, existing && existing.sha, "Admin : mise à jour de " + f.path);
        });
      });
    }, Promise.resolve());
  }

  /* Enregistre la nouvelle valeur de images[key] dans site.json (valeur vide = image retirée). */
  function setImageValue(key, value) {
    var site = siteCopy();
    site.images = site.images || {};
    site.images[key] = value;
    return writeJSON(CONFIG.sitePath, site, state.siteSha, "Admin : nouvelle image du site").then(function (sha) {
      state.site = site;
      state.siteSha = sha;
    });
  }

  /* Remplace le(s) fichier(s) image dans le dépôt, puis note le nouveau ?v= dans site.json.
     `files` : liste de { path, base64 } ; `mainPath` : le fichier noté dans site.json. */
  function saveImage(key, mainPath, files, status, done) {
    setBusy(true);
    status.textContent = "Envoi de l’image…";
    putImages(files).then(function () {
      return setImageValue(key, imagePath(mainPath));
    }).then(function () {
      status.textContent = "";
      fillImages();
      flash(done);
    }).catch(function (err) {
      status.textContent = explain(err);
    }).then(function () { setBusy(false); });
  }

  function single(path, dataUrl) { return [{ path: path, base64: dataUrl.split(",")[1] }]; }

  /* Icône du site : une image carrée déclinée en 32 px (onglet), 180 px (iPhone)
     et en SVG (navigateurs récents), qui contient l'image en 180 px. */
  function buildIconFiles(file) {
    return Promise.all([
      processImage(file, { mode: "square", size: 32, exact: true, format: "png" }),
      processImage(file, { mode: "square", size: 180, exact: true, format: "png" })
    ]).then(function (pngs) {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 180 180">'
        + '<image width="180" height="180" href="' + pngs[1] + '" xlink:href="' + pngs[1] + '"/></svg>\n';
      return [
        { path: CONFIG.iconPaths.png32, base64: pngs[0].split(",")[1] },
        { path: CONFIG.iconPaths.apple, base64: pngs[1].split(",")[1] },
        { path: CONFIG.iconPaths.svg, base64: utf8ToBase64(svg) }
      ];
    });
  }

  /* Prépare une image choisie : aperçu immédiat, bouton d'enregistrement actif. */
  function watchImageField(inputId, buttonId, previewId, statusId, options, store) {
    $(inputId).addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      $(statusId).textContent = "Préparation de l’image…";
      processImage(file, options).then(function (data) {
        store(data);
        $(previewId).src = data;
        $(buttonId).disabled = false;
        $(statusId).textContent = "Cliquez sur « Enregistrer » pour publier cette image.";
      }).catch(function (err) {
        $(statusId).textContent = err.message;
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                               */
  /* ---------------------------------------------------------------------- */

  var TABS = ["tracks", "texts", "images", "settings", "duels"];

  function selectTab(name) {
    TABS.forEach(function (tab) {
      if (!$("tab-" + tab) || !$(tab + "-view")) return;
      $("tab-" + tab).setAttribute("aria-selected", String(tab === name));
      $(tab + "-view").hidden = tab !== name;
    });
  }

  /* Outils partagés avec admin/duels.js (onglet « Votes »). */
  window.DPTAdmin = {
    config: CONFIG,
    state: state,
    getFile: getFile,
    putFile: putFile,
    readJSON: readJSON,
    writeJSON: writeJSON,
    explain: explain,
    flash: flash,
    setBusy: setBusy,
    selectTab: selectTab,
    openDialog: openDialog,
    closeDialog: closeDialog,
    processCover: processCover,
    slugify: slugify
  };

  /* Toute erreur inattendue s'affiche en haut de la page plutôt que de bloquer l'admin en silence. */
  function showUnexpected(err) {
    var box = $("flash");
    if (!box) return;
    box.textContent = "Erreur inattendue : " + ((err && err.message) || err) + ". Rechargez la page (Ctrl + Maj + R) puis réessayez.";
    box.classList.add("is-error");
    box.hidden = false;
    var app = $("app-view");
    if (app && app.hidden) { $("loading").hidden = true; $("login-view").hidden = false; $("login-status").textContent = box.textContent; }
  }
  window.addEventListener("error", function (e) { showUnexpected(e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { showUnexpected(e.reason); });

  document.addEventListener("DOMContentLoaded", function () {
    buildSocialFields();

    $("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = $("token").value.trim();
      var status = $("login-status");
      status.textContent = "Connexion…";
      login(token).then(function () {
        storeToken(token, $("remember").checked);
        $("token").value = "";
        status.textContent = "";
      }).catch(function (err) {
        show("login");
        status.textContent = explain(err);
      });
    });

    $("logout").addEventListener("click", function () {
      clearToken();
      state.token = "";
      $("flash").hidden = true;
      show("login");
    });

    TABS.forEach(function (tab) {
      $("tab-" + tab).addEventListener("click", function () { selectTab(tab); });
    });

    $("texts-form").addEventListener("submit", submitTexts);

    watchImageField("i-artist", "save-artist", "artist-preview", "artist-status",
      { mode: "square", size: CONFIG.artistSize }, function (data) { state.artistData = data; });
    watchImageField("i-logo", "save-logo", "logo-preview", "logo-status",
      { mode: "fit", maxWidth: CONFIG.logoWidth }, function (data) { state.logoData = data; });

    watchImageField("i-about", "save-about", "about-preview", "about-status",
      { mode: "square", size: CONFIG.artistSize }, function (data) { state.aboutData = data; });
    watchImageField("i-icon", "save-icon", "icon-preview", "icon-status",
      { mode: "square", size: 180, exact: true, format: "png" }, function (data) { state.iconData = data; state.iconFile = $("i-icon").files[0]; });

    $("save-artist").addEventListener("click", function () {
      if (!state.artistData) return;
      saveImage("artist", CONFIG.artistPath, single(CONFIG.artistPath, state.artistData), $("artist-status"),
        "Nouvelle photo officielle enregistrée. Le site sera à jour d’ici 1 à 2 minutes.");
    });
    $("save-logo").addEventListener("click", function () {
      if (!state.logoData) return;
      saveImage("logo", CONFIG.logoPath, single(CONFIG.logoPath, state.logoData), $("logo-status"),
        "Nouveau logo enregistré. Le site sera à jour d’ici 1 à 2 minutes.");
    });
    $("save-about").addEventListener("click", function () {
      if (!state.aboutData) return;
      saveImage("about", CONFIG.aboutPath, single(CONFIG.aboutPath, state.aboutData), $("about-status"),
        "Photo de la page « À propos » enregistrée. Le site sera à jour d’ici 1 à 2 minutes.");
    });
    $("about-reset").addEventListener("click", function () {
      if (!window.confirm("La page « À propos » affichera de nouveau la photo officielle. Continuer ?")) return;
      setBusy(true);
      setImageValue("about", "").then(function () {
        state.aboutData = null;
        fillImages();
        flash("La page « À propos » utilise de nouveau la photo officielle. Le site sera à jour d’ici 1 à 2 minutes.");
      }).catch(function (err) { $("about-status").textContent = explain(err); })
        .then(function () { setBusy(false); });
    });
    $("save-icon").addEventListener("click", function () {
      if (!state.iconFile) return;
      $("icon-status").textContent = "Préparation des différentes tailles…";
      buildIconFiles(state.iconFile).then(function (files) {
        saveImage("icon", CONFIG.iconPaths.apple, files, $("icon-status"),
          "Nouvelle icône enregistrée. Le site sera à jour d’ici 1 à 2 minutes (les navigateurs peuvent garder l’ancienne icône un peu plus longtemps).");
      }).catch(function (err) { $("icon-status").textContent = err.message; });
    });

    $("new-track").addEventListener("click", function () { openForm(-1); });
    $("track-cancel").addEventListener("click", function () { closeDialog($("track-dialog")); });
    $("track-form").addEventListener("submit", submitTrack);
    $("import-form").addEventListener("submit", submitImport);
    $("settings-form").addEventListener("submit", submitSettings);

    $("t-cover").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      processCover(file).then(function (data) {
        state.coverData = data;
        $("cover-preview").src = data;
      }).catch(function (err) { $("track-status").textContent = err.message; });
    });

    var saved = readToken();
    if (saved) {
      login(saved).catch(function (err) {
        show("login");
        $("login-status").textContent = explain(err);
      });
    } else {
      show("login");
    }
  });
})();
