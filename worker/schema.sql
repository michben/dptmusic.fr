-- Base de données des votes (Cloudflare D1).
-- Ce fichier est appliqué automatiquement par la GitHub Action « Déployer les votes ».
-- Il ne crée que ce qui manque : on peut le relancer sans rien perdre.

-- Pouces vers le haut / vers le bas sur les morceaux (sans inscription).
CREATE TABLE IF NOT EXISTS likes (
  track_id   TEXT    NOT NULL,
  voter      TEXT    NOT NULL,  -- identifiant aléatoire du navigateur (haché)
  ip         TEXT    NOT NULL,  -- adresse IP hachée (jamais stockée en clair)
  value      INTEGER NOT NULL,  -- 1 = pouce haut, -1 = pouce bas
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (track_id, voter)
);
CREATE INDEX IF NOT EXISTS likes_ip ON likes (track_id, ip);

-- Comptes du public pour voter aux duels de versions.
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo     TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  pass_hash  TEXT    NOT NULL,
  pass_salt  TEXT    NOT NULL,
  ip         TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Votes des duels : un vote par compte et par duel (modifiable jusqu'à la fin).
CREATE TABLE IF NOT EXISTS duel_votes (
  duel_id    TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  version    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (duel_id, user_id)
);

-- Limites anti-abus (nombre d'actions par adresse IP et par jour).
CREATE TABLE IF NOT EXISTS rate (
  key   TEXT    PRIMARY KEY,
  count INTEGER NOT NULL,
  day   TEXT    NOT NULL
);
