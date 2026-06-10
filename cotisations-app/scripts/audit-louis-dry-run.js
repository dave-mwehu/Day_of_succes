#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const { buildConsistencyPlan } = require('./lib/financial-consistency');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FC`;
}

async function loadAllData() {
  const [{ data: settings, error: settingsError }, { data: members, error: membersError }, { data: deposits, error: depositsError }, { data: weeklyCycles, error: weeklyCyclesError }, { data: memberCycles, error: memberCyclesError }] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 'main').maybeSingle(),
    supabase.from('members').select('*'),
    supabase.from('deposits').select('*'),
    supabase.from('weekly_cycles').select('*').order('index'),
    supabase.from('member_cycles').select('*'),
  ]);

  const error = settingsError || membersError || depositsError || weeklyCyclesError || memberCyclesError;
  if (error) throw error;
  return { settings, members: members || [], deposits: deposits || [], weeklyCycles: weeklyCycles || [], memberCycles: memberCycles || [] };
}

async function auditLouis() {
  const data = await loadAllData();
  const louis = data.members.find((member) => String(member.name || '').toLowerCase() === 'louis');
  if (!louis) {
    console.error('Louis not found in members.');
    process.exit(1);
  }

  const plan = buildConsistencyPlan(data);
  const result = plan.memberResults.find((item) => item.memberId === louis.id);
  const louisDeposits = data.deposits.filter((deposit) => deposit.member_id === louis.id || deposit.memberId === louis.id);
  const louisMemberCycles = data.memberCycles.filter((mc) => mc.member_id === louis.id || mc.memberId === louis.id);
  const depositsWithCycle = louisDeposits.filter((deposit) => deposit.cycle_id || deposit.cycleId);
  const depositsWithoutCycle = louisDeposits.filter((deposit) => !(deposit.cycle_id || deposit.cycleId));
  const oldAppliedAmount = result.existingCyclePaid + depositsWithoutCycle.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);

  console.log('\nAUDIT LOUIS - DRY RUN\n');
  console.log('Configuration');
  console.log(`  Start date: ${plan.startDate}`);
  console.log(`  Weekly amount: ${formatCurrency(plan.weeklyAmount)}`);
  console.log(`  Expected weekly cycles: ${plan.expectedCycles.length}`);
  console.log(`  Active weekly cycles: ${plan.activeCycles.length}`);

  console.log('\nWeekly cycles');
  console.log(`  Missing indices: ${plan.cycleAudit.missing.map((cycle) => cycle.index).join(', ') || 'none'}`);
  console.log(`  Duplicate indices: ${plan.cycleAudit.duplicateIndexes.map((entry) => entry.index).join(', ') || 'none'}`);

  console.log('\nCurrent Louis data');
  console.log(`  ID: ${louis.id}`);
  console.log(`  Manual debt base: ${formatCurrency(result.manualDebtBase)}`);
  console.log(`  Current computed debt: ${formatCurrency(louis.computed_debt)}`);
  console.log(`  Current computed credit: ${formatCurrency(louis.computed_credit)}`);
  console.log(`  Deposits: ${louisDeposits.length} rows, ${formatCurrency(result.totalDeposits)}`);
  console.log(`  Deposits with cycle_id: ${depositsWithCycle.length} rows, ${formatCurrency(depositsWithCycle.reduce((sum, d) => sum + Number(d.amount || 0), 0))}`);
  console.log(`  Deposits without cycle_id: ${depositsWithoutCycle.length} rows, ${formatCurrency(depositsWithoutCycle.reduce((sum, d) => sum + Number(d.amount || 0), 0))}`);
  console.log(`  Member cycles: ${louisMemberCycles.length} rows`);
  console.log(`  Currently applied in member_cycles: ${formatCurrency(result.existingCyclePaid)}`);

  console.log('\nWhy the old result ignored credit');
  console.log(`  Old applied formula: member_cycles.amount_paid + deposits without cycle_id`);
  console.log(`  Old applied amount: ${formatCurrency(oldAppliedAmount)}`);
  console.log(`  Total raw deposits: ${formatCurrency(result.totalDeposits)}`);
  console.log(`  Amount not reflected by old formula: ${formatCurrency(result.totalDeposits - oldAppliedAmount)}`);

  console.log('\nCorrected dry-run');
  console.log(`  Weekly obligations: ${formatCurrency(result.memberExpected)}`);
  console.log(`  Manual debt: ${formatCurrency(result.manualDebtBase)}`);
  console.log(`  Total obligations: ${formatCurrency(result.totalObligations)}`);
  console.log(`  Total deposits: ${formatCurrency(result.totalDeposits)}`);
  console.log(`  Allocated to weekly cycles: ${formatCurrency(result.allocatedToCycles)}`);
  console.log(`  Remaining after weekly cycles: ${formatCurrency(result.remainingAfterCycles)}`);
  console.log(`  computed_debt would be: ${formatCurrency(result.computedDebt)}`);
  console.log(`  computed_credit would be: ${formatCurrency(result.computedCredit)}`);

  console.log('\nFirst allocations after correction');
  result.memberCycleRows.slice(0, 12).forEach((row) => {
    console.log(`  ${row.cycle_id}: ${formatCurrency(row.amount_paid)} | ${row.status}`);
  });

  const hasIssues = plan.cycleAudit.duplicateIndexes.length > 0;
  console.log(`\nDry-run status: ${hasIssues ? 'BLOCKED - duplicate weekly cycle indices' : 'READY TO BACKFILL'}\n`);
  process.exit(hasIssues ? 1 : 0);
}

auditLouis().catch((err) => {
  console.error('Audit error:', err.message || err);
  if (err.cause) console.error('Cause:', err.cause.message || err.cause);
  process.exit(1);
});
