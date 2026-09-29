/**
 * JobsDB job detail extraction.
 * Strategy (in order): JSON-LD JobPosting → __NEXT_DATA__ / page props →
 * data-automation DOM → heuristic DOM fallbacks.
 */
(function (global) {
  "use strict";

  const AUTOMATION = {
    title: [
      '[data-automation="job-detail-title"]',
      '[data-automation="jobTitle"]',
      'h1[data-automation="job-detail-title"]',
    ],
    company: [
      '[data-automation="advertiser-name"]',
      '[data-automation="job-company-name"]',
      'a[data-automation="job-header-company-name"]',
      '[data-automation="company-profile-name"]',
    ],
    location: [
      '[data-automation="job-detail-location"]',
      '[data-automation="jobLocation"]',
    ],
    salary: [
      '[data-automation="job-detail-salary"]',
      '[data-automation="jobSalary"]',
    ],
    workType: [
      '[data-automation="job-detail-work-type"]',
      '[data-automation="jobWorkType"]',
    ],
    classification: [
      '[data-automation="job-detail-classifications"]',
      '[data-automation="jobClassification"]',
    ],
    description: [
      '[data-automation="jobAdDetails"]',
      '[data-automation="job-detail-description"]',
      '[data-automation="jobDescription"]',
      'div[data-automation="jobAdDetails"]',
    ],
    posted: [
      '[data-automation="job-detail-date"]',
      '[data-automation="jobListedDate"]',
    ],
  };

  function textOf(el) {
    if (!el) return null;
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return t || null;
  }

  function htmlOf(el) {
    if (!el) return null;
    const h = (el.innerHTML || "").trim();
    return h || null;
  }

  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function clean(value) {
    if (value == null) return null;
    if (typeof value === "string") {
      const t = value.replace(/\s+/g, " ").trim();
      return t || null;
    }
    return value;
  }

  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function pick(...values) {
    for (const v of values) {
      const c = clean(v);
      if (c != null && c !== "") return c;
    }
    return null;
  }

  function deepFind(obj, predicate, maxDepth = 12) {
    const seen = new Set();
    const stack = [{ value: obj, depth: 0 }];
    while (stack.length) {
      const { value, depth } = stack.pop();
      if (value == null || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (predicate(value)) return value;
      if (depth >= maxDepth) continue;
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          stack.push({ value: value[i], depth: depth + 1 });
        }
      } else {
        for (const k of Object.keys(value)) {
          stack.push({ value: value[k], depth: depth + 1 });
        }
      }
    }
    return null;
  }

  function looksLikeJobDetails(node) {
    if (!node || typeof node !== "object") return false;
    const hasTitle = typeof node.title === "string" && node.title.length > 1;
    const hasCompany =
      (node.companyName && typeof node.companyName === "string") ||
      (node.advertiser && (node.advertiser.name || node.advertiser.id)) ||
      typeof node.advertiserName === "string";
    const hasId = node.id != null || node.jobId != null || node.listingId != null;
    return hasTitle && (hasCompany || hasId || node.description || node.content);
  }

  function salaryFromNode(node) {
    if (!node) return null;
    if (typeof node.salary === "string") return clean(node.salary);
    if (typeof node.salaryLabel === "string") return clean(node.salaryLabel);
    if (typeof node.salaryText === "string") return clean(node.salaryText);
    const range = node.salaryRange || node.salary;
    if (range && typeof range === "object") {
      const min = range.min ?? range.minimumAmount ?? range.low;
      const max = range.max ?? range.maximumAmount ?? range.high;
      const currency = range.currency || node.salaryCurrency || "";
      const period = range.period || range.interval || node.salaryType || "";
      if (min != null || max != null) {
        const parts = [currency, min != null && max != null ? `${min} – ${max}` : min ?? max, period]
          .filter(Boolean)
          .join(" ");
        return clean(parts);
      }
    }
    return null;
  }

  function locationFromNode(node) {
    if (!node) return null;
    if (typeof node.location === "string") return clean(node.location);
    if (typeof node.locationLabel === "string") return clean(node.locationLabel);
    const loc = node.location || node.jobLocation;
    if (Array.isArray(loc)) {
      return clean(loc.map((l) => (typeof l === "string" ? l : l?.label || l?.name)).filter(Boolean).join(", "));
    }
    if (loc && typeof loc === "object") {
      return pick(loc.label, loc.name, loc.displayName, [loc.area, loc.suburb, loc.city].filter(Boolean).join(", "));
    }
    return pick(node.suburb, node.area, node.city);
  }

  function companyFromNode(node) {
    if (!node) return null;
    return pick(
      node.companyName,
      node.advertiserName,
      node.company?.name,
      node.advertiser?.name,
      node.advertiser?.description,
      node.employer?.name
    );
  }

  function descriptionFromNode(node) {
    if (!node) return { text: null, html: null };
    const html = pick(node.descriptionHtml, node.content, typeof node.description === "string" && node.description.includes("<") ? node.description : null);
    let text = pick(
      node.descriptionText,
      typeof node.description === "string" && !node.description.includes("<") ? node.description : null,
      node.teaser,
      node.abstract
    );
    if (!text && html) {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      text = textOf(tmp);
    }
    return { text, html };
  }

  function fromJobNode(node, source) {
    if (!node) return null;
    const { text: description, html: descriptionHtml } = descriptionFromNode(node);
    const bulletPoints = asArray(node.bulletPoints || node.bullet_points || node.keyPoints)
      .map((b) => (typeof b === "string" ? clean(b) : clean(b?.text)))
      .filter(Boolean);

    const workTypes = asArray(node.workTypes || node.workType || node.work_type)
      .map((w) => (typeof w === "string" ? clean(w) : clean(w?.label || w?.name)))
      .filter(Boolean);

    const classifications = asArray(node.classifications || node.classification)
      .map((c) => {
        if (typeof c === "string") return clean(c);
        const main = clean(c?.description || c?.label || c?.name);
        const sub = clean(c?.subClassification?.description || c?.subclassification || c?.subClassification);
        return [main, sub].filter(Boolean).join(" / ") || null;
      })
      .filter(Boolean);

    const jobId = pick(
      node.id != null ? String(node.id) : null,
      node.jobId != null ? String(node.jobId) : null,
      node.listingId != null ? String(node.listingId) : null
    );

    return {
      source,
      jobId,
      title: pick(node.title, node.jobTitle),
      company: companyFromNode(node),
      companyUrl: pick(node.companyUrl, node.company?.url, node.advertiser?.url, node.companyProfileUrl),
      location: locationFromNode(node),
      salary: salaryFromNode(node),
      workType: workTypes.join(", ") || null,
      workArrangement: pick(
        node.workArrangement,
        node.workArrangements?.label,
        Array.isArray(node.workArrangements)
          ? node.workArrangements.map((w) => w?.label || w).filter(Boolean).join(", ")
          : null
      ),
      classification: classifications.join("; ") || null,
      postedAt: pick(node.listingDate, node.listedAt, node.postedAt, node.datePosted, node.createdAt),
      postedLabel: pick(node.listingDateDisplay, node.listedAtLabel, node.postedLabel),
      teaser: pick(node.teaser, node.abstract, node.summary),
      bulletPoints,
      description,
      descriptionHtml,
      url: pick(node.canonicalUrl, node.url, node.shareLink, global.location.href),
    };
  }

  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent || "");
      } catch {
        continue;
      }
      const candidates = asArray(data).flatMap((item) => {
        if (item?.["@graph"]) return asArray(item["@graph"]);
        return [item];
      });
      for (const item of candidates) {
        const type = item?.["@type"];
        const types = asArray(type).map((t) => String(t).toLowerCase());
        if (!types.includes("jobposting")) continue;

        const org = item.hiringOrganization || {};
        const loc = item.jobLocation;
        let location = null;
        if (typeof loc === "string") location = loc;
        else {
          const places = asArray(loc).map((l) => {
            const addr = l?.address || l;
            if (typeof addr === "string") return addr;
            return [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
              .filter(Boolean)
              .join(", ");
          });
          location = places.filter(Boolean).join("; ") || null;
        }

        const baseSalary = item.baseSalary;
        let salary = null;
        if (typeof baseSalary === "string") salary = baseSalary;
        else if (baseSalary?.value) {
          const v = baseSalary.value;
          const min = v.minValue ?? v.value;
          const max = v.maxValue;
          const currency = baseSalary.currency || "";
          const unit = baseSalary.unitText || v.unitText || "";
          salary = [currency, min != null && max != null ? `${min} – ${max}` : min ?? max, unit]
            .filter(Boolean)
            .join(" ");
        }

        const descriptionHtml =
          typeof item.description === "string" && item.description.includes("<")
            ? item.description
            : null;
        let description = typeof item.description === "string" ? item.description : null;
        if (descriptionHtml) {
          const tmp = document.createElement("div");
          tmp.innerHTML = descriptionHtml;
          description = textOf(tmp);
        }

        return {
          source: "json-ld",
          jobId: pick(item.identifier?.value, item.identifier, null),
          title: pick(item.title),
          company: pick(typeof org === "string" ? org : org.name),
          companyUrl: pick(typeof org === "object" ? org.sameAs || org.url : null),
          location: clean(location),
          salary: clean(salary),
          workType: pick(
            Array.isArray(item.employmentType) ? item.employmentType.join(", ") : item.employmentType
          ),
          workArrangement: null,
          classification: pick(item.occupationalCategory, item.industry),
          postedAt: pick(item.datePosted),
          postedLabel: null,
          teaser: null,
          bulletPoints: [],
          description,
          descriptionHtml,
          url: pick(item.url, global.location.href),
        };
      }
    }
    return null;
  }

  function extractNextData() {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el?.textContent) return null;
    let data;
    try {
      data = JSON.parse(el.textContent);
    } catch {
      return null;
    }
    const jobNode = deepFind(data, looksLikeJobDetails);
    return fromJobNode(jobNode, "next-data");
  }

  function extractApolloOrSeekState() {
    const keys = ["__APOLLO_STATE__", "__SEEK_APP_STATE__", "__PRELOADED_STATE__"];
    for (const key of keys) {
      try {
        const raw = global[key];
        if (!raw) continue;
        const jobNode = deepFind(raw, looksLikeJobDetails);
        if (jobNode) return fromJobNode(jobNode, key);
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function extractFromDomAutomation() {
    const title = textOf(firstMatch(AUTOMATION.title));
    const companyEl = firstMatch(AUTOMATION.company);
    const company = textOf(companyEl);
    const companyUrl = companyEl?.closest("a")?.href || companyEl?.href || null;
    const jobLocation = textOf(firstMatch(AUTOMATION.location));
    const salary = textOf(firstMatch(AUTOMATION.salary));
    const workType = textOf(firstMatch(AUTOMATION.workType));
    const classification = textOf(firstMatch(AUTOMATION.classification));
    const descEl = firstMatch(AUTOMATION.description);
    const description = textOf(descEl);
    const descriptionHtml = htmlOf(descEl);
    const postedLabel = textOf(firstMatch(AUTOMATION.posted));
    const pageUrl = global.location.href;

    if (!title && !description && !company) return null;

    return {
      source: "dom-automation",
      jobId: extractJobIdFromUrl(pageUrl),
      title,
      company,
      companyUrl,
      location: jobLocation,
      salary,
      workType,
      workArrangement: null,
      classification,
      postedAt: null,
      postedLabel,
      teaser: null,
      bulletPoints: [],
      description,
      descriptionHtml,
      url: pageUrl,
    };
  }

  function extractFromDomHeuristic() {
    const title =
      textOf(document.querySelector("h1")) ||
      textOf(document.querySelector('[class*="JobTitle"], [class*="job-title"]'));

    const company =
      textOf(document.querySelector('a[href*="/companies/"]')) ||
      textOf(document.querySelector('[class*="Advertiser"], [class*="CompanyName"]'));

    const descEl =
      document.querySelector('[data-automation="jobAdDetails"]') ||
      document.querySelector("article") ||
      document.querySelector('[class*="JobDescription"], [class*="job-description"]');

    if (!title && !descEl) return null;

    const pageUrl = global.location.href;
    return {
      source: "dom-heuristic",
      jobId: extractJobIdFromUrl(pageUrl),
      title,
      company,
      companyUrl: document.querySelector('a[href*="/companies/"]')?.href || null,
      location: null,
      salary: null,
      workType: null,
      workArrangement: null,
      classification: null,
      postedAt: null,
      postedLabel: null,
      teaser: null,
      bulletPoints: [],
      description: textOf(descEl),
      descriptionHtml: htmlOf(descEl),
      url: pageUrl,
    };
  }

  function extractJobIdFromUrl(url) {
    try {
      const u = new URL(url);
      const m =
        u.pathname.match(/\/job\/(\d+)/i) ||
        u.pathname.match(/\/jobs\/(\d+)/i) ||
        u.searchParams.get("jobId");
      if (typeof m === "string") return m;
      if (m) return m[1];
    } catch {
      /* ignore */
    }
    return null;
  }

  function isJobDetailPage() {
    const path = global.location.pathname || "";
    return (
      /\/job\/\d+/i.test(path) ||
      /\/jobs\/\d+/i.test(path) ||
      Boolean(
        document.querySelector(
          '[data-automation="job-detail-title"], [data-automation="jobAdDetails"]'
        )
      )
    );
  }

  function mergeJob(...parts) {
    const pageUrl = global.location.href;
    const base = {
      source: null,
      jobId: null,
      title: null,
      company: null,
      companyUrl: null,
      location: null,
      salary: null,
      workType: null,
      workArrangement: null,
      classification: null,
      postedAt: null,
      postedLabel: null,
      teaser: null,
      bulletPoints: [],
      description: null,
      descriptionHtml: null,
      url: pageUrl,
      extractedAt: new Date().toISOString(),
      pageUrl,
    };

    const sources = [];
    for (const part of parts) {
      if (!part) continue;
      sources.push(part.source);
      for (const key of Object.keys(base)) {
        if (key === "source" || key === "extractedAt" || key === "pageUrl") continue;
        if (key === "bulletPoints") {
          if ((!base.bulletPoints || !base.bulletPoints.length) && part.bulletPoints?.length) {
            base.bulletPoints = part.bulletPoints;
          }
          continue;
        }
        if (base[key] == null || base[key] === "") {
          if (part[key] != null && part[key] !== "") base[key] = part[key];
        }
      }
    }
    base.source = sources.filter(Boolean).join("+") || null;
    base.jobId = base.jobId || extractJobIdFromUrl(base.url || global.location.href);
    return base;
  }

  function extractJobDetails() {
    const jsonLd = extractJsonLd();
    const nextData = extractNextData();
    const seekState = extractApolloOrSeekState();
    const domAuto = extractFromDomAutomation();
    const heuristic = extractFromDomHeuristic();

    const merged = mergeJob(jsonLd, nextData, seekState, domAuto, heuristic);
    const hasSignal = Boolean(merged.title || merged.description || merged.company);
    return {
      ok: hasSignal,
      isJobPage: isJobDetailPage(),
      job: hasSignal ? merged : null,
      errors: hasSignal
        ? []
        : [
            isJobDetailPage()
              ? "Could not read the job — the page may still be loading or its structure has changed."
              : "This does not look like a JobsDB job detail page. Open a specific job (URL with /job/…).",
          ],
    };
  }

  function toMarkdown(job) {
    if (!job) return "";
    const lines = [
      `# ${job.title || "Job offer"}`,
      "",
      job.company ? `**Company:** ${job.company}` : null,
      job.location ? `**Location:** ${job.location}` : null,
      job.salary ? `**Salary:** ${job.salary}` : null,
      job.workType ? `**Work type:** ${job.workType}` : null,
      job.workArrangement ? `**Work arrangement:** ${job.workArrangement}` : null,
      job.classification ? `**Classification:** ${job.classification}` : null,
      job.postedLabel || job.postedAt ? `**Posted:** ${job.postedLabel || job.postedAt}` : null,
      job.url ? `**URL:** ${job.url}` : null,
      "",
    ].filter((l) => l !== null);

    if (job.bulletPoints?.length) {
      lines.push("## Highlights", "");
      for (const b of job.bulletPoints) lines.push(`- ${b}`);
      lines.push("");
    }
    if (job.description) {
      lines.push("## Description", "", job.description, "");
    }
    return lines.join("\n").trim() + "\n";
  }

  function toPlainText(job) {
    if (!job) return "";
    const rows = [
      ["Title", job.title],
      ["Company", job.company],
      ["Location", job.location],
      ["Salary", job.salary],
      ["Work type", job.workType],
      ["Work arrangement", job.workArrangement],
      ["Classification", job.classification],
      ["Posted", job.postedLabel || job.postedAt],
      ["URL", job.url],
    ];
    const header = rows
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const bullets = job.bulletPoints?.length
      ? "\n\nHighlights:\n" + job.bulletPoints.map((b) => `- ${b}`).join("\n")
      : "";
    const desc = job.description ? `\n\nDescription:\n${job.description}` : "";
    return (header + bullets + desc).trim() + "\n";
  }

  global.JobsDBExtractor = {
    extractJobDetails,
    isJobDetailPage,
    toMarkdown,
    toPlainText,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
