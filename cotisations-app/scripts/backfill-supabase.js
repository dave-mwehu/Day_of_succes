const { createClient } = require('@supabase/supabase-js');
const { buildConsistencyPlan } = require('./lib/financial-consistency');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function loadAllData() {
  const [{ data: settings, error: settingsError }, { data: members, error: membersError }, { data: deposits, error: depositsError }, { data: weeklyCycles, error: weeklyCyclesError }, { data: memberCycles, error: memberCyclesError }] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 'main').maybeSingle(),
    supabase.from('members').select('*'),
    supabase.from('deposits').select('*'),
    supabase.from('weekly_cycles').select('*'),
    supabase.from('member_cycles').select('*'),
  ]);

  const error = settingsError || membersError || depositsError || weeklyCyclesError || memberCyclesError;
  if (error) throw error;
  return { settings, members: members || [], deposits: deposits || [], weeklyCycles: weeklyCycles || [], memberCycles: memberCycles || [] };
}

async function writeBatches(table, rows, options) {
  const queue = [...rows];
  while (queue.length) {
    const batch = queue.splice(0, 100);
    const { error } = await supabase.from(table).upsert(batch, options);
    if (error) throw error;
  }
}

function printSummary(plan) {
  const missing = plan.cycleAudit.missing.map((cycle) => cycle.index);
  const duplicateIndexes = plan.cycleAudit.duplicateIndexes.map((entry) => entry.index);
  const totalDeposits = plan.memberResults.reduce((sum, result) => sum + result.totalDeposits, 0);
  const totalExistingApplied = plan.memberResults.reduce((sum, result) => sum + result.existingCyclePaid, 0);
  const totalNewApplied = plan.memberResults.reduce((sum, result) => sum + result.allocatedToCycles, 0);
  const totalCredit = plan.memberResults.reduce((sum, result) => sum + result.computedCredit, 0);
  const totalDebt = plan.memberResults.reduce((sum, result) => sum + result.computedDebt, 0);

  console.log(`Weekly cycles expected: ${plan.expectedCycles.length}`);
  console.log(`Missing weekly cycle indices: ${missing.length ? missing.join(', ') : 'none'}`);
  console.log(`Duplicate weekly cycle indices: ${duplicateIndexes.length ? duplicateIndexes.join(', ') : 'none'}`);
  console.log(`Members: ${plan.memberResults.length}`);
  console.log(`Deposits total: ${totalDeposits} FC`);
  console.log(`Currently applied in member_cycles: ${totalExistingApplied} FC`);
  console.log(`Will apply to member_cycles: ${totalNewApplied} FC`);
  console.log(`Computed debt: ${totalDebt} FC`);
  console.log(`Computed credit: ${totalCredit} FC`);
}

async function runBackfill() {
  if (process.env.ALLOW_REWRITE_BACKFILL !== 'yes') {
    console.error('Backfill blocked: the current rewrite would reallocate historical deposits too broadly.');
    console.error('Set ALLOW_REWRITE_BACKFILL=yes only after the allocation rule is finalized.');
    process.exit(1);
  }

  const data = await loadAllData();
  if (!data.settings?.start_date && !data.settings?.startDate) {
    console.error('No start date set in settings/main.');
    process.exit(1);
  }

  const plan = buildConsistencyPlan(data);
  printSummary(plan);

  if (plan.cycleAudit.duplicateIndexes.length) {
    throw new Error('Duplicate weekly cycle indices found. Resolve duplicates before writing allocations.');
  }

  console.log('Writing continuous weekly cycles...');
  await writeBatches('weekly_cycles', plan.cyclesToUpsert, { onConflict: 'id' });

  console.log('Writing member cycle allocations...');
  await writeBatches('member_cycles', plan.memberCycleUpserts, { onConflict: 'id' });

  console.log('Writing member computed totals...');
  await writeBatches('members', plan.memberUpdates, { onConflict: 'id' });

  console.log('Writing public stats...');
  await writeBatches('public_stats', [plan.publicStats], { onConflict: 'id' });

  console.log('Backfill complete.');
}

runBackfill().catch((err) => {
  console.error('Backfill error:', err.message || err);
  if (err.cause) console.error('Cause:', err.cause.message || err.cause);
  process.exit(1);
});
