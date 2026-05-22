const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WEEKLY = Number(process.env.WEEKLY_AMOUNT || 10000);

function initAdminSdk() {
  const explicitPath = process.env.SERVICE_ACCOUNT_PATH;
  const candidates = [
    explicitPath,
    path.resolve(__dirname, "..", "serviceAccountKey.json"),
    path.resolve(__dirname, "..", "..", "..", "day-of-succes-firebase-adminsdk-fbsvc-97db454c33.json"),
  ].filter(Boolean);

  let keyPath = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      keyPath = candidate;
      break;
    }
  }

  if (!admin.apps.length) {
    if (keyPath) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log(`SDK initialise avec service account: ${keyPath}`);
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log("SDK initialise avec applicationDefault().");
    }
  }
}

function parseYmdToDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function cycleIdFromDate(startDateYmd, date) {
  const start = startOfDay(parseYmdToDate(startDateYmd));
  const target = startOfDay(date);
  const diff = target.getTime() - start.getTime();
  if (diff < 0) return null;
  const index = Math.floor(diff / WEEK_MS) + 1;
  return `w${String(index).padStart(4, "0")}`;
}

async function main() {
  initAdminSdk();
  const db = admin.firestore();

  const settingsSnap = await db.collection("settings").doc("main").get();
  const settings = settingsSnap.data() || {};
  const startDate = settings.startDate || process.env.START_DATE;
  const weeklyAmount = Number(settings.weeklyAmount || DEFAULT_WEEKLY);
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("START_DATE invalide dans settings/main.");
  }

  const today = startOfDay(new Date());
  const start = startOfDay(parseYmdToDate(startDate));
  const cycleCount = Math.floor((today.getTime() - start.getTime()) / WEEK_MS) + 1;
  const membersSnap = await db.collection("members").get();
  const depositsSnap = await db.collection("deposits").get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const deposits = depositsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`Membres: ${members.length} | Depots: ${deposits.length} | Cycles: ${cycleCount}`);

  for (let i = 0; i < cycleCount; i += 1) {
    const index = i + 1;
    const cycleId = `w${String(index).padStart(4, "0")}`;
    const cycleStart = new Date(start.getTime() + i * WEEK_MS);
    const cycleEnd = new Date(cycleStart.getTime() + WEEK_MS - 1);
    await db.collection("weekly_cycles").doc(cycleId).set(
      {
        index,
        label: `Semaine ${index}`,
        startDate: toYmd(cycleStart),
        endDate: toYmd(cycleEnd),
        status: "open",
        weeklyAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  for (const member of members) {
    for (let i = 0; i < cycleCount; i += 1) {
      const cycleId = `w${String(i + 1).padStart(4, "0")}`;
      const cycleDeposits = deposits.filter((d) => {
        if (d.memberId !== member.id) return false;
        const dDate = d.date?.toDate ? d.date.toDate() : null;
        if (!dDate) return false;
        return cycleIdFromDate(startDate, dDate) === cycleId;
      });
      const cycleTotal = cycleDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);
      const status = cycleTotal >= weeklyAmount ? "paid" : "unpaid";
      await db.collection("member_cycles").doc(`${member.id}_${cycleId}`).set(
        {
          memberId: member.id,
          cycleId,
          status,
          amountPaid: cycleTotal,
          confirmedBy: status === "paid" ? "backfill" : null,
          confirmedAt:
            status === "paid" ? admin.firestore.FieldValue.serverTimestamp() : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  console.log("Backfill termine.");
}

main().catch((error) => {
  console.error("Erreur backfill:", error);
  process.exit(1);
});
