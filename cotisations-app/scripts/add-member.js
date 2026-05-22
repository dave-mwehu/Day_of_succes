/**
 * add-member.js — Ajoute un nouveau membre dans Supabase.
 *
 * Usage :
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   MEMBER_NAME="Exaucee" \
 *   node scripts/add-member.js
 *
 * Variables optionnelles :
 *   MEMBER_PASSWORD  (défaut: DaySuccess2026!)
 *   EMAIL_DOMAIN     (défaut: day.com)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MEMBER_NAME = process.env.MEMBER_NAME;
const MEMBER_PASSWORD = process.env.MEMBER_PASSWORD || 'DaySuccess2026!';
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'day.com';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Définis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!MEMBER_NAME || !MEMBER_NAME.trim()) {
  console.error('❌  Définis MEMBER_NAME (ex: MEMBER_NAME="Exaucee").');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeEmailLocalPart(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const name = MEMBER_NAME.trim();
  const emailLocal = normalizeEmailLocalPart(name);
  const email = `${emailLocal}@${EMAIL_DOMAIN}`;
  const memberId = emailLocal; // id texte stable, lisible

  console.log(`\n🚀  Ajout du membre : ${name}`);
  console.log(`   email    : ${email}`);
  console.log(`   memberId : ${memberId}`);
  console.log(`   password : ${MEMBER_PASSWORD}\n`);

  // ── 1. Créer l'utilisateur Supabase Auth ────────────────────────────────────
  console.log('1/4  Création compte Auth…');
  let authUserId;

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: MEMBER_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createError) {
    // L'utilisateur existe peut-être déjà
    if (createError.message?.toLowerCase().includes('already')) {
      console.log('     ⚠️  Utilisateur Auth déjà existant — récupération…');
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (listError) throw listError;
      const found = listData.users.find((u) => u.email === email);
      if (!found) throw new Error(`Impossible de trouver l'utilisateur Auth pour ${email}`);
      authUserId = found.id;
      console.log(`     ✅ Auth UUID récupéré : ${authUserId}`);
    } else {
      throw createError;
    }
  } else {
    authUserId = createData.user.id;
    console.log(`     ✅ Auth UUID créé : ${authUserId}`);
  }

  // ── 2. Insérer dans members ─────────────────────────────────────────────────
  console.log('2/4  Insertion dans members…');
  const { error: memberError } = await supabase.from('members').upsert(
    {
      id: memberId,
      name,
      manual_debt_base: 0,
      debt_adjustment: 0,
      computed_debt: 0,
      computed_late_weeks: 0,
      computed_expected: 0,
      computed_total: 0,
    },
    { onConflict: 'id' }
  );
  if (memberError) throw memberError;
  console.log('     ✅ Membre inséré.');

  // ── 3. Insérer dans profiles ────────────────────────────────────────────────
  console.log('3/4  Insertion dans profiles…');
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: authUserId,
      email,
      name,
      role: 'member',
      member_id: memberId,
    },
    { onConflict: 'id' }
  );
  if (profileError) throw profileError;
  console.log('     ✅ Profile inséré.');

  // ── 4. Créer les member_cycles pour tous les cycles existants ───────────────
  console.log('4/4  Création member_cycles pour les cycles existants…');
  const { data: cycles, error: cycleError } = await supabase
    .from('weekly_cycles')
    .select('id')
    .order('index');
  if (cycleError) throw cycleError;

  if (!cycles?.length) {
    console.log('     ⚠️  Aucun weekly_cycle trouvé — à créer via "Init Cycles" dans l\'app.');
  } else {
    const mcRows = cycles.map((c) => ({
      id: `${memberId}_${c.id}`,
      member_id: memberId,
      cycle_id: c.id,
      status: 'unpaid',
      amount_paid: 0,
    }));
    const { error: mcError } = await supabase
      .from('member_cycles')
      .upsert(mcRows, { onConflict: 'id' });
    if (mcError) throw mcError;
    console.log(`     ✅ ${mcRows.length} member_cycles créés.`);
  }

  console.log(`\n🎉  Membre "${name}" ajouté avec succès.`);
  console.log(`   Identifiant : ${email}`);
  console.log(`   Mot de passe : ${MEMBER_PASSWORD}`);
  console.log(`   member_id (interne) : ${memberId}\n`);
}

main().catch((err) => {
  console.error('\n❌  Erreur :', err.message || err);
  process.exit(1);
});
