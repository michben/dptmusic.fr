/* ==========================================================================
   DPT — Service des votes (Cloudflare Worker + base D1)

   - Pouces haut / bas sur chaque morceau, sans inscription, protégés par
     Cloudflare Turnstile (captcha) contre les robots.
   - Duels « Quelle version tu préfères ? » : vote réservé aux inscrits,
     résultats en direct, vote fermé à la date de fin du duel.

   Les morceaux et les duels ne sont pas stockés ici : ils sont lus sur le
   site (assets/data/tracks.json et assets/data/duels.json). La base ne
   contient que les votes et les comptes.
   ========================================================================== */

const DAY = 86400000;
const SESSION_DAYS = 180;
const PBKDF2_ITERATIONS = 100000; // maximum autorisé par Cloudflare Workers

// Limites anti-abus, par adresse IP et par jour.
const LIMITS = { like: 300, signup: 5, login: 30 };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const res = await route(request, env, ctx);
      Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err && err.stack || err);
      return json({ error: status === 500 ? "Erreur du serveur, réessayez plus tard." : err.message }, status, cors);
    }
  }
};

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (path === "/" && method === "GET") return json({ ok: true, service: "dpt-votes" });

  if (method !== "GET") checkOrigin(request, env);

  if (path === "/likes" && method === "GET") return getLikes(url, env);
  if (path === "/likes" && method === "POST") return postLike(request, env);

  if (path === "/auth/signup" && method === "POST") return signup(request, env);
  if (path === "/auth/login" && method === "POST") return login(request, env);
  if (path === "/auth/me" && method === "GET") return me(request, env);
  if (path === "/auth/logout" && method === "POST") return logout(request, env);

  const duel = path.match(/^\/duels\/([a-z0-9-]{1,80})(\/vote)?$/);
  if (duel && !duel[2] && method === "GET") return getDuel(duel[1], request, env, ctx);
  if (duel && duel[2] && method === "POST") return voteDuel(duel[1], request, env, ctx);

  throw httpError(404, "Adresse inconnue.");
}

/* --- Pouces sur les morceaux ---------------------------------------------- */

async function likeCounts(env, ids) {
  const placeholders = ids.length ? " WHERE track_id IN (" + ids.map(() => "?").join(",") + ")" : "";
  const { results } = await env.DB.prepare(
    "SELECT track_id, SUM(value = 1) AS up, SUM(value = -1) AS down FROM likes" + placeholders + " GROUP BY track_id"
  ).bind(...ids).all();
  const out = {};
  results.forEach((r) => { out[r.track_id] = { up: r.up || 0, down: r.down || 0 }; });
  return out;
}

async function getLikes(url, env) {
  const ids = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(isSlug).slice(0, 200);
  return json({ counts: await likeCounts(env, ids) }, 200, { "Cache-Control": "no-store" });
}

async function postLike(request, env) {
  const body = await readBody(request);
  const track = String(body.track || "");
  const value = Number(body.value);
  const voter = String(body.voter || "");
  if (!isSlug(track)) throw httpError(400, "Morceau inconnu.");
  if (![1, -1, 0].includes(value)) throw httpError(400, "Vote invalide.");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(voter)) throw httpError(400, "Identifiant de vote invalide.");

  const ip = await clientIp(request, env);
  await verifyCaptcha(body.captcha, request, env);
  await rateLimit(env, "like:" + ip, LIMITS.like);

  const tracks = await siteData(env, "assets/data/tracks.json");
  if (!Array.isArray(tracks) || !tracks.some((t) => t && t.id === track)) throw httpError(400, "Morceau inconnu.");

  const voterHash = await hash(env, "voter:" + voter);
  if (value === 0) {
    await env.DB.prepare("DELETE FROM likes WHERE track_id = ? AND voter = ?").bind(track, voterHash).run();
  } else {
    // Au plus 20 votes différents par adresse IP et par morceau (une famille, un lycée…).
    const existing = await env.DB.prepare("SELECT 1 FROM likes WHERE track_id = ? AND voter = ?").bind(track, voterHash).first();
    if (!existing) {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM likes WHERE track_id = ? AND ip = ?").bind(track, ip).first();
      if (row && row.n >= 20) throw httpError(429, "Trop de votes depuis cette connexion pour ce morceau.");
    }
    await env.DB.prepare(
      "INSERT INTO likes (track_id, voter, ip, value, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (track_id, voter) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(track, voterHash, ip, value, Date.now()).run();
  }

  const counts = await likeCounts(env, [track]);
  return json({ track, value, counts: counts[track] || { up: 0, down: 0 } });
}

/* --- Comptes -------------------------------------------------------------- */

async function signup(request, env) {
  const body = await readBody(request);
  const pseudo = String(body.pseudo || "").trim().replace(/\s+/g, " ");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (pseudo.length < 2 || pseudo.length > 30) throw httpError(400, "Le pseudo doit faire entre 2 et 30 caractères.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) throw httpError(400, "Adresse e-mail invalide.");
  if (password.length < 8 || password.length > 200) throw httpError(400, "Le mot de passe doit faire au moins 8 caractères.");

  const ip = await clientIp(request, env);
  await verifyCaptcha(body.captcha, request, env);
  await rateLimit(env, "signup:" + ip, LIMITS.signup);

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) throw httpError(409, "Un compte existe déjà avec cette adresse e-mail. Connectez-vous.");

  const salt = randomToken(16);
  const passHash = await hashPassword(password, salt);
  const res = await env.DB.prepare(
    "INSERT INTO users (pseudo, email, pass_hash, pass_salt, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(pseudo, email, passHash, salt, ip, Date.now()).run();
  const userId = res.meta.last_row_id;
  return json({ session: await createSession(env, userId), user: { pseudo } }, 201);
}

async function login(request, env) {
  const body = await readBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const ip = await clientIp(request, env);
  await verifyCaptcha(body.captcha, request, env);
  await rateLimit(env, "login:" + ip, LIMITS.login);

  const user = await env.DB.prepare("SELECT id, pseudo, pass_hash, pass_salt FROM users WHERE email = ?").bind(email).first();
  if (!user || !timingSafeEqual(await hashPassword(password, user.pass_salt), user.pass_hash)) {
    throw httpError(401, "E-mail ou mot de passe incorrect.");
  }
  return json({ session: await createSession(env, user.id), user: { pseudo: user.pseudo } });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw httpError(401, "Non connecté.");
  return json({ user: { pseudo: user.pseudo } });
}

async function logout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), userId, now + SESSION_DAYS * DAY)
  ]);
  return token;
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id, u.pseudo FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256(token), Date.now()).first();
}

function bearer(request) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : "";
}

/* --- Duels de versions ---------------------------------------------------- */

async function findDuel(env, id) {
  const duels = await siteData(env, "assets/data/duels.json");
  const duel = Array.isArray(duels) ? duels.find((d) => d && d.id === id) : null;
  if (!duel) throw httpError(404, "Ce vote n’existe pas.");
  return duel;
}

async function duelResults(env, duel) {
  const { results } = await env.DB.prepare(
    "SELECT version, COUNT(*) AS n FROM duel_votes WHERE duel_id = ? GROUP BY version"
  ).bind(duel.id).all();
  const counts = {};
  (duel.versions || []).forEach((v) => { counts[v.id] = 0; });
  results.forEach((r) => { if (r.version in counts) counts[r.version] = r.n; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const end = Date.parse(duel.endDate);
  return { duel: duel.id, counts, total, closed: !isNaN(end) && Date.now() >= end, endDate: duel.endDate };
}

async function getDuel(id, request, env) {
  const duel = await findDuel(env, id);
  const out = await duelResults(env, duel);
  const user = await currentUser(request, env);
  if (user) {
    const row = await env.DB.prepare("SELECT version FROM duel_votes WHERE duel_id = ? AND user_id = ?").bind(duel.id, user.id).first();
    out.mine = row ? row.version : null;
  }
  return json(out, 200, { "Cache-Control": "no-store" });
}

async function voteDuel(id, request, env) {
  const user = await currentUser(request, env);
  if (!user) throw httpError(401, "Connectez-vous pour voter.");
  const body = await readBody(request);
  const duel = await findDuel(env, id);
  const version = String(body.version || "");
  if (!(duel.versions || []).some((v) => v.id === version)) throw httpError(400, "Version inconnue.");
  const start = Date.parse(duel.startDate || "");
  if (!isNaN(start) && Date.now() < start) throw httpError(403, "Le vote n’a pas encore commencé.");
  const end = Date.parse(duel.endDate);
  if (isNaN(end) || Date.now() >= end) throw httpError(403, "Le vote est terminé.");

  await env.DB.prepare(
    "INSERT INTO duel_votes (duel_id, user_id, version, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (duel_id, user_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at"
  ).bind(duel.id, user.id, version, Date.now()).run();

  const out = await duelResults(env, duel);
  out.mine = version;
  return json(out);
}

/* -------------------------------------------------------------------------- */
/* Outils                                                                      */
/* -------------------------------------------------------------------------- */

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {})
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isSlug(s) { return typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s); }

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowedOrigins(env).includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function checkOrigin(request, env) {
  if (!allowedOrigins(env).includes(request.headers.get("Origin") || "")) throw httpError(403, "Origine non autorisée.");
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 10000) throw httpError(413, "Requête trop grosse.");
  try { return JSON.parse(text || "{}") || {}; } catch (e) { throw httpError(400, "Requête invalide."); }
}

/* Lit un fichier JSON publié sur le site (mis en cache 1 minute). */
async function siteData(env, path) {
  const res = await fetch(String(env.SITE_URL).replace(/\/+$/, "") + "/" + path, {
    cf: { cacheTtl: 60, cacheEverything: true }
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Lecture de " + path + " impossible : " + res.status);
  return res.json();
}

async function verifyCaptcha(token, request, env) {
  if (typeof token !== "string" || !token || token.length > 2048) throw httpError(400, "Vérification anti-robot manquante.");
  if (!env.TURNSTILE_SECRET) throw new Error("TURNSTILE_SECRET n’est pas configuré.");
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch(env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw httpError(403, "La vérification anti-robot a échoué. Réessayez.");
}

async function rateLimit(env, key, max) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "INSERT INTO rate (key, count, day) VALUES (?, 1, ?) " +
    "ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate.day = excluded.day THEN rate.count + 1 ELSE 1 END, day = excluded.day " +
    "RETURNING count"
  ).bind(key, day).first();
  if (row && row.count > max) throw httpError(429, "Trop de tentatives aujourd’hui. Réessayez demain.");
}

/* Sel secret propre à cette installation, créé au premier besoin et gardé dans la base. */
let saltCache = null;
async function secretSalt(env) {
  if (saltCache) return saltCache;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('salt', ?)").bind(randomToken(32)).run();
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'salt'").first();
  saltCache = row.value;
  return saltCache;
}

async function hash(env, text) { return sha256((await secretSalt(env)) + ":" + text); }

/* L'adresse IP n'est jamais enregistrée en clair : seulement son empreinte. */
async function clientIp(request, env) {
  return hash(env, "ip:" + (request.headers.get("CF-Connecting-IP") || "local"));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(buf);
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS }, key, 256
  );
  return toHex(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomToken(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
