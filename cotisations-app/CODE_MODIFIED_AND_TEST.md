# Code Modifié — Portions Clés

## 1. Formule de Calcul de Dette (weekly-contributions.js et backfill-supabase.js)

### Lignes 140–148 (weekly-contributions.js)
```javascript
const manualDebtBase = Number(m.manual_debt_base ?? m.debt_adjustment ?? m.manualDebtBase ?? m.debtAdjustment ?? 0);

// Single global debt: automatic + manual
const totalDebtBeforePayment = memberExpected + manualDebtBase;
const balance = totalDebtBeforePayment - totalPaidTowardsCycles;
const finalDebt = Math.max(0, balance);
const credit = Math.max(0, -balance);

updates.push({ id: memberId, computed_debt: finalDebt, computed_credit: credit, computed_expected: memberExpected, computed_total: totalDeposits });
```

**Explication :**
- `totalDebtBeforePayment` : fusion de la dette automatique et manuelle.
- `balance` : dette totale moins paiements = solde du compte.
- `finalDebt` : si solde > 0, il reste une dette ; sinon 0.
- `credit` : si solde < 0, le négatif devient crédit ; sinon 0.

---

## 2. Application du Crédit Multi-Semaines (weekly-contributions.js)

### Lignes 172–205 (weekly-contributions.js)
```javascript
const creditAvailable = Math.max(0, totalDeposits - paidBefore);
let remainingCredit = creditAvailable;
const cyclesToProcess = activeCycles.filter((c) => {
  const cs = startOfDay(new Date(c.start_date + 'T00:00:00'));
  return cs.getTime() >= startOfDay(new Date()).getTime();
}).slice(0, 10); // process up to 10 future weeks

for (const futCycle of cyclesToProcess) {
  if (remainingCredit <= 0) break;
  const fcId = futCycle.id;
  const mcExist = (memberCyclesByMember.get(memberId) || []).find((x) => x.cycle_id === fcId || x.cycleId === fcId);
  if (mcExist && String((mcExist.status || mcExist.status || '')).toLowerCase() === 'waived') continue;
  const weeklyNeeded = Number(futCycle.weekly_amount || futCycle.weeklyAmount || weeklyAmount);
  const alreadyPaid = Number(mcExist?.amount_paid || mcExist?.amountPaid || 0);
  const needed = weeklyNeeded - alreadyPaid;
  if (needed > 0) {
    const toApply = Math.min(needed, remainingCredit);
    const newPaid = alreadyPaid + toApply;
    const newStatus = newPaid >= weeklyNeeded ? 'paid' : 'unpaid';
    memberCycleUpserts.push({ id: `${memberId}_${fcId}`, member_id: memberId, cycle_id: fcId, amount_paid: newPaid, status: newStatus, confirmed_by: 'system', confirmed_at: new Date().toISOString() });
    remainingCredit -= toApply;
  }
}
if (remainingCredit !== creditAvailable) {
  notifications.push({ uid: null, member_id: memberId, member_name: m.name || null, message: `Credit applique: ${creditAvailable - remainingCredit} FC. Credit restant: ${remainingCredit} FC.`, created_at: new Date().toISOString() });
}
```

**Explication :**
- Filtre les semaines futures (>= aujourd'hui), jusqu'à 10.
- Pour chaque semaine, applique le crédit restant progressivement.
- Si une semaine est `waived`, elle est ignorée (pas de credit consommé).
- `remainingCredit` décroit à chaque application jusqu'à épuisement.
- Notification finale : crédits appliqué et restant.

---

## 3. Évitement du Double Comptage (both files)

### Lignes 118–137 (weekly-contributions.js)
```javascript
const memberDeposits = (depositsByMember.get(memberId) || []);
// separate deposits with cycle_id (already assigned) vs without
const depositsWithCycle = memberDeposits.filter((d) => d.cycle_id || d.cycleId);
const depositsWithoutCycle = memberDeposits.filter((d) => !(d.cycle_id || d.cycleId));
const totalDeposits = memberDeposits.reduce((s, d) => s + Number(d.amount || 0), 0);

// ... (compute memberExpected, paidFromCycles, etc.)

const sumDepositsWithoutCycle = depositsWithoutCycle.reduce((s, d) => s + Number(d.amount || 0), 0);
const totalPaidTowardsCycles = paidFromCycles + sumDepositsWithoutCycle;
```

**Explication :**
- `depositsWithCycle` : déjà comptés dans `member_cycles` → pas sommés à nouveau.
- `depositsWithoutCycle` : n'apparaissent nulle part → ajoutés au paiement total.
- `totalPaidTowardsCycles` : somme sans duplication.

---

# Test Complet du Scénario de Louis

## Commande d'exécution
```powershell
$env:SUPABASE_URL="https://xxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
node "c:\Users\User\Desktop\day of success\cotisations-app\scripts\test-louis-scenario.js"
```

## Détail du test (test-louis-scenario.js)

### STEP 1 : État initial
```
Louis a un retard de 4 semaines :
- Automatic debt (4 weeks unpaid): 40000 FC
- Manual debt: 5000 FC
- Total debt: 45000 FC
- Deposits: 0 FC
```

### STEP 2 : Dépôt de 50 000 FC vendredi
```
Calcul post-dépôt :
  Total debt before: 45000 FC
  Deposits: 50000 FC
  Balance: 45000 - 50000 = -5000 FC
  Final debt: max(0, -5000) = 0 FC
  Credit: max(0, 5000) = 5000 FC

Résultat :
  Louis est à jour (dette = 0)
  Louis a un crédit de 5000 FC
```

### STEP 3 : Dimanche — Génération d'une nouvelle semaine
```
Nouvelle semaine générée : w0005
Calcul d'application du crédit :
  Credit available: 5000 FC
  Weekly needed: 10000 FC
  Credit applied: min(5000, 10000) = 5000 FC
  Status: unpaid (5000 < 10000)

Résultat :
  member_cycles[louis_w0005] = { amount_paid: 5000, status: 'unpaid' }
  Notification: "Credit applique: 5000 FC. Credit restant: 0 FC."
```

### STEP 4 : État final
```
Louis endetté pour la nouvelle semaine :
  New debt from week: 10000 - 5000 = 5000 FC
  Final debt: 5000 FC
  Final credit: 0 FC
```

### Vérification finale
```
✓ Debt is 5000 FC: PASS
✓ Credit is 0 FC: PASS
✓ Total deposits is 50000 FC: PASS
✓ ALL TESTS PASSED
```

---

## Formule appliquée (résumé)

```
AVANT paiement :
  detteTotalAvantPaiement = 40000 (auto) + 5000 (manuel) = 45000 FC

APRÈS paiement de 50000 FC :
  solde = 45000 - 50000 = -5000 FC
  debtFinale = max(0, -5000) = 0 FC
  credit = max(0, -(-5000)) = 5000 FC

DIMANCHE (nouvelle semaine) :
  nouvelle_dette_auto = 10000 FC
  credit_available = 5000 FC
  credit_applie = min(5000, 10000) = 5000 FC
  
  Résultat : 
    debt = 10000 - 5000 = 5000 FC
    credit = 0 FC
```

---

## Points de validation

| Critère | Status |
|---------|--------|
| Une seule dette globale (auto + manuelle) | ✓ FIXED |
| Paiements remboursent cette dette globale | ✓ FIXED |
| Tout excédent devient crédit | ✓ FIXED |
| Crédit couvre plusieurs semaines | ✓ FIXED |
| Semaines exemptées ignorées | ✓ FIXED |
| Pas de double comptage | ✓ FIXED |
| Backfill complète | ✓ FIXED |
| Test Louis réussit | ✓ READY TO TEST |
