import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const WEEKLY_AMOUNT = 10000;
const CYCLE_MS = 7 * 24 * 60 * 60 * 1000;
const isConfigured = !SUPABASE_URL.includes("TON-PROJET") && !SUPABASE_ANON_KEY.includes("COLLE_ICI");
const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  session: null,
  profile: null,
  settings: null,
  members: [],
  profiles: [],
  memberRecord: null,
  weeklyCycles: [],
  memberCycles: [],
  deposits: [],
  debtAdjustments: [],
  notifications: [],
  publicStats: null,
  ui: { query: "", lateOnly: false, sort: "debt-desc" },
  lastPublishedPublicStatsSignature: null,
  channel: null,
};

const $ = (id) => document.getElementById(id);
const authSection = $("authSection");
const appSection = $("appSection");
const adminView = $("adminView");
const memberView = $("memberView");
const welcomeText = $("welcomeText");
const systemInfo = $("systemInfo");
const loginForm = $("loginForm");
const logoutBtn = $("logoutBtn");
const togglePassword = $("togglePassword");
const depositForm = $("depositForm");
const depositMember = $("depositMember");
const depositAmount = $("depositAmount");
const depositDate = $("depositDate");
const cycleMember = $("cycleMember");
const cycleSelect = $("cycleSelect");
const cycleStatus = $("cycleStatus");
const confirmCycleBtn = $("confirmCycleBtn");
const waiveCycleBtn = $("waiveCycleBtn");
const reopenCycleBtn = $("reopenCycleBtn");
const membersList = $("membersList");
const debtsTableBody = $("debtsTableBody");
const adminDepositsList = $("adminDepositsList");
const debtHistoryList = $("debtHistoryList");
const sortDebt = $("sortDebt");
const filterLateOnly = $("filterLateOnly");
const searchMember = $("searchMember");
const globalTotal = $("globalTotal");
const globalExpected = $("globalExpected");
const globalDebt = $("globalDebt");
const globalLateMembers = $("globalLateMembers");
const initCyclesBtn = $("initCyclesBtn");
const memberTotal = $("memberTotal");
const memberExpected = $("memberExpected");
const memberDebt = $("memberDebt");
const memberStatus = $("memberStatus");
const memberLateBadge = $("memberLateBadge");
const memberLateBadgeWrap = $("memberLateBadgeWrap");
const memberGlobalTotal = $("memberGlobalTotal");
const memberThisWeekStatus = $("memberThisWeekStatus");
const memberStreak = $("memberStreak");
const memberWeekTimeline = $("memberWeekTimeline");
const memberDepositsList = $("memberDepositsList");
const memberNotificationsList = $("memberNotificationsList");
const toastContainer = $("toastContainer");
const adminSkeleton = $("adminSkeleton");
const memberSkeleton = $("memberSkeleton");

function formatFc(value) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value || 0)))} FC`;
}

function showToast(message, type = "info") {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

function assertSupabase() {
  if (!supabase) {
    throw new Error("Supabase n'est pas encore configure dans public/config.js.");
  }
}

function handleDb({ data, error }) {
  if (error) throw error;
  return data;
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const clean = value.includes("T") ? value.slice(0, 10) : value;
    const [y, m, d] = clean.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function weeksElapsedSince(startDateYmd) {
  const startDate = parseDate(startDateYmd);
  if (!startDate) return 0;
  const start = startOfDay(startDate);
  const today = startOfDay(new Date());
  if (today < start) return 0;
  return Math.floor((today.getTime() - start.getTime()) / CYCLE_MS) + 1;
}

function weeksDueSince(startDateYmd) {
  return weeksDueBetween(parseDate(startDateYmd), new Date());
}

function weeksDueBetween(startDate, endDate) {
  if (!startDate) return 0;
  const start = startOfDay(startDate);
  const end = startOfDay(endDate || new Date());
  if (end <= start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / CYCLE_MS);
}

function weeksSinceDate(date) {
  if (!date) return 0;
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  if (today <= target) return 0;
  return Math.floor((today.getTime() - target.getTime()) / CYCLE_MS);
}

function cycleIdFromDate(startDateYmd, date) {
  const start = parseDate(startDateYmd);
  if (!start || !date) return null;
  const diff = startOfDay(date).getTime() - startOfDay(start).getTime();
  if (diff < 0) return null;
  return `w${String(Math.floor(diff / CYCLE_MS) + 1).padStart(4, "0")}`;
}

function animateNumber(el, nextValue) {
  if (!el) return;
  const target = Number(nextValue || 0);
  const prev = Number(el.dataset.value || 0);
  const duration = 380;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = formatFc(prev + (target - prev) * progress);
    if (progress < 1) requestAnimationFrame(step);
    else el.dataset.value = String(target);
  }
  requestAnimationFrame(step);
}

function showApp(role) {
  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  adminView.classList.toggle("hidden", role !== "admin");
  memberView.classList.toggle("hidden", role !== "member");
}

function showAuth() {
  appSection.classList.add("hidden");
  authSection.classList.remove("hidden");
  adminView.classList.add("hidden");
  memberView.classList.add("hidden");
}

function renderSystemInfo() {
  const start = state.settings?.start_date || "non defini";
  const weekly = Number(state.settings?.weekly_amount || WEEKLY_AMOUNT);
  const weeks = weeksElapsedSince(state.settings?.start_date);
  systemInfo.textContent = `Debut: ${start} | Cycles: ${weeks} | Montant hebdo: ${formatFc(weekly)} | Statut: Supabase`;
}

function getActiveCycles() {
  return state.weeklyCycles.filter((c) => c.status !== "cancelled" && c.status !== "frozen");
}

function getMemberCycle(memberId, cycleId) {
  return state.memberCycles.find((mc) => mc.member_id === memberId && mc.cycle_id === cycleId) || null;
}

function computeStreak(cycles) {
  let streak = 0;
  for (let i = cycles.length - 1; i >= 0; i -= 1) {
    if (cycles[i].status === "paid" || cycles[i].status === "waived") streak += 1;
    else break;
  }
  return streak;
}

function getLastDepositDateForMember(memberId) {
  const dates = state.deposits
    .filter((d) => d.member_id === memberId)
    .map((d) => parseDate(d.date))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] || null;
}

function computeMemberStats(member) {
  const weekly = Number(state.settings?.weekly_amount || WEEKLY_AMOUNT);
  const activeCycles = getActiveCycles().sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  const memberDeposits = state.deposits
    .filter((d) => d.member_id === member.id)
    .map((d) => ({ ...d, parsedDate: parseDate(d.date) }))
    .filter((d) => d.parsedDate)
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
  const total = memberDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const firstDepositDate = memberDeposits[0]?.parsedDate || parseDate(state.settings?.start_date);
  const firstDepositYmd = firstDepositDate ? toYmd(firstDepositDate) : null;
  const initialCapital = memberDeposits
    .filter((deposit) => toYmd(deposit.parsedDate) === firstDepositYmd)
    .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const paymentsAfterCapital = memberDeposits
    .filter((deposit) => toYmd(deposit.parsedDate) !== firstDepositYmd)
    .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const elapsedWeeks = firstDepositDate ? weeksDueBetween(firstDepositDate, new Date()) : activeCycles.length;
  const expected = elapsedWeeks * weekly;

  const manualDebtBase = Number(member.manual_debt_base ?? member.debt_adjustment ?? 0);
  const totalDebtBeforePayments = expected + manualDebtBase;
  const balance = totalDebtBeforePayments - paymentsAfterCapital;
  const debt = Math.max(0, balance);
  const credit = Math.max(0, -balance);
  const autoDebt = Math.max(0, expected - paymentsAfterCapital);
  const lateWeeks = Math.ceil(debt / weekly);
  const streak = computeStreak(activeCycles.map((c) => getMemberCycle(member.id, c.id) || { status: "unpaid" }));
  return { expected, total, initialCapital, paymentsAfterCapital, autoDebt, manualDebtBase, debt, credit, lateWeeks, elapsedWeeks, lastDepositDate: getLastDepositDateForMember(member.id), streak };
}

async function loadProfile(userId) {
  return handleDb(await supabase.from("profiles").select("*").eq("id", userId).single());
}

async function loadSettings() {
  const rows = handleDb(await supabase.from("settings").select("*").eq("id", "main").limit(1));
  state.settings = rows?.[0] || { id: "main", weekly_amount: WEEKLY_AMOUNT, start_date: null };
}

async function loadAdminData() {
  const [profiles, members, weeklyCycles, memberCycles, deposits, debtAdjustments, publicStats] = await Promise.all([
    supabase.from("profiles").select("*").order("name"),
    supabase.from("members").select("*").order("name"),
    supabase.from("weekly_cycles").select("*").order("index"),
    supabase.from("member_cycles").select("*"),
    supabase.from("deposits").select("*").order("date", { ascending: false }).limit(300),
    supabase.from("debt_adjustments").select("*").order("created_at", { ascending: false }).limit(80),
    supabase.from("public_stats").select("*").eq("id", "main").limit(1),
  ]);
  state.profiles = handleDb(profiles);
  const activeMemberIds = new Set(state.profiles.map((p) => p.member_id).filter(Boolean));
  const allMembers = handleDb(members);
  state.members = activeMemberIds.size
    ? allMembers.filter((m) => activeMemberIds.has(m.id) || m.id === state.profile?.member_id)
    : allMembers;
  state.weeklyCycles = handleDb(weeklyCycles);
  state.memberCycles = handleDb(memberCycles);
  state.deposits = handleDb(deposits);
  state.debtAdjustments = handleDb(debtAdjustments);
  state.publicStats = handleDb(publicStats)?.[0] || null;
}

async function loadMemberData() {
  const memberId = state.profile?.member_id;
  const [member, weeklyCycles, memberCycles, deposits, notifications, publicStats, groupTotal] = await Promise.all([
    supabase.from("members").select("*").eq("id", memberId).limit(1),
    supabase.from("weekly_cycles").select("*").order("index"),
    supabase.from("member_cycles").select("*").eq("member_id", memberId),
    supabase.from("deposits").select("*").eq("member_id", memberId).order("date", { ascending: false }),
    supabase.from("notifications").select("*").or(`uid.eq.${state.profile.id},member_id.eq.${memberId}`).order("created_at", { ascending: false }),
    supabase.from("public_stats").select("*").eq("id", "main").limit(1),
    supabase.rpc("get_group_total"),
  ]);
  state.memberRecord = handleDb(member)?.[0] || null;
  state.members = state.memberRecord ? [state.memberRecord] : [];
  state.weeklyCycles = handleDb(weeklyCycles);
  state.memberCycles = handleDb(memberCycles);
  state.deposits = handleDb(deposits);
  state.notifications = handleDb(notifications);
  state.publicStats = handleDb(publicStats)?.[0] || null;
  const total = Number(handleDb(groupTotal) || 0);
  if (!state.publicStats || Number(state.publicStats.total || 0) === 0) {
    state.publicStats = { ...(state.publicStats || {}), total };
  }
}

async function reloadData() {
  await loadSettings();
  renderSystemInfo();
  if (state.profile?.role === "admin") {
    await loadAdminData();
    await ensureWeeklyDataModel(); // auto-comble les semaines manquantes, met à jour state local
    renderAdmin();
  }
  if (state.profile?.role === "member") {
    await loadMemberData();
    renderMember();
  }
}

function subscribeRealtime() {
  if (state.channel) supabase.removeChannel(state.channel);
  state.channel = supabase
    .channel("cotisations-live")
    .on("postgres_changes", { event: "*", schema: "public" }, () => {
      reloadData().catch((error) => showToast(error.message, "error"));
    })
    .subscribe();
}

async function ensureWeeklyDataModel() {
  if (state.profile?.role !== "admin" || !state.settings?.start_date) return;
  const cyclesNeeded = weeksElapsedSince(state.settings.start_date);
  if (!cyclesNeeded) return;
  const existing = new Set(state.weeklyCycles.map((c) => c.id));
  const rows = [];
  for (let i = 0; i < cyclesNeeded; i += 1) {
    const index = i + 1;
    const id = `w${String(index).padStart(4, "0")}`;
    if (existing.has(id)) continue;
    const start = parseDate(state.settings.start_date);
    const cycleStart = new Date(start.getTime() + i * CYCLE_MS);
    const cycleEnd = new Date(cycleStart.getTime() + CYCLE_MS - 1);
    rows.push({
      id,
      index,
      label: `Semaine ${index}`,
      start_date: toYmd(cycleStart),
      end_date: toYmd(cycleEnd),
      status: "open",
      weekly_amount: Number(state.settings.weekly_amount || WEEKLY_AMOUNT),
    });
  }
  if (rows.length) {
    handleDb(await supabase.from("weekly_cycles").upsert(rows));
    // Mise à jour locale immédiate : évite un re-fetch Supabase
    state.weeklyCycles = [...state.weeklyCycles, ...rows].sort((a, b) => a.index - b.index);
  }
  return rows.length;
}

async function ensureCycleExists(cycleId) {
  if (!cycleId || state.weeklyCycles.some((cycle) => cycle.id === cycleId)) return;
  const match = cycleId.match(/^w(\d+)$/);
  const start = parseDate(state.settings?.start_date);
  if (!match || !start) return;
  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1) return;
  const cycleStart = new Date(start.getTime() + (index - 1) * CYCLE_MS);
  const cycleEnd = new Date(cycleStart.getTime() + CYCLE_MS - 1);
  handleDb(
    await supabase.from("weekly_cycles").upsert({
      id: cycleId,
      index,
      label: `Semaine ${index}`,
      start_date: toYmd(cycleStart),
      end_date: toYmd(cycleEnd),
      status: "open",
      weekly_amount: Number(state.settings?.weekly_amount || WEEKLY_AMOUNT),
    })
  );
  state.weeklyCycles.push({
    id: cycleId,
    index,
    label: `Semaine ${index}`,
    start_date: toYmd(cycleStart),
    end_date: toYmd(cycleEnd),
    status: "open",
    weekly_amount: Number(state.settings?.weekly_amount || WEEKLY_AMOUNT),
  });
}

async function ensureMemberCycles() {
  if (state.profile?.role !== "admin" || !state.members.length || !state.weeklyCycles.length) return;
  const existing = new Set(state.memberCycles.map((mc) => mc.id));
  const rows = [];
  state.members.forEach((member) => {
    state.weeklyCycles.forEach((cycle) => {
      const id = `${member.id}_${cycle.id}`;
      if (!existing.has(id)) {
        rows.push({ id, member_id: member.id, cycle_id: cycle.id, status: "unpaid", amount_paid: 0 });
      }
    });
  });
  if (rows.length) handleDb(await supabase.from("member_cycles").upsert(rows));
}

async function publishPublicStats(payload) {
  if (state.profile?.role !== "admin") return;
  const signature = JSON.stringify(payload);
  if (signature === state.lastPublishedPublicStatsSignature) return;
  state.lastPublishedPublicStatsSignature = signature;
  handleDb(
    await supabase.from("public_stats").upsert({
      id: "main",
      ...payload,
      members_count: payload.membersCount,
      late_members: payload.lateMembers,
      updated_at: new Date().toISOString(),
      updated_by: state.profile.id,
    })
  );
}

async function setManualDebt(member) {
  const stats = computeMemberStats(member);
  const next = prompt(`Dette cible pour ${member.name}.\nDette automatique: ${formatFc(stats.autoDebt)}\nMontant final (FC):`, String(stats.debt));
  if (next === null) return;
  const target = Number(next);
  if (!Number.isFinite(target) || target < 0) {
    showToast("Montant invalide.", "error");
    return;
  }
  const reason = prompt("Motif de modification (obligatoire):", "");
  if (!reason?.trim()) {
    showToast("Motif requis.", "error");
    return;
  }
  const manualDebtBase = target - stats.autoDebt;
  handleDb(
    await supabase
      .from("members")
      .update({ manual_debt_base: manualDebtBase, debt_adjustment: manualDebtBase, debt_adjusted_at: new Date().toISOString() })
      .eq("id", member.id)
  );
  handleDb(
    await supabase.from("debt_adjustments").insert({
      member_id: member.id,
      member_name: member.name || member.id,
      delta: manualDebtBase,
      target_debt: target,
      auto_debt: stats.autoDebt,
      reason: reason.trim(),
      author: state.profile.id,
    })
  );
  await reloadData();
  showToast("Dette ajustee.", "success");
}

async function clearManualDebt(member) {
  handleDb(
    await supabase
      .from("members")
      .update({ manual_debt_base: 0, debt_adjustment: 0, debt_adjusted_at: new Date().toISOString() })
      .eq("id", member.id)
  );
  handleDb(
    await supabase.from("debt_adjustments").insert({
      member_id: member.id,
      member_name: member.name,
      delta: 0,
      reason: "Reset ajustement manuel",
      author: state.profile.id,
    })
  );
  await reloadData();
  showToast("Ajustement reset.", "success");
}

async function updateMemberCycleStatus(memberId, cycleId, status) {
  const member = state.members.find((m) => m.id === memberId);
  const memberProfile = state.profiles.find((p) => p.member_id === memberId);
  const weekly = Number(state.settings?.weekly_amount || WEEKLY_AMOUNT);
  await ensureCycleExists(cycleId);
  handleDb(
    await supabase.from("member_cycles").upsert({
      id: `${memberId}_${cycleId}`,
      member_id: memberId,
      cycle_id: cycleId,
      status,
      amount_paid: status === "paid" ? weekly : 0,
      confirmed_at: status === "paid" || status === "waived" ? new Date().toISOString() : null,
      confirmed_by: status === "paid" || status === "waived" ? state.profile.id : null,
      updated_at: new Date().toISOString(),
    })
  );
  handleDb(
    await supabase.from("notifications").insert({
      uid: memberProfile?.id || null,
      member_id: memberId,
      member_name: member?.name || memberId,
      message:
        status === "paid"
          ? `Paiement confirme pour ${cycleId}.`
          : status === "waived"
          ? `Semaine ${cycleId} gelee/exemptee.`
          : `Semaine ${cycleId} reouverte en non payee.`,
    })
  );
  await reloadData();
  showToast(`${member?.name || memberId}: ${status}`, "success");
}

async function applyNewDepositAllocation(memberId, amount) {
  const [memberRes, cyclesRes, memberCyclesRes, depositsRes] = await Promise.all([
    supabase.from("members").select("*").eq("id", memberId).single(),
    supabase.from("weekly_cycles").select("*").order("index"),
    supabase.from("member_cycles").select("*").eq("member_id", memberId),
    supabase.from("deposits").select("amount,date").eq("member_id", memberId).order("date"),
  ]);
  const member = handleDb(memberRes);
  const cycles = handleDb(cyclesRes) || [];
  const memberCycles = handleDb(memberCyclesRes) || [];
  const deposits = handleDb(depositsRes) || [];

  let remainingForCycleRows = Number(amount || 0);
  const rows = [];
  cycles
    .filter((cycle) => !["cancelled", "frozen"].includes(String(cycle.status || "open").toLowerCase()))
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .forEach((cycle) => {
      if (remainingForCycleRows <= 0) return;
      const existing = memberCycles.find((row) => row.cycle_id === cycle.id);
      if (existing?.status === "waived") return;
      const weekly = Number(cycle.weekly_amount || state.settings?.weekly_amount || WEEKLY_AMOUNT);
      const paid = Number(existing?.amount_paid || 0);
      const needed = Math.max(0, weekly - paid);
      if (!needed) return;
      const applied = Math.min(needed, remainingForCycleRows);
      const nextPaid = paid + applied;
      rows.push({
        id: existing?.id || `${memberId}_${cycle.id}`,
        member_id: memberId,
        cycle_id: cycle.id,
        amount_paid: nextPaid,
        status: nextPaid >= weekly ? "paid" : "unpaid",
        confirmed_at: nextPaid >= weekly ? existing?.confirmed_at || new Date().toISOString() : existing?.confirmed_at || null,
        confirmed_by: nextPaid >= weekly ? existing?.confirmed_by || state.profile.id : existing?.confirmed_by || null,
        updated_at: new Date().toISOString(),
      });
      remainingForCycleRows -= applied;
    });

  if (rows.length) {
    handleDb(await supabase.from("member_cycles").upsert(rows));
  }

  const computedTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const datedDeposits = deposits
    .map((deposit) => ({ ...deposit, parsedDate: parseDate(deposit.date) }))
    .filter((deposit) => deposit.parsedDate)
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
  const firstDepositDate = datedDeposits[0]?.parsedDate || parseDate(state.settings?.start_date);
  const firstDepositYmd = firstDepositDate ? toYmd(firstDepositDate) : null;
  const paymentsAfterCapital = datedDeposits
    .filter((deposit) => toYmd(deposit.parsedDate) !== firstDepositYmd)
    .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const automaticDebt = (firstDepositDate ? weeksDueBetween(firstDepositDate, new Date()) : 0) * Number(state.settings?.weekly_amount || WEEKLY_AMOUNT);
  const totalDebtBeforePayments = automaticDebt + Number(member.manual_debt_base ?? member.debt_adjustment ?? 0);
  const balance = totalDebtBeforePayments - paymentsAfterCapital;
  const computedDebt = Math.max(0, balance);
  const computedCredit = Math.max(0, -balance);

  handleDb(
    await supabase
      .from("members")
      .update({
        computed_debt: computedDebt,
        computed_total: computedTotal,
        stats_updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
  );
}

function renderCycleControls() {
  if (!cycleMember || !cycleSelect || !cycleStatus) return;
  cycleMember.innerHTML = "";
  cycleSelect.innerHTML = "";
  state.members.forEach((member) => {
    const opt = document.createElement("option");
    opt.value = member.id;
    opt.textContent = member.name;
    cycleMember.appendChild(opt);
  });
  state.weeklyCycles.forEach((cycle) => {
    const opt = document.createElement("option");
    opt.value = cycle.id;
    opt.textContent = `${cycle.label || cycle.id} (${cycle.status || "open"})`;
    cycleSelect.appendChild(opt);
  });
  const row = getMemberCycle(cycleMember.value, cycleSelect.value);
  cycleStatus.textContent = cycleMember.value && cycleSelect.value ? `Statut actuel: ${row?.status || "unpaid"}` : "Aucun cycle selectionne.";
}

function renderDebtHistory() {
  debtHistoryList.innerHTML = "";
  state.debtAdjustments.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.created_at?.slice(0, 10) || "-"} | ${item.member_name || item.member_id} | ${item.reason || "-"}</span><strong>${formatFc(item.delta || 0)}</strong>`;
    debtHistoryList.appendChild(li);
  });
}

function renderAdmin() {
  adminSkeleton?.classList.add("hidden");
  depositMember.innerHTML = "";
  membersList.innerHTML = "";
  debtsTableBody.innerHTML = "";
  adminDepositsList.innerHTML = "";
  renderCycleControls();
  renderDebtHistory();

  if (!state.members.length) {
    membersList.innerHTML = "<li>Aucun membre.</li>";
    return;
  }

  const rows = state.members.map((member) => {
    const stats = computeMemberStats(member);
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    depositMember.appendChild(option);
    const li = document.createElement("li");
    li.innerHTML = `<span>${member.name}</span><span class="muted">${stats.elapsedWeeks} semaine(s) depuis depot</span>`;
    membersList.appendChild(li);
    return { id: member.id, name: member.name, ...stats };
  });

  const queryText = state.ui.query.toLowerCase();
  const filtered = rows
    .filter((row) => (state.ui.lateOnly ? row.debt > 0 : true))
    .filter((row) => row.name.toLowerCase().includes(queryText));
  filtered.sort((a, b) => {
    if (state.ui.sort === "name-asc") return a.name.localeCompare(b.name, "fr");
    if (state.ui.sort === "debt-asc") return a.debt - b.debt;
    return b.debt - a.debt;
  });

  const sumTotal = rows.reduce((n, row) => n + row.total, 0);
  const sumExpected = rows.reduce((n, row) => n + row.expected, 0);
  const sumDebt = rows.reduce((n, row) => n + row.debt, 0);
  const lateCount = rows.filter((row) => row.debt > 0).length;
  animateNumber(globalTotal, sumTotal);
  animateNumber(globalExpected, sumExpected);
  animateNumber(globalDebt, sumDebt);
  globalLateMembers.textContent = String(lateCount);
  publishPublicStats({ total: sumTotal, expected: sumExpected, debt: sumDebt, membersCount: rows.length, lateMembers: lateCount }).catch(console.error);

  filtered.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.name}</td>
      <td><strong class="amount-positive">${formatFc(row.total)}</strong></td>
      <td><strong class="amount-debt">${formatFc(row.debt)}</strong><div class="muted">Auto: ${formatFc(row.autoDebt)} | Manuel: ${formatFc(row.manualDebtBase)}</div></td>
      <td>${row.debt === 0 ? '<span class="badge badge-ok">a jour</span>' : `<span class="badge badge-danger">en dette (${row.lateWeeks})</span>`}</td>
      <td><div class="actions"><button type="button" class="set-debt-btn" data-id="${row.id}">Fixer</button><button type="button" class="danger clear-debt-btn" data-id="${row.id}">Reset</button></div></td>
    `;
    debtsTableBody.appendChild(tr);
  });

  debtsTableBody.querySelectorAll(".set-debt-btn").forEach((btn) => {
    btn.addEventListener("click", async () => setManualDebt(state.members.find((m) => m.id === btn.dataset.id)).catch((error) => showToast(error.message, "error")));
  });
  debtsTableBody.querySelectorAll(".clear-debt-btn").forEach((btn) => {
    btn.addEventListener("click", async () => clearManualDebt(state.members.find((m) => m.id === btn.dataset.id)).catch((error) => showToast(error.message, "error")));
  });

  state.deposits.forEach((deposit) => {
    const member = state.members.find((m) => m.id === deposit.member_id);
    const li = document.createElement("li");
    li.innerHTML = `<span>${deposit.date || "-"} | ${member?.name || deposit.member_id}</span><strong>${formatFc(deposit.amount)}</strong>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", async () => {
      const nextAmount = prompt("Nouveau montant (FC)", String(deposit.amount));
      const parsed = Number(nextAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      handleDb(await supabase.from("deposits").update({ amount: parsed }).eq("id", deposit.id));
      await reloadData();
      showToast("Depot modifie.", "success");
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Supprimer";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce depot ?")) return;
      handleDb(await supabase.from("deposits").delete().eq("id", deposit.id));
      await reloadData();
      showToast("Depot supprime.", "error");
    });
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);
    adminDepositsList.appendChild(li);
  });
}

function renderMemberTimeline(memberId) {
  memberWeekTimeline.innerHTML = "";
  getActiveCycles()
    .slice(-10)
    .forEach((cycle) => {
      const status = getMemberCycle(memberId, cycle.id)?.status || "unpaid";
      const chip = document.createElement("span");
      chip.className = `chip chip-${status}`;
      chip.textContent = cycle.label || cycle.id;
      memberWeekTimeline.appendChild(chip);
    });
}

function renderMember() {
  memberSkeleton?.classList.add("hidden");
  const memberId = state.profile?.member_id;
  if (!memberId) return;
  const member = state.memberRecord || { id: memberId, name: state.profile.name, manual_debt_base: 0 };
  const stats = computeMemberStats(member);
  animateNumber(memberTotal, stats.total);
  animateNumber(memberExpected, stats.autoDebt);
  animateNumber(memberDebt, stats.debt);
  animateNumber(memberGlobalTotal, Number(state.publicStats?.total || 0));
  memberStreak.textContent = `${stats.streak} semaine(s)`;
  memberStatus.textContent = stats.debt === 0 ? "a jour" : "en dette";
  memberStatus.className = stats.debt === 0 ? "badge badge-ok" : "badge badge-danger";
  if (stats.lateWeeks > 0) {
    memberLateBadgeWrap.classList.remove("hidden");
    memberLateBadge.textContent = `En retard depuis ${stats.lateWeeks} semaine(s)`;
  } else {
    memberLateBadgeWrap.classList.add("hidden");
  }
  const currentCycle = state.weeklyCycles[state.weeklyCycles.length - 1];
  const currentStatus = currentCycle ? getMemberCycle(memberId, currentCycle.id)?.status || "unpaid" : "unpaid";
  memberThisWeekStatus.textContent =
    currentStatus === "paid" ? "Paiement confirme cette semaine" : currentStatus === "waived" ? "Semaine gelee/exemptee" : "Paiement non confirme cette semaine";
  renderMemberTimeline(memberId);
  memberDepositsList.innerHTML = "";
  state.deposits.forEach((deposit) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${deposit.date || "-"}</span><strong>${formatFc(deposit.amount)}</strong>`;
    memberDepositsList.appendChild(li);
  });
  memberNotificationsList.innerHTML = "";
  state.notifications.forEach((notification) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${notification.created_at?.slice(0, 10) || "-"}</span><span>${notification.message}</span>`;
    memberNotificationsList.appendChild(li);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    assertSupabase();
    const email = $("email").value.trim();
    const password = $("password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (error) {
    showToast(`Connexion echouee: ${error.message}`, "error");
  }
});

togglePassword?.addEventListener("click", () => {
  const password = $("password");
  const shouldShow = password.type === "password";
  password.type = shouldShow ? "text" : "password";
  togglePassword.textContent = shouldShow ? "Cacher" : "Voir";
  togglePassword.setAttribute("aria-label", shouldShow ? "Masquer le mot de passe" : "Afficher le mot de passe");
  togglePassword.title = shouldShow ? "Masquer le mot de passe" : "Afficher le mot de passe";
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

depositForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const memberId = depositMember.value;
    const amount = Number(depositAmount.value);
    const date = depositDate.value;
    if (!memberId || !Number.isFinite(amount) || amount <= 0 || !date) throw new Error("Veuillez remplir correctement.");
    const weekly = Number(state.settings?.weekly_amount || WEEKLY_AMOUNT);
    const cycleId = cycleIdFromDate(state.settings?.start_date, parseDate(date));
    if (cycleId) await ensureCycleExists(cycleId);
    handleDb(
      await supabase.from("deposits").insert({
        member_id: memberId,
        amount,
        date,
        cycle_id: cycleId,
        created_by: state.profile.id,
      })
    );
    await applyNewDepositAllocation(memberId, amount);
    await reloadData();
    depositAmount.value = "";
    depositDate.value = toYmd(new Date());
    showToast("Depot enregistre.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

sortDebt?.addEventListener("change", () => {
  state.ui.sort = sortDebt.value;
  renderAdmin();
});

filterLateOnly?.addEventListener("change", () => {
  state.ui.lateOnly = Boolean(filterLateOnly.checked);
  renderAdmin();
});

searchMember?.addEventListener("input", () => {
  state.ui.query = searchMember.value || "";
  renderAdmin();
});

initCyclesBtn?.addEventListener("click", async () => {
  try {
    await ensureWeeklyDataModel();
    await reloadData();
    await ensureMemberCycles();
    await reloadData();
    showToast("Cycles hebdo initialises.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

cycleMember?.addEventListener("change", renderCycleControls);
cycleSelect?.addEventListener("change", renderCycleControls);
confirmCycleBtn?.addEventListener("click", () => updateMemberCycleStatus(cycleMember.value, cycleSelect.value, "paid").catch((error) => showToast(error.message, "error")));
waiveCycleBtn?.addEventListener("click", () => updateMemberCycleStatus(cycleMember.value, cycleSelect.value, "waived").catch((error) => showToast(error.message, "error")));
reopenCycleBtn?.addEventListener("click", () => updateMemberCycleStatus(cycleMember.value, cycleSelect.value, "unpaid").catch((error) => showToast(error.message, "error")));

async function boot() {
  if (!isConfigured) {
    showAuth();
    showToast("Configure d'abord public/config.js avec Supabase.", "error");
    return;
  }
  const { data } = await supabase.auth.getSession();
  await handleAuthSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => {
    handleAuthSession(session).catch((error) => showToast(error.message, "error"));
  });
}

async function handleAuthSession(session) {
  state.session = session;
  state.profile = null;
  state.members = [];
  state.profiles = [];
  state.memberRecord = null;
  state.weeklyCycles = [];
  state.memberCycles = [];
  state.deposits = [];
  state.debtAdjustments = [];
  state.notifications = [];
  state.publicStats = null;
  state.lastPublishedPublicStatsSignature = null;
  if (state.channel) {
    supabase.removeChannel(state.channel);
    state.channel = null;
  }
  if (!session?.user) {
    showAuth();
    return;
  }
  state.profile = await loadProfile(session.user.id);
  welcomeText.textContent = `Connecte: ${state.profile.name || session.user.email} (${state.profile.role})`;
  showApp(state.profile.role);
  if (state.profile.role === "admin") {
    depositDate.value = toYmd(new Date());
    adminSkeleton?.classList.remove("hidden");
  }
  if (state.profile.role === "member") {
    if (!state.profile.member_id) throw new Error("Votre profil membre doit contenir member_id.");
    memberSkeleton?.classList.remove("hidden");
  }
  await reloadData();
  subscribeRealtime();
}

boot().catch((error) => showToast(error.message, "error"));
