# Day of Succes - Cotisations

Application web pour suivre les cotisations hebdomadaires d'un groupe : membres, depots, dettes, cycles de paiement, notifications et statistiques publiques.

## Probleme

Le suivi des cotisations devient vite difficile quand les paiements, retards et ajustements sont geres dans plusieurs conversations ou fichiers. Day of Succes centralise les depots, calcule les dettes par cycle et donne une vue claire aux administrateurs comme aux membres.

## Fonctionnalites

- Authentification des administrateurs et membres.
- Gestion des profils et des roles.
- Suivi des membres du groupe.
- Configuration du montant hebdomadaire et de la date de debut.
- Enregistrement des depots.
- Generation et suivi des cycles hebdomadaires.
- Calcul des dettes par membre.
- Ajustements manuels des dettes.
- Notifications visibles par les membres.
- Statistiques publiques du groupe.
- Scripts de migration depuis Firebase vers Supabase.

## Technologies

- HTML, CSS, JavaScript
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage / API
- Firebase export scripts
- Netlify
- Node.js pour les scripts d'import/export

## Architecture

```text
cotisations-app/
|-- public/              # Application web statique
|   |-- index.html
|   |-- app.js
|   |-- styles.css
|   `-- config.example.js
|-- supabase/            # Schema SQL
|-- scripts/             # Migration Firebase -> Supabase
|-- functions/           # Fonctions et scripts historiques Firebase
|-- netlify.toml         # Configuration deploiement
`-- README.md            # Documentation detaillee
```

La version actuelle privilegie une application statique connectee a Supabase afin d'eviter une infrastructure serveur couteuse.

## Installation

1. Creer un projet Supabase.
2. Executer `cotisations-app/supabase/schema.sql` dans Supabase SQL Editor.
3. Copier `cotisations-app/public/config.example.js` vers `cotisations-app/public/config.js`.
4. Renseigner les valeurs publiques Supabase.

```js
export const SUPABASE_URL = "https://TON-PROJET.supabase.co";
export const SUPABASE_ANON_KEY = "TA_CLE_ANON_PUBLIC";
```

5. Lancer localement avec un serveur statique.

```bash
cd cotisations-app
npx serve public
```

## Deploiement

Le projet est pret pour Netlify.

```text
Base directory  : cotisations-app
Publish folder  : public
Config file     : cotisations-app/netlify.toml
```

## Migration Firebase vers Supabase

Exporter les donnees Firebase :

```powershell
cd cotisations-app
node scripts/export-firebase-data.js
```

Importer dans Supabase :

```powershell
$env:SUPABASE_URL="https://TON-PROJET.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="TA_CLE_SERVICE_ROLE"
$env:DEFAULT_PASSWORD="ChangeMoi2026!"
node scripts/import-supabase-data.js
```

## Captures d'ecran prevues

- Tableau de bord administrateur.
- Liste des membres et statut de paiement.
- Formulaire d'ajout de depot.
- Vue membre avec dette et historique.
- Ecran de notifications.
- Statistiques publiques.

## Documentation detaillee

La documentation technique historique se trouve dans [`cotisations-app/README.md`](./cotisations-app/README.md).

## Statut

Application web pragmatique orientee gestion associative. Le projet montre la migration d'une base Firebase vers une architecture Supabase/Netlify plus economique et maintenable.
