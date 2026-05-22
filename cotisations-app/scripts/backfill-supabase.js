const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
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

async function runBackfill() {
  const { data: settings } = await supabase.from('settings').select('*').eq('id', 'main').maybeSingle();
  const startDate = settings?.start_date || settings?.startDate;
  const weeklyAmount = Number(settings?.weekly_amount || settings?.weeklyAmount || 10000);
  if (!startDate) {
    console.error('No start date set in settings/main.');
    process.exit(1);
  }

  // ensure weekly cycles
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
  console.log(`Ensuring ${cycles.length} weekly cycles...`);
  await supabase.from('weekly_cycles').upsert(cycles, { onConflict: ['id'] });

  // fetch members, deposits, member_cycles
  const [{ data: members }, { data: deposits }, { data: memberCycles }] = await Promise.all([
    supabase.from('members').select('*'),
    supabase.from('deposits').select('*'),
    supabase.from('member_cycles').select('*'),
  ]);

  console.log(`Members: ${members.length} | Deposits: ${deposits.length} | Member cycles: ${memberCycles.length}`);

  // index deposits and member_cycles
  const depositsByMember = new Map();
  (deposits || []).forEach((d) => {
    const memberId = d.member_id || d.memberId;
    if (!memberId) return;
    if (!depositsByMember.has(memberId)) depositsByMember.set(memberId, []);
    depositsByMember.get(memberId).push(d);
  });

  const memberCyclesByMember = new Map();
  (memberCycles || []).forEach((mc) => {
    const memberId = mc.member_id || mc.memberId;
    if (!memberId) return;
    if (!memberCyclesByMember.has(memberId)) memberCyclesByMember.set(memberId, []);
    memberCyclesByMember.get(memberId).push(mc);
  });

  const updates = [];
  const memberCycleUpserts = [];

  // load cycles list
  const { data: cyclesList } = await supabase.from('weekly_cycles').select('*');
  const activeCycles = (cyclesList || []).filter((c) => {
    const sd = startOfDay(new Date(c.start_date + 'T00:00:00'));
    const status = (c.status || 'open').toLowerCase();
    return sd.getTime() <= startOfDay(new Date()).getTime() && status !== 'cancelled' && status !== 'frozen';
  });

  for (const m of members) {
    const memberId = m.id;
    const memberDeposits = depositsByMember.get(memberId) || [];
    const depositsWithCycle = memberDeposits.filter((d) => d.cycle_id || d.cycleId);
    const depositsWithoutCycle = memberDeposits.filter((d) => !(d.cycle_id || d.cycleId));
    const totalDeposits = memberDeposits.reduce((s, d) => s + Number(d.amount || 0), 0);

    let memberExpected = 0;
    for (const c of activeCycles) {
      const cycleWeekly = Number(c.weekly_amount || c.weeklyAmount || weeklyAmount);
      const mcList = memberCyclesByMember.get(memberId) || [];
      const mc = mcList.find((x) => x.cycle_id === c.id || x.cycleId === c.id);
      if (mc && String((mc.status || mc.status || '')).toLowerCase() === 'waived') continue;
      memberExpected += cycleWeekly;
    }

    const paidFromCycles = (memberCyclesByMember.get(memberId) || []).reduce((acc, cur) => {
      const cid = cur.cycle_id || cur.cycleId;
      if (!cid) return acc;
      if (!activeCycles.find((c) => c.id === cid)) return acc;
      return acc + Number(cur.amount_paid || cur.amountPaid || 0);
    }, 0);

    const sumDepositsWithoutCycle = depositsWithoutCycle.reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalPaidTowardsCycles = paidFromCycles + sumDepositsWithoutCycle;
    const manualDebtBase = Number(m.manual_debt_base ?? m.debt_adjustment ?? m.manualDebtBase ?? m.debtAdjustment ?? 0);
    
    // Single global debt: automatic + manual
    const totalDebtBeforePayment = memberExpected + manualDebtBase;
    const balance = totalDebtBeforePayment - totalPaidTowardsCycles;
    const finalDebt = Math.max(0, balance);
    const credit = Math.max(0, -balance);

    updates.push({ id: memberId, computed_debt: finalDebt, computed_credit: credit, computed_expected: memberExpected, computed_total: totalDeposits });

    // ensure member_cycles exist
    for (const c of activeCycles) {
      const id = `${memberId}_${c.id}`;
      const mcExisting = (memberCyclesByMember.get(memberId) || []).find((x) => x.id === id || x.cycle_id === c.id || x.cycleId === c.id);
      if (!mcExisting) {
        memberCycleUpserts.push({ id, member_id: memberId, cycle_id: c.id, status: 'unpaid', amount_paid: 0 });
      }
    }
  }

  // persist
  console.log('Writing member updates...');
  while (updates.length) {
    const batch = updates.splice(0, 50);
    const { error } = await supabase.from('members').upsert(batch, { onConflict: ['id'] });
    if (error) throw error;
  }

  console.log('Ensuring member_cycles...');
  while (memberCycleUpserts.length) {
    const batch = memberCycleUpserts.splice(0, 50);
    const { error } = await supabase.from('member_cycles').upsert(batch, { onConflict: ['id'] });
    if (error) throw error;
  }

  console.log('Backfill complete.');
}

runBackfill().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
