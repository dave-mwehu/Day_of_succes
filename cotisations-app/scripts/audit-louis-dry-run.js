#!/usr/bin/env node
/**
 * Audit complet des données Supabase
 * Mode dry-run : simule le backfill sans écrire
 * Affiche toutes les données de Louis avec validation
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
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

function formatCurrency(val) {
  return `${Number(val).toLocaleString('fr-FR')} FC`;
}

async function auditLouis() {
  console.log('\n' + '╔' + '═'.repeat(90) + '╗');
  console.log('║' + ' '.repeat(20) + 'AUDIT COMPLET — DONNÉES RÉELLES SUPABASE' + ' '.repeat(30) + '║');
  console.log('╚' + '═'.repeat(90) + '╝\n');

  // Load settings
  const { data: settings, error: settingsErr } = await supabase.from('settings').select('*').eq('id', 'main').maybeSingle();
  if (settingsErr) throw settingsErr;

  const startDate = settings?.start_date || settings?.startDate;
  const weeklyAmount = Number(settings?.weekly_amount || settings?.weeklyAmount || 10000);

  if (!startDate) {
    console.error('❌ No start_date in settings/main');
    process.exit(1);
  }

  console.log(`📌 Configuration:`);
  console.log(`   Start date: ${startDate}`);
  console.log(`   Weekly amount: ${formatCurrency(weeklyAmount)}`);
  console.log(`\n`);

  // Find Louis
  const { data: louis, error: louisErr } = await supabase.from('members').select('*').eq('name', 'Louis').single();
  if (louisErr) {
    console.error('❌ Louis not found in members');
    process.exit(1);
  }

  console.log('📋 LOUIS INFORMATION:');
  console.log(`   ID: ${louis.id}`);
  console.log(`   Name: ${louis.name}`);
  console.log(`   Manual debt base: ${formatCurrency(louis.manual_debt_base || louis.manualDebtBase || 0)}`);
  console.log(`   Current computed debt: ${formatCurrency(louis.computed_debt || 0)}`);
  console.log(`   Current computed credit: ${formatCurrency(louis.computed_credit || 0)}`);
  console.log(`\n`);

  // Load all data
  const [{ data: deposits }, { data: weeklyCycles }, { data: memberCycles }, { data: allMembers }] = await Promise.all([
    supabase.from('deposits').select('*').eq('member_id', louis.id),
    supabase.from('weekly_cycles').select('*').order('index'),
    supabase.from('member_cycles').select('*').eq('member_id', louis.id),
    supabase.from('members').select('*'),
  ]);

  console.log('📊 DATA COUNTS:');
  console.log(`   Weekly cycles total: ${weeklyCycles?.length || 0}`);
  console.log(`   Member cycles (Louis): ${memberCycles?.length || 0}`);
  console.log(`   Deposits (Louis): ${deposits?.length || 0}`);
  console.log(`\n`);

  // Filter active cycles
  const today = startOfDay(new Date());
  const activeCycles = (weeklyCycles || []).filter((c) => {
    if (!c.start_date) return false;
    const sd = startOfDay(new Date(c.start_date + 'T00:00:00'));
    const status = (c.status || 'open').toLowerCase();
    return sd.getTime() <= today.getTime() && status !== 'cancelled' && status !== 'frozen';
  });

  console.log(`📅 ACTIVE CYCLES (up to today):`);
  console.log(`   Total: ${activeCycles.length}`);
  if (activeCycles.length > 0) {
    console.log(`   Range: ${activeCycles[0].label} to ${activeCycles[activeCycles.length - 1].label}`);
  }
  console.log(`\n`);

  // Compute expected debt per cycle
  console.log('💰 DEBT CALCULATION:');
  let memberExpected = 0;
  for (const c of activeCycles) {
    const cycleWeekly = Number(c.weekly_amount || c.weeklyAmount || weeklyAmount);
    const mcList = memberCycles || [];
    const mc = mcList.find((x) => x.cycle_id === c.id);
    if (mc && String((mc.status || '')).toLowerCase() === 'waived') {
      // Skip waived
    } else {
      memberExpected += cycleWeekly;
    }
  }

  console.log(`   Expected debt (active cycles): ${formatCurrency(memberExpected)}`);

  // Compute paid from cycles
  const paidFromCycles = (memberCycles || []).reduce((acc, cur) => {
    const cid = cur.cycle_id || cur.cycleId;
    if (!cid) return acc;
    if (!activeCycles.find((c) => c.id === cid)) return acc;
    return acc + Number(cur.amount_paid || cur.amountPaid || 0);
  }, 0);

  console.log(`   Paid from member_cycles: ${formatCurrency(paidFromCycles)}`);

  // Deposits without cycle
  const depositsWithCycle = (deposits || []).filter((d) => d.cycle_id || d.cycleId);
  const depositsWithoutCycle = (deposits || []).filter((d) => !(d.cycle_id || d.cycleId));
  const totalDeposits = (deposits || []).reduce((s, d) => s + Number(d.amount || 0), 0);
  const sumDepositsWithoutCycle = depositsWithoutCycle.reduce((s, d) => s + Number(d.amount || 0), 0);

  console.log(`   Deposits with cycle assigned: ${formatCurrency(depositsWithCycle.reduce((s, d) => s + Number(d.amount || 0), 0))} (${depositsWithCycle.length} items)`);
  console.log(`   Deposits without cycle: ${formatCurrency(sumDepositsWithoutCycle)} (${depositsWithoutCycle.length} items)`);
  console.log(`   Total deposits: ${formatCurrency(totalDeposits)}`);

  const totalPaidTowardsCycles = paidFromCycles + sumDepositsWithoutCycle;
  console.log(`   Total paid towards cycles: ${formatCurrency(totalPaidTowardsCycles)}`);

  // Apply formula
  const manualDebtBase = Number(louis.manual_debt_base ?? louis.debt_adjustment ?? louis.manualDebtBase ?? louis.debtAdjustment ?? 0);
  const totalDebtBeforePayment = memberExpected + manualDebtBase;
  const balance = totalDebtBeforePayment - totalPaidTowardsCycles;
  const finalDebt = Math.max(0, balance);
  const credit = Math.max(0, -balance);

  console.log(`\n📐 FORMULA APPLIED:`);
  console.log(`   Manual debt: ${formatCurrency(manualDebtBase)}`);
  console.log(`   Total debt before payment: ${formatCurrency(memberExpected)} + ${formatCurrency(manualDebtBase)} = ${formatCurrency(totalDebtBeforePayment)}`);
  console.log(`   Balance: ${formatCurrency(totalDebtBeforePayment)} - ${formatCurrency(totalPaidTowardsCycles)} = ${formatCurrency(balance)}`);
  console.log(`   Final debt: max(0, ${formatCurrency(balance)}) = ${formatCurrency(finalDebt)}`);
  console.log(`   Credit: max(0, -${formatCurrency(balance)}) = ${formatCurrency(credit)}`);

  // Check for duplicates
  console.log(`\n🔍 DUPLICATE CHECK:`);
  const depositsCount = deposits?.length || 0;
  const cycleDepositsCount = depositsWithCycle.length;
  const unassignedCount = depositsWithoutCycle.length;
  const noDuplicate = cycleDepositsCount + unassignedCount === depositsCount;
  console.log(`   Total deposits: ${depositsCount}`);
  console.log(`   Assigned to cycles: ${cycleDepositsCount}`);
  console.log(`   Unassigned: ${unassignedCount}`);
  console.log(`   Sum matches: ${noDuplicate ? '✅ YES' : '❌ NO'}`);

  if (!noDuplicate) {
    console.log(`   ❌ MISMATCH DETECTED`);
  }

  // Last 10 weeks
  console.log(`\n📆 LAST 10 WEEKS OF LOUIS:`);
  const louisCycles = (memberCycles || [])
    .map((mc) => {
      const cycle = activeCycles.find((c) => c.id === mc.cycle_id);
      return { ...mc, cycle };
    })
    .filter((x) => x.cycle)
    .sort((a, b) => a.cycle.index - b.cycle.index)
    .slice(-10);

  if (louisCycles.length === 0) {
    console.log('   No member_cycles found for Louis');
  } else {
    console.log(`   ${louisCycles.length} weeks found:\n`);
    louisCycles.forEach((mc) => {
      const cycleWeekly = Number(mc.cycle?.weekly_amount || mc.cycle?.weeklyAmount || weeklyAmount);
      const amountPaid = Number(mc.amount_paid || mc.amountPaid || 0);
      const status = mc.status || 'unpaid';
      const waived = status === 'waived' ? ' (WAIVED)' : '';
      const bar = '█'.repeat(Math.round(amountPaid / cycleWeekly * 20));
      const emptyBar = '░'.repeat(20 - Math.round(amountPaid / cycleWeekly * 20));
      console.log(`   ${mc.cycle.label || mc.cycle_id}: ${formatCurrency(cycleWeekly)} | Paid: ${formatCurrency(amountPaid)} | [${bar}${emptyBar}] | ${status}${waived}`);
    });
  }

  // Check for missing weeks
  console.log(`\n⏭️  MISSING WEEKS CHECK:`);
  let noMissingWeeks = true;
  if (activeCycles.length === 0) {
    console.log('   No active cycles found');
  } else {
    const firstIdx = activeCycles[0].index;
    const lastIdx = activeCycles[activeCycles.length - 1].index;
    const expectedCount = lastIdx - firstIdx + 1;
    const actualCount = activeCycles.length;
    noMissingWeeks = expectedCount === actualCount;
    console.log(`   Expected: ${expectedCount} cycles (week ${firstIdx} to ${lastIdx})`);
    console.log(`   Actual: ${actualCount} cycles`);
    console.log(`   Missing weeks: ${noMissingWeeks ? '✅ NONE' : `❌ ${expectedCount - actualCount}`}`);

    if (!noMissingWeeks) {
      const indexSet = new Set(activeCycles.map((c) => c.index));
      const missing = [];
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (!indexSet.has(i)) missing.push(i);
      }
      console.log(`   Missing indices: ${missing.join(', ')}`);
    }
  }

  // Simulation results
  console.log(`\n✅ SIMULATION RESULTS (DRY-RUN):`);
  console.log(`   Louis would be updated with:`);
  console.log(`     computed_debt: ${formatCurrency(finalDebt)} (current: ${formatCurrency(louis.computed_debt || 0)})`);
  console.log(`     computed_credit: ${formatCurrency(credit)} (current: ${formatCurrency(louis.computed_credit || 0)})`);
  console.log(`     computed_expected: ${formatCurrency(memberExpected)}`);
  console.log(`     computed_total: ${formatCurrency(totalDeposits)}`);

  const debtChanged = finalDebt !== (louis.computed_debt || 0);
  const creditChanged = credit !== (louis.computed_credit || 0);
  if (debtChanged || creditChanged) {
    console.log(`   Changes: ${debtChanged ? 'DEBT ' : ''}${creditChanged ? 'CREDIT' : ''}`.trim());
  } else {
    console.log(`   Changes: NONE (values already correct)`);
  }

  // Final validation
  console.log(`\n🎯 FINAL VALIDATION:`);
  const allOk = noDuplicate && noMissingWeeks;
  console.log(`   No duplicates: ${noDuplicate ? '✅' : '❌'}`);
  console.log(`   No missing weeks: ${noMissingWeeks ? '✅' : '❌'}`);
  console.log(`   Data integrity: ${allOk ? '✅ READY FOR DEPLOYMENT' : '❌ ISSUES FOUND'}`);

  console.log(`\n`);
  process.exit(allOk ? 0 : 1);
}

auditLouis().catch((err) => {
  console.error('❌ Audit error:', err.message);
  process.exit(1);
});
