const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

async function ensureWeeklyCycles(startDateYmd, weeklyAmount) {
  if (!startDateYmd) return [];
  const start = new Date(startDateYmd + 'T00:00:00');
  const today = startOfDay(new Date());
  if (today < start) return [];
  const diff = startOfDay(today).getTime() - startOfDay(start).getTime();
  const count = Math.floor(diff / WEEK_MS) + 1;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const index = i + 1;
    const cycleStart = new Date(start.getTime() + i * WEEK_MS);
    const cycleEnd = new Date(cycleStart.getTime() + WEEK_MS - 1);
    rows.push({
      id: cycleIdFromIndex(index),
      index,
      label: `Semaine ${index}`,
      start_date: toYmd(cycleStart),
      end_date: toYmd(cycleEnd),
      status: 'open',
      weekly_amount: weeklyAmount,
    });
  }
  // upsert cycles
  const { data, error } = await supabase.from('weekly_cycles').upsert(rows, { onConflict: ['id'] });
  if (error) throw error;
  return rows.map((r) => r.id);
}

async function loadAllData() {
  const [{ data: settings }, { data: members }, { data: deposits }, { data: weeklyCycles }, { data: memberCycles }] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 'main').maybeSingle(),
    supabase.from('members').select('*'),
    supabase.from('deposits').select('*'),
    supabase.from('weekly_cycles').select('*'),
    supabase.from('member_cycles').select('*'),
  ]);
  return { settings: settings || null, members: members || [], deposits: deposits || [], weeklyCycles: weeklyCycles || [], memberCycles: memberCycles || [] };
}

async function applyWeeklyLogic() {
  const { settings, members, deposits, weeklyCycles, memberCycles } = await loadAllData();
  const startDate = settings?.start_date || settings?.startDate || null;
  const weeklyAmount = Number(settings?.weekly_amount || settings?.weeklyAmount || 10000);

  // ensure cycles up to today
  await ensureWeeklyCycles(startDate, weeklyAmount);

  // reload cycles
  const { data: cycles } = await supabase.from('weekly_cycles').select('*');
  const activeCycles = (cycles || []).filter((c) => {
    if (!c.start_date) return false;
    const sd = startOfDay(new Date(c.start_date + 'T00:00:00'));
    const status = (c.status || 'open').toLowerCase();
    return sd.getTime() <= startOfDay(new Date()).getTime() && status !== 'cancelled' && status !== 'frozen';
  });

  // index member cycles by member
  const memberCyclesByMember = new Map();
  (memberCycles || []).forEach((mc) => {
    const memberId = mc.member_id || mc.memberId;
    if (!memberId) return;
    if (!memberCyclesByMember.has(memberId)) memberCyclesByMember.set(memberId, []);
    memberCyclesByMember.get(memberId).push(mc);
  });

  // index deposits
  const depositsByMember = new Map();
  (deposits || []).forEach((d) => {
    const memberId = d.member_id || d.memberId;
    if (!memberId) return;
    if (!depositsByMember.has(memberId)) depositsByMember.set(memberId, []);
    depositsByMember.get(memberId).push(d);
  });

  const updates = [];
  const memberCycleUpserts = [];
  const notifications = [];

  // compute per-member
  for (const m of (members || [])) {
    const memberId = m.id;
    const memberDeposits = (depositsByMember.get(memberId) || []);
    // separate deposits with cycle_id (already assigned) vs without
    const depositsWithCycle = memberDeposits.filter((d) => d.cycle_id || d.cycleId);
    const depositsWithoutCycle = memberDeposits.filter((d) => !(d.cycle_id || d.cycleId));
    const totalDeposits = memberDeposits.reduce((s, d) => s + Number(d.amount || 0), 0);

    // compute memberExpected: sum weekly_amount for active cycles unless waived for member
    let memberExpected = 0;
    for (const c of activeCycles) {
      const cycleWeekly = Number(c.weekly_amount || c.weeklyAmount || weeklyAmount);
      const mcList = memberCyclesByMember.get(memberId) || [];
      const mc = mcList.find((x) => x.cycle_id === c.id || x.cycleId === c.id);
      if (mc && String((mc.status || mc.status || '')).toLowerCase() === 'waived') continue;
      memberExpected += cycleWeekly;
    }

    // paidFromCycles = sum of amount_paid for member_cycles in activeCycles
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

    // ensure member_cycles exist for each active cycle
    for (const c of activeCycles) {
      const id = `${memberId}_${c.id}`;
      const mcExisting = (memberCyclesByMember.get(memberId) || []).find((x) => x.id === id || x.cycle_id === c.id || x.cycleId === c.id);
      if (!mcExisting) {
        memberCycleUpserts.push({ id, member_id: memberId, cycle_id: c.id, status: 'unpaid', amount_paid: 0 });
      }
    }

    // apply credit to current week if any
    const today = startOfDay(new Date());
    const start = new Date((settings?.start_date || settings?.startDate) + 'T00:00:00');
    const index = Math.floor((today.getTime() - startOfDay(start).getTime()) / WEEK_MS) + 1;
    const currentCycleId = cycleIdFromIndex(index);
    const currentCycle = activeCycles.find((c) => c.id === currentCycleId);
    if (currentCycle) {
      const mcList = memberCyclesByMember.get(memberId) || [];
      const mc = mcList.find((x) => x.cycle_id === currentCycleId || x.cycleId === currentCycleId);
      if (mc && String((mc.status || mc.status || '')).toLowerCase() === 'waived') {
        // skip
      } else {
        // Apply credit across current and future cycles: credit can cover multiple weeks
        const paidBefore = (memberCyclesByMember.get(memberId) || []).reduce((acc, cur) => {
          const cid = cur.cycle_id || cur.cycleId;
          if (!cid) return acc;
          // Exclude current cycle
          if (cid === currentCycleId) return acc;
          return acc + Number(cur.amount_paid || cur.amountPaid || 0);
        }, 0);
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
      }
    }
  }

  // persist updates in chunks
  while (updates.length) {
    const batch = updates.splice(0, 50);
    const { error } = await supabase.from('members').upsert(batch, { onConflict: ['id'] });
    if (error) throw error;
  }

  while (memberCycleUpserts.length) {
    const batch = memberCycleUpserts.splice(0, 50);
    const { error } = await supabase.from('member_cycles').upsert(batch, { onConflict: ['id'] });
    if (error) throw error;
  }

  if (notifications.length) {
    while (notifications.length) {
      const batch = notifications.splice(0, 50);
      const { error } = await supabase.from('notifications').insert(batch);
      if (error) throw error;
    }
  }

  // final recompute: update public_stats-like summary
  await recomputePublicStats();
}

async function recomputePublicStats() {
  // simple aggregation
  const [{ data: members }, { data: memberCycles }] = await Promise.all([
    supabase.from('members').select('*'),
    supabase.from('member_cycles').select('*'),
  ]);
  const total = (members || []).reduce((s, m) => s + Number(m.computed_total || 0), 0);
  const expected = (members || []).reduce((s, m) => s + Number(m.computed_expected || 0), 0);
  const debt = (members || []).reduce((s, m) => s + Number(m.computed_debt || 0), 0);
  const lateMembers = (members || []).filter((m) => Number(m.computed_debt || 0) > 0).length;
  await supabase.from('public_stats').upsert([{ id: 'main', total, expected, debt, members_count: (members || []).length, late_members: lateMembers, updated_at: new Date().toISOString() }], { onConflict: ['id'] });
}

// Netlify function handler
exports.handler = async function (event, context) {
  try {
    await applyWeeklyLogic();
    return { statusCode: 200, body: 'Weekly contribution processing completed.' };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err) };
  }
};
