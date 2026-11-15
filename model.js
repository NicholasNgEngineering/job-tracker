export const STATUS = {
  awaiting: { label: "Awaiting reply", color: "#aabca7" },
  ghosted: { label: "No reply · 4+ weeks", color: "#9a825b" },
  replied: { label: "Replied", color: "#497a7d" },
  interviewing: { label: "Interviewing", color: "#477a5c" },
  offered: { label: "Offer received", color: "#976918" },
  accepted: { label: "Offer accepted", color: "#27704e" },
  rejected: { label: "Rejected", color: "#b95c4d" },
  withdrawn: { label: "Withdrawn", color: "#746878" },
};

export const DATES = {
  applied: "Date applied",
  reply: "First reply",
  round1: "Round 1 invite",
  round2: "Round 2 invite",
  round3: "Round 3 invite",
  offer: "Offer received",
  rejected: "Rejection received",
};
export const TEXT_FIELDS = {
  company: 120, role: 160, source: 120, resume: 160, link: 2000, notes: 5000,
};
export const OUTCOMES = {
  open: "Active",
  rejected: "Rejected",
  accepted: "Offer accepted",
  withdrawn: "Withdrawn / offer declined",
};

export function todayKey() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(part => String(part).padStart(2, "0")).join("-");
}

export function getStatus(job, today = todayKey()) {
  if (job.outcome !== "open") return job.outcome;
  if (job.offer) return "offered";
  if (job.round1 || job.round2 || job.round3) return "interviewing";
  if (gotReply(job)) return "replied";
  const daysElapsed = (Date.parse(today) - Date.parse(job.applied)) / 86400000;
  return daysElapsed >= 28 ? "ghosted" : "awaiting";
}

export function gotReply(job) {
  return Boolean(job.reply || job.round1 || job.round2 || job.round3 || job.offer ||
    job.rejected || job.outcome === "rejected");
}

export function validateJob(input) {
  if (!input || typeof input !== "object") throw new Error("Enter application details.");
  const record = {};
  for (const [field, length] of Object.entries(TEXT_FIELDS)) {
    const value = typeof input[field] === "string" ? input[field].trim() : "";
    if (value.length > length) throw new Error("One of the fields is too long.");
    record[field] = value;
  }
  if (!record.company || !record.role) throw new Error("Enter a company and role.");
  if (record.link) {
    try {
      const url = new URL(record.link);
      if (![ "http:", "https:" ].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error("Enter a job link starting with https:// or http://.");
    }
  }

  for (const [field, label] of Object.entries(DATES)) {
    const value = input[field] || "";
    if (value && !validDate(value)) throw new Error(`Enter a valid date for ${label.toLowerCase()}.`);
    record[field] = value;
  }
  if (!record.applied) throw new Error("Enter the date you applied.");
  for (const [field, label] of Object.entries(DATES)) {
    if (record[field] && record[field] < record.applied) {
      throw new Error(`${label} must be on or after the application date.`);
    }
  }
  const outcome = input.outcome || "open";
  if (!Object.hasOwn(OUTCOMES, outcome)) throw new Error("Choose a valid outcome.");
  if (outcome === "accepted" && !record.offer) throw new Error("Enter the offer date.");
  record.outcome = record.rejected && outcome === "open" ? "rejected" : outcome;
  return record;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
