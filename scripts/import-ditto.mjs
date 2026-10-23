#!/usr/bin/env node
/* ==========================================================================
   DPT — Import automatique d'une sortie depuis un lien ditto.fm
   Lancé par la GitHub Action « Importer un lien ditto.fm »
   (.github/workflows/import-ditto.yml), jamais dans le navigateur :
   ditto.fm ne peut pas être lu depuis une autre page web.

   Ce que fait le script :
   1. lit la page ditto.fm (titre, pochette, liens des plateformes) ;
   2. enregistre la pochette dans assets/img/covers/<id>.jpg ;
   3. ajoute la sortie en haut de assets/data/tracks.json, ou met à jour
      celle qui a déjà ce lien ;
   4. écrit le compte rendu dans import/resultat.json (lu par l'admin).

   Rien n'est inventé : un champ introuvable sur la page reste vide.

   Utilisation :  node scripts/import-ditto.mjs https://ditto.fm/mon-titre
   Sans argument, le lien est lu dans import/demande.json.
   ========================================================================== */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const TRACKS_PATH = "assets/data/tracks.json";
const COVERS_DIR = "assets/img/covers/";
const REQUEST_PATH = "import/demande.json";
const RESULT_PATH = "import/resultat.json";
const COVER_SIZE = 800;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* Liens acceptés : pages ditto.fm (et feature.fm, le service qui les héberge). */
const ALLOWED_HOSTS = ["ditto.fm", "ffm.to"];

/* Plateformes reconnues, dans l'ordre d'enregistrement.
   `keep` = paramètres d'URL conservés (le reste, souvent du suivi, est retiré). */
const PLATFORMS = [
  { key: "spotify", hosts: ["open.spotify.com", "spotify.link"] },
  { key: "appleMusic", hosts: ["music.apple.com", "itunes.apple.com", "geo.music.apple.com"] },
  { key: "youtubeMusic", hosts: ["music.youtube.com"], keep: ["v", "list"] },
  { key: "youtube", hosts: ["youtube.com", "youtu.be"], keep: ["v", "list"] },
  { key: "deezer", hosts: ["deezer.com", "deezer.page.link", "dzr.page.link"] },
  { key: "soundcloud", hosts: ["soundcloud.com"] },
  { key: "tidal", hosts: ["tidal.com"] },
  { key: "amazonMusic", hosts: ["music.amazon.com", "music.amazon.fr", "amazon.com", "amazon.fr"] },
  { key: "anghami", hosts: ["anghami.com"] },
  { key: "audiomack", hosts: ["audiomack.com"] },
  { key: "boomplay", hosts: ["boomplay.com"] },
  { key: "pandora", hosts: ["pandora.com"] },
  { key: "iheart", hosts: ["iheart.com"] },
  { key: "kkbox", hosts: ["kkbox.com"] }
];

/* ---------------------------------------------------------------------- */
/* Outils                                                                  */
/* ---------------------------------------------------------------------- */

function log(...args) { console.log("[import]", ...args); }

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in named ? named[n.toLowerCase()] : m));
}

function slugify(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sortie";
}

function hostMatches(host, candidates) {
  host = host.toLowerCase().replace(/^www\./, "");
  return candidates.some((c) => host === c || host.endsWith("." + c));
}

function checkSourceUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch { throw new Error("Ce n'est pas un lien valide."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Le lien doit commencer par https://");
  if (!hostMatches(url.hostname, ALLOWED_HOSTS)) throw new Error("Seuls les liens ditto.fm sont acceptés.");
  if (!/^\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname)) throw new Error("Le lien doit ressembler à https://ditto.fm/nom-du-titre");
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/* Récupère <meta property|name="…" content="…"> quel que soit l'ordre des attributs. */
function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (key && key.toLowerCase() === name.toLowerCase()) {
      const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
      if (content && content.trim()) return decodeEntities(content.trim());
    }
  }
  return "";
}

/* Le paramètre cd des liens feature.fm est un JSON encodé en base64. */
function decodeCd(value) {
  // URLSearchParams a déjà décodé la valeur, et transformé les « + » en espaces.
  let b64 = value.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  while (b64.length % 4) b64 += "=";
  const text = Buffer.from(b64, "base64").toString("utf8");
  try { return JSON.parse(text); } catch { return text; }
}

/* Toutes les URL http(s) contenues dans une valeur (objet JSON ou texte). */
function collectUrls(value, out = []) {
  if (typeof value === "string") {
    const found = value.match(/https?:\/\/[^\s"'<>\\]+/g);
    if (found) out.push(...found);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectUrls(v, out));
  }
  return out;
}

function platformOf(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  const platform = PLATFORMS.find((p) => hostMatches(url.hostname, p.hosts));
  if (!platform) return null;
  // Nettoyage : https, sans paramètres de suivi.
  const params = new URLSearchParams();
  (platform.keep || []).forEach((k) => { if (url.searchParams.has(k)) params.set(k, url.searchParams.get(k)); });
  url.protocol = "https:";
  url.search = params.toString();
  url.hash = "";
  return { key: platform.key, url: url.toString() };
}

/* ---------------------------------------------------------------------- */
/* Lecture de la page ditto.fm                                             */
/* ---------------------------------------------------------------------- */

export function parseDittoPage(html) {
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title")
    || decodeEntities(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim());
  const image = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  const artist = metaContent(html, "music:musician_description") || metaContent(html, "music:musician")
    || metaContent(html, "og:music:musician");
  const dateRaw = metaContent(html, "music:release_date") || metaContent(html, "og:music:release_date");
  const releaseDate = (dateRaw.match(/^\d{4}(-\d{2}-\d{2})?/) || [""])[0];

  const platforms = {};
  const add = (raw) => {
    const p = platformOf(raw);
    if (p && !platforms[p.key]) platforms[p.key] = p.url;
  };

  const hrefs = (html.match(/\bhref\s*=\s*"[^"]*"|\bhref\s*=\s*'[^']*'/gi) || [])
    .map((h) => decodeEntities(h.replace(/^href\s*=\s*["']|["']$/gi, "")));
  let smartLinks = 0;
  for (const href of hrefs) {
    let url;
    try { url = new URL(href); } catch { continue; }
    if (hostMatches(url.hostname, ["ffm.to"]) && url.searchParams.has("cd")) {
      // Lien de redirection feature.fm : la vraie destination est dans cd.
      smartLinks++;
      const data = decodeCd(url.searchParams.get("cd"));
      collectUrls(data).forEach(add);
    } else {
      add(href);
    }
  }

  return { title, image, artist, releaseDate, platforms, smartLinks };
}

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" }
  });
  if (res.status === 404) throw new Error("Cette page ditto.fm n'existe pas (erreur 404). Vérifiez le lien.");
  if (!res.ok) throw new Error("ditto.fm a répondu avec l'erreur " + res.status + ". Réessayez dans quelques minutes.");
  return res.text();
}

/* Télécharge la pochette et l'enregistre en JPEG carré 800 × 800 (si sharp est disponible). */
async function saveCover(imageUrl, id) {
  const res = await fetch(imageUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error("pochette introuvable (erreur " + res.status + ")");
  const input = Buffer.from(await res.arrayBuffer());
  const path = COVERS_DIR + id + ".jpg";
  let output = null;
  try {
    const sharp = (await import("sharp")).default;
    output = await sharp(input).resize(COVER_SIZE, COVER_SIZE, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (err) {
    log("redimensionnement impossible, image d'origine conservée :", err.message);
    const isJpeg = input[0] === 0xff && input[1] === 0xd8;
    if (!isJpeg) throw new Error("la pochette n'est pas un JPEG et ne peut pas être convertie");
    output = input;
  }
  await mkdir(COVERS_DIR, { recursive: true });
  await writeFile(path, output);
  return path + "?v=" + Date.now().toString(36);
}

/* ---------------------------------------------------------------------- */
/* Programme principal                                                     */
/* ---------------------------------------------------------------------- */

async function readRequest() {
  if (process.argv[2]) return { url: process.argv[2], requestId: "" };
  if (!existsSync(REQUEST_PATH)) throw new Error("Aucun lien fourni.");
  const req = JSON.parse(await readFile(REQUEST_PATH, "utf8"));
  return { url: req.url, requestId: String(req.requestId || "") };
}

async function main() {
  const result = { requestId: "", url: "", status: "error", message: "", trackId: "", title: "", platforms: [], finishedAt: "" };
  try {
    const req = await readRequest();
    result.requestId = req.requestId;
    const url = checkSourceUrl(req.url);
    result.url = url;
    log("lecture de", url);

    const html = await fetchPage(url);
    const page = parseDittoPage(html);
    log("titre :", JSON.stringify(page.title));
    log("pochette :", page.image || "(aucune)");
    log("liens feature.fm décodés :", page.smartLinks);
    log("plateformes :", JSON.stringify(page.platforms, null, 2));
    if (!page.title) throw new Error("Impossible de trouver le titre sur la page ditto.fm.");

    const tracks = JSON.parse(await readFile(TRACKS_PATH, "utf8"));
    if (!Array.isArray(tracks)) throw new Error(TRACKS_PATH + " doit contenir une liste [ … ]");

    const sameLink = (t) => String(t.mainLink || "").replace(/\/$/, "").toLowerCase() === url.toLowerCase();
    const index = tracks.findIndex(sameLink);
    const old = index >= 0 ? tracks[index] : null;

    let id = old ? old.id : slugify(page.title);
    if (!old) {
      const base = id;
      for (let n = 2; tracks.some((t) => t.id === id); n++) id = base + "-" + n;
    }

    // Les valeurs trouvées sur la page remplacent les anciennes ; un champ
    // introuvable garde ce qui avait été saisi à la main.
    const track = {
      id,
      title: page.title,
      artist: page.artist || (old && old.artist) || "DPT",
      releaseDate: page.releaseDate || (old && old.releaseDate) || "",
      type: (old && old.type) || "Single",
      cover: (old && old.cover) || "",
      mainLink: url,
      platforms: Object.assign({ spotify: "", appleMusic: "", youtube: "", deezer: "" }, old && old.platforms, page.platforms)
    };

    const warnings = [];
    if (page.image) {
      try { track.cover = await saveCover(page.image, id); }
      catch (err) { warnings.push("Pochette non récupérée : " + err.message + "."); }
    } else {
      warnings.push("Aucune pochette trouvée sur la page.");
    }

    if (old) tracks[index] = track; else tracks.unshift(track);
    await writeFile(TRACKS_PATH, JSON.stringify(tracks, null, 2) + "\n");

    const found = Object.keys(page.platforms);
    Object.assign(result, {
      status: "ok",
      trackId: id,
      title: track.title,
      platforms: found,
      message: (old ? "« " + track.title + " » a été mise à jour" : "« " + track.title + " » a été ajoutée")
        + " avec " + found.length + " plateforme" + (found.length > 1 ? "s" : "") + "."
        + (warnings.length ? " " + warnings.join(" ") : "")
    });
    log(result.message);
  } catch (err) {
    result.message = err.message || String(err);
    console.error("[import] échec :", result.message);
    process.exitCode = 1;
  }
  result.finishedAt = new Date().toISOString();
  await mkdir("import", { recursive: true });
  await writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + "\n");
  if (existsSync(REQUEST_PATH)) await unlink(REQUEST_PATH).catch(() => {});
}

if (import.meta.url === "file://" + process.argv[1]) main();
