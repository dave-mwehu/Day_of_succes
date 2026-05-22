# Corrections Supabase/Netlify — Gestion des Dettes et Crédits

## Modifications apportées

### 1. Formule de calcul de dette (CRITIQUE)
**Ancien code (incorrect) :**
```js
const autoDebt = Math.max(0, memberExpected - totalPaidTowardsCycles);
const finalDebt = Math.max(0, autoDebt + manualDebtBase);
const credit = Math.max(0, totalPaidTowardsCycles - memberExpected);
```

**Nouveau code (correct) :**
```js
const totalDebtBeforePayment = memberExpected + manualDebtBase;
const balance = totalDebtBeforePayment - totalPaidTowardsCycles;
const finalDebt = Math.max(0, balance);
const credit = Math.max(0, -balance);
```

**Effet :** Les paiements remboursent maintenant une seule dette globale (automatique + manuelle fusionnées).

### 2. Crédit multi-semaines
**Ancien code :** Le crédit n'était appliqué que à la semaine courante.

**Nouveau code :** Le crédit peut couvrir automatiquement jusqu'à 10 semaines futures non exemptées.
- Exemple : 40 000 FC de crédit = 4 semaines complètes de 10 000 FC couverts.
- Chaque semaine future (y compris les semaines non encore générées) consomme le crédit progressivement.

### 3. Évitement du double comptage
**Logique appliquée :**
- `depositsWithCycle` : dépôts déjà assignés à une semaine dans `member_cycles`.
- `depositsWithoutCycle` : dépôts non assignés (comptés comme contributions au crédit).
- `totalPaidTowardsCycles = paidFromCycles + depositsWithoutCycle` : total sans double comptage.

### 4. Backfill amélioré
- Crée/assure tous les `weekly_cycles` manquants (pas de semaine sautée).
- Crée tous les `member_cycles` manquants pour chaque membre et cycle.
- Recalcule `computed_debt`, `computed_credit`, `computed_expected` avec la nouvelle formule.

## Fichiers

- **`netlify/functions/weekly-contributions.js`** — Netlify Scheduled Function (s'exécute chaque dimanche).
- **`scripts/backfill-supabase.js`** — Script de rétro-calcul (exécution locale).
- **`scripts/test-louis-scenario.js`** — Test complet du scénario de Louis (validation).

## Exécution

### Prérequis
Définir les variables d'environnement :
```powershell
$env:SUPABASE_URL="https://xxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

### 1. Rétro-calcul (backfill)
```powershell
cd "c:\Users\User\Desktop\day of success\cotisations-app"
node .\scripts\backfill-supabase.js
```

### 2. Test du scénario de Louis
```powershell
cd "c:\Users\User\Desktop\day of success\cotisations-app"
node .\scripts\test-louis-scenario.js
```

**Résultat attendu :**
```
=== STEP 1: Initial State ===
Automatic debt (4 weeks unpaid): 40000 FC
Manual debt: 5000 FC
Total debt: 45000 FC

=== STEP 2: Deposit 50,000 FC on Friday ===
Final debt: 0 FC
Credit: 5000 FC

=== STEP 3: Sunday — New Week Generated ===
Credit available: 5000 FC
Weekly needed: 10000 FC
Credit applied: 5000 FC
Status: unpaid

=== STEP 4: Final State ===
Final debt: 5000 FC
Final credit: 0 FC

✓ ALL TESTS PASSED
```

### 3. Déploiement sur Netlify
```bash
git add netlify/functions/weekly-contributions.js
git commit -m "Deploy weekly contributions function"
git push
```

Puis configurer le **Scheduled Function** dans Netlify UI :
- **Function:** `weekly-contributions`
- **Schedule:** `0 8 * * 0` (dimanche 8h, timezone Africa/Lubumbashi)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Formule obligatoire appliquée

```
detteTotalAvantPaiement = detteAutomatique + detteManuelle
solde = detteTotalAvantPaiement - paiements
detteFinale = max(0, solde)
credit = max(0, -solde)
```

## Cas de test — Louis

**Situation :**
- Dette automatique : 40 000 FC (4 semaines)
- Dette manuelle : 5 000 FC
- Dépôt vendredi : 50 000 FC

**Résultat :**
| Étape | Dette | Crédit | Statut |
|-------|-------|--------|--------|
| Avant dépôt | 45 000 | 0 | En retard |
| Après dépôt | 0 | 5 000 | À jour + crédit |
| Dimanche (nouvelle semaine) | 5 000 | 0 | En retard (5000 non couverts) |

**Explication :** Les 50 000 FC remboursent les 45 000 FC de dette, laissant 5 000 FC de crédit. Dimanche, la nouvelle semaine de 10 000 FC est générée ; le crédit de 5 000 FC la couvre partiellement, laissant une dette de 5 000 FC.

## Points clés respectés

✓ Une seule dette globale (auto + manuelle fusionnées)  
✓ Les paiements remboursent cette dette globale sans distinction  
✓ Tout excédent devient crédit automatique  
✓ Le crédit couvre automatiquement les semaines futures (multi-semaines)  
✓ Les semaines exemptées (`waived`) ne génèrent pas de dette et ne consomment pas de crédit  
✓ Aucun double comptage entre `deposits` et `member_cycles`  
✓ Aucune semaine n'est sautée  
✓ Rétro-calcul complet via backfill
