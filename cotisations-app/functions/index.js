const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weeksSinceDate(date) {
  if (!date) return 0;
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  if (today <= target) return 0;
  return Math.floor((today.getTime() - target.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

async function recomputeStats() {
  const settingsSnap = await db.collection("settings").doc("main").get();
  const startDate = settingsSnap.data()?.startDate || null;
  const weeklyAmount = Number(settingsSnap.data()?.weeklyAmount || 10000);

  const [membersSnap, depositsSnap, weeklyCyclesSnap, memberCyclesSnap] = await Promise.all([
    db.collection("members").get(),
    db.collection("deposits").get(),
    db.collection("weekly_cycles").get(),
    db.collection("member_cycles").get(),
  ]);

  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const deposits = depositsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const weeklyCycles = weeklyCyclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const memberCycles = memberCyclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const depositsByMember = new Map();
  deposits.forEach((d) => {
    if (!depositsByMember.has(d.memberId)) depositsByMember.set(d.memberId, 0);
    depositsByMember.set(d.memberId, depositsByMember.get(d.memberId) + Number(d.amount || 0));
  });

  let total = 0;
  let expected = 0;
  let debt = 0;
  let lateMembers = 0;

  const today = startOfDay(new Date()).toISOString().slice(0, 10);
  const activeCycles = weeklyCycles.filter((c) => {
    if (!c.startDate) return false;
    const start = parseYmd(c.startDate);
    const sd = startOfDay(start).toISOString().slice(0, 10);
    const status = (c.status || "open").toLowerCase();
    return sd <= today && status !== "cancelled" && status !== "frozen";
  });

  const memberCyclesByMember = new Map();
  memberCycles.forEach((mc) => {
    const memberId = mc.memberId || mc.member_id;
    if (!memberId) return;
    if (!memberCyclesByMember.has(memberId)) memberCyclesByMember.set(memberId, []);
    memberCyclesByMember.get(memberId).push(mc);
  });

  const memberUpdates = [];
  members.forEach((m) => {
    const memberTotal = Number(depositsByMember.get(m.id) || 0);
    total += memberTotal;

    let memberExpected = 0;
    activeCycles.forEach((c) => {
      const cycleWeekly = Number(c.weeklyAmount || weeklyAmount);
      const mcList = memberCyclesByMember.get(m.id) || [];
      const mc = mcList.find((x) => (x.cycleId || x.cycle_id) === c.id);
      const status = mc ? mc.status || mc.status : null;
      if (status && String(status).toLowerCase() === "waived") return;
      memberExpected += cycleWeekly;
    });

    const paidFromCycles = (memberCyclesByMember.get(m.id) || []).reduce((acc, cur) => {
      const cid = cur.cycleId || cur.cycle_id;
      if (!cid) return acc;
      if (!activeCycles.find((c) => c.id === cid)) return acc;
      return acc + Number(cur.amountPaid || cur.amount_paid || 0);
    }, 0);

    const depositsWithoutCycle = deposits
      .filter((d) => d.memberId === m.id && !(d.cycleId || d.cycle_id))
      .reduce((s, d) => s + Number(d.amount || 0), 0);

    const totalPaidTowardsCycles = paidFromCycles + depositsWithoutCycle;

    const manualDebtBase = Number(m.manualDebtBase ?? m.debtAdjustment ?? m.manual_debt_base ?? m.debt_adjustment ?? 0);

    const autoDebt = Math.max(0, memberExpected - totalPaidTowardsCycles);
    const finalDebt = Math.max(0, autoDebt + manualDebtBase);

    expected += memberExpected;
    debt += finalDebt;
    if (finalDebt > 0) lateMembers += 1;

    const elapsedWeeks = Math.ceil(finalDebt / weeklyAmount);

    memberUpdates.push({
      ref: db.collection("members").doc(m.id),
      data: {
        computedDebt: finalDebt,
        computedCredit: Math.max(0, totalPaidTowardsCycles - memberExpected),
        computedLateWeeks: elapsedWeeks,
        computedExpected: memberExpected,
        computedTotal: memberTotal,
        statsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  for (const group of chunk(memberUpdates, 400)) {
    const batch = db.batch();
    group.forEach((u) => batch.set(u.ref, u.data, { merge: true }));
    await batch.commit();
  }

  await db.collection("publicStats").doc("main").set(
    {
      total,
      expected,
      debt,
      membersCount: members.length,
      lateMembers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "cloud-function",
    },
    { merge: true }
  );
}

exports.syncStatsOnFinanceChange = onDocumentWritten(
  { document: "{collectionId}/{docId}", region: "us-central1" },
  async (event) => {
    // Retrait de 'members' pour éviter une boucle de rechargement/sur-écriture infinie des statistiques
    const allowed = new Set(["deposits", "weekly_cycles", "member_cycles", "debt_adjustments"]);
    if (!allowed.has(event.params.collectionId)) return;
    await recomputeStats();
  }
);
const { onSchedule } = require("firebase-functions/v2/scheduler");

function weeksElapsedSince(startDateYmd) {
  if (!startDateYmd) return 0;
  const start = startOfDay(parseYmd(startDateYmd));
  const today = startOfDay(new Date());
  if (today < start) return 0;

  const diffMs = today.getTime() - start.getTime();
  const fullWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return fullWeeks + 1;
}

exports.weeklyContributionReminder = onSchedule(
  {
    schedule: "0 8 * * 0",
    timeZone: "Africa/Lubumbashi",
    region: "us-central1",
  },
  async () => {
    const db = admin.firestore();

    const settingsSnap = await db.collection("settings").doc("main").get();
    const settings = settingsSnap.data() || {};
    const weeklyAmount = settings.weeklyAmount || 10000;
    // Ensure weekly cycle for current week exists, then apply available credits automatically.
    const today = startOfDay(new Date());
    const start = settings.startDate ? parseYmd(settings.startDate) : null;
    if (!start) return;
    const diff = today.getTime() - startOfDay(start).getTime();
    const weekIndex = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
    const cycleId = `w${String(weekIndex).padStart(4, "0")}`;

    // create or update weekly cycle
    const cycleStart = new Date(start.getTime() + (weekIndex - 1) * 7 * 24 * 60 * 60 * 1000);
    const cycleEnd = new Date(cycleStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    await db.collection("weekly_cycles").doc(cycleId).set(
      {
        id: cycleId,
        index: weekIndex,
        label: `Semaine ${weekIndex}`,
        startDate: `${cycleStart.getFullYear()}-${String(cycleStart.getMonth() + 1).padStart(2, "0")}-${String(cycleStart.getDate()).padStart(2, "0")}`,
        endDate: `${cycleEnd.getFullYear()}-${String(cycleEnd.getMonth() + 1).padStart(2, "0")}-${String(cycleEnd.getDate()).padStart(2, "0")}`,
        status: "open",
        weeklyAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Load members, deposits and member_cycles to decide credit usage
    const [membersSnap, usersSnap, depositsSnap, memberCyclesSnap] = await Promise.all([
      db.collection("members").get(),
      db.collection("users").where("role", "==", "member").get(),
      db.collection("deposits").get(),
      db.collection("member_cycles").get(),
    ]);

    const deposits = depositsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const memberCycles = memberCyclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const memberCyclesByMember = new Map();
    memberCycles.forEach((mc) => {
      const memberId = mc.memberId || mc.member_id;
      if (!memberId) return;
      if (!memberCyclesByMember.has(memberId)) memberCyclesByMember.set(memberId, []);
      memberCyclesByMember.get(memberId).push(mc);
    });

    const depositsByMember = new Map();
    deposits.forEach((d) => {
      if (!depositsByMember.has(d.memberId)) depositsByMember.set(d.memberId, 0);
      depositsByMember.set(d.memberId, depositsByMember.get(d.memberId) + Number(d.amount || 0));
    });

    const batch = db.batch();

    usersSnap.forEach((uDoc) => {
      const u = uDoc.data();
      const memberId = u.memberId;
      if (!memberId) return;

      // compute paid so far (from member_cycles) for previous cycles
      const mcList = memberCyclesByMember.get(memberId) || [];
      const paidBefore = mcList.reduce((acc, cur) => {
        const cid = cur.cycleId || cur.cycle_id;
        if (!cid) return acc;
        // ignore current cycle
        if (cid === cycleId) return acc;
        return acc + Number(cur.amountPaid || cur.amount_paid || 0);
      }, 0);

      const totalDeposits = Number(depositsByMember.get(memberId) || 0);
      const creditAvailable = Math.max(0, totalDeposits - paidBefore);

      // load member cycle for current week
      const mcRef = db.collection("member_cycles").doc(`${memberId}_${cycleId}`);
      const mcDoc = (mcList || []).find((c) => (c.cycleId || c.cycle_id) === cycleId);

      // if cycle is waived, skip
      if (mcDoc && String((mcDoc.status || mcDoc.status || "")).toLowerCase() === "waived") return;

      if (creditAvailable >= weeklyAmount) {
        batch.set(mcRef, {
          memberId,
          cycleId,
          status: "paid",
          amountPaid: weeklyAmount,
          confirmedBy: "system",
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } else if (creditAvailable > 0) {
        batch.set(mcRef, {
          memberId,
          cycleId,
          status: "unpaid",
          amountPaid: creditAvailable,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        // ensure a member_cycle exists in unpaid state
        batch.set(mcRef, {
          memberId,
          cycleId,
          status: mcDoc ? mcDoc.status || "unpaid" : "unpaid",
          amountPaid: mcDoc ? Number(mcDoc.amountPaid || mcDoc.amount_paid || 0) : 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      // create a notification for the member summarizing the situation
      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        uid: uDoc.id,
        memberId,
        memberName: u.name || "Membre",
        weeklyAmount,
        message: `Nouvelle semaine ${cycleId} generee. Credit applique: ${Math.min(creditAvailable, weeklyAmount)} FC.`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    });

    await batch.commit();

    // Recompute stats after applying credits
    await recomputeStats();
  }
);
