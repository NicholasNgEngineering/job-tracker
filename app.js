import { STATUS, DATES, OUTCOMES, todayKey, getStatus, gotReply, validateJob } from "./model.js";
import { request, importApplications, storageKey } from "./storage.js";

const paths = {
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a22 22 0 0 0 18 0M12 12v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 19V5M4 19h16M9 15v-4m5 4V7m5 8v-6"/>',
  pie: '<path d="M11 3a9 9 0 1 0 10 10H11zM15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
  reply: '<path d="M9 10h6m-6 4h3M20 12a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 12Z"/>',
  interview: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 5 2 2 4-4"/>',
  offer: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3m10-5h3v2a3 3 0 0 1-3 3m-5 3v5m-4 1h8"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  "arrow-right": '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function icon(name) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
document.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = icon(node.dataset.icon); });

const el = id => document.getElementById(id);
const form = el("application-form");
const editor = el("editor");
const confirm = el("confirm");
const statusFilter = el("status-filter");
const dateFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

let applications = [];
let demo = false;
let loaded = false;
let loading = true;
let editing = null;
let saving = false;
let toastTimer;

const reached = {
  applied: { label: "Applied", filter: "all", color: "#305841", test: () => true },
  replied: { label: "Replied", filter: "stage-replied", color: "#437660", test: gotReply },
  round1: { label: "Round 1", filter: "stage-round1", color: "#56846a", test: job => Boolean(job.round1) },
  round2: { label: "Round 2", filter: "stage-round2", color: "#6b9476", test: job => Boolean(job.round2) },
  round3: { label: "Round 3", filter: "stage-round3", color: "#7e9f82", test: job => Boolean(job.round3) },
  offer: { label: "Offer", filter: "stage-offer", color: "#a47b38", test: job => Boolean(job.offer) },
};
const stageFilters = {
  ...Object.fromEntries(Object.values(reached).filter(stage => stage.filter !== "all").map(stage => [stage.filter, stage])),
  "stage-interview": { label: "Any interview", test: job => Boolean(job.round1 || job.round2 || job.round3) },
};
const demoRows = [
  ["Harbour Civil", "Site Engineer Intern", 5, {}],
  ["Ridgeline Infrastructure", "Civil Engineering Cadet", 8, { reply: 7 }],
  ["Southbank Projects", "Project Management Intern", 10, { reply: 8, round1: 6 }],
  ["Ironbark Structures", "Structural Engineering Intern", 14, { reply: 9, round1: 8, round2: 3 }],
  ["Cove Construction", "Construction Cadet", 17, { outcome: "rejected", rejected: 10 }],
  ["Fieldstone Group", "Undergraduate Civil Engineer", 19, { reply: 16, round1: 11, round2: 8, round3: 3, offer: 1 }],
  ["Cedar Engineering", "Civil Engineering Intern", 26, {}],
  ["Wattle Works", "Project Support Intern", 34, {}],
  ["Eastline Contractors", "Site Cadet", 39, { reply: 38, round1: 33, rejected: 30, outcome: "rejected" }],
  ["Bayside Engineering", "Engineering Intern", 41, {}],
  ["Summit Civil", "Undergraduate Site Engineer", 44, { reply: 39, round1: 34, round2: 28, rejected: 25, outcome: "rejected" }],
  ["Norwood Projects", "Construction Management Intern", 47, { reply: 45, round1: 42, round2: 34, round3: 28, offer: 22, outcome: "accepted" }],
  ["Orchard Infrastructure", "Civil Cadet", 52, { outcome: "withdrawn" }],
  ["Brookfield Works", "Site Engineer Intern", 55, {}],
].map(([company, role, days, details], index) => {
  const date = offset => new Date(Date.parse(todayKey()) - offset * 86400000).toISOString().slice(0, 10);
  const job = { company, role, id: `demo-${index}`, applied: date(days), outcome: details.outcome || "open", source: index % 2 ? "SEEK" : "Company careers page" };
  for (const field of Object.keys(DATES).filter(field => field !== "applied")) {
    job[field] = details[field] === undefined ? "" : date(details[field]);
  }
  return job;
});

for (const [status, label] of Object.entries(OUTCOMES)) {
  form.elements.outcome.add(new Option(label, status));
}
for (const [name, label] of Object.entries(DATES).filter(([name]) => name !== "applied")) {
  el("date-fields").insertAdjacentHTML("beforeend", `<label>${label}<input name="${name}" type="date"></label>`);
}
statusFilter.add(new Option("All applications", "all"));
const statusOptions = document.createElement("optgroup");
statusOptions.label = "Current status";
for (const [key, status] of Object.entries(STATUS)) statusOptions.append(new Option(status.label, key));
statusFilter.append(statusOptions);
const milestoneOptions = document.createElement("optgroup");
milestoneOptions.label = "Stage reached";
for (const [key, stage] of Object.entries(stageFilters)) {
  milestoneOptions.append(new Option(key === "stage-replied" ? "Ever received a reply" : stage.label, key));
}
statusFilter.append(milestoneOptions);

function rows() { return demo ? demoRows : applications; }
function view() { return location.hash === "#applications" ? "applications" : "overview"; }
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function percent(count, total) { return total ? Math.round(count * 100 / total) : 0; }
function dateLabel(date) { return date ? dateFormatter.format(new Date(date)) : "·"; }

async function load() {
  loading = true;
  el("load-error").hidden = true;
  render();
  try {
    applications = await request("GET");
    loaded = true;
  } catch (error) {
    el("load-message").textContent = error.message;
    el("load-error").hidden = false;
  } finally {
    loading = false;
    render();
  }
}

function render() {
  const page = view();
  el("overview").hidden = page !== "overview";
  el("applications").hidden = page !== "applications";
  document.querySelectorAll("[data-nav]").forEach(link => {
    if (link.dataset.nav === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  el("demo-banner").hidden = !demo;
  el("demo").hidden = demo;
  el("export").disabled = !rows().length;
  el("backup").disabled = demo || !applications.length;
  el("import").disabled = demo;
  renderOverview();
  renderApplications();
}

function renderOverview() {
  const jobs = rows();
  const total = jobs.length;
  const count = test => jobs.filter(test).length;
  const replies = count(gotReply);
  const interviews = count(stageFilters["stage-interview"].test);
  const offers = count(reached.offer.test);
  const ready = loaded || demo;
  const stats = [
    ["Applications sent", total, "Total submitted", "briefcase", "all"],
    ["Employer replies", replies, total ? `${percent(replies, total)}% reply rate` : "Reply rate", "reply", "stage-replied"],
    ["Interview invites", interviews, "Applications with an invite", "interview", "stage-interview"],
    ["Offers received", offers, total ? `${percent(offers, total)}% of applications` : "Offers across all applications", "offer", "stage-offer"],
  ];
  el("stats").innerHTML = stats.map(([label, value, note, symbol, filter]) => `
    <button class="stat" type="button" data-filter="${filter}">
      <span class="stat-label">${label}</span><strong class="stat-value">${ready ? value : "·"}</strong>
      <span class="stat-icon" data-icon>${icon(symbol)}</span><span class="stat-note">${note}</span>
    </button>`).join("");

  el("funnel").innerHTML = Object.values(reached).map(stage => {
    const value = count(stage.test);
    return `<button class="funnel-row" type="button" data-filter="${stage.filter}" aria-label="${stage.label}, ${value} ${value === 1 ? "application" : "applications"}">
      <span class="funnel-label">${stage.label}</span>
      <span class="track" aria-hidden="true"><i style="--width:${percent(value, total)}%;--bar:${stage.color}"></i></span>
      <span class="funnel-count">${ready ? value : "·"}</span></button>`;
  }).join("");

  const counts = Object.fromEntries(Object.keys(STATUS).map(key => [key, 0]));
  const today = todayKey();
  for (const job of jobs) counts[getStatus(job, today)]++;
  let running = 0;
  const segments = [];
  el("legend").innerHTML = Object.entries(STATUS).map(([key, status]) => {
    const value = counts[key];
    if (value) {
      const end = running + value;
      segments.push(`${status.color} ${100 * running / total}% ${100 * end / total}%`);
      running = end;
    }
    return `<li><button class="legend-button" type="button" data-filter="${key}">
      <i class="dot" style="--dot:${status.color}" aria-hidden="true"></i><span>${status.label}</span><b>${ready ? value : "·"}</b>
    </button></li>`;
  }).join("");
  el("ring").style.setProperty("--ring", segments.length ? `conic-gradient(${segments.join(",")})` : "#eaf0e9");
  el("ring-total").textContent = ready ? total : "·";
  el("ring-total").nextElementSibling.textContent = total === 1 ? "application" : "applications";
  el("recent").innerHTML = table([...jobs].sort(compareNewest).slice(0, 5), false);
}

function compareNewest(a, b) {
  return b.applied.localeCompare(a.applied) || a.company.localeCompare(b.company);
}

function renderApplications() {
  const query = el("search").value.trim().toLowerCase();
  const filter = statusFilter.value;
  const sort = el("sort").value;
  const today = todayKey();
  const jobs = rows().filter(job => {
    const matchesText = [job.company, job.role, job.source].join(" ").toLowerCase().includes(query);
    const matchesStatus = filter === "all" ||
      (stageFilters[filter] ? stageFilters[filter].test(job) : getStatus(job, today) === filter);
    return matchesText && matchesStatus;
  });
  jobs.sort(sort === "company" ? (a, b) => a.company.localeCompare(b.company) || compareNewest(a, b) :
    sort === "oldest" ? (a, b) => a.applied.localeCompare(b.applied) || a.company.localeCompare(b.company) : compareNewest);
  el("results").textContent = loaded || demo ? `${jobs.length} of ${rows().length} applications` : "";
  el("application-list").innerHTML = table(jobs, Boolean(query || filter !== "all"));
}

function table(jobs, filtered) {
  if (loading && !demo && !loaded) return '<p class="empty">Loading applications…</p>';
  if (!loaded && !demo) return '<p class="empty">Applications are currently unavailable.</p>';
  if (!jobs.length) {
    if (filtered) return '<div class="empty"><strong>No matching applications</strong><button class="button small" type="button" data-clear>Clear filters</button></div>';
    return '<div class="empty"><strong>No applications yet</strong><p>Add a job you’ve applied for to start tracking it.</p><button class="button small" type="button" data-add>Add application</button></div>';
  }

  const today = todayKey();
  return `<div class="table-scroll"><table><thead><tr>
    <th scope="col">Company and role</th><th scope="col">Current status</th>
    <th scope="col">Applied</th><th scope="col" class="optional-column">Last milestone</th>
    <th scope="col" class="table-action"><span class="sr-only">Actions</span></th>
  </tr></thead><tbody>${jobs.map(job => {
    const status = STATUS[getStatus(job, today)];
    const latest = Object.entries(DATES).filter(([key]) => key !== "applied" && job[key])
      .sort(([a], [b]) => job[a].localeCompare(job[b])).at(-1);
    return `<tr><td><button class="company-button" type="button" data-open="${job.id}">${escapeHTML(job.company)}</button><div class="role">${escapeHTML(job.role)}</div></td>
      <td><span class="pill" style="--dot:${status.color}"><i class="dot" aria-hidden="true"></i>${status.label}</span></td>
      <td class="date-cell">${dateLabel(job.applied)}</td>
      <td class="optional-column">${latest ? `${latest[1]} · ${dateLabel(job[latest[0]])}` : "·"}</td>
      <td class="table-action"><button class="editor-link" type="button" data-open="${job.id}" aria-label="${demo ? "View" : "Update"} ${escapeHTML(job.company)}">${demo ? "View" : "Update"}</button></td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function showApplications(filter = "all") {
  statusFilter.value = filter;
  el("search").value = "";
  if (view() === "applications") render();
  else location.hash = "applications";
  window.scrollTo(0, 0);
}

function openEditor(job) {
  editing = job ?? null;
  form.reset();
  for (const field of form.elements) {
    if (field.name) field.value = job?.[field.name] || (field.name === "outcome" ? "open" : "");
  }
  if (!job) form.elements.applied.value = todayKey();
  el("editor-title").textContent = job ? (demo ? "Demo application" : "Update application") : "Add application";
  el("editor-subtitle").textContent = job ? `${job.company} · ${job.role}` : "Enter the company, role, and date you applied.";
  el("job-link").hidden = !job?.link;
  el("job-link").href = job?.link || "#";
  el("milestones").open = Boolean(job);
  el("extra").open = Boolean(job && [job.link, job.source, job.resume, job.notes].some(Boolean));
  el("delete").hidden = !job || demo;
  el("save").hidden = demo;
  el("cancel").textContent = demo ? "Close" : "Cancel";
  for (const field of form.elements) {
    if (field.name) field.disabled = demo;
  }
  el("form-error").hidden = true;
  syncDates();
  editor.showModal();
  (job ? el("close-editor") : form.elements.company).focus();
}

function syncDates() {
  for (const field of Object.keys(DATES).filter(field => field !== "applied")) {
    form.elements[field].min = form.elements.applied.value;
  }
  form.elements.offer.required = form.elements.outcome.value === "accepted";
  if (form.elements.offer.required) el("milestones").open = true;
}

function setSaving(busy) {
  saving = busy;
  for (const id of ["save", "delete", "cancel", "close-editor"]) el(id).disabled = busy;
  el("save").textContent = busy ? "Saving…" : "Save application";
}

function notify(message) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").hidden = false;
  toastTimer = setTimeout(() => { el("toast").hidden = true; }, 3500);
}
function showFormError(error) {
  const message = el("form-error");
  message.textContent = error.message;
  message.hidden = false;
  message.scrollIntoView({ block: "nearest" });
}

async function save(event) {
  event.preventDefault();
  if (demo || saving) return;
  el("form-error").hidden = true;
  const previous = editing;
  setSaving(true);
  try {
    const job = validateJob(Object.fromEntries(new FormData(form)));
    await request(previous ? "PATCH" : "POST", previous ? {
      ...job, id: previous.id, revision: previous.revision,
    } : job);
    applications = await request("GET");
    editor.close();
    render();
    notify(previous ? "Application updated" : "Application added");
    if (!loaded) await load();
  } catch (error) {
    showFormError(error);
  } finally {
    setSaving(false);
  }
}

async function remove() {
  if (!editing || saving || demo) return;
  el("confirm-copy").textContent = `${editing.role} at ${editing.company}`;
  confirm.returnValue = "cancel";
  confirm.showModal();
}

confirm.addEventListener("close", async () => {
  if (confirm.returnValue !== "delete" || !editing) return;
  setSaving(true);
  try {
    await request("DELETE", { id: editing.id, revision: editing.revision });
    applications = await request("GET");
    editor.close();
    render();
    notify("Application deleted");
  } catch (error) {
    showFormError(error);
  } finally {
    setSaving(false);
  }
});

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\t\r\n ]*[=@+\-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function exportCSV() {
  const fields = {
    company: "Company", role: "Role", ...DATES, status: "Current status", outcome: "Outcome",
    source: "Source", resume: "Résumé version", link: "Job link", notes: "Notes",
  };
  const lines = [Object.values(fields).map(csvCell).join(",")];
  for (const job of [...rows()].sort(compareNewest)) {
    const record = { ...job, status: STATUS[getStatus(job)].label, outcome: OUTCOMES[job.outcome] };
    lines.push(Object.keys(fields).map(field => csvCell(record[field])).join(","));
  }
  download(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    demo ? "job-tracker-demo.csv" : `job-applications-${todayKey()}.csv`);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  if (demo) return;
  const data = JSON.stringify({ version: 1, applications }, null, 2);
  download(new Blob([data], { type: "application/json" }), `job-tracker-backup-${todayKey()}.json`);
}

async function importBackup(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file || demo) return;
  const message = el("import-error");
  message.hidden = true;
  try {
    const result = await importApplications(await file.text());
    applications = result.records;
    loaded = true;
    showApplications();
    const duplicates = result.skipped ? `, ${result.skipped} already in tracker` : "";
    notify(`Imported ${result.added} ${result.added === 1 ? "application" : "applications"}${duplicates}.`);
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  } finally {
    input.value = "";
  }
}

document.addEventListener("click", event => {
  const action = event.target.closest("[data-add],[data-open],[data-filter],[data-clear]");
  if (!action) return;
  if (action.hasAttribute("data-add")) {
    if (demo) {
      demo = false;
      statusFilter.value = "all";
      el("search").value = "";
      render();
    }
    openEditor();
  } else if (action.dataset.open) {
    const job = rows().find(row => row.id === action.dataset.open);
    if (job) openEditor(job);
  } else if (action.dataset.filter) {
    showApplications(action.dataset.filter);
  } else {
    showApplications();
  }
});
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
el("search").addEventListener("input", renderApplications);
statusFilter.addEventListener("change", renderApplications);
el("sort").addEventListener("change", renderApplications);
el("view-all").addEventListener("click", () => {
  statusFilter.value = "all";
  el("search").value = "";
});
el("demo").addEventListener("click", () => { demo = true; render(); });
el("close-demo").addEventListener("click", () => {
  demo = false;
  statusFilter.value = "all";
  el("search").value = "";
  render();
});
el("retry").addEventListener("click", load);
el("export").addEventListener("click", exportCSV);
el("backup").addEventListener("click", exportBackup);
el("import").addEventListener("click", () => el("import-file").click());
el("import-file").addEventListener("change", importBackup);
window.addEventListener("storage", event => {
  if (event.key === storageKey || event.key === null) load();
});
for (const id of ["cancel", "close-editor"]) el(id).addEventListener("click", () => editor.close());
editor.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
form.elements.applied.addEventListener("change", syncDates);
form.elements.outcome.addEventListener("change", syncDates);
form.addEventListener("invalid", event => {
  const section = event.target.closest("details");
  if (section) section.open = true;
}, true);
form.addEventListener("submit", save);
el("delete").addEventListener("click", remove);
load();
