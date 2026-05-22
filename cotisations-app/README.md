# Day of Succes - Cotisations

Application web de gestion des cotisations hebdomadaires, migree vers Supabase pour eviter Firebase Blaze.

## Stack

- `public/` : application web statique
- Supabase Auth : connexion email / mot de passe
- Supabase Postgres : membres, depots, cycles, dettes, notifications
- Netlify : hebergement gratuit du site statique

## Configuration Supabase

1. Cree un projet sur Supabase.
2. Ouvre `SQL Editor`.
3. Execute `supabase/schema.sql`.
4. Dans Supabase, va dans `Project Settings > API`.
5. Copie `Project URL` et `anon public key`.
6. Remplis `public/config.js`.

```js
export const SUPABASE_URL = "https://TON-PROJET.supabase.co";
export const SUPABASE_ANON_KEY = "TA_CLE_ANON_PUBLIC";
```

## Premier demarrage sans anciennes donnees

1. Dans Supabase, execute `supabase/schema.sql` dans le `SQL Editor`.
2. Va dans `Authentication > Users`, puis cree ton compte admin.
3. Copie l'ID du compte admin.
4. Dans `SQL Editor`, cree le profil admin :

```sql
insert into public.profiles (id, email, name, role)
values ('ID_DU_COMPTE_ADMIN', 'ton-email@example.com', 'Dave', 'admin');
```

Si l'admin cotise aussi, cree aussi son membre et lie `member_id` :

```sql
insert into public.members (id, name)
values ('dave', 'Dave');

update public.profiles
set member_id = 'dave'
where id = 'ID_DU_COMPTE_ADMIN';
```

5. Cree les membres :

```sql
insert into public.members (id, name) values
  ('nathan', 'Nathan'),
  ('corince', 'Corince'),
  ('louis', 'Louis'),
  ('mechack', 'Mechack'),
  ('monica', 'Monica'),
  ('jeno', 'Jeno');
```

6. Pour chaque membre, cree un utilisateur dans `Authentication > Users`, puis lie-le avec `profiles` :

```sql
insert into public.profiles (id, email, name, role, member_id)
values ('ID_DU_COMPTE_MEMBRE', 'membre@example.com', 'Nathan', 'member', 'nathan');
```

7. Configure le depart des cotisations :

```sql
update public.settings
set start_date = '2026-05-01', weekly_amount = 10000
where id = 'main';
```

## Migration des donnees Firebase

Les donnees peuvent etre exportees depuis Firebase puis importees dans Supabase. Les mots de passe Firebase ne sont pas recuperables : les comptes Supabase seront crees avec un mot de passe temporaire.

### 1. Exporter Firebase

Depuis ce dossier :

```powershell
node scripts/export-firebase-data.js
```

Le script cree `firebase-export.json`.

Si Firebase repond `invalid_grant`, genere une nouvelle cle dans `Firebase > Parametres du projet > Comptes de service > Generer une nouvelle cle privee`, puis lance :

```powershell
$env:FIREBASE_SERVICE_ACCOUNT="C:\chemin\vers\nouvelle-cle.json"
node scripts/export-firebase-data.js
```

### 2. Importer dans Supabase

Recupere la cle `service_role` dans Supabase (`Project Settings > API`). Ne la mets jamais dans `public/config.js`.

```powershell
$env:SUPABASE_URL="https://TON-PROJET.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="TA_CLE_SERVICE_ROLE"
$env:DEFAULT_PASSWORD="ChangeMoi2026!"
node scripts/import-supabase-data.js
```

Chaque utilisateur importe pourra se connecter avec `DEFAULT_PASSWORD`, puis changer son mot de passe.

## Lancer localement

Le site est statique. Tu peux ouvrir `public/index.html`, ou lancer un petit serveur local :

```powershell
npx serve public
```

## Deployer gratuitement sur Netlify

1. Cree un compte sur Netlify.
2. Ajoute le dossier/projet.
3. Configure le dossier de publication sur `public`.
4. Deploie.

Le fichier `netlify.toml` est deja pret.

## Tables principales

- `profiles` : roles admin/membre et lien vers membre
- `members` : membres du groupe
- `settings` : date de debut et montant hebdomadaire
- `deposits` : depots payes
- `weekly_cycles` : semaines de cotisation
- `member_cycles` : statut par membre et par semaine
- `debt_adjustments` : modifications manuelles des dettes
- `notifications` : messages visibles par les membres
- `public_stats` : stats globales du groupe
