const fs = require("fs");
const path = require("path");
const admin = require("../functions/node_modules/firebase-admin");

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  path.resolve(__dirname, "../../day-of-succes-firebase-adminsdk-fbsvc-97db454c33.json");
const outputPath = process.env.OUTPUT || path.resolve(__dirname, "../firebase-export.json");

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`Service account introuvable: ${serviceAccountPath}`);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();
const collections = [
  "settings",
  "members",
  "users",
  "weekly_cycles",
  "member_cycles",
  "deposits",
  "debt_adjustments",
  "notifications",
  "publicStats",
];

function serialize(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

async function listAuthUsers() {
  const users = [];
  let nextPageToken;
  do {
    const page = await admin.auth().listUsers(1000, nextPageToken);
    page.users.forEach((user) => {
      users.push({
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        disabled: user.disabled,
      });
    });
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return users;
}

async function exportCollection(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: serialize(doc.data()) }));
}

async function main() {
  const out = { exportedAt: new Date().toISOString(), authUsers: await listAuthUsers(), collections: {} };
  for (const name of collections) {
    out.collections[name] = await exportCollection(name);
  }
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`Export termine: ${outputPath}`);
  console.log(`${out.authUsers.length} compte(s) Auth, ${collections.length} collection(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
