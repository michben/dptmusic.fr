// Met en ligne le service des votes sur Cloudflare (lancé par la GitHub Action
// .github/workflows/deploy-votes.yml). Tout est automatique et peut être relancé
// sans risque : ce qui existe déjà est réutilisé, rien n'est effacé.
//
// 1. crée (ou retrouve) le captcha Turnstile du site ;
// 2. crée (ou retrouve) la base de données D1 « dpt-votes » et ses tables ;
// 3. déploie le Worker « dpt-votes » avec la clé secrète du captcha ;
// 4. écrit l'adresse du service et la clé publique du captcha dans
//    assets/data/site.json (rubrique "votes"), pour que le site les utilise.
//
// Variables d'environnement : CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const WRANGLER = "wrangler@4.150.0";
const WORKER = "dpt-votes";
const DATABASE = "dpt-votes";
const WIDGET = "dptmusic.fr";
const DOMAINS = ["dptmusic.fr", "www.dptmusic.fr", "localhost"];
const SITE_JSON = "assets/data/site.json";

if (!TOKEN || !ACCOUNT) {
  console.error("Il manque les secrets CLOUDFLARE_API_TOKEN et/ou CLOUDFLARE_ACCOUNT_ID dans GitHub (Settings → Secrets and variables → Actions). Voir README.md, rubrique « Votes ».");
  process.exit(1);
}

async function cf(path, options = {}) {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT + path, {
    method: options.method || "GET",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    if (options.allow404 && res.status === 404) return null;
    const msg = (data.errors || []).map((e) => e.code + " " + e.message).join(" ; ") || res.status;
    throw new Error("Cloudflare " + (options.method || "GET") + " " + path + " : " + msg +
      (res.status === 403 ? " (le jeton Cloudflare n’a pas toutes les permissions : voir README.md)" : ""));
  }
  return data.result;
}

function wrangler(args, input) {
  return execFileSync("npx", ["--yes", WRANGLER, ...args], {
    cwd: "worker",
    input,
    encoding: "utf8",
    stdio: [input ? "pipe" : "ignore", "pipe", "inherit"],
    env: process.env
  });
}

// 1. Captcha Turnstile
const widgets = await cf("/challenges/widgets?per_page=50");
let widget = (widgets || []).find((w) => w.name === WIDGET);
if (!widget) {
  console.log("Création du captcha Turnstile…");
  widget = await cf("/challenges/widgets", { method: "POST", body: { name: WIDGET, domains: DOMAINS, mode: "managed" } });
}
if (!widget.secret) widget = await cf("/challenges/widgets/" + widget.sitekey);
console.log("Captcha Turnstile : " + widget.sitekey);

// 2. Base de données D1
const dbs = await cf("/d1/database?name=" + DATABASE);
let db = (dbs || []).find((d) => d.name === DATABASE);
if (!db) {
  console.log("Création de la base de données…");
  db = await cf("/d1/database", { method: "POST", body: { name: DATABASE } });
}
const dbId = db.uuid;
console.log("Base D1 : " + dbId);

const tomlPath = "worker/wrangler.toml";
writeFileSync(tomlPath, readFileSync(tomlPath, "utf8").replace(/database_id = "[^"]*"/, 'database_id = "' + dbId + '"'));
wrangler(["d1", "execute", DATABASE, "--remote", "--file=schema.sql", "--yes"]);
console.log("Tables de la base à jour.");

// 3. Adresse workers.dev du compte (choisie automatiquement si le compte n'en a pas encore)
let sub = await cf("/workers/subdomain", { allow404: true }).catch(() => null);
if (!sub || !sub.subdomain) {
  const wanted = "dptmusic-" + Math.random().toString(36).slice(2, 7);
  console.log("Création de l’adresse " + wanted + ".workers.dev…");
  sub = await cf("/workers/subdomain", { method: "PUT", body: { subdomain: wanted } });
}

console.log("Déploiement du service…");
wrangler(["deploy"]);
wrangler(["secret", "put", "TURNSTILE_SECRET"], widget.secret);

const api = "https://" + WORKER + "." + sub.subdomain + ".workers.dev";
console.log("Service des votes en ligne : " + api);

// 4. Réglages du site
const site = JSON.parse(readFileSync(SITE_JSON, "utf8"));
const before = JSON.stringify(site.votes || {});
site.votes = Object.assign({}, site.votes, { api, turnstileSiteKey: widget.sitekey });
if (JSON.stringify(site.votes) !== before) {
  writeFileSync(SITE_JSON, JSON.stringify(site, null, 2) + "\n");
  console.log("assets/data/site.json mis à jour.");
}
