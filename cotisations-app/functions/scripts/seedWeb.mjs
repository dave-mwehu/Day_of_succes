import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBRAf1ExmQWi9CrfVB8RAru2jL6uoPCCaQ",
  authDomain: "day-of-succes.firebaseapp.com",
  projectId: "day-of-succes",
  storageBucket: "day-of-succes.firebasestorage.app",
  messagingSenderId: "957590571083",
  appId: "1:957590571083:web:3d417be0b59c0b3dd6a5ce"
};

const MEMBERS = ["NATHAN", "DAVE", "CORINCE", "LOUIS", "MECHACK", "MONICA", "JENO"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  await setDoc(doc(db, "settings", "main"), { startDate: "2026-04-05", weeklyAmount: 10000 });

  for (const name of MEMBERS) {
    const email = `${name.toLowerCase()}@day.com`;
    const role = name === "DAVE" ? "admin" : "member";
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, "12345678");
      const uid = cred.user.uid;
      if (role === "member") {
        await setDoc(doc(db, "members", uid), { name, email }, { merge: true });
      }
      await setDoc(doc(db, "users", uid), {
        name, role, memberId: role === "member" ? uid : null,
      }, { merge: true });
      console.log(`Created ${email}`);
    } catch (e) {
      console.log(`Error ${email}: ${e.message}`);
    }
  }
  process.exit(0);
}
main();
