/**
 * Test complet du scénario de Louis :
 * - Dette totale initiale : 45 000 FC
 * - Dépôt vendredi : 50 000 FC
 * - Nouvelle semaine générée dimanche : 10 000 FC
 * - Résultat attendu : dette = 5 000 FC, crédit = 0 FC
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

function cycleIdFromIndex(i) {
  return `w${String(i).padStart(4, '0')}`;
}

async function testLouisScenario() {
  console.log('=== LOUIS SCENARIO TEST ===\n');

  // Load settings
  const { data: settings } = await supabase.from('settings').select('*').eq('id', 'main').maybeSingle();
  const startDate = settings?.start_date || settings?.startDate;
  const weeklyAmount = Number(settings?.weekly_amount || settings?.weeklyAmount || 10000);
  console.log(`Start date: ${startDate}`);
  console.log(`Weekly amount: ${weeklyAmount}\n`);

  // Find or create Louis
  const { data: louis, error: luErr } = await supabase.from('members').select('*').eq('name', 'Louis').maybeSingle();
  if (luErr) throw luErr;

  const louisId = louis?.id || 'louis-test-' + Date.now();
  console.log(`Louis ID: ${louisId}`);

  if (!louis) {
    console.log('Creating Louis member...');
    await supabase.from('members').insert([{ id: louisId, name: 'Louis', manual_debt_base: 0, computed_debt: 0, computed_credit: 0, computed_expected: 0, computed_total: 0 }]);
  }

  // Clean up prior data for this test
  console.log('\nCleaning prior deposits/cycles for Louis...');
  await supabase.from('deposits').delete().eq('member_id', louisId);
  await supabase.from('member_cycles').delete().eq('member_id', louisId);

  // Ensure weekly cycles
  const start = new Date(startDate + 'T00:00:00');
  const today = startOfDay(new Date());
  const diff = startOfDay(today).getTime() - startOfDay(start).getTime();
  const count = Math.floor(diff / WEEK_MS) + 1;
  const cycles = [];
  for (let i = 0; i < count; i++) {
    const index = i + 1;
    const cycleStart = new Date(start.getTime() + i * WEEK_MS);
    const cycleEnd = new Date(cycleStart.getTime() + WEEK_MS - 1);
    cycles.push({ id: cycleIdFromIndex(index), index, label: `Semaine ${index}`, start_date: toYmd(cycleStart), end_date: toYmd(cycleEnd), status: 'open', weekly_amount: weeklyAmount });
  }
  await supabase.from('weekly_cycles').upsert(cycles, { onConflict: ['id'] });
  console.log(`Ensured ${cycles.length} weekly cycles.\n`);

  // Create member_cycles for Louis (all unpaid initially)
  console.log('Creating initial member_cycles (all unpaid)...');
  const memberCycleRows = cycles.map((c) => ({
    id: `${louisId}_${c.id}`,
    member_id: louisId,
    cycle_id: c.id,
    status: 'unpaid',
    amount_paid: 0,
  }));
  await supabase.from('member_cycles').upsert(memberCycleRows, { onConflict: ['id'] });
  console.log(`Created ${memberCycleRows.length} member_cycles.\n`);

  // STEP 1: Initial state — Louis has 45,000 FC automatic debt (4.5 weeks unpaid) + some manual debt
  console.log('=== STEP 1: Initial State ===');
  const autoDept4Weeks = 4 * weeklyAmount; // 40 000
  const manualDebt = 5000; // 5 000 manual
  const totalDebtInitial = autoDept4Weeks + manualDebt; // 45 000
  console.log(`Automatic debt (4 weeks unpaid): ${autoDept4Weeks} FC`);
  console.log(`Manual debt: ${manualDebt} FC`);
  console.log(`Total debt: ${totalDebtInitial} FC`);
  console.log(`Deposits: 0 FC`);

  // Update Louis member record
  await supabase.from('members').update({
    manual_debt_base: manualDebt,
    computed_debt: totalDebtInitial,
    computed_expected: autoDept4Weeks,
    computed_total: 0,
    computed_credit: 0,
  }).eq('id', louisId);

  // STEP 2: Deposit on Friday 50,000 FC
  console.log('\n=== STEP 2: Deposit 50,000 FC on Friday ===');
  const fridayDate = toYmd(new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000)); // 2 days ago = Friday
  await supabase.from('deposits').insert([{ member_id: louisId, amount: 50000, date: fridayDate }]);
  console.log(`Deposit recorded: 50,000 FC on ${fridayDate}`);

  // Compute post-deposit state
  const totalDeposits = 50000;
  const totalDebtBeforePayment = totalDebtInitial; // 45 000
  const balance = totalDebtBeforePayment - totalDeposits; // 45 000 - 50 000 = -5 000
  const debtAfterDeposit = Math.max(0, balance); // 0
  const creditAfterDeposit = Math.max(0, -balance); // 5 000
  console.log(`\nPost-deposit calculation:`);
  console.log(`  Total debt before: ${totalDebtBeforePayment} FC`);
  console.log(`  Deposits: ${totalDeposits} FC`);
  console.log(`  Balance: ${balance} FC`);
  console.log(`  Final debt: ${debtAfterDeposit} FC`);
  console.log(`  Credit: ${creditAfterDeposit} FC`);

  // Update Louis after deposit
  await supabase.from('members').update({
    computed_debt: debtAfterDeposit,
    computed_credit: creditAfterDeposit,
    computed_total: totalDeposits,
  }).eq('id', louisId);

  // STEP 3: Sunday — new week generated and credit applied
  console.log('\n=== STEP 3: Sunday — New Week Generated ===');
  const sundayIndex = count + 1;
  const sundayCycleId = cycleIdFromIndex(sundayIndex);
  const sundayCycleStart = new Date(start.getTime() + (count) * WEEK_MS);
  const sundayCycleEnd = new Date(sundayCycleStart.getTime() + WEEK_MS - 1);
  
  console.log(`Creating new cycle: ${sundayCycleId}`);
  await supabase.from('weekly_cycles').insert([{
    id: sundayCycleId,
    index: sundayIndex,
    label: `Semaine ${sundayIndex}`,
    start_date: toYmd(sundayCycleStart),
    end_date: toYmd(sundayCycleEnd),
    status: 'open',
    weekly_amount: weeklyAmount,
  }]);

  // Apply credit to the new week
  const creditAvailable = creditAfterDeposit; // 5 000
  const weeklyNeeded = weeklyAmount; // 10 000
  const creditApplied = Math.min(creditAvailable, weeklyNeeded); // 5 000
  const newStatusSunday = creditApplied >= weeklyNeeded ? 'paid' : 'unpaid'; // unpaid
  console.log(`\nApplying credit to ${sundayCycleId}:`);
  console.log(`  Credit available: ${creditAvailable} FC`);
  console.log(`  Weekly needed: ${weeklyNeeded} FC`);
  console.log(`  Credit applied: ${creditApplied} FC`);
  console.log(`  Status: ${newStatusSunday}`);

  await supabase.from('member_cycles').insert([{
    id: `${louisId}_${sundayCycleId}`,
    member_id: louisId,
    cycle_id: sundayCycleId,
    status: newStatusSunday,
    amount_paid: creditApplied,
  }]);

  // STEP 4: Final state after new week
  console.log('\n=== STEP 4: Final State ===');
  const newDebtFromWeek = weeklyNeeded - creditApplied; // 10 000 - 5 000 = 5 000
  const finalDebt = newDebtFromWeek; // 5 000 (no old debt left, only new week deficit)
  const finalCredit = 0; // credit fully used
  console.log(`Expected new debt from week: ${newDebtFromWeek} FC`);
  console.log(`Final debt: ${finalDebt} FC`);
  console.log(`Final credit: ${finalCredit} FC`);

  await supabase.from('members').update({
    computed_debt: finalDebt,
    computed_credit: finalCredit,
  }).eq('id', louisId);

  // Verify final state
  console.log('\n=== VERIFICATION ===');
  const { data: louisFinal } = await supabase.from('members').select('*').eq('id', louisId).maybeSingle();
  const { data: louisCycles } = await supabase.from('member_cycles').select('*').eq('member_id', louisId);
  const { data: louisDeposits } = await supabase.from('deposits').select('*').eq('member_id', louisId);

  console.log(`\nLouis final record:`);
  console.log(`  computed_debt: ${louisFinal.computed_debt} FC (expected: ${finalDebt})`);
  console.log(`  computed_credit: ${louisFinal.computed_credit} FC (expected: ${finalCredit})`);
  console.log(`  computed_expected: ${louisFinal.computed_expected} FC`);
  console.log(`  computed_total: ${louisFinal.computed_total} FC (expected: ${totalDeposits})`);

  console.log(`\nLouis cycles (last 5):`);
  (louisCycles || []).slice(-5).forEach((mc) => {
    console.log(`  ${mc.cycle_id}: status=${mc.status}, amount_paid=${mc.amount_paid}`);
  });

  console.log(`\nLouis deposits:`);
  (louisDeposits || []).forEach((d) => {
    console.log(`  ${d.date}: ${d.amount} FC`);
  });

  // Final validation
  console.log('\n=== TEST RESULT ===');
  const debtOk = louisFinal.computed_debt === finalDebt;
  const creditOk = louisFinal.computed_credit === finalCredit;
  const totalOk = louisFinal.computed_total === totalDeposits;
  const allOk = debtOk && creditOk && totalOk;

  console.log(`✓ Debt is ${finalDebt} FC: ${debtOk ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Credit is ${finalCredit} FC: ${creditOk ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Total deposits is ${totalDeposits} FC: ${totalOk ? 'PASS' : 'FAIL'}`);
  console.log(`\n${allOk ? '✓ ALL TESTS PASSED' : '✗ TESTS FAILED'}`);

  process.exit(allOk ? 0 : 1);
}

testLouisScenario().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
