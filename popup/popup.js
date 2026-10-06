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
    summaryEl.replaceChildren();
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

  summaryEl.replaceChildren(
    ...rows.map(([k, v]) => {
      const row = document.createElement("div");
      row.className = "row";
      const keyEl = document.createElement("span");
      keyEl.className = "k";
      keyEl.textContent = k;
      const valEl = document.createElement("span");
      valEl.className = "v";
      valEl.textContent = String(v);
      row.append(keyEl, valEl);
      return row;
    })
  );
  summaryEl.hidden = false;
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

function isLinkedInUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function isSupportedSiteUrl(url) {
  if (isJobsDbUrl(url)) return true;
  return isLinkedInJobUrl(url);
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

function isLinkedInJobUrl(url) {
  if (!isLinkedInUrl(url)) return false;
  try {
    return /\/jobs\/view\/(?:.*-)?(\d+)\/?/i.test(new URL(url).pathname || "");
  } catch {
    return false;
  }
}

function isJobDetailUrl(url) {
  return isJobsDbJobUrl(url) || isLinkedInJobUrl(url);
}

function extractorApi() {
  return globalThis.JobExtractor || globalThis.JobsDBExtractor;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

async function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  // Prefer the downloads API so the file survives popup close and is not
  // truncated by an early revokeObjectURL (common with large LinkedIn exports).
  try {
    if (browser.downloads?.download) {
      await browser.downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
  } catch {
    /* fall back to <a download> */
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function uniqueJobIdCount(jobs) {
  const ids = new Set();
  for (const job of jobs) {
    if (job?.jobId) ids.add(String(job.jobId));
    else if (job?.pageUrl) ids.add(job.pageUrl);
    else if (job?.url) ids.add(job.url);
  }
  return ids.size;
}

function jobToMarkdown(job) {
  return (
    extractorApi()?.toMarkdown?.(job) ||
    `# ${job.title || "Job"}\n\n${job.description || ""}\n`
  );
}

function jobToPlainText(job) {
  return (
    extractorApi()?.toPlainText?.(job) ||
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

async function extractFromTabId(tabId, pageUrl) {
  try {
    const result = await browser.tabs.sendMessage(tabId, {
      type: "EXTRACT_JOB",
      pageUrl: pageUrl || undefined,
    });
    if (result?.ok && result.job) {
      const job = { ...result.job };
      if (pageUrl) {
        job.pageUrl = pageUrl;
        job.url = pageUrl;
          const fromTab =
          globalThis.LinkedInExtractor?.extractJobIdFromUrl?.(pageUrl) ||
          null;
        // Prefer id derived from the tab URL when available (popup may not load LinkedIn helper).
        try {
          const u = new URL(pageUrl);
          const view = u.pathname.match(/\/jobs\/view\/(?:.*-)?(\d+)\/?/i);
          if (view?.[1]) job.jobId = view[1];
          else if (fromTab) job.jobId = fromTab;
        } catch {
          if (fromTab) job.jobId = fromTab;
        }
      }
      return { ok: true, job };
    }
    return { ok: false, error: result?.errors?.[0] || "No job data found" };
  } catch {
    return { ok: false, error: "Content script unavailable — refresh the tab" };
  }
}

async function getOpenJobTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.filter((tab) => tab.id != null && tab.url && isJobDetailUrl(tab.url));
}

async function extractAllOpenJobs() {
  const jobTabs = await getOpenJobTabs();
  if (!jobTabs.length) {
    return { jobs: [], failed: 0, tabCount: 0, failures: [] };
  }

  const jobs = [];
  const failures = [];

  for (const tab of jobTabs) {
    setBulkStatus(`Extracting ${jobs.length + failures.length + 1}/${jobTabs.length}…`);
    const result = await extractFromTabId(tab.id, tab.url);
    if (result.ok) jobs.push(result.job);
    else failures.push({ url: tab.url, error: result.error });
  }

  return { jobs, failed: failures.length, tabCount: jobTabs.length, failures };
}

async function exportAll(format) {
  if (bulkBusy) return;
  setBulkBusy(true);
  setBulkStatus("Scanning open tabs…");

  try {
    const { jobs, failed, tabCount, failures } = await extractAllOpenJobs();

    if (!tabCount) {
      setBulkStatus("No open JobsDB / LinkedIn job tabs found", "is-error");
      return;
    }
    if (!jobs.length) {
      setBulkStatus(
        `Found ${tabCount} job tab(s), but extraction failed — refresh those tabs`,
        "is-error"
      );
      return;
    }

    const uniqueIds = uniqueJobIdCount(jobs);
    const base = `jobs-${stamp()}`;
    let text;
    let filename;
    let mime;

    if (format === "json") {
      text = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: jobs.length,
          uniqueJobIds: uniqueIds,
          tabCount,
          failed,
          failures: failures.length ? failures : undefined,
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

    await downloadText(filename, text, mime);

    const failNote = failed ? `, ${failed} failed` : "";
    const dupNote =
      uniqueIds < jobs.length ? `, ${uniqueIds} unique job ids` : "";
    setBulkStatus(
      `Exported ${jobs.length}/${tabCount} job(s)${failNote}${dupNote} → ${filename}`,
      "is-ok"
    );
    setStatus(`Bulk export ready (${jobs.length})`, "is-ok");

    await browser.storage.local.set({
      lastBulkExport: {
        jobs,
        savedAt: new Date().toISOString(),
        format,
        filename,
        count: jobs.length,
        uniqueJobIds: uniqueIds,
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
  if (!tab?.id || !tab.url || !isSupportedSiteUrl(tab.url)) {
    setJob(null);
    setStatus("Open a JobsDB or LinkedIn job page", "is-error");
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
    setStatus("Cannot reach the page — refresh the job tab and try again", "is-error");
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
