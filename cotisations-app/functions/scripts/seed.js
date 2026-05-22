const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const MEMBERS = ["NATHAN", "DAVE", "CORINCE", "LOUIS", "MECHACK", "MONICA", "JENO", "Elie Kam's"];
const ADMIN_NAME = process.env.ADMIN_NAME || "DAVE";
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || "12345678";
const START_DATE = process.env.START_DATE || "2026-04-05";
const WEEKLY_AMOUNT = Number(process.env.WEEKLY_AMOUNT || 10000);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmailLocalPart(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
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
      console.log("SDK initialise avec applicationDefault() (pas de serviceAccountKey.json trouve).");
    }
  }
}

async function upsertAuthUser({ email, password, displayName }) {
  try {
    const created = await admin.auth().createUser({
      email,
      password,
      displayName,
    });
    return { uid: created.uid, created: true };
  } catch (error) {
    if (error.code !== "auth/email-already-exists") {
      console.log("Create user error for", email, ":", error.code, error.message);
    }
    const existing = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(existing.uid, {
      displayName,
      password,
      disabled: false,
    });
    return { uid: existing.uid, created: false };
  }
}

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) {
    throw new Error(`START_DATE invalide (${START_DATE}). Format attendu: YYYY-MM-DD`);
  }

  if (!Number.isFinite(WEEKLY_AMOUNT) || WEEKLY_AMOUNT <= 0) {
    throw new Error(`WEEKLY_AMOUNT invalide (${WEEKLY_AMOUNT}).`);
  }

  initAdminSdk();
  const db = admin.firestore();

  console.log("Configuration globale...");
  await db.collection("settings").doc("main").set(
    {
      startDate: START_DATE,
      weeklyAmount: WEEKLY_AMOUNT,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log("Creation/mise a jour des utilisateurs...");
  const memberUids = [];
  for (const name of MEMBERS) {
    const email = `${normalizeEmailLocalPart(name)}@day.com`;
    const role = name === ADMIN_NAME ? "admin" : "member";

    const user = await upsertAuthUser({
      email,
      password: DEFAULT_PASSWORD,
      displayName: name,
    });

    await db.collection("members").doc(user.uid).set(
      {
        name,
        email,
        debtAdjustment: 0,
      },
      { merge: true }
    );

    const profile = {
      name,
      role,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    profile.memberId = user.uid;

    await db.collection("users").doc(user.uid).set(profile, { merge: true });
    memberUids.push(user.uid);

    const status = user.created ? "cree" : "mis a jour";
    console.log(`${name}: ${email} (${role}) ${status}`);
  }

  const today = new Date();
  const start = parseYmdToDate(START_DATE);
  const cycleCount = Math.max(1, Math.floor((today.getTime() - start.getTime()) / WEEK_MS) + 1);
  console.log(`Initialisation des cycles hebdo (${cycleCount})...`);
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
        weeklyAmount: WEEKLY_AMOUNT,
      },
      { merge: true }
    );
  }

  console.log("Initialisation member_cycles...");
  for (const uid of memberUids) {
    for (let i = 0; i < cycleCount; i += 1) {
      const cycleId = `w${String(i + 1).padStart(4, "0")}`;
      await db.collection("member_cycles").doc(`${uid}_${cycleId}`).set(
        {
          memberId: uid,
          cycleId,
          status: "unpaid",
          amountPaid: 0,
          confirmedAt: null,
          confirmedBy: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  console.log("Seed termine avec succes.");
  console.log(`startDate: ${START_DATE}`);
  console.log(`weeklyAmount: ${WEEKLY_AMOUNT}`);
  console.log(`admin: ${ADMIN_NAME.toLowerCase()}@day.com`);
  console.log(`mot de passe par defaut: ${DEFAULT_PASSWORD}`);
}

main().catch((error) => {
  console.error("Erreur seed:", error);
  process.exit(1);
});
