# dptmusic.fr — Site officiel de DPT

Site vitrine statique (HTML, CSS, JavaScript, sans framework), hébergé sur **GitHub Pages** avec le domaine **https://dptmusic.fr**.

Toutes les modifications courantes (ajouter un morceau, changer un lien, mettre l’e-mail) se font dans **deux fichiers de données**, sans toucher au HTML :

| Fichier | Rôle |
| --- | --- |
| `assets/data/tracks.json` | La liste des morceaux (page Musique et « Dernières sorties ») |
| `assets/data/site.json` | Slogan, textes « À propos » et mentions légales, photo officielle et logo, lien « Écouter », e-mail, formulaire, réseaux sociaux |

> Astuce : sur GitHub, ouvrez le fichier, cliquez sur l’icône crayon (✏️ *Edit this file*), faites la modification puis cliquez sur **Commit changes**. Le site se met à jour tout seul en 1 à 2 minutes.

---

## Structure

```text
dptmusic.fr/
├── index.html              Accueil
├── music.html              Discographie (générée depuis tracks.json)
├── about.html              À propos (textes saisis dans l’admin)
├── contact.html            Contact
├── mentions-legales.html   Mentions légales (textes saisis dans l’admin)
├── 404.html                Page « introuvable »
├── admin/                  Espace admin (gestion des sorties et des liens)
├── assets/
│   ├── css/style.css       Styles (couleurs en haut du fichier)
│   ├── js/main.js          Script (pas besoin d’y toucher)
│   ├── img/
│   │   ├── logo.png        Logo (remplaçable depuis /admin/, onglet « Images »)
│   │   ├── artist.jpg      Photo officielle (remplaçable depuis /admin/ ; sert aussi d’image de partage)
│   │   ├── favicon.svg, favicon-32.png, apple-touch-icon.png
│   │   └── covers/         Pochettes des morceaux
│   └── data/
│       ├── tracks.json     Morceaux
│       └── site.json       Paramètres du site
├── CNAME                   Domaine personnalisé (dptmusic.fr)
├── .nojekyll               Indique à GitHub Pages de servir les fichiers tels quels
├── robots.txt
├── sitemap.xml
└── README.md
```

---

## Espace admin : gérer les sorties sans toucher au code

Une interface d’administration est disponible à l’adresse **https://dptmusic.fr/admin/** (une fois le site publié). Elle permet de :

- **ajouter une nouvelle sortie** (titre, type, date, lien d’écoute, liens Spotify / Apple Music / YouTube / Deezer, pochette) ;
- **modifier** ou **supprimer** une sortie ;
- **changer l’ordre** des sorties (flèches ↑ ↓) ;
- écrire les **textes du site** : slogan, page « À propos » (accroche, biographie, univers musical, influences, citation) et **mentions légales** (éditeur, responsable de publication, données personnelles) — onglet « Textes du site » ;
- changer la **photo officielle** et le **logo** — onglet « Images » ;
- modifier le lien **Écouter**, l’**e-mail**, **Formspree** et les **réseaux sociaux** (onglet « Liens et contact »).

Dans les textes, une **ligne vide sépare deux paragraphes**, et un champ laissé vide masque le bloc correspondant sur le site.

La pochette envoyée est automatiquement recadrée en carré, redimensionnée en 800 × 800 px et compressée. Chaque enregistrement crée une modification (commit) dans le dépôt GitHub, et le site se met à jour tout seul en 1 à 2 minutes.

### Première connexion : créer un jeton GitHub (une seule fois)

L’admin utilise un « jeton d’accès personnel » GitHub, limité à ce seul dépôt :

1. Connecté à GitHub, ouvrez https://github.com/settings/personal-access-tokens/new
2. **Token name** : `Admin site DPT` ; **Expiration** : par exemple 1 an.
3. **Repository access** : *Only select repositories* → `michben/dptmusic.fr`.
4. **Permissions** → **Repository permissions** → **Contents** : *Read and write*.
5. **Generate token**, copiez le jeton (`github_pat_…`) et collez-le sur la page `/admin/`.

Le jeton est gardé uniquement dans votre navigateur (case « Rester connecté »). Ne le partagez pas ; s’il est perdu ou compromis, supprimez-le sur https://github.com/settings/personal-access-tokens et créez-en un nouveau. La page admin n’est pas référencée par les moteurs de recherche (`robots.txt` et `noindex`) et ne fonctionne pas sans jeton.

## Importer une sortie depuis un lien ditto.fm (le plus simple)

Dans l’admin (`/admin/`), collez le lien ditto.fm de la sortie (ex. `https://ditto.fm/plus-de-deception`) dans **Importer depuis ditto.fm**, puis cliquez sur **Importer**. En 30 secondes environ, la sortie apparaît en haut de la liste avec :

- le **titre** et la **pochette** de la page ditto.fm (enregistrée dans `assets/img/covers/`) ;
- les **liens des plateformes** trouvés sur la page : Spotify, Apple Music, YouTube, YouTube Music, Deezer, SoundCloud, Tidal, Amazon Music (et d’autres comme Anghami, gardés dans les données) ;
- le lien ditto.fm comme bouton **Écouter**.

Rien n’est inventé : ce qui n’est pas sur la page reste vide. Le type est mis à `Single` par défaut et la date reste vide si ditto.fm ne l’affiche pas : corrigez-les avec **Modifier** si besoin. Réimporter un lien déjà présent met la sortie à jour (utile quand de nouvelles plateformes s’ajoutent après la sortie).

Comment ça marche : un navigateur n’a pas le droit de lire ditto.fm, donc l’admin dépose le lien dans `import/demande.json` et une GitHub Action (`.github/workflows/import-ditto.yml`, script `scripts/import-ditto.mjs`) lit la page et publie le résultat. On peut aussi la lancer depuis GitHub : onglet **Actions** → **Importer un lien ditto.fm** → **Run workflow**. Le compte rendu du dernier import est dans `import/resultat.json`.

## Ajouter un nouveau morceau à la main

L’espace admin ci-dessus est la méthode la plus simple. Pour le faire directement dans les fichiers :


1. **Pochette** : ajoutez l’image dans `assets/img/covers/`, par exemple `assets/img/covers/mon-titre.jpg`.
   - Format carré, idéalement **800 × 800 px**, en JPG, **moins de 150 Ko** (voir « Optimiser les images » plus bas).
2. **Données** : ouvrez `assets/data/tracks.json` et ajoutez un bloc **en haut de la liste** (les morceaux en haut apparaissent en premier et dans « Dernières sorties » sur l’accueil) :

```json
[
  {
    "id": "mon-titre",
    "title": "Mon titre",
    "artist": "DPT",
    "releaseDate": "2026-11-15",
    "type": "Single",
    "cover": "assets/img/covers/mon-titre.jpg",
    "mainLink": "https://ditto.fm/...",
    "platforms": {
      "spotify": "",
      "appleMusic": "",
      "youtube": "",
      "youtubeMusic": "",
      "deezer": "",
      "soundcloud": "",
      "tidal": "",
      "amazonMusic": ""
    }
  },
  {
    "id": "dpt-dpt",
    ...le morceau existant...
  }
]
```

Règles à respecter :

- Chaque bloc `{ ... }` est séparé du suivant par une **virgule**. Pas de virgule après le dernier bloc.
- Les textes sont **entre guillemets droits** `"..."`.
- `id` : un identifiant unique, en minuscules et sans espace (ex. `mon-titre`).
- `releaseDate` : `AAAA-MM-JJ` ou seulement `AAAA`. Laissez `""` si inconnue : l’année ne s’affiche pas.
  **Une date complète encore à venir** (ex. `2026-12-01`) fait passer la sortie en « À venir » : elle s’affiche dans la section « Prochaines sorties » de l’accueil, en haut de la page Musique, avec un **compte à rebours** qui se met à jour chaque seconde. Dès que la date est passée, la sortie bascule automatiquement en « En écoute ». Rien n’est deviné : sans date complète, la sortie est considérée comme déjà disponible.
- `type` : `Single`, `EP`, `Album` ou `Featuring` (c’est ce qui alimente les filtres de la page Musique).
- `cover` : chemin de la pochette. Laissez `""` pour afficher une pochette neutre.
- `mainLink` : le lien du bouton **Écouter** (ex. lien Ditto).
- `platforms` : liens directs. **Un lien vide `""` = le bouton n’apparaît pas.**

Pour vérifier qu’il n’y a pas d’erreur de syntaxe, collez le contenu du fichier sur https://jsonlint.com.

## Modifier les liens, l’e-mail et le slogan

Ouvrez `assets/data/site.json` :

```json
{
  "tagline": "Le slogan affiché sous DPT sur l'accueil",
  "listenLink": "https://ditto.fm/dpt-dpt",
  "email": "contact@exemple.fr",
  "formspreeId": "",
  "socials": {
    "spotify": "https://open.spotify.com/artist/...",
    "appleMusic": "",
    "youtube": "",
    "deezer": "",
    "instagram": "",
    "tiktok": "",
    "x": "",
    "facebook": ""
  }
}
```

- `tagline` : phrase d’accroche de l’accueil (masquée si vide).
- `listenLink` : lien de **tous** les boutons « Écouter » / « Écouter la musique » du site.
- `email` : adresse affichée sur la page Contact (un message d’attente s’affiche si vide).
- `socials` : liens vers les profils. Les liens vides ne sont pas affichés.

### Activer le formulaire de contact (Formspree, gratuit)

1. Créez un compte sur https://formspree.io et un nouveau formulaire.
2. Formspree donne une adresse du type `https://formspree.io/f/xyzabcd` : copiez seulement la fin (`xyzabcd`).
3. Collez-la dans `site.json` : `"formspreeId": "xyzabcd"`.

Le formulaire apparaît alors sur la page Contact et les messages arrivent dans votre boîte mail.

## Contenus à compléter

Le plus simple est de tout saisir depuis l’espace admin (`/admin/`). Les textes et les images sont enregistrés dans `assets/data/site.json` : un champ vide masque simplement le bloc sur le site.

| Contenu | Où |
| --- | --- |
| Biographie courte, biographie longue, univers musical, influences, citation | `/admin/` onglet « Textes du site » (ou `assets/data/site.json`, clé `about`) |
| Photo officielle | `/admin/` onglet « Images » (ou remplacer `assets/img/artist.jpg`, carré 1200 × 1200 px) |
| Logo | `/admin/` onglet « Images » (ou remplacer `assets/img/logo.png`, PNG transparent) |
| Favicon | remplacer `assets/img/favicon.svg`, `favicon-32.png` et `apple-touch-icon.png` (180 × 180) |
| Pochettes | `assets/img/covers/` (la pochette actuelle de « DPT » est provisoire) |
| Morceaux | `assets/data/tracks.json` |
| Liens Spotify, Apple Music, YouTube, Deezer, Instagram, TikTok… | `assets/data/site.json` et `tracks.json` |
| E-mail de contact | `assets/data/site.json` |
| Mentions légales | `/admin/` onglet « Textes du site » (ou `assets/data/site.json`, clé `legal`) |

Gardez les **mêmes noms de fichiers** pour les images : il suffit alors de remplacer le fichier, sans rien modifier ailleurs.

### Optimiser les images

Avant d’ajouter une image, compressez-la avec https://squoosh.app (gratuit, dans le navigateur) : choisissez **MozJPEG**, qualité **75 à 80**, et redimensionnez à la taille conseillée. Une page légère se charge vite sur mobile.

### Changer les couleurs

Les couleurs sont regroupées en haut de `assets/css/style.css` (bloc `:root`). Par exemple, `--accent: #ff4d2e;` est la couleur vive des boutons.

---

## Tester le site sur son ordinateur

Le site charge ses données avec JavaScript : ouvrir `index.html` en double-cliquant ne suffit pas (les morceaux ne s’affichent pas). Lancez un petit serveur depuis le dossier du site :

```bash
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000.

---

## Publier sur GitHub Pages

1. Sur GitHub, ouvrez le dépôt **michben/dptmusic.fr** → **Settings** → **Pages**.
2. Dans **Build and deployment** :
   - **Source** : `Deploy from a branch`
   - **Branch** : `main` et dossier `/ (root)`, puis **Save**.
3. Attendez 1 à 2 minutes : le site est publié. L’onglet **Actions** du dépôt montre l’avancement.

Chaque modification enregistrée (commit) sur la branche `main` met le site à jour automatiquement.

## Connecter le domaine dptmusic.fr

Le fichier `CNAME` (qui contient `dptmusic.fr`) est déjà dans le dépôt. Il reste deux étapes.

### 1. Côté GitHub

1. **Settings** → **Pages** → **Custom domain** : saisissez `dptmusic.fr` puis **Save**.
2. Une fois la vérification DNS réussie (voir ci-dessous), cochez **Enforce HTTPS**. Le certificat peut mettre jusqu’à 24 h à être créé ; la case est grisée en attendant.

Recommandé : vérifiez aussi le domaine pour votre compte (photo de profil → **Settings** → **Pages** → **Add a domain**). Cela empêche quelqu’un d’autre de l’utiliser sur GitHub Pages.

### 2. Chez le registraire du domaine (OVH, Gandi, IONOS, o2switch…)

Dans la **zone DNS** de `dptmusic.fr`, supprimez les anciens enregistrements `A`, `AAAA` et `CNAME` du domaine nu (`@`) et de `www` qui pointent vers un autre hébergeur (par exemple une page de parking), puis ajoutez :

| Type | Nom / Sous-domaine | Valeur |
| --- | --- | --- |
| A | `@` (vide) | `185.199.108.153` |
| A | `@` (vide) | `185.199.109.153` |
| A | `@` (vide) | `185.199.110.153` |
| A | `@` (vide) | `185.199.111.153` |
| AAAA | `@` (vide) | `2606:50c0:8000::153` |
| AAAA | `@` (vide) | `2606:50c0:8001::153` |
| AAAA | `@` (vide) | `2606:50c0:8002::153` |
| AAAA | `@` (vide) | `2606:50c0:8003::153` |
| CNAME | `www` | `michben.github.io.` |

Les adresses IP ci-dessus sont celles de GitHub Pages ; vérifiez-les si besoin sur la documentation officielle :
https://docs.github.com/fr/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

Avec le `CNAME` sur `www`, l’adresse `www.dptmusic.fr` redirige automatiquement vers `dptmusic.fr`.

La propagation DNS prend de quelques minutes à 48 h. Pour vérifier :

```bash
dig dptmusic.fr +noall +answer
dig www.dptmusic.fr +noall +answer
```

Ou en ligne : https://dnschecker.org.

### En cas de problème

- **« Domain's DNS record could not be retrieved »** : les DNS ne sont pas encore propagés, patientez puis cliquez sur **Check again**.
- **« Enforce HTTPS » grisé** : normal pendant la création du certificat (jusqu’à 24 h).
- **Le domaine disparaît des réglages** : vérifiez que le fichier `CNAME` est toujours présent à la racine du dépôt.
- **Les morceaux ne s’affichent pas** : erreur de syntaxe dans `tracks.json` (virgule manquante ou en trop). Vérifiez-le sur https://jsonlint.com.

---

## Référencement (SEO)

- Chaque page a son titre, sa description et les balises de partage (Open Graph / X). L’image de partage est `assets/img/artist.jpg`.
- `sitemap.xml` liste les pages. Si vous ajoutez une page, ajoutez-la aussi au sitemap.
- Après la mise en ligne, déclarez le site sur https://search.google.com/search-console et soumettez `https://dptmusic.fr/sitemap.xml`.
