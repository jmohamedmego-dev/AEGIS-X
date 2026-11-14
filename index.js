
/* =====================================================
   AEGIS-X 2.0
   DATA INTEGRITY + SOURCE RECONCILIATION ENGINE
   No invented predictions. No silent data correction.
===================================================== */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let rawRecords = [];
  let curatedRecords = [];
  let auditResults = [];

  const RAW_O2_INITIAL = [
    "calibrated initial o2 % by vol",
    "initial o2",
    "initialo2"
  ];

  const CURATED_O2 = [
    "oxygen vol pct",
    "oxygen",
    "oxygen percentage"
  ];

  // ---------- CSV IMPORT ----------

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/).find(line => line.trim()) || "";
    const options = [",", ";", "\t"];
    let best = ",";
    let highest = -1;

    for (const delimiter of options) {
      let count = 0;
      let quoted = false;

      for (let i = 0; i < firstLine.length; i++) {
        if (firstLine[i] === '"') {
          if (quoted && firstLine[i + 1] === '"') i++;
          else quoted = !quoted;
        } else if (firstLine[i] === delimiter && !quoted) {
          count++;
        }
      }

      if (count > highest) {
        highest = count;
        best = delimiter;
      }
    }

    return best;
  }

  function parseCSV(text) {
    const delimiter = detectDelimiter(text);
    const rows = [];

    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i++;
        row.push(cell);

        if (row.some(value => value.trim() !== "")) {
          rows.push(row);
        }

        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    row.push(cell);
    if (row.some(value => value.trim() !== "")) rows.push(row);

    if (rows.length < 2) {
      throw new Error("The CSV file has no data rows.");
    }

    const headers = rows[0].map((value, index) => {
      const clean = value.replace(/^\uFEFF/, "").trim();
      return clean || `unnamed_${index + 1}`;
    });

    return rows.slice(1).map((values, index) => {
      const record = { __rowNumber: index + 2 };

      headers.forEach((header, column) => {
        record[header] = values[column] ?? "";
      });

      return record;
    });
  }

  async function loadFile(input, labelId, type) {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const records = parseCSV(text);

      if (type === "raw") rawRecords = records;
      else curatedRecords = records;

      $(labelId).textContent =
        `${file.name} · ${records.length} data rows`;

      updateReadyState();
      setStatus(`${type.toUpperCase()} dataset imported successfully.`);
    } catch (error) {
      setStatus(`Import error: ${error.message}`);
      input.value = "";
    }
  }

  $("rawFile").addEventListener("change", () =>
    loadFile($("rawFile"), "rawFileName", "raw")
  );

  $("curatedFile").addEventListener("change", () =>
    loadFile($("curatedFile"), "curatedFileName", "curated")
  );

  function updateReadyState() {
    $("auditButton").disabled =
      !(rawRecords.length && curatedRecords.length);
  }

  // ---------- HEADER AND VALUE UTILITIES ----------

  function normalizeHeader(value) {
    return String(value)
      .toLowerCase()
      .replace(/[\uFEFF]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function findField(record, candidates) {
    const keys = Object.keys(record);

    for (const candidate of candidates) {
      const target = normalizeHeader(candidate);
      const found = keys.find(key =>
        normalizeHeader(key) === target
      );

      if (found) return found;
    }

    return null;
  }

  function readField(record, candidates) {
    const key = findField(record, candidates);
    return key ? record[key] : null;
  }

  function strictNumber(value) {
    if (value === null || value === undefined) return null;

    const cleaned = String(value).trim();

    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
      return null;
    }

    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeId(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[_–—]/g, "-");
  }

  function rawIdentifiers(record) {
    const testNumber = readField(record, ["Test #", "Test Number", "test_id"]);
    const pi = readField(record, ["PI", "Principal Investigator"]);

    return [...new Set([testNumber, pi]
      .map(normalizeId)
      .filter(Boolean))];
  }

  function curatedIdentifier(record) {
    return normalizeId(readField(record, [
      "test_id", "test id", "id"
    ]));
  }

  // ---------- DATA QUALITY AUDIT ----------

  function inspectValue(record, candidates, fieldName, min, max) {
    const raw = readField(record, candidates);
    const number = strictNumber(raw);
    const flags = [];

    if (raw === null || String(raw).trim() === "") {
      flags.push("MISSING_VALUE");
    } else if (number === null) {
      flags.push("NON_NUMERIC_OR_AMBIGUOUS");
    } else if (number < min || number > max) {
      flags.push("OUTSIDE_SCREENING_RANGE");
    }

    return {
      field: fieldName,
      original: raw,
      numeric: number,
      flags
    };
  }

  function auditRawRecord(record) {
    const measurements = [
      inspectValue(record, RAW_O2_INITIAL,
        "Initial O2 (%)", 0, 100),

      inspectValue(record, [
        "Calibrated final O2 % by vol",
        "final O2",
        "finalO2"
      ], "Final O2 (%)", 0, 100),

      inspectValue(record, [
        "Initial CO2 % by vol", "initialCO2"
      ], "Initial CO2 (%)", 0, 100),

      inspectValue(record, [
        "Final CO2 % by vol", "finalCO2"
      ], "Final CO2 (%)", 0, 100),

      inspectValue(record, [
        "Initial CO (ppm)", "initialCO"
      ], "Initial CO (ppm)", 0, 100000000),

      inspectValue(record, [
        "Final CO (ppm)", "finalCO"
      ], "Final CO (ppm)", 0, 100000000)
    ];

    const issues = [];

    measurements.forEach(item => {
      item.flags.forEach(flag => {
        issues.push({
          testId: rawIdentifiers(record).join(" / ") || "UNIDENTIFIED",
          row: record.__rowNumber,
          field: item.field,
          flag,
          originalValue: item.original
        });
      });
    });

    const initial = measurements[0].numeric;
    const final = measurements[1].numeric;

    if (initial !== null && final !== null && final > initial) {
      issues.push({
        testId: rawIdentifiers(record).join(" / ") || "UNIDENTIFIED",
        row: record.__rowNumber,
        field: "Final O2 (%)",
        flag: "OXYGEN_INCREASE_REQUIRES_CONTEXT",
        originalValue: measurements[1].original
      });
    }

    return { measurements, issues };
  }

  // ---------- SOURCE RECONCILIATION ----------

  function compareSources() {
    const rawIndex = new Map();
    const curatedIndex = new Map();

    rawRecords.forEach(record => {
      rawIdentifiers(record).forEach(id => {
        if (!rawIndex.has(id)) rawIndex.set(id, []);
        rawIndex.get(id).push(record);
      });
    });

    curatedRecords.forEach(record => {
      const id = curatedIdentifier(record);
      if (!id) return;

      if (!curatedIndex.has(id)) curatedIndex.set(id, []);
      curatedIndex.get(id).push(record);
    });

    const results = [];

    curatedRecords.forEach(curated => {
      const id = curatedIdentifier(curated);
      const candidates = id ? (rawIndex.get(id) || []) : [];

      const uniqueCandidates = [...new Set(candidates)];

      if (!id || uniqueCandidates.length !== 1) {
        results.push({
          id: id || "MISSING ID",
          rawValue: "—",
          curatedValue: readField(curated, CURATED_O2) ?? "—",
          investigation: readField(curated, ["investigation"]) ?? "—",
          status: uniqueCandidates.length > 1
            ? "AMBIGUOUS MATCH"
            : "NO RAW MATCH"
        });
        return;
      }

      const raw = uniqueCandidates[0];

      const rawValue = readField(raw, RAW_O2_INITIAL);
      const curatedValue = readField(curated, CURATED_O2);

      const a = strictNumber(rawValue);
      const b = strictNumber(curatedValue);

      let status = "MANUAL REVIEW";

      if (a !== null && b !== null) {
        status = Math.abs(a - b) < 0.000001
          ? "MATCH"
          : "VALUE CONFLICT";
      }

      results.push({
        id,
        rawValue: rawValue ?? "—",
        curatedValue: curatedValue ?? "—",
        investigation: readField(curated, ["investigation"]) ?? "—",
        status
      });
    });

    return results;
  }

  // ---------- DUPLICATE CHECK ----------

  function findDuplicates(records, getId) {
    const counts = new Map();

    records.forEach(record => {
      const id = getId(record);
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
    });

    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  }

  // ---------- DISPLAY ----------

  function setStatus(message) {
    $("auditStatus").textContent = message;
  }

  function setMetric(id, value) {
    $(id).textContent = String(value);
  }

  function renderMetrics(comparisons) {
    const flags = auditResults.reduce(
      (sum, result) => sum + result.issues.length, 0
    );

    const conflicts = comparisons.filter(
      item => item.status === "VALUE CONFLICT"
    ).length;

    setMetric("rawCount", rawRecords.length);
    setMetric("curatedCount", curatedRecords.length);
    setMetric("flagCount", flags);
    setMetric("conflictCount", conflicts);
  }

  function addCell(row, value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "—");
    if (className) cell.className = className;
    row.appendChild(cell);
  }

  function renderComparisons(comparisons) {
    const body = $("comparisonBody");
    body.replaceChildren();

    comparisons.forEach(item => {
      const row = document.createElement("tr");

      const className =
        item.status === "MATCH" ? "match" :
        item.status === "VALUE CONFLICT" ? "conflict" : "review";

      addCell(row, item.id);
      addCell(row, item.rawValue);
      addCell(row, item.curatedValue);
      addCell(row, item.investigation);
      addCell(row, item.status, className);

      body.appendChild(row);
    });

    if (!comparisons.length) {
      const row = document.createElement("tr");
      addCell(row, "No comparable records found.");
      body.appendChild(row);
    }
  }

  function renderIssues() {
    const container = $("issueList");
    container.replaceChildren();

    const issues = auditResults.flatMap(result => result.issues);
    const rawDuplicates = findDuplicates(rawRecords, record =>
      rawIdentifiers(record).join("|")
    );

    const curatedDuplicates = findDuplicates(curatedRecords, curatedIdentifier);

    rawDuplicates.forEach(item => issues.push({
      testId: item.id,
      field: "Record identity",
      flag: `DUPLICATE RAW IDENTIFIER (${item.count} rows)`,
      originalValue: item.id
    }));

    curatedDuplicates.forEach(item => issues.push({
      testId: item.id,
      field: "Record identity",
      flag: `DUPLICATE CURATED IDENTIFIER (${item.count} rows)`,
      originalValue: item.id
    }));

    if (!issues.length) {
      container.textContent = "No flags found by the current checks.";
      return;
    }

    issues.slice(0, 150).forEach(issue => {
      const box = document.createElement("div");
      box.className = "issue";

      const title = document.createElement("strong");
      title.textContent =
        `${issue.testId} · ${issue.field}`;

      const detail = document.createElement("div");
      detail.textContent =
        `${issue.flag} · Original value: ${issue.originalValue ?? "blank"}`;

      box.append(title, detail);
      container.appendChild(box);
    });

    if (issues.length > 150) {
      const note = document.createElement("p");
      note.textContent =
        `${issues.length - 150} additional flags are not displayed.`;
      container.appendChild(note);
    }
  }

  function renderCoverage(comparisons) {
    const container = $("coverage");
    container.replaceChildren();

    const investigations = new Map();

    curatedRecords.forEach(record => {
      const name = String(
        readField(record, ["investigation"]) || "Unspecified"
      ).trim();

      investigations.set(name, (investigations.get(name) || 0) + 1);
    });

    const stats = [
      ["Unique investigation groups", investigations.size],
      ["Matched records", comparisons.filter(x =>
        ["MATCH", "VALUE CONFLICT"].includes(x.status)
      ).length],
      ["Unmatched / ambiguous", comparisons.filter(x =>
        ["NO RAW MATCH", "AMBIGUOUS MATCH", "MANUAL REVIEW"].includes(x.status)
      ).length],
      ["Curated investigations", [...investigations.keys()].join(", ") || "—"]
    ];

    stats.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "coverage-item";

      const name = document.createElement("span");
      name.textContent = label;

      const result = document.createElement("strong");
      result.textContent = String(value);

      item.append(name, result);
      container.appendChild(item);
    });
  }

  // ---------- MAIN AUDIT ----------

  function runAudit() {
    if (!rawRecords.length || !curatedRecords.length) {
      setStatus("Import both datasets before analysis.");
      return;
    }

    auditResults = rawRecords.map(auditRawRecord);

    const comparisons = compareSources();

    renderMetrics(comparisons);
    renderComparisons(comparisons);
    renderIssues();
    renderCoverage(comparisons);

    setStatus(
      `Analysis complete · ${comparisons.length} curated records compared.`
    );
  }

  $("auditButton").addEventListener("click", runAudit);

})();
