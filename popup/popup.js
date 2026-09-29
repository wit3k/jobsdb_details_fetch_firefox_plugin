"use strict";

const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const bulkStatusEl = document.getElementById("bulk-status");
const btnJson = document.getElementById("btn-json");
const btnMd = document.getElementById("btn-md");
const btnText = document.getElementById("btn-text");
const btnRefresh = document.getElementById("btn-refresh");
const btnBulkJson = document.getElementById("btn-bulk-json");
const btnBulkMd = document.getElementById("btn-bulk-md");
const btnBulkText = document.getElementById("btn-bulk-text");

let currentJob = null;
let bulkBusy = false;

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.classList.remove("is-error", "is-ok");
  if (kind) statusEl.classList.add(kind);
}

function setBulkStatus(text, kind = "") {
  bulkStatusEl.textContent = text;
  bulkStatusEl.classList.remove("is-error", "is-ok");
  if (kind) bulkStatusEl.classList.add(kind);
}

function setBulkBusy(busy) {
  bulkBusy = busy;
  btnBulkJson.disabled = busy;
  btnBulkMd.disabled = busy;
  btnBulkText.disabled = busy;
}

function renderSummary(job) {
  if (!job) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = "";
    return;
  }
  const rows = [
    ["Title", job.title],
    ["Company", job.company],
    ["Location", job.location],
    ["Salary", job.salary],
    ["Work type", job.workType],
    ["Source", job.source],
  ].filter(([, v]) => v);

  summaryEl.innerHTML = rows
    .map(
      ([k, v]) =>
        `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(
          String(v)
        )}</span></div>`
    )
    .join("");
  summaryEl.hidden = false;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setJob(job, note) {
  currentJob = job;
  const enabled = Boolean(job);
  btnJson.disabled = !enabled;
  btnMd.disabled = !enabled;
  btnText.disabled = !enabled;
  renderSummary(job);
  if (job) setStatus(note || "Job ready to copy", "is-ok");
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
  setStatus("Copied to clipboard", "is-ok");
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isJobsDbUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "jobsdb.com" || host.endsWith(".jobsdb.com");
  } catch {
    return false;
  }
}

function isJobsDbJobUrl(url) {
  if (!isJobsDbUrl(url)) return false;
  try {
    const path = new URL(url).pathname || "";
    return /\/job\/\d+/i.test(path) || /\/jobs\/\d+/i.test(path);
  } catch {
    return false;
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function jobToMarkdown(job) {
  return (
    globalThis.JobsDBExtractor?.toMarkdown?.(job) ||
    `# ${job.title || "Job"}\n\n${job.description || ""}\n`
  );
}

function jobToPlainText(job) {
  return (
    globalThis.JobsDBExtractor?.toPlainText?.(job) ||
    [job.title, job.company, job.description].filter(Boolean).join("\n") + "\n"
  );
}

function jobsToMarkdown(jobs) {
  return jobs
    .map((job, i) => {
      const body = jobToMarkdown(job).trim();
      return i === 0 ? body : `\n---\n\n${body}`;
    })
    .join("\n")
    .trim() + "\n";
}

function jobsToPlainText(jobs) {
  const divider = "\n" + "=".repeat(60) + "\n";
  return jobs
    .map((job, i) => {
      const body = jobToPlainText(job).trim();
      return i === 0 ? body : `${divider}\n${body}`;
    })
    .join("\n")
    .trim() + "\n";
}

async function extractFromTabId(tabId) {
  try {
    const result = await browser.tabs.sendMessage(tabId, { type: "EXTRACT_JOB" });
    if (result?.ok && result.job) return { ok: true, job: result.job };
    return { ok: false, error: result?.errors?.[0] || "No job data found" };
  } catch {
    return { ok: false, error: "Content script unavailable — refresh the tab" };
  }
}

async function getOpenJobTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.filter((tab) => tab.id != null && tab.url && isJobsDbJobUrl(tab.url));
}

async function extractAllOpenJobs() {
  const jobTabs = await getOpenJobTabs();
  if (!jobTabs.length) {
    return { jobs: [], failed: 0, tabCount: 0 };
  }

  const jobs = [];
  let failed = 0;

  for (const tab of jobTabs) {
    setBulkStatus(`Extracting ${jobs.length + failed + 1}/${jobTabs.length}…`);
    const result = await extractFromTabId(tab.id);
    if (result.ok) jobs.push(result.job);
    else failed += 1;
  }

  return { jobs, failed, tabCount: jobTabs.length };
}

async function exportAll(format) {
  if (bulkBusy) return;
  setBulkBusy(true);
  setBulkStatus("Scanning open tabs…");

  try {
    const { jobs, failed, tabCount } = await extractAllOpenJobs();

    if (!tabCount) {
      setBulkStatus("No open JobsDB job tabs found", "is-error");
      return;
    }
    if (!jobs.length) {
      setBulkStatus(
        `Found ${tabCount} job tab(s), but extraction failed — refresh those tabs`,
        "is-error"
      );
      return;
    }

    const base = `jobsdb-jobs-${stamp()}`;
    let text;
    let filename;
    let mime;

    if (format === "json") {
      text = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: jobs.length,
          jobs,
        },
        null,
        2
      );
      filename = `${base}.json`;
      mime = "application/json";
    } else if (format === "md") {
      text = jobsToMarkdown(jobs);
      filename = `${base}.md`;
      mime = "text/markdown";
    } else {
      text = jobsToPlainText(jobs);
      filename = `${base}.txt`;
      mime = "text/plain";
    }

    downloadText(filename, text, mime);

    const failNote = failed ? `, ${failed} failed` : "";
    setBulkStatus(`Exported ${jobs.length}/${tabCount} job(s)${failNote} → ${filename}`, "is-ok");
    setStatus(`Bulk export ready (${jobs.length})`, "is-ok");

    await browser.storage.local.set({
      lastBulkExport: {
        jobs,
        savedAt: new Date().toISOString(),
        format,
        filename,
      },
    });
  } catch (err) {
    setBulkStatus(err?.message || "Bulk export failed", "is-error");
  } finally {
    setBulkBusy(false);
  }
}

async function extractFromTab() {
  setStatus("Extracting job…");
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isJobsDbUrl(tab.url)) {
    setJob(null);
    setStatus("Open a JobsDB job page (hk/th.jobsdb.com)", "is-error");
    return;
  }

  try {
    const result = await browser.tabs.sendMessage(tab.id, { type: "EXTRACT_JOB" });
    if (result?.ok && result.job) {
      setJob(result.job);
      await browser.storage.local.set({
        lastExtractedJob: { job: result.job, savedAt: new Date().toISOString() },
      });
      return;
    }
    setJob(null);
    setStatus(result?.errors?.[0] || "No job data found", "is-error");
  } catch {
    setStatus("Cannot reach the page — refresh the JobsDB tab and try again", "is-error");
    const stored = await browser.storage.local.get("lastExtractedJob");
    if (stored.lastExtractedJob?.job) {
      setJob(stored.lastExtractedJob.job, "Showing last saved job");
    } else {
      setJob(null);
    }
  }
}

btnJson.addEventListener("click", () => {
  if (currentJob) copy(JSON.stringify(currentJob, null, 2));
});

btnMd.addEventListener("click", () => {
  if (!currentJob) return;
  copy(jobToMarkdown(currentJob));
});

btnText.addEventListener("click", () => {
  if (!currentJob) return;
  copy(jobToPlainText(currentJob));
});

btnBulkJson.addEventListener("click", () => exportAll("json"));
btnBulkMd.addEventListener("click", () => exportAll("md"));
btnBulkText.addEventListener("click", () => exportAll("txt"));

btnRefresh.addEventListener("click", () => extractFromTab());

extractFromTab();
