#!/usr/bin/env node
/**
 * Test complet et autonome (sans Supabase)
 * Simule la logique de calcul de dette et crédits
 * Affiche tous les calculs intermédiaires
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatCurrency(val) {
  return `${Number(val).toLocaleString('fr-FR')} FC`;
}

/**
 * Calcul de la dette et du crédit pour un membre
 */
function computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles) {
  // Formule obligatoire
  const totalDebtBeforePayment = memberExpected + manualDebtBase;
  const balance = totalDebtBeforePayment - totalPaidTowardsCycles;
  const finalDebt = Math.max(0, balance);
  const credit = Math.max(0, -balance);
  
  return { totalDebtBeforePayment, balance, finalDebt, credit };
}

/**
 * Scénario 1 : Louis (45 000 FC de dette initiale)
 */
function scenario1() {
  console.log('\n' + '='.repeat(80));
  console.log('SCÉNARIO 1 : Louis (Dette auto 40k + manuelle 5k + dépôt 50k)');
  console.log('='.repeat(80));

  const weeklyAmount = 10000;
  const weeksUnpaid = 4; // 4 semaines en retard
  
  console.log('\n--- ÉTAT INITIAL ---');
  const memberExpected = weeksUnpaid * weeklyAmount; // 40 000 FC (4 semaines de 10 000)
  const manualDebtBase = 5000; // 5 000 FC manuel
  const totalPaidTowardsCycles_before = 0; // Aucun paiement avant
  
  console.log(`✓ memberExpected (4 sem × 10k): ${formatCurrency(memberExpected)}`);
  console.log(`✓ manualDebtBase: ${formatCurrency(manualDebtBase)}`);
  console.log(`✓ totalPaidTowardsCycles: ${formatCurrency(totalPaidTowardsCycles_before)}`);
  
  let result = computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles_before);
  console.log('\n--- CALCUL AVANT PAIEMENT ---');
  console.log(`totalDebtBeforePayment = ${formatCurrency(memberExpected)} + ${formatCurrency(manualDebtBase)} = ${formatCurrency(result.totalDebtBeforePayment)}`);
  console.log(`balance = ${formatCurrency(result.totalDebtBeforePayment)} - ${formatCurrency(totalPaidTowardsCycles_before)} = ${formatCurrency(result.balance)}`);
  console.log(`finalDebt = max(0, ${formatCurrency(result.balance)}) = ${formatCurrency(result.finalDebt)}`);
  console.log(`credit = max(0, -${formatCurrency(result.balance)}) = ${formatCurrency(result.credit)}`);
  console.log('\n✓ AVANT PAIEMENT: dette = ' + formatCurrency(result.finalDebt) + ', crédit = ' + formatCurrency(result.credit));

  // APRÈS PAIEMENT DE 50 000 FC
  console.log('\n--- APRÈS PAIEMENT DE 50 000 FC ---');
  const totalPaidTowardsCycles_after = 50000;
  console.log(`✓ memberExpected: ${formatCurrency(memberExpected)} (inchangé)`);
  console.log(`✓ manualDebtBase: ${formatCurrency(manualDebtBase)} (inchangé)`);
  console.log(`✓ totalPaidTowardsCycles: ${formatCurrency(totalPaidTowardsCycles_after)} (nouveau paiement)`);

  result = computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles_after);
  console.log('\n--- CALCUL APRÈS PAIEMENT ---');
  console.log(`totalDebtBeforePayment = ${formatCurrency(memberExpected)} + ${formatCurrency(manualDebtBase)} = ${formatCurrency(result.totalDebtBeforePayment)}`);
  console.log(`balance = ${formatCurrency(result.totalDebtBeforePayment)} - ${formatCurrency(totalPaidTowardsCycles_after)} = ${formatCurrency(result.balance)}`);
  console.log(`finalDebt = max(0, ${formatCurrency(result.balance)}) = ${formatCurrency(result.finalDebt)}`);
  console.log(`credit = max(0, -${formatCurrency(result.balance)}) = ${formatCurrency(result.credit)}`);
  console.log('\n✓ APRÈS PAIEMENT: dette = ' + formatCurrency(result.finalDebt) + ', crédit = ' + formatCurrency(result.credit));

  // VÉRIFICATION RÉSULTAT
  console.log('\n--- VÉRIFICATION RÉSULTAT ATTENDU ---');
  const debt_expected_1 = 0;
  const credit_expected_1 = 5000;
  const debt_ok_1 = result.finalDebt === debt_expected_1;
  const credit_ok_1 = result.credit === credit_expected_1;
  console.log(`Résultat attendu: dette = ${formatCurrency(debt_expected_1)}, crédit = ${formatCurrency(credit_expected_1)}`);
  console.log(`Résultat obtenu: dette = ${formatCurrency(result.finalDebt)}, crédit = ${formatCurrency(result.credit)}`);
  console.log(debt_ok_1 && credit_ok_1 ? '✅ SCÉNARIO 1 VALIDÉ' : '❌ SCÉNARIO 1 ÉCHOUÉ');

  // NOUVELLE SEMAINE GÉNÉRÉE DIMANCHE (10 000 FC)
  console.log('\n--- DIMANCHE : NOUVELLE SEMAINE (10 000 FC) ---');
  const credit_available = result.credit; // 5000
  const week_amount = weeklyAmount; // 10000
  const credit_applied = Math.min(credit_available, week_amount);
  const new_debt_from_week = week_amount - credit_applied; // 5000
  const new_credit_after = credit_available - credit_applied; // 0

  console.log(`Crédit disponible: ${formatCurrency(credit_available)}`);
  console.log(`Semaine générée: ${formatCurrency(week_amount)}`);
  console.log(`Crédit appliqué: ${formatCurrency(credit_applied)}`);
  console.log(`Nouvelle dette (semaine): ${formatCurrency(new_debt_from_week)}`);
  console.log(`Crédit restant: ${formatCurrency(new_credit_after)}`);
  console.log(`✓ APRÈS DIMANCHE: dette = ${formatCurrency(new_debt_from_week)}, crédit = ${formatCurrency(new_credit_after)}`);

  // VÉRIFICATION FINALE
  console.log('\n--- VÉRIFICATION DIMANCHE ---');
  const debt_expected_sunday = 5000;
  const credit_expected_sunday = 0;
  const debt_ok_sunday = new_debt_from_week === debt_expected_sunday;
  const credit_ok_sunday = new_credit_after === credit_expected_sunday;
  console.log(`Résultat attendu: dette = ${formatCurrency(debt_expected_sunday)}, crédit = ${formatCurrency(credit_expected_sunday)}`);
  console.log(`Résultat obtenu: dette = ${formatCurrency(new_debt_from_week)}, crédit = ${formatCurrency(new_credit_after)}`);
  console.log(debt_ok_sunday && credit_ok_sunday ? '✅ DIMANCHE VALIDÉ' : '❌ DIMANCHE ÉCHOUÉ');

  return debt_ok_1 && credit_ok_1 && debt_ok_sunday && credit_ok_sunday;
}

/**
 * Scénario 2 : Auto 20k + Manuel 25k + Paiement 50k
 */
function scenario2() {
  console.log('\n' + '='.repeat(80));
  console.log('SCÉNARIO 2 : Dette auto 20k + manuelle 25k + dépôt 50k');
  console.log('='.repeat(80));

  console.log('\n--- CALCUL ---');
  const memberExpected = 20000; // auto
  const manualDebtBase = 25000; // manuel
  const totalPaidTowardsCycles = 50000; // paiement

  console.log(`✓ memberExpected: ${formatCurrency(memberExpected)}`);
  console.log(`✓ manualDebtBase: ${formatCurrency(manualDebtBase)}`);
  console.log(`✓ totalPaidTowardsCycles: ${formatCurrency(totalPaidTowardsCycles)}`);

  const result = computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles);
  console.log('\n--- FORMULE ---');
  console.log(`totalDebtBeforePayment = ${formatCurrency(memberExpected)} + ${formatCurrency(manualDebtBase)} = ${formatCurrency(result.totalDebtBeforePayment)}`);
  console.log(`balance = ${formatCurrency(result.totalDebtBeforePayment)} - ${formatCurrency(totalPaidTowardsCycles)} = ${formatCurrency(result.balance)}`);
  console.log(`finalDebt = max(0, ${formatCurrency(result.balance)}) = ${formatCurrency(result.finalDebt)}`);
  console.log(`credit = max(0, -${formatCurrency(result.balance)}) = ${formatCurrency(result.credit)}`);

  console.log('\n✓ RÉSULTAT: dette = ' + formatCurrency(result.finalDebt) + ', crédit = ' + formatCurrency(result.credit));

  // VÉRIFICATION
  console.log('\n--- VÉRIFICATION ---');
  const debt_expected = 0;
  const credit_expected = 5000;
  const debt_ok = result.finalDebt === debt_expected;
  const credit_ok = result.credit === credit_expected;
  console.log(`Résultat attendu: dette = ${formatCurrency(debt_expected)}, crédit = ${formatCurrency(credit_expected)}`);
  console.log(`Résultat obtenu: dette = ${formatCurrency(result.finalDebt)}, crédit = ${formatCurrency(result.credit)}`);
  console.log(debt_ok && credit_ok ? '✅ SCÉNARIO 2 VALIDÉ' : '❌ SCÉNARIO 2 ÉCHOUÉ');

  return debt_ok && credit_ok;
}

/**
 * Scénario 3 : Paiement anticipé (pas de dette, dépôt 40k)
 */
function scenario3() {
  console.log('\n' + '='.repeat(80));
  console.log('SCÉNARIO 3 : Paiement anticipé (pas de dette, dépôt 40k)');
  console.log('='.repeat(80));

  console.log('\n--- ÉTAT INITIAL ---');
  const memberExpected = 0; // aucune semaine en retard
  const manualDebtBase = 0; // aucune dette manuelle
  const totalPaidTowardsCycles_before = 0; // aucun paiement

  console.log(`✓ memberExpected: ${formatCurrency(memberExpected)}`);
  console.log(`✓ manualDebtBase: ${formatCurrency(manualDebtBase)}`);
  console.log(`✓ totalPaidTowardsCycles: ${formatCurrency(totalPaidTowardsCycles_before)}`);

  let result = computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles_before);
  console.log('\n--- AVANT DÉPÔT ---');
  console.log(`totalDebtBeforePayment = ${formatCurrency(result.totalDebtBeforePayment)}`);
  console.log(`balance = ${formatCurrency(result.balance)}`);
  console.log(`finalDebt = ${formatCurrency(result.finalDebt)}`);
  console.log(`credit = ${formatCurrency(result.credit)}`);
  console.log('✓ État: à jour, pas de crédit');

  // APRÈS PAIEMENT DE 40 000 FC (ANTICIPÉ)
  console.log('\n--- APRÈS DÉPÔT DE 40 000 FC (ANTICIPÉ) ---');
  const totalPaidTowardsCycles_after = 40000;
  console.log(`✓ memberExpected: ${formatCurrency(memberExpected)} (inchangé)`);
  console.log(`✓ manualDebtBase: ${formatCurrency(manualDebtBase)} (inchangé)`);
  console.log(`✓ totalPaidTowardsCycles: ${formatCurrency(totalPaidTowardsCycles_after)}`);

  result = computeDebtAndCredit(memberExpected, manualDebtBase, totalPaidTowardsCycles_after);
  console.log('\n--- CALCUL APRÈS DÉPÔT ---');
  console.log(`totalDebtBeforePayment = ${formatCurrency(memberExpected)} + ${formatCurrency(manualDebtBase)} = ${formatCurrency(result.totalDebtBeforePayment)}`);
  console.log(`balance = ${formatCurrency(result.totalDebtBeforePayment)} - ${formatCurrency(totalPaidTowardsCycles_after)} = ${formatCurrency(result.balance)}`);
  console.log(`finalDebt = max(0, ${formatCurrency(result.balance)}) = ${formatCurrency(result.finalDebt)}`);
  console.log(`credit = max(0, -${formatCurrency(result.balance)}) = ${formatCurrency(result.credit)}`);
  console.log(`\n✓ RÉSULTAT: crédit = ${formatCurrency(result.credit)} (paiement anticipé)`);

  // VÉRIFICATION INITIALE
  console.log('\n--- VÉRIFICATION IMMÉDIATE ---');
  const credit_expected_initial = 40000;
  const credit_ok_initial = result.credit === credit_expected_initial;
  console.log(`Résultat attendu: crédit = ${formatCurrency(credit_expected_initial)}`);
  console.log(`Résultat obtenu: crédit = ${formatCurrency(result.credit)}`);
  console.log(credit_ok_initial ? '✅ INITIAL OK' : '❌ INITIAL ÉCHOUÉ');

  // APRÈS 4 SEMAINES GÉNÉRÉES (40 000 FC de crédit doivent tout couvrir)
  console.log('\n--- APRÈS 4 SEMAINES GÉNÉRÉES (4 × 10k = 40k) ---');
  const weeks_generated = 4;
  const weeklyAmount = 10000;
  const memberExpected_after = weeks_generated * weeklyAmount; // 40 000 FC
  const credit_to_apply = result.credit; // 40 000 FC (crédit disponible)
  
  let remaining_credit = credit_to_apply;
  for (let i = 1; i <= weeks_generated; i++) {
    const week_need = weeklyAmount;
    const applied = Math.min(remaining_credit, week_need);
    remaining_credit -= applied;
    console.log(`  Semaine ${i}: ${formatCurrency(week_need)} - ${formatCurrency(applied)} appliqué = ${formatCurrency(week_need - applied)} = ${applied >= week_need ? 'PAID' : 'UNPAID'}`);
  }

  console.log(`\n✓ APRÈS 4 SEMAINES: crédit restant = ${formatCurrency(remaining_credit)}, dette = ${formatCurrency(remaining_credit)} (ou 0 si tout payé)`);

  // VÉRIFICATION FINALE
  console.log('\n--- VÉRIFICATION FINALE ---');
  const credit_expected_final = 0;
  const debt_expected_final = 0;
  const credit_ok_final = remaining_credit === credit_expected_final;
  const debt_ok_final = remaining_credit === debt_expected_final;
  console.log(`Résultat attendu: crédit = ${formatCurrency(credit_expected_final)}, dette = ${formatCurrency(debt_expected_final)}`);
  console.log(`Résultat obtenu: crédit = ${formatCurrency(remaining_credit)}, dette = ${formatCurrency(Math.max(0, memberExpected_after - credit_to_apply))}`);
  console.log(credit_ok_final && debt_ok_final ? '✅ SCÉNARIO 3 VALIDÉ' : '❌ SCÉNARIO 3 ÉCHOUÉ');

  return credit_ok_initial && credit_ok_final && debt_ok_final;
}

/**
 * Main
 */
async function main() {
  console.log('\n╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(15) + 'TEST COMPLET DES SCÉNARIOS DE DETTE/CRÉDIT' + ' '.repeat(20) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const s1 = scenario1();
  const s2 = scenario2();
  const s3 = scenario3();

  console.log('\n' + '='.repeat(80));
  console.log('RÉSUMÉ FINAL');
  console.log('='.repeat(80));
  console.log(`Scénario 1 (Louis 45k): ${s1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Scénario 2 (Auto 20k + Manuel 25k): ${s2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Scénario 3 (Paiement anticipé 40k): ${s3 ? '✅ PASS' : '❌ FAIL'}`);
  console.log('='.repeat(80));

  const allPass = s1 && s2 && s3;
  console.log(`\n${allPass ? '✅✅✅ TOUS LES TESTS RÉUSSIS ✅✅✅' : '❌ CERTAINS TESTS ONT ÉCHOUÉ'}\n`);

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
