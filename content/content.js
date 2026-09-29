(function () {
  "use strict";

  const BTN_ID = "jobsdb-extractor-fab";
  const TOAST_ID = "jobsdb-extractor-toast";

  function ensureFab() {
    if (document.getElementById(BTN_ID)) return;
    if (!globalThis.JobsDBExtractor?.isJobDetailPage?.()) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "Extract JobsDB job";
    btn.setAttribute("aria-label", "Extract JobsDB job");
    btn.textContent = "Extract";
    btn.addEventListener("click", async () => {
      const result = globalThis.JobsDBExtractor.extractJobDetails();
      if (!result.ok) {
        showToast(result.errors[0] || "No data", true);
        return;
      }
      const text = JSON.stringify(result.job, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        showToast("Job JSON copied");
        browser.runtime.sendMessage({ type: "JOB_EXTRACTED", payload: result }).catch(() => {});
      } catch {
        showToast("Extracted — open the extension popup to copy", false);
        browser.runtime.sendMessage({ type: "JOB_EXTRACTED", payload: result }).catch(() => {});
      }
    });
    document.documentElement.appendChild(btn);
  }

  function showToast(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "EXTRACT_JOB") {
      const result = globalThis.JobsDBExtractor.extractJobDetails();
      if (result.ok) {
        browser.runtime.sendMessage({ type: "JOB_EXTRACTED", payload: result }).catch(() => {});
      }
      return Promise.resolve(result);
    }
    return undefined;
  });

  ensureFab();
  const obs = new MutationObserver(() => ensureFab());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
