const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "DaySuccess2026!";
const inputPath = process.env.INPUT || path.resolve(__dirname, "../firebase-export.json");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Definis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY avant l'import.");
}

if (!fs.existsSync(inputPath)) {
  throw new Error(`Fichier export introuvable: ${inputPath}`);
}

const exportData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

function rows(name) {
  return exportData.collections[name] || [];
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function upsert(table, payload, conflict = "id") {
  if (!payload.length) return;
  await request(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
}

async function createAuthUser(firebaseUser, profileDoc) {
  if (!firebaseUser.email) return null;
  const body = {
    email: firebaseUser.email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: {
      name: profileDoc?.data?.name || firebaseUser.displayName || firebaseUser.email,
      firebase_uid: firebaseUser.uid,
    },
  };
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status === 422 && text.includes("already")) {
    const found = await request(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
    return found.users.find((user) => user.email === firebaseUser.email) || null;
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const firebaseToSupabaseUser = new Map();
  const userDocs = new Map(rows("users").map((doc) => [doc.id, doc]));

  await upsert(
    "members",
    rows("members").map((doc) => ({
      id: doc.id,
      name: doc.data.name || doc.id,
      manual_debt_base: Number(doc.data.manualDebtBase ?? doc.data.debtAdjustment ?? 0),
      debt_adjustment: Number(doc.data.debtAdjustment ?? doc.data.manualDebtBase ?? 0),
      debt_adjusted_at: doc.data.debtAdjustedAt || null,
      computed_debt: Number(doc.data.computedDebt || 0),
      computed_late_weeks: Number(doc.data.computedLateWeeks || 0),
      computed_expected: Number(doc.data.computedExpected || 0),
      computed_total: Number(doc.data.computedTotal || 0),
      stats_updated_at: doc.data.statsUpdatedAt || null,
    }))
  );

  for (const authUser of exportData.authUsers || []) {
    const profileDoc = userDocs.get(authUser.uid);
    const created = await createAuthUser(authUser, profileDoc);
    if (created?.id) firebaseToSupabaseUser.set(authUser.uid, created.id);
  }

  await upsert(
    "profiles",
    rows("users")
      .map((doc) => {
        const id = firebaseToSupabaseUser.get(doc.id);
        if (!id) return null;
        return {
          id,
          email: (exportData.authUsers || []).find((user) => user.uid === doc.id)?.email || null,
          name: doc.data.name || doc.id,
          role: doc.data.role || "member",
          member_id: doc.data.memberId || null,
          firebase_uid: doc.id,
        };
      })
      .filter(Boolean)
  );

  await upsert(
    "settings",
    rows("settings").map((doc) => ({
      id: doc.id,
      start_date: dateOnly(doc.data.startDate),
      weekly_amount: Number(doc.data.weeklyAmount || 10000),
    }))
  );

  await upsert(
    "weekly_cycles",
    rows("weekly_cycles").map((doc) => ({
      id: doc.id,
      index: Number(doc.data.index || 0),
      label: doc.data.label || doc.id,
      start_date: dateOnly(doc.data.startDate),
      end_date: dateOnly(doc.data.endDate),
      status: doc.data.status || "open",
      weekly_amount: Number(doc.data.weeklyAmount || 10000),
      created_at: doc.data.createdAt || null,
    }))
  );

  await upsert(
    "member_cycles",
    rows("member_cycles").map((doc) => ({
      id: doc.id,
      member_id: doc.data.memberId,
      cycle_id: doc.data.cycleId,
      status: doc.data.status || "unpaid",
      amount_paid: Number(doc.data.amountPaid || 0),
      confirmed_at: doc.data.confirmedAt || null,
      confirmed_by: firebaseToSupabaseUser.get(doc.data.confirmedBy) || null,
      updated_at: doc.data.updatedAt || null,
    }))
  );

  await upsert(
    "deposits",
    rows("deposits").map((doc) => ({
      firebase_id: doc.id,
      member_id: doc.data.memberId,
      amount: Number(doc.data.amount || 0),
      date: dateOnly(doc.data.date),
      cycle_id: doc.data.cycleId || null,
      created_at: doc.data.createdAt || null,
      created_by: firebaseToSupabaseUser.get(doc.data.createdBy) || null,
      firebase_created_by: doc.data.createdBy || null,
    })),
    "firebase_id"
  );

  await upsert(
    "debt_adjustments",
    rows("debt_adjustments").map((doc) => ({
      firebase_id: doc.id,
      member_id: doc.data.memberId || null,
      member_name: doc.data.memberName || null,
      delta: Number(doc.data.delta || 0),
      target_debt: doc.data.targetDebt == null ? null : Number(doc.data.targetDebt),
      auto_debt: doc.data.autoDebt == null ? null : Number(doc.data.autoDebt),
      reason: doc.data.reason || null,
      author: firebaseToSupabaseUser.get(doc.data.author) || null,
      firebase_author: doc.data.author || null,
      created_at: doc.data.createdAt || null,
    })),
    "firebase_id"
  );

  await upsert(
    "public_stats",
    rows("publicStats").map((doc) => ({
      id: doc.id,
      total: Number(doc.data.total || 0),
      expected: Number(doc.data.expected || 0),
      debt: Number(doc.data.debt || 0),
      members_count: Number(doc.data.membersCount || 0),
      late_members: Number(doc.data.lateMembers || 0),
      updated_at: doc.data.updatedAt || null,
    }))
  );

  await upsert(
    "notifications",
    rows("notifications").map((doc) => ({
      firebase_id: doc.id,
      uid: firebaseToSupabaseUser.get(doc.data.uid) || null,
      firebase_uid: doc.data.uid || null,
      member_id: doc.data.memberId || null,
      member_name: doc.data.memberName || null,
      debt: doc.data.debt == null ? null : Number(doc.data.debt),
      weekly_amount: doc.data.weeklyAmount == null ? null : Number(doc.data.weeklyAmount),
      message: doc.data.message || "",
      read: Boolean(doc.data.read),
      created_at: doc.data.createdAt || null,
    })),
    "firebase_id"
  );

  console.log("Import Supabase termine.");
  console.log(`Mot de passe temporaire des comptes importes: ${DEFAULT_PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
