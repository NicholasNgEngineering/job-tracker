import { validateJob } from "./model.js";

export const storageKey = "job-tracker.github-pages.applications.v1";

function readApplications() {
  const stored = localStorage.getItem(storageKey);
  if (stored === null) return [];
  const records = JSON.parse(stored);
  if (!Array.isArray(records)) throw new Error("Couldn’t read your saved applications.");
  return records;
}

function writeApplications(records) {
  localStorage.setItem(storageKey, JSON.stringify(records));
}

function newRecord(job, id = crypto.randomUUID()) {
  return { ...validateJob(job), id, revision: 1 };
}

function withWriteLock(action) {
  const locks = navigator.locks;
  return locks ? locks.request(storageKey, action) : action();
}

export async function request(method, body) {
  if (method === "GET") return readApplications();
  return withWriteLock(() => {
    const records = readApplications();
    if (method === "POST") {
      const record = newRecord(body);
      writeApplications([...records, record]);
      return record;
    }
    const index = records.findIndex(row => row.id === body.id && row.revision === body.revision);
    if (index < 0) throw new Error("This application changed. Close the editor and reopen it.");
    if (method === "DELETE") {
      records.splice(index, 1);
      writeApplications(records);
      return { id: body.id };
    }
    const record = { ...validateJob(body), id: body.id, revision: body.revision + 1 };
    records[index] = record;
    writeApplications(records);
    return record;
  });
}

function identity(job) {
  return JSON.stringify([job.company.toLowerCase(), job.role.toLowerCase(), job.applied]);
}

export async function importApplications(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid Job Tracker JSON file.");
  }
  if (data?.version !== 1 || !Array.isArray(data.applications)) {
    throw new Error("Choose a Job Tracker JSON file.");
  }
  const proposed = data.applications.map(input => {
    const id = typeof input?.id === "string" && /^[a-f0-9-]{36}$/i.test(input.id) ? input.id : undefined;
    return newRecord(input, id);
  });
  return withWriteLock(() => {
    const current = readApplications();
    const ids = new Set(current.map(job => job.id));
    const identities = new Set(current.map(identity));
    const added = [];
    for (const job of proposed) {
      const signature = identity(job);
      if (ids.has(job.id) || identities.has(signature)) continue;
      ids.add(job.id);
      identities.add(signature);
      added.push(job);
    }
    const records = [...current, ...added];
    if (added.length) writeApplications(records);
    return { records, added: added.length, skipped: proposed.length - added.length };
  });
}
