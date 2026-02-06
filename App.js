const KEY = "poker_sessions_v2";

const $ = (id) => document.getElementById(id);

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}

function saveSessions(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function money(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function esc(s) {
  return (s || "").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function toISODate(d) {
  // YYYY-MM-DD in local time
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(iso) {
  // safe local date parse (avoid timezone shifting)
  const [y,m,d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m-1, d, 12, 0, 0); // noon local
}

function ensureYearOptions() {
  const sessions = loadSessions();
  const years = new Set(sessions.map(s => (s.date || "").slice(0,4)).filter(Boolean));

  const currentYear = new Date().getFullYear();
  years.add(String(currentYear));
  years.add(String(currentYear-1));

  const sorted = Array.from(years).sort((a,b) => Number(b) - Number(a));
  const sel = $("yearSelect");
  sel.innerHTML = "";
  for (const y of sorted) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
  sel.value = String(currentYear);
}

function selectedYear() {
  return Number($("yearSelect").value);
}

function filterYTD(sessions, year) {
  const start = new Date(year, 0, 1, 0, 0, 0);
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

  return sessions.filter(s => {
    const d = parseISODate(s.date);
    if (!d) return false;
    return d >= start && d <= end && d.getFullYear() === year;
  });
}

function recalcResultPreview() {
  const buyin = Number($("buyin").value || 0);
  const cashout = Number($("cashout").value || 0);
  const profit = cashout - buyin;
  $("result").value = money(profit);
  $("result").style.color = profit >= 0 ? "#6dff9b" : "#ff6d6d";
}

function addSession() {
  const date = $("date").value || toISODate(new Date());
  const type = $("type").value;
  const location = $("location").value.trim();
  const stakes = $("stakes").value.trim();
  const hours = Number($("hours").value || 0);
  const buyin = Number($("buyin").value || 0);
  const cashout = Number($("cashout").value || 0);
  const notes = $("notes").value.trim();

  const profit = cashout - buyin;

  const session = {
    id: crypto.randomUUID(),
    date, type, location, stakes,
    hours, buyin, cashout, profit, notes,
    createdAt: Date.now()
  };

  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);

  // reset quick fields
  $("stakes").value = "";
  $("hours").value = "";
  $("buyin").value = "";
  $("cashout").value = "";
  $("notes").value = "";
  recalcResultPreview();

  ensureYearOptions();
  render();
}

function exportBackup() {
  const data = { version: 2, exportedAt: new Date().toISOString(), sessions: loadSessions() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poker-tracker-backup-${toISODate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.sessions)) {
    alert("Invalid backup file.");
    return;
  }
  saveSessions(data.sessions);
  ensureYearOptions();
  render();
}

function clearAll() {
  if (!confirm("Clear ALL sessions? This cannot be undone.")) return;
  saveSessions([]);
  ensureYearOptions();
  render();
}

function aggregateByMonth(sessions) {
  // returns array of 12 items for selected year
  const months = Array.from({length: 12}, (_, m) => ({
    monthIndex: m,
    profit: 0,
    sessions: 0,
    hours: 0
  }));

  for (const s of sessions) {
    const d = parseISODate(s.date);
    if (!d) continue;
    const m = d.getMonth();
    months[m].profit += Number(s.profit || 0);
    months[m].sessions += 1;
    months[m].hours += Number(s.hours || 0);
  }
  return months;
}

function aggregateByDow(sessions) {
  const days = Array.from({length: 7}, (_, i) => ({
    dowIndex: i,
    profit: 0,
    sessions: 0,
    hours: 0
  }));

  for (const s of sessions) {
    const d = parseISODate(s.date);
    if (!d) continue;
    const i = d.getDay();
    days[i].profit += Number(s.profit || 0);
    days[i].sessions += 1;
    days[i].hours += Number(s.hours || 0);
  }
  return days;
}

function aggregateByDate(sessions) {
  // Map ISO date -> totals
  const map = new Map();
  for (const s of sessions) {
    const iso = s.date;
    if (!iso) continue;
    if (!map.has(iso)) map.set(iso, { date: iso, profit: 0, sessions: 0, hours: 0 });
    const row = map.get(iso);
    row.profit += Number(s.profit || 0);
    row.sessions += 1;
    row.hours += Number(s.hours || 0);
  }
  return Array.from(map.values()).sort((a,b) => a.date.localeCompare(b.date));
}

function render() {
  const all = loadSessions();
  const year = selectedYear();

  // YTD for that year (Jan 1 -> today)
  const ytd = filterYTD(all, year).sort((a,b) => (b.date || "").localeCompare(a.date || ""));

  // Stats
  const totalProfit = ytd.reduce((s,x) => s + (x.profit || 0), 0);
  const totalHours  = ytd.reduce((s,x) => s + (x.hours || 0), 0);
  const avg = ytd.length ? totalProfit / ytd.length : 0;
  const hourly = totalHours > 0 ? totalProfit / totalHours : 0;

  $("statProfit").textContent = money(totalProfit);
  $("statProfit").className = "kpi " + (totalProfit >= 0 ? "pos" : "neg");
  $("statSessions").textContent = ytd.length;
  $("statAvg").textContent = money(avg);
  $("statHourly").textContent = `${money(hourly)}/hr`;

  // Meta label
  const todayIso = toISODate(new Date());
  $("statProfitMeta").textContent = `Jan 1 ${year} → ${todayIso}`;

  // Aggregations
  const months = aggregateByMonth(ytd);
  const dows = aggregateByDow(ytd);
  const dates = aggregateByDate(ytd);

  // Best month
  const bestM = months.reduce((best, cur) => (cur.profit > best.profit ? cur : best), {profit: -Infinity});
  if (bestM.profit > -Infinity && months.some(m => m.sessions > 0)) {
    $("bestMonth").textContent = `${MONTH_NAMES[bestM.monthIndex]} ${year}`;
    $("bestMonthMeta").textContent = `${money(bestM.profit)} • ${bestM.sessions} sess • ${bestM.hours.toFixed(2)}h`;
    $("bestMonth").className = "kpi " + (bestM.profit >= 0 ? "pos" : "neg");
  } else {
    $("bestMonth").textContent = "—";
    $("bestMonthMeta").textContent = "No sessions yet";
    $("bestMonth").className = "kpi";
  }

  // Best date
  const bestD = dates.reduce((best, cur) => (cur.profit > best.profit ? cur : best), {profit: -Infinity});
  if (bestD.profit > -Infinity && dates.length) {
    $("bestDate").textContent = bestD.date;
    $("bestDateMeta").textContent = `${money(bestD.profit)} • ${bestD.sessions} sess • ${bestD.hours.toFixed(2)}h`;
    $("bestDate").className = "kpi " + (bestD.profit >= 0 ? "pos" : "neg");
  } else {
    $("bestDate").textContent = "—";
    $("bestDateMeta").textContent = "No sessions yet";
    $("bestDate").className = "kpi";
  }

  // Best day of week
  const bestW = dows.reduce((best, cur) => (cur.profit > best.profit ? cur : best), {profit: -Infinity});
  if (bestW.profit > -Infinity && dows.some(d => d.sessions > 0)) {
    $("bestDow").textContent = DOW_NAMES[bestW.dowIndex];
    $("bestDowMeta").textContent = `${money(bestW.profit)} • ${bestW.sessions} sess • ${bestW.hours.toFixed(2)}h`;
    $("bestDow").className = "kpi " + (bestW.profit >= 0 ? "pos" : "neg");
  } else {
    $("bestDow").textContent = "—";
    $("bestDowMeta").textContent = "No sessions yet";
    $("bestDow").className = "kpi";
  }

  // Monthly table
  const monthTbody = $("monthTbody");
  monthTbody.innerHTML = "";
  months.forEach(m => {
    const tr = document.createElement("tr");
    const cls = m.profit >= 0 ? "pos" : "neg";
    tr.innerHTML = `
      <td>${MONTH_NAMES[m.monthIndex]} ${year}</td>
      <td class="${cls}" style="font-weight:700;">${money(m.profit)}</td>
      <td>${m.sessions}</td>
      <td>${m.hours.toFixed(2)}</td>
    `;
    monthTbody.appendChild(tr);
  });

  // DOW table (Sun..Sat)
  const dowTbody = $("dowTbody");
  dowTbody.innerHTML = "";
  dows.forEach(d => {
    const tr = document.createElement("tr");
    const cls = d.profit >= 0 ? "pos" : "neg";
    tr.innerHTML = `
      <td>${DOW_NAMES[d.dowIndex]}</td>
      <td class="${cls}" style="font-weight:700;">${money(d.profit)}</td>
      <td>${d.sessions}</td>
      <td>${d.hours.toFixed(2)}</td>
    `;
    dowTbody.appendChild(tr);
  });

  // Sessions table (YTD list)
  const tbody = $("tbody");
  tbody.innerHTML = "";

  ytd.forEach((x) => {
    const tr = document.createElement("tr");
    const profitClass = x.profit >= 0 ? "pos" : "neg";
    tr.innerHTML = `
      <td>${x.date || ""}</td>
      <td>
        <div><span class="pill">${esc(x.type)}</span> <span class="muted">${esc(x.location)}</span></div>
        <div class="muted">${esc(x.stakes)} • ${x.hours ? `${Number(x.hours).toFixed(2)}h` : "—"}</div>
      </td>
      <td class="${profitClass}" style="font-weight:700;">${money(x.profit)}</td>
      <td class="muted">${esc(x.notes)}</td>
      <td><button data-del="${x.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      const next = loadSessions().filter(s => s.id !== id);
      saveSessions(next);
      ensureYearOptions();
      render();
    });
  });
}

function initDefaults() {
  $("date").value = toISODate(new Date());
  recalcResultPreview();
  ensureYearOptions();
}

$("buyin").addEventListener("input", recalcResultPreview);
$("cashout").addEventListener("input", recalcResultPreview);

$("addBtn").addEventListener("click", addSession);
$("exportBtn").addEventListener("click", exportBackup);
$("importFile").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importBackup(file);
  e.target.value = "";
});
$("clearBtn").addEventListener("click", clearAll);

$("yearSelect").addEventListener("change", render);

initDefaults();
render();
