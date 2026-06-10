const { createClient } = require('@supabase/supabase-js');
const { buildConsistencyPlan } = require('../../scripts/lib/financial-consistency');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function loadAllData(supabase) {
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

async function writeBatches(supabase, table, rows, options) {
  const queue = [...rows];
  while (queue.length) {
    const batch = queue.splice(0, 100);
    const { error } = await supabase.from(table).upsert(batch, options);
    if (error) throw error;
  }
}

async function applyWeeklyLogic() {
  const supabase = getSupabase();
  const data = await loadAllData(supabase);
  const plan = buildConsistencyPlan(data);

  if (plan.cycleAudit.duplicateIndexes.length) {
    const indices = plan.cycleAudit.duplicateIndexes.map((entry) => entry.index).join(', ');
    throw new Error(`Duplicate weekly cycle indices found: ${indices}`);
  }

  await writeBatches(supabase, 'weekly_cycles', plan.cyclesToUpsert, { onConflict: 'id' });

  const existingMemberCycleIds = new Set((data.memberCycles || []).map((row) => row.id));
  const missingMemberCycles = [];
  for (const member of data.members || []) {
    for (const cycle of plan.activeCycles) {
      const id = `${member.id}_${cycle.id}`;
      if (!existingMemberCycleIds.has(id)) {
        missingMemberCycles.push({
          id,
          member_id: member.id,
          cycle_id: cycle.id,
          status: 'unpaid',
          amount_paid: 0,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  if (missingMemberCycles.length) {
    await writeBatches(supabase, 'member_cycles', missingMemberCycles, { onConflict: 'id' });
  }

  return { ...plan, missingMemberCycles };
}

exports.handler = async function () {
  try {
    const plan = await applyWeeklyLogic();
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Weekly contribution processing completed.',
        weeklyCycles: plan.expectedCycles.length,
        members: plan.memberResults.length,
        missingMemberCycles: plan.missingMemberCycles.length,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err.message || err) };
  }
};
