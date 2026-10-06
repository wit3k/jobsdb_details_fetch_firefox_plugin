/**
 * LinkedIn job detail extraction.
 * Strategy (in order):
 *   1) JSON-LD JobPosting (when present)
 *   2) Hidden <code>/application/json blobs (Voyager BPR)
 *   3) Authenticated + public DOM (partial class matches, textContent)
 *   4) Guest job fragment API (no "See more" needed)
 */
(function (global) {
  "use strict";

  const S = global.JobExtractor || {};

  function textOf(el) {
    if (!el) return null;
    // textContent keeps clamped / visually truncated description text;
    // innerText often drops it until "See more" is clicked.
    const t = (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
    return t || null;
  }

  function htmlOf(el) {
    if (!el) return null;
    const h = (el.innerHTML || "").trim();
    return h || null;
  }

  const htmlToText =
    S.htmlToText ||
    function (html) {
      if (!html) return null;
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      const t = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
      return t || null;
    };

  function firstMatch(selectors, root) {
    const scope = root || document;
    for (const sel of selectors) {
      try {
        const el = scope.querySelector(sel);
        if (el) return el;
      } catch {
        /* invalid selector — skip */
      }
    }
    return null;
  }

  function firstMatchWithText(selectors, root) {
    const scope = root || document;
    for (const sel of selectors) {
      try {
        const nodes = scope.querySelectorAll(sel);
        for (const el of nodes) {
          const t = textOf(el);
          if (t && t.length > 1) return { el, text: t };
        }
      } catch {
        /* skip */
      }
    }
    return null;
  }

  const clean =
    S.clean ||
    function (value) {
      if (value == null) return null;
      if (typeof value === "string") {
        const t = value.replace(/\s+/g, " ").trim();
        return t || null;
      }
      return value;
    };

  const pick =
    S.pick ||
    function (...values) {
      for (const v of values) {
        const c = clean(v);
        if (c != null && c !== "") return c;
      }
      return null;
    };

  const asArray =
    S.asArray || ((value) => (value == null ? [] : Array.isArray(value) ? value : [value]));

  function decodeHtmlEntities(str) {
    if (!str || typeof str !== "string" || !str.includes("&")) return str;
    // Avoid Element.innerHTML (AMO linter); LinkedIn mainly uses these entities.
    return str
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*34;/g, '"')
      .replace(/&#x0*22;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#0*39;/g, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#0*60;/g, "<")
      .replace(/&#0*62;/g, ">")
      .replace(/&amp;/gi, "&");
  }

  function unescapeJsonBlob(raw) {
    if (!raw) return "";
    let s = String(raw).trim();
    // LinkedIn often HTML-escapes the whole JSON blob inside <code>.
    if (s.includes("&quot;") || s.includes("&#34;") || s.includes("&amp;")) {
      s = decodeHtmlEntities(s);
    }
    return s;
  }

  function mergeJob(...parts) {
    if (typeof S.mergeJob === "function") {
      const merged = S.mergeJob(...parts);
      merged.jobId =
        merged.jobId || extractJobIdFromUrl(global.location.href) || extractJobIdFromDom();
      return merged;
    }
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
        if ((base[key] == null || base[key] === "") && part[key] != null && part[key] !== "") {
          base[key] = part[key];
        }
      }
    }
    base.source = sources.filter(Boolean).join("+") || null;
    base.jobId = base.jobId || extractJobIdFromUrl(base.url || global.location.href) || extractJobIdFromDom();
    return base;
  }

  const DETAILS_ROOT_SELECTORS = [
    ".jobs-search__job-details",
    ".jobs-details",
    ".job-view-layout",
    ".scaffold-layout__detail",
    ".jobs-details__main-content",
    "[class*='job-details-jobs-unified-top-card']",
    "main",
  ];

  const TITLE_SELECTORS = [
    "[class*='job-details-jobs-unified-top-card__job-title'] h1",
    "[class*='job-details-jobs-unified-top-card__job-title'] a",
    "[class*='job-details-jobs-unified-top-card__job-title']",
    "[class*='jobs-unified-top-card__job-title'] h1",
    "[class*='jobs-unified-top-card__job-title'] a",
    "[class*='jobs-unified-top-card__job-title']",
    "[class*='jobs-details-top-card__job-title']",
    "h1.t-24",
    "h1.t-22",
    ".top-card-layout__title",
    "h1.top-card-layout__title",
    "h2.top-card-layout__title",
    ".topcard__title",
    '[data-test-id="job-details-job-title"]',
    ".jobs-details h1",
    ".scaffold-layout__detail h1",
    "h1 a[href*='/jobs/view/']",
    "a[href*='/jobs/view/'] h1",
  ];

  const COMPANY_SELECTORS = [
    "[class*='job-details-jobs-unified-top-card__company-name'] a",
    "[class*='job-details-jobs-unified-top-card__company-name']",
    "[class*='jobs-unified-top-card__company-name'] a",
    "[class*='jobs-unified-top-card__company-name']",
    "[class*='jobs-details-top-card__company-url']",
    "a.topcard__org-name-link",
    ".topcard__org-name-link",
    ".top-card-layout__card a[href*='/company/']",
    ".jobs-details a[href*='/company/']",
    ".scaffold-layout__detail a[href*='/company/']",
    'a[data-tracking-control-name*="public_jobs_topcard-org-name"]',
    'a[href*="/company/"][data-tracking-control-name*="job"]',
  ];

  const LOCATION_SELECTORS = [
    "[class*='job-details-jobs-unified-top-card__bullet']",
    "[class*='job-details-jobs-unified-top-card__primary-description']",
    "[class*='job-details-jobs-unified-top-card__tertiary-description'] .tvm__text",
    "[class*='jobs-unified-top-card__bullet']",
    "[class*='jobs-unified-top-card__tertiary-description'] .tvm__text",
    "span.topcard__flavor--bullet",
    ".topcard__flavor--bullet",
    "[class*='jobs-unified-top-card__subtitle']",
  ];

  const DESCRIPTION_SELECTORS = [
    ".show-more-less-html__markup",
    "#job-details .jobs-box__html-content",
    "#job-details",
    "[data-job-description]",
    ".jobs-description__content .jobs-box__html-content",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".jobs-description",
    "div.description__text",
    ".description__text",
    ".core-section-container__content",
    '[data-test-id="job-details-description"]',
    "[class*='jobs-description']",
  ];

  const POSTED_SELECTORS = [
    "[class*='jobs-unified-top-card__posted-date']",
    "span.posted-time-ago__text",
    ".posted-time-ago__text",
    "time[datetime]",
  ];

  function detailsRoot() {
    return firstMatch(DETAILS_ROOT_SELECTORS) || document;
  }

  function extractJobIdFromUrl(url) {
    try {
      const u = new URL(url);
      const view = u.pathname.match(/\/jobs\/view\/(?:.*-)?(\d+)\/?/i);
      if (view) return view[1];
    } catch {
      /* ignore */
    }
    return null;
  }

  function extractJobIdFromDom() {
    const urnEl = document.querySelector(
      "[data-job-id], [data-entity-urn*='jobPosting'], [data-urn*='jobPosting']"
    );
    if (urnEl) {
      const dataId = urnEl.getAttribute("data-job-id");
      if (dataId && /^\d+$/.test(dataId)) return dataId;
      const urn =
        urnEl.getAttribute("data-entity-urn") || urnEl.getAttribute("data-urn") || "";
      const m = urn.match(/jobPosting:?(\d+)/i);
      if (m) return m[1];
    }
    const href = document.querySelector("a[href*='/jobs/view/']")?.getAttribute("href") || "";
    const fromHref = href.match(/\/jobs\/view\/(?:.*-)?(\d+)/i);
    if (fromHref) return fromHref[1];

    // Avoid scanning entire document HTML (huge on LinkedIn) — sample scripts/code only.
    const blobs = document.querySelectorAll("code, script[type='application/json']");
    for (const el of blobs) {
      const raw = el.textContent || "";
      if (!raw.includes("jobPosting")) continue;
      const m = raw.match(/urn:li:jobPosting:(\d+)/);
      if (m) return m[1];
      const m2 = raw.match(/"jobPostingId"\s*:\s*(\d+)/);
      if (m2) return m2[1];
    }
    return null;
  }

  function isJobDetailPage() {
    // Only dedicated job view URLs — not /jobs/search or collections.
    return Boolean(extractJobIdFromUrl(global.location.href));
  }

  function classifyInsight(label, value) {
    const blob = `${label || ""} ${value || ""}`.toLowerCase();
    if (/seniority|experience level|niveau/.test(blob)) return "classification";
    if (/employment|job type|type d.?emploi|contract/.test(blob)) return "workType";
    if (/remote|hybrid|on-?site|workplace|work arrangement|lieu/.test(blob)) return "workArrangement";
    if (/salary|compensation|pay|報酬|薪|\$|€|£/.test(blob)) return "salary";
    if (/function|industry|sector|department|classification/.test(blob)) return "classification";
    return null;
  }

  function extractInsights(root) {
    const out = {
      workType: null,
      workArrangement: null,
      classification: null,
      salary: null,
      postedLabel: null,
    };

    const criteria = (root || document).querySelectorAll(
      "li.description__job-criteria-item, li.jobs-unified-description__job-criteria-item, [class*='job-criteria-item']"
    );
    for (const item of criteria) {
      const label = textOf(
        item.querySelector("h3, .description__job-criteria-subheader, [class*='criteria-subheader']")
      );
      const value = textOf(
        item.querySelector("span, .description__job-criteria-text, [class*='criteria-text']")
      );
      if (!value) continue;
      const kind = classifyInsight(label, value);
      if (kind && !out[kind]) out[kind] = value;
      else if (!kind && label && !out.classification) out.classification = `${label}: ${value}`;
    }

    const insights = (root || document).querySelectorAll(
      "[class*='job-details-jobs-unified-top-card__job-insight'], [class*='jobs-unified-top-card__job-insight']"
    );
    const insightTexts = [];
    for (const el of insights) {
      const t = textOf(el);
      if (!t) continue;
      insightTexts.push(t);
      const kind = classifyInsight("", t);
      if (kind && !out[kind]) out[kind] = t;
    }

    if (!out.workType) {
      const wt = insightTexts.find((t) =>
        /\b(full-?time|part-?time|contract|temporary|internship|volunteer)\b/i.test(t)
      );
      if (wt) out.workType = wt;
    }
    if (!out.workArrangement) {
      const wa = insightTexts.find((t) => /\b(remote|hybrid|on-?site|on site)\b/i.test(t));
      if (wa) out.workArrangement = wa;
    }

    return out;
  }

  function extractFromDomUnified() {
    const root = detailsRoot();
    const titleHit = firstMatchWithText(TITLE_SELECTORS, root) || firstMatchWithText(TITLE_SELECTORS);
    const title = titleHit?.text || null;

    const companyHit =
      firstMatchWithText(COMPANY_SELECTORS, root) || firstMatchWithText(COMPANY_SELECTORS);
    const companyEl = companyHit?.el || null;
    const company = companyHit?.text || null;
    const companyUrl =
      companyEl?.closest?.("a")?.href ||
      (companyEl?.tagName === "A" ? companyEl.href : null) ||
      null;

    let location = null;
    for (const sel of LOCATION_SELECTORS) {
      let els;
      try {
        els = root.querySelectorAll(sel);
        if (!els.length) els = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of els) {
        const t = textOf(el);
        if (!t) continue;
        if (/ago|applicants?|people clicked|promoted|responses?|see more|show more/i.test(t)) {
          continue;
        }
        location = t;
        break;
      }
      if (location) break;
    }

    const descEl =
      firstMatch(DESCRIPTION_SELECTORS, root) || firstMatch(DESCRIPTION_SELECTORS);
    let description = textOf(descEl);
    let descriptionHtml = htmlOf(descEl);
    // Prefer the rich markup node when #job-details is just a wrapper.
    if (descEl && description && description.length < 80) {
      const markup = firstMatch([".show-more-less-html__markup", ".jobs-box__html-content"], descEl);
      if (markup) {
        description = textOf(markup) || description;
        descriptionHtml = htmlOf(markup) || descriptionHtml;
      }
    }

    const postedEl = firstMatch(POSTED_SELECTORS, root) || firstMatch(POSTED_SELECTORS);
    const postedLabel = textOf(postedEl);
    const postedAt = postedEl?.getAttribute?.("datetime") || null;
    const insights = extractInsights(root);

    if (!title && !description && !company) return null;

    const pageUrl = global.location.href;
    return {
      source: "linkedin-dom",
      jobId: extractJobIdFromUrl(pageUrl) || extractJobIdFromDom(),
      title,
      company,
      companyUrl,
      location,
      salary: insights.salary,
      workType: insights.workType,
      workArrangement: insights.workArrangement,
      classification: insights.classification,
      postedAt,
      postedLabel: postedLabel || insights.postedLabel,
      teaser: null,
      bulletPoints: [],
      description,
      descriptionHtml,
      url: pageUrl,
    };
  }

  function looksLikeLinkedInJob(node) {
    if (!node || typeof node !== "object") return false;
    const title = node.title || node.jobTitle || node.standardizedTitle;
    const hasTitle = typeof title === "string" && title.length > 1;
    const company =
      node.companyName ||
      node.companyDetails?.name ||
      node.company?.name ||
      node.posterCompanyName;
    const hasCompany = typeof company === "string" && company.length > 0;
    const hasId =
      node.jobPostingId != null ||
      (typeof node.entityUrn === "string" && node.entityUrn.includes("jobPosting")) ||
      (typeof node.dashEntityUrn === "string" && node.dashEntityUrn.includes("jobPosting")) ||
      node.jobId != null;
    const hasDesc = Boolean(node.description || node.descriptionText || node.jobDescription);
    return hasTitle && (hasCompany || hasId || hasDesc);
  }

  function fromLinkedInJobNode(node, source) {
    if (!node) return null;

    let descriptionHtml = null;
    let description = null;
    const desc =
      node.description ||
      node.descriptionText ||
      node.jobDescription ||
      node.descriptionSnippet ||
      null;
    if (typeof desc === "string") {
      const decoded = decodeHtmlEntities(desc);
      if (decoded.includes("<")) {
        descriptionHtml = decoded;
        description = htmlToText(decoded);
      } else {
        description = clean(decoded);
      }
    } else if (desc && typeof desc === "object") {
      descriptionHtml = pick(desc.text, desc.html);
      if (descriptionHtml) descriptionHtml = decodeHtmlEntities(descriptionHtml);
      description = descriptionHtml?.includes?.("<")
        ? htmlToText(descriptionHtml)
        : clean(descriptionHtml);
    }

    const company = pick(
      node.companyName,
      node.companyDetails?.name,
      node.company?.name,
      node.posterCompanyName
    );

    const companyUrl = pick(
      node.companyDetails?.companyUrl,
      node.companyDetails?.url,
      node.company?.url,
      node.companyWebsiteUrl,
      typeof node.companyDetails?.companyUniversalName === "string"
        ? `https://www.linkedin.com/company/${node.companyDetails.companyUniversalName}/`
        : null
    );

    const location = pick(
      node.formattedLocation,
      typeof node.location === "string" ? node.location : null,
      node.jobLocation,
      Array.isArray(node.formattedLocations) ? node.formattedLocations.join(", ") : null,
      node.jobPostingLocation?.defaultLocalizedName
    );

    const workType = pick(
      node.employmentStatus,
      typeof node.employmentType === "string" ? node.employmentType : null,
      Array.isArray(node.employmentTypes) ? node.employmentTypes.join(", ") : null
    );

    const workArrangement = pick(
      node.workRemoteAllowed === true ? "Remote" : null,
      Array.isArray(node.workplaceTypes)
        ? node.workplaceTypes
            .map((w) => w?.localizedName || w?.localizedNameV2 || w)
            .filter(Boolean)
            .join(", ")
        : null,
      node.remoteAllowed === true ? "Remote" : null
    );

    const jobId = pick(
      node.jobPostingId != null ? String(node.jobPostingId) : null,
      node.jobId != null ? String(node.jobId) : null,
      typeof node.entityUrn === "string" ? node.entityUrn.match(/(\d+)$/)?.[1] : null,
      typeof node.dashEntityUrn === "string" ? node.dashEntityUrn.match(/(\d+)$/)?.[1] : null
    );

    return {
      source,
      jobId,
      title: pick(node.title, node.jobTitle, node.standardizedTitle),
      company,
      companyUrl,
      location: clean(location),
      salary: pick(
        typeof node.salaryInsights?.salaryHint === "string" ? node.salaryInsights.salaryHint : null,
        typeof node.salary === "string" ? node.salary : null
      ),
      workType: clean(typeof workType === "string" ? workType : null),
      workArrangement: clean(typeof workArrangement === "string" ? workArrangement : null),
      classification: pick(
        node.experienceLevel,
        node.formattedExperienceLevel,
        Array.isArray(node.jobFunctions)
          ? node.jobFunctions.map((f) => f?.name || f).filter(Boolean).join(", ")
          : null,
        Array.isArray(node.industries)
          ? node.industries.map((i) => i?.name || i).filter(Boolean).join(", ")
          : null
      ),
      postedAt: pick(
        node.listedAt != null ? String(node.listedAt) : null,
        node.originalListedAt != null ? String(node.originalListedAt) : null,
        node.postedAt,
        node.createdAt
      ),
      postedLabel: pick(node.listedAtString, node.postedAgo, node.repostInfo?.text),
      teaser: pick(node.descriptionSnippet),
      bulletPoints: [],
      description,
      descriptionHtml,
      url: pick(node.jobPostingUrl, node.url, global.location.href),
    };
  }

  function deepFind(obj, predicate, maxDepth = 16) {
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

  function deepFindAll(obj, predicate, maxDepth = 14, limit = 8) {
    const seen = new Set();
    const found = [];
    const stack = [{ value: obj, depth: 0 }];
    while (stack.length && found.length < limit) {
      const { value, depth } = stack.pop();
      if (value == null || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (predicate(value)) found.push(value);
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
    return found;
  }

  function pickBestJobNode(nodes) {
    if (!nodes?.length) return null;
    const wantId = extractJobIdFromUrl(global.location.href) || extractJobIdFromDom();
    if (wantId) {
      const exact = nodes.find((n) => {
        const id = String(
          n.jobPostingId ?? n.jobId ?? n.entityUrn?.match?.(/(\d+)$/)?.[1] ?? ""
        );
        return id === wantId;
      });
      if (exact) return exact;
    }
    return nodes.sort((a, b) => {
      const score = (n) =>
        (n.description || n.descriptionText || n.jobDescription ? 5 : 0) +
        (n.companyName || n.companyDetails ? 2 : 0) +
        (n.title || n.jobTitle ? 1 : 0);
      return score(b) - score(a);
    })[0];
  }

  function extractJsonLdLocal() {
    if (typeof S.extractJsonLd === "function") {
      const jsonLd = S.extractJsonLd();
      if (jsonLd?.title || jsonLd?.description || jsonLd?.company) {
        if (jsonLd.descriptionHtml) {
          jsonLd.descriptionHtml = decodeHtmlEntities(jsonLd.descriptionHtml);
        }
        if (jsonLd.description && jsonLd.description.includes("&lt;")) {
          const decoded = decodeHtmlEntities(jsonLd.description);
          if (decoded.includes("<")) {
            jsonLd.descriptionHtml = decoded;
            jsonLd.description = htmlToText(decoded);
          } else {
            jsonLd.description = decoded;
          }
        }
        return {
          ...jsonLd,
          source: "linkedin-json-ld",
          jobId: jsonLd.jobId || extractJobIdFromUrl(global.location.href) || extractJobIdFromDom(),
        };
      }
    }

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent || "");
      } catch {
        continue;
      }
      const candidates = asArray(data).flatMap((item) =>
        item?.["@graph"] ? asArray(item["@graph"]) : [item]
      );
      for (const item of candidates) {
        const types = asArray(item?.["@type"]).map((t) => String(t).toLowerCase());
        if (!types.includes("jobposting")) continue;
        const org = item.hiringOrganization || {};
        const descRaw = typeof item.description === "string" ? decodeHtmlEntities(item.description) : null;
        const descriptionHtml = descRaw && descRaw.includes("<") ? descRaw : null;
        const description = descriptionHtml ? htmlToText(descriptionHtml) : clean(descRaw);
        return {
          source: "linkedin-json-ld",
          jobId: pick(item.identifier?.value, item.identifier, extractJobIdFromUrl(global.location.href)),
          title: pick(item.title),
          company: pick(typeof org === "string" ? org : org.name),
          companyUrl: pick(typeof org === "object" ? org.sameAs || org.url : null),
          location: null,
          salary: null,
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

  function extractFromEmbeddedJson() {
    const jsonLd = extractJsonLdLocal();
    const nodes = [];

    const scriptLike = document.querySelectorAll(
      [
        'script[type="application/json"]',
        "code[id^='bpr-guid']",
        "code[style*='display: none']",
        "code[style*='display:none']",
        "code.datalet-container",
      ].join(", ")
    );

    for (const el of scriptLike) {
      const raw = unescapeJsonBlob(el.textContent || "");
      if (!raw || raw.length < 40) continue;
      if (!/jobPosting|JobPosting|jobTitle|formattedLocation|companyDetails/i.test(raw)) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      nodes.push(...deepFindAll(data, looksLikeLinkedInJob));
    }

    const keys = ["__INITIAL_STATE__", "__PRELOADED_STATE__", "__DATA__"];
    for (const key of keys) {
      try {
        const raw = global[key];
        if (!raw) continue;
        nodes.push(...deepFindAll(raw, looksLikeLinkedInJob));
      } catch {
        /* ignore */
      }
    }

    const best = pickBestJobNode(nodes);
    const fromNode = best ? fromLinkedInJobNode(best, "linkedin-embedded-json") : null;
    return mergeJob(jsonLd, fromNode);
  }

  function parseGuestHtml(html, jobId) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = textOf(
      firstMatch(
        [".top-card-layout__title", ".topcard__title", "h1", "h2.top-card-layout__title"],
        doc
      )
    );
    const companyEl = firstMatch(
      ["a.topcard__org-name-link", ".topcard__org-name-link", "a[href*='/company/']"],
      doc
    );
    const company = textOf(companyEl);
    const companyUrl = companyEl?.href || null;
    const location = textOf(firstMatch([".topcard__flavor--bullet", ".topcard__flavor"], doc));
    const descEl = firstMatch(
      [
        ".show-more-less-html__markup",
        ".description__text",
        ".core-section-container__content",
        ".decorated-job-posting__details",
      ],
      doc
    );
    const description = textOf(descEl);
    const descriptionHtml = htmlOf(descEl);
    const postedLabel = textOf(firstMatch([".posted-time-ago__text", "time"], doc));

    const insights = { workType: null, workArrangement: null, classification: null, salary: null };
    for (const item of doc.querySelectorAll("li.description__job-criteria-item")) {
      const label = textOf(item.querySelector(".description__job-criteria-subheader, h3"));
      const value = textOf(item.querySelector(".description__job-criteria-text, span"));
      if (!value) continue;
      const kind = classifyInsight(label, value);
      if (kind && !insights[kind]) insights[kind] = value;
    }

    if (!title && !description && !company) return null;

    return {
      source: "linkedin-guest-api",
      jobId: jobId || null,
      title,
      company,
      companyUrl,
      location,
      salary: insights.salary,
      workType: insights.workType,
      workArrangement: insights.workArrangement,
      classification: insights.classification,
      postedAt: null,
      postedLabel,
      teaser: null,
      bulletPoints: [],
      description,
      descriptionHtml,
      url: global.location.href,
    };
  }

  async function fetchGuestJob(jobId) {
    if (!jobId) return null;
    const origins = [
      global.location.origin,
      "https://www.linkedin.com",
      "https://hk.linkedin.com",
    ];
    const seen = new Set();
    for (const origin of origins) {
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      const url = `${origin}/jobs-guest/jobs/api/jobPosting/${jobId}`;
      try {
        const res = await fetch(url, {
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
        if (!res.ok) continue;
        const html = await res.text();
        if (!html || html.length < 200) continue;
        const parsed = parseGuestHtml(html, jobId);
        if (parsed) return parsed;
      } catch {
        /* try next origin */
      }
    }
    return null;
  }

  function hasSignal(job) {
    return Boolean(job && (job.title || job.description || job.company));
  }

  async function extractJobDetails(options = {}) {
    const pageUrl = options.pageUrl || global.location.href;
    const hintedId =
      extractJobIdFromUrl(pageUrl) ||
      extractJobIdFromUrl(global.location.href) ||
      extractJobIdFromDom();

    const embedded = extractFromEmbeddedJson();
    const dom = extractFromDomUnified();
    let merged = mergeJob(embedded, dom);

    // Guest fragment is keyed by job id from the tab URL — prefer it so bulk
    // export across many LinkedIn tabs does not collapse to the same DOM panel.
    if (hintedId) {
      const guest = await fetchGuestJob(hintedId);
      if (guest) {
        merged = mergeJob(guest, merged);
      }
    } else if (!hasSignal(merged) || !merged.description) {
      const guest = await fetchGuestJob(merged.jobId || extractJobIdFromDom());
      if (guest) merged = mergeJob(merged, guest);
    }

    merged.jobId = hintedId || merged.jobId || extractJobIdFromDom();
    merged.url = pageUrl;
    merged.pageUrl = pageUrl;
    merged.extractedAt = merged.extractedAt || new Date().toISOString();

    const ok = hasSignal(merged);
    return {
      ok,
      isJobPage: isJobDetailPage() || Boolean(hintedId),
      job: ok ? merged : null,
      errors: ok
        ? []
        : [
            isJobDetailPage() || hintedId
              ? "Could not read the LinkedIn job — the page may still be loading, or LinkedIn changed its layout. Try refreshing the tab."
              : "This does not look like a LinkedIn job detail page. Open a URL with /jobs/view/…",
          ],
    };
  }

  global.LinkedInExtractor = {
    extractJobDetails,
    isJobDetailPage,
    extractJobIdFromUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
