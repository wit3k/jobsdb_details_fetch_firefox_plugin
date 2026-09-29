"use strict";

const LAST_JOB_KEY = "lastExtractedJob";

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "JOB_EXTRACTED" && message.payload?.job) {
    return browser.storage.local
      .set({
        [LAST_JOB_KEY]: {
          job: message.payload.job,
          savedAt: new Date().toISOString(),
        },
      })
      .then(() => ({ ok: true }));
  }
  return undefined;
});
