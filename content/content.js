(function () {
  "use strict";

  const BTN_ID = "jobsdb-extractor-fab";
  const TOAST_ID = "jobsdb-extractor-toast";

  function api() {
    return globalThis.JobExtractor || globalThis.JobsDBExtractor;
  }

  async function runExtract(options) {
    return Promise.resolve(api().extractJobDetails(options || {}));
  }

  function ensureFab() {
    if (document.getElementById(BTN_ID)) return;
    if (!api()?.isJobDetailPage?.()) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "Extract job details";
    btn.setAttribute("aria-label", "Extract job details");
    btn.textContent = "Extract";
    btn.addEventListener("click", async () => {
      const result = await runExtract({ pageUrl: location.href });
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
      return runExtract({ pageUrl: message.pageUrl || location.href }).then((result) => {
        if (result.ok) {
          browser.runtime.sendMessage({ type: "JOB_EXTRACTED", payload: result }).catch(() => {});
        }
        return result;
      });
    }
    return undefined;
  });

  ensureFab();
  const obs = new MutationObserver(() => ensureFab());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
