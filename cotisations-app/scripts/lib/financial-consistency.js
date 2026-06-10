const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const clean = String(value).includes('T') ? String(value).slice(0, 10) : String(value);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
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

function getCycleIndex(cycle) {
  const explicit = Number(cycle?.index);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = String(cycle?.id || '').match(/^w(\d+)$/);
  return match ? Number(match[1]) : null;
}

function buildExpectedCycles(startDateYmd, weeklyAmount, today = new Date()) {
  const start = parseYmd(startDateYmd);
  if (!start) return [];
  const normalizedStart = startOfDay(start);
  const normalizedToday = startOfDay(today);
  if (normalizedToday < normalizedStart) return [];

  const count = Math.floor((normalizedToday.getTime() - normalizedStart.getTime()) / WEEK_MS) + 1;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const index = i + 1;
    const cycleStart = new Date(normalizedStart.getTime() + i * WEEK_MS);
    const cycleEnd = new Date(cycleStart.getTime() + WEEK_MS - 1);
    rows.push({
      id: cycleIdFromIndex(index),
      index,
      label: `Semaine ${index}`,
      start_date: toYmd(cycleStart),
      end_date: toYmd(cycleEnd),
      status: 'open',
      weekly_amount: Number(weeklyAmount || 10000),
    });
  }
  return rows;
}

function mergeExpectedCycles(existingCycles, expectedCycles) {
  const byId = new Map((existingCycles || []).map((cycle) => [cycle.id, cycle]));
  return expectedCycles.map((expected) => {
    const existing = byId.get(expected.id);
    return {
      ...expected,
      status: existing?.status || expected.status,
      weekly_amount: Number(existing?.weekly_amount ?? existing?.weeklyAmount ?? expected.weekly_amount),
    };
  });
}

function auditWeeklyCycles(existingCycles, expectedCycles) {
  const expectedIds = new Set(expectedCycles.map((cycle) => cycle.id));
  const byIndex = new Map();
  const duplicateIndexes = [];
  const unexpected = [];

  for (const cycle of existingCycles || []) {
    const index = getCycleIndex(cycle);
    if (!expectedIds.has(cycle.id)) unexpected.push(cycle);
    if (!index) continue;
    if (!byIndex.has(index)) byIndex.set(index, []);
    byIndex.get(index).push(cycle);
  }

  for (const [index, cycles] of byIndex.entries()) {
    if (cycles.length > 1) duplicateIndexes.push({ index, cycles });
  }

  const existingIds = new Set((existingCycles || []).map((cycle) => cycle.id));
  const missing = expectedCycles.filter((cycle) => !existingIds.has(cycle.id));

  return { missing, duplicateIndexes, unexpected };
}

function indexBy(items, getKey) {
  const map = new Map();
  for (const item of items || []) {
    const key = getKey(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function statusForAmount(amountPaid, requiredAmount) {
  return Number(amountPaid || 0) >= Number(requiredAmount || 0) ? 'paid' : 'unpaid';
}

function computeMemberFinancials(member, activeCycles, memberCycles, deposits, defaultWeeklyAmount) {
  const memberId = member.id;
  const memberCycleList = memberCycles || [];
  const memberDeposits = (deposits || [])
    .filter((deposit) => (deposit.member_id || deposit.memberId) === memberId)
    .sort((a, b) => {
      const dateA = String(a.date || '');
      const dateB = String(b.date || '');
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return String(a.created_at || a.id || '').localeCompare(String(b.created_at || b.id || ''));
    });

  const totalDeposits = memberDeposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const manualDebtBase = Number(member.manual_debt_base ?? member.debt_adjustment ?? member.manualDebtBase ?? member.debtAdjustment ?? 0);
  let remainingDeposits = totalDeposits;
  let memberExpected = 0;
  const memberCycleRows = [];

  for (const cycle of activeCycles) {
    const cycleId = cycle.id;
    const existing = memberCycleList.find((mc) => (mc.cycle_id || mc.cycleId) === cycleId);
    const weeklyAmount = Number(cycle.weekly_amount ?? cycle.weeklyAmount ?? defaultWeeklyAmount ?? 10000);
    const status = String(existing?.status || '').toLowerCase();
    const isWaived = status === 'waived';
    const obligation = isWaived ? 0 : weeklyAmount;
    const amountPaid = isWaived ? 0 : Math.min(remainingDeposits, obligation);
    if (!isWaived) {
      memberExpected += obligation;
      remainingDeposits -= amountPaid;
    }

    memberCycleRows.push({
      id: existing?.id || `${memberId}_${cycleId}`,
      member_id: memberId,
      cycle_id: cycleId,
      status: isWaived ? 'waived' : statusForAmount(amountPaid, obligation),
      amount_paid: amountPaid,
      confirmed_at: isWaived
        ? existing?.confirmed_at || null
        : amountPaid >= obligation && obligation > 0
        ? existing?.confirmed_at || new Date().toISOString()
        : null,
      confirmed_by: isWaived ? existing?.confirmed_by || null : existing?.confirmed_by || null,
      updated_at: new Date().toISOString(),
    });
  }

  const totalObligations = memberExpected + manualDebtBase;
  const balance = totalObligations - totalDeposits;
  const computedDebt = Math.max(0, balance);
  const computedCredit = Math.max(0, -balance);
  const lateWeeks = Math.ceil(computedDebt / Number(defaultWeeklyAmount || 10000));

  const existingCyclePaid = memberCycleList.reduce((sum, mc) => {
    const cycleId = mc.cycle_id || mc.cycleId;
    if (!activeCycles.some((cycle) => cycle.id === cycleId)) return sum;
    return sum + Number(mc.amount_paid || mc.amountPaid || 0);
  }, 0);

  return {
    memberId,
    totalDeposits,
    manualDebtBase,
    memberExpected,
    totalObligations,
    computedDebt,
    computedCredit,
    computedLateWeeks: lateWeeks,
    allocatedToCycles: Math.min(totalDeposits, memberExpected),
    remainingAfterCycles: Math.max(0, totalDeposits - memberExpected),
    existingCyclePaid,
    unappliedDepositAmount: totalDeposits - existingCyclePaid,
    memberCycleRows,
    memberUpdate: {
      id: memberId,
      computed_debt: computedDebt,
      computed_credit: computedCredit,
      computed_late_weeks: lateWeeks,
      computed_expected: memberExpected,
      computed_total: totalDeposits,
      stats_updated_at: new Date().toISOString(),
    },
  };
}

function buildConsistencyPlan({ settings, members, deposits, weeklyCycles, memberCycles, today = new Date() }) {
  const startDate = settings?.start_date || settings?.startDate;
  const weeklyAmount = Number(settings?.weekly_amount || settings?.weeklyAmount || 10000);
  const expectedCycles = buildExpectedCycles(startDate, weeklyAmount, today);
  const cycleAudit = auditWeeklyCycles(weeklyCycles || [], expectedCycles);
  const canonicalCycles = mergeExpectedCycles(weeklyCycles || [], expectedCycles);
  const activeCycles = canonicalCycles
    .filter((cycle) => {
      const status = String(cycle.status || 'open').toLowerCase();
      return status !== 'cancelled' && status !== 'frozen';
    })
    .sort((a, b) => Number(a.index) - Number(b.index));

  const memberCyclesByMember = indexBy(memberCycles || [], (mc) => mc.member_id || mc.memberId);
  const results = (members || []).map((member) =>
    computeMemberFinancials(
      member,
      activeCycles,
      memberCyclesByMember.get(member.id) || [],
      deposits || [],
      weeklyAmount
    )
  );

  return {
    startDate,
    weeklyAmount,
    expectedCycles,
    cyclesToUpsert: expectedCycles,
    cycleAudit,
    activeCycles,
    memberResults: results,
    memberUpdates: results.map((result) => result.memberUpdate),
    memberCycleUpserts: results.flatMap((result) => result.memberCycleRows),
    publicStats: {
      id: 'main',
      total: results.reduce((sum, result) => sum + result.totalDeposits, 0),
      expected: results.reduce((sum, result) => sum + result.memberExpected, 0),
      debt: results.reduce((sum, result) => sum + result.computedDebt, 0),
      members_count: results.length,
      late_members: results.filter((result) => result.computedDebt > 0).length,
      updated_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  WEEK_MS,
  startOfDay,
  parseYmd,
  toYmd,
  cycleIdFromIndex,
  buildExpectedCycles,
  auditWeeklyCycles,
  buildConsistencyPlan,
};
