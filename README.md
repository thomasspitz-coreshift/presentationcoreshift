# Présentations Coreshift

Un moteur pour produire des présentations animées aux couleurs de Coreshift, dans l'esprit des sites « scroll-driven » (fond de rubans lumineux, titres qui se révèlent mot à mot, chiffres qui défilent, interfaces qui se construisent sous les yeux).

**Le principe : on écrit le contenu une fois, on obtient trois sorties.**

| Sortie | Fichier | Usage |
| --- | --- | --- |
| Web animé | `dist/<deck>/index.html` | présenter en rendez-vous, envoyer un lien. Fichier unique, autonome, s'ouvre hors ligne. |
| PDF léger | `dist/<deck>/<deck>.pdf` | l'envoi habituel par e-mail. Chaque slide dans son état final, texte vectoriel et sélectionnable, environ 1 Mo. |
| Vidéo MP4 | `dist/<deck>/<deck>.mp4` | LinkedIn, relance commerciale, écran de salon. Rendu image par image, donc fluide quelle que soit la machine. |

Le design, les animations et la charte vivent dans `engine/`. Une nouvelle présentation, c'est uniquement un fichier `decks/<nom>/deck.yaml`.

## Le studio (usage quotidien)

`npm run studio` construit **Coreshift Slides**, le remplaçant du PowerPoint :

- **Bibliothèque** de decks partagée avec l'équipe (publiée comme artefact claude.ai, les decks vivent dans sa base).
- **Édition directe** : on clique sur un texte de la slide et on tape. Sélectionner des mots → « Mettre en orange ». Le panneau « Contenu détaillé » (YAML) règle les listes, chiffres et courbes, l'aperçu suit en direct.
- **Gabarits** : « + Slide » ajoute l'un des 9 gabarits ; gabarit, fond clair ou sombre, animation du fond se changent dans les réglages. Annulation illimitée.
- **Présenter** : plein écran animé, flèches, clic ou swipe, `Échap` pour sortir.
- **Exporter** : PDF (sombre ou clair, une page par slide), présentation hors ligne `.html` (Fichier > Imprimer depuis Chrome donne un PDF vectoriel), contenu `.json`.
- **Claude** : génération d'un premier jet à partir d'un brief, réécriture d'une slide sur consigne.

| Fichier | Rôle |
| --- | --- |
| `dist/studio/studio.html` | page publiée comme artefact (bibliothèques chargées depuis les CDN autorisés) |
| `dist/studio/index.html` | studio autonome, hors ligne : les decks restent dans le navigateur |
| `studio/` | interface (`studio.css`) et logique (`studio.js`) du studio |

Un deck exporté en `.json` depuis le studio se place dans `decks/<nom>/deck.json` : `npm run pdf -- <nom>` et `npm run video -- <nom>` fonctionnent alors comme avec un `deck.yaml`.

## Démarrer

```bash
npm install
npx playwright install chromium   # une seule fois
npm run build              # → dist/coreshift-demo/index.html
npm run pdf                # → dist/coreshift-demo/coreshift-demo.pdf
npm run pdf -- --light     # → version claire (fond papier), pour l'impression
npm run video              # → dist/coreshift-demo/coreshift-demo.mp4 (1920×1080, 30 i/s)
npm run video -- --scale=0.5   # aperçu rapide en 960×540
npm run dev                # reconstruit à chaque modification
```

Pour une autre présentation : `npm run build -- client-dupont`, `npm run pdf -- client-dupont`, etc.

Navigation dans la version web : flèches ou espace, clic (droite = suivante, gauche = précédente), swipe sur mobile, `F` pour le plein écran. `#4` à la fin de l'URL ouvre directement la slide 4, `?autoplay&loop` enchaîne seul (écran de salon).

## Écrire une présentation

```yaml
title: Coreshift pour Menuiserie Dubreuil
slides:
  - layout: hero
    section: Introduction
    bg: hero
    eyebrow: Coreshift · Intégrateur Mistral AI
    title: L'intelligence artificielle des *TPE et PME*.
    lead: Une plateforme de gestion avec Verso…
```

- `*mot*` met un mot en orange.
- `section` s'affiche en haut à droite, avec le numéro de slide.
- `bg` choisit la pose du fond animé : `hero`, `left`, `right`, `low`, `calm`, `grid` (grille de carrés du site), `off`. Le fond glisse d'une pose à l'autre entre deux slides.
- `theme` : `dark` (défaut), `light` (fond papier) ou `accent` (fond orange).
- `duration` : durée en secondes en lecture automatique et en vidéo. Sans elle, la durée est calculée d'après les animations.
- La typographie française est gérée automatiquement : espaces fines avant `: ; ! ? €`, apostrophes courbes, pas de « à » ou « de » seul en fin de ligne.

### Gabarits disponibles

| `layout` | Contenu | Animation |
| --- | --- | --- |
| `hero` | titre, accroche, boutons, flux d'activité Verso | titre mot à mot, lignes du flux une à une |
| `chat` | une demande à Verso et sa réponse | la demande se tape, la réponse et les actions apparaissent |
| `grid` | 4 × 2 tuiles (secteurs, cas d'usage) | filets qui se tracent, tuiles en cascade |
| `cards` | 3 cartes avec visuel (`progress`, `checklist`, `twin`) | cartes et visuels qui s'animent |
| `punchline` | une citation plein écran | carte orange qui s'agrandit jusqu'au plein écran, logo qui se construit |
| `chart` | courbe (trésorerie…), seuil, point d'alerte | courbe tracée, zone à risque, bulle d'alerte |
| `kpis` | 4 chiffres clés avec visuel (`bar`, `days`, `segments`, `ring`, `spark`) | compteurs de 0 à la valeur |
| `hub` | logo au centre, 4 satellites, liste de faits | liaisons tracées, impulsions qui circulent |
| `cta` | titre de conclusion, carte orange de contact | logo, liste cochée, bouton |

`decks/coreshift-demo/deck.yaml` utilise les neuf gabarits et sert de modèle.

## Comment c'est fait

- `engine/layouts.mjs` : un gabarit = une fonction qui renvoie du HTML. Les attributs `data-a` (type d'animation), `data-d` (délai en ms) et `data-dur` décrivent l'entrée de chaque élément.
- `engine/theme.css` : la charte (`#14110e`, `#f2f1ef`, `#ff6a1f`, Geist et Geist Mono, comme sur coreshift.fr), sur une scène fixe de 1920 × 1080 mise à l'échelle de l'écran.
- `engine/runtime.js` : le lecteur. Une seule horloge pilote toutes les animations et le fond (rubans dessinés en Canvas 2D). En mode `?print` il n'anime rien et fige un fond JPEG par slide ; en mode `?capture` le script vidéo avance l'horloge image par image.
- `scripts/` : `build` (YAML → HTML autonome, polices embarquées), `pdf` et `video` (Chromium via Playwright, ffmpeg pour l'encodage).

Pré-requis : Node 20+, ffmpeg pour la vidéo, et Chromium pour Playwright à installer une fois avec `npx playwright install chromium`.

## Ajouter un gabarit

1. Écrire la fonction dans `layouts` (`engine/layouts.mjs`), en posant `data-a` / `data-d` sur les éléments à animer.
2. Ajouter ses styles dans `engine/theme.css`, sous `.layout-<nom>`.
3. Animations disponibles : `fade`, `up`, `left`, `right`, `scale`, `pop`, `words`, `count`, `type`, `draw` (tracé SVG), `grow-x`, `grow-y`, `zoom`, `pulse`.
