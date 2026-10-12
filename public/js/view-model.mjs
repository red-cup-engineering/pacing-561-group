/**
 * View-model layer for the pacing app: pure data shaping between the
 * biometric-observation record format, the vendored analyzePacing()
 * output (public/vendor/pacing-intelligence.mjs), and what the DOM
 * renders. No DOM, no storage, no network, no clock -- every input,
 * including "now", is caller-supplied, the same no-I/O discipline
 * @red-cup-engineering/pacing-intelligence-services-section itself holds.
 * This module never edits, shortens, or paraphrases an evidence label --
 * every `message`/`evidenceStatus` string the compute layer returns is
 * passed through byte-for-byte.
 */

/** Metric ids this app writes and reads, matching the compute package's own default metric ids. */
export const METRIC_IDS = Object.freeze({
  restingHeartRate: "resting-heart-rate",
  hrv: "hrv-rmssd",
  sleep: "sleep-duration",
  activity: "activity-load",
});

/** Prior-day activity levels this app offers on the daily-entry form, and their numeric activity-load value. */
export const ACTIVITY_LEVELS = Object.freeze([
  Object.freeze({ value: 0, label: "Rest day" }),
  Object.freeze({ value: 1, label: "Light" }),
  Object.freeze({ value: 2, label: "Moderate" }),
  Object.freeze({ value: 3, label: "High" }),
  Object.freeze({ value: 4, label: "Very high / crash-inducing" }),
]);

/** Plain-words explainers, shown beside each computed number. Never a diagnosis. */
export const EXPLAINERS = Object.freeze({
  deviation:
    "This number describes how far today's reading sits from YOUR OWN recent history. It is not a population norm, not a target, and not a diagnosis.",
  heartRateThreshold:
    "An informal clinical rule of thumb (resting heart rate + 15 bpm) in wide but unvalidated use. Never a diagnostic ceiling or a medical instrument.",
  riskFlags:
    "These flags report that today's numbers deviate notably from your own baseline. They do not diagnose, predict, or confirm post-exertional malaise.",
  privacy:
    "Everything you enter stays in this browser. Nothing is sent anywhere. Export a copy any time to back it up or share it with a clinician.",
});

const RECORD_TYPE = "nutrition-biometric-observation";
const SCHEMA_VERSION = "1.0.0";
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const VALUE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MISSINGNESS_STATUSES = new Set(["observed", "estimated", "missing"]);
const CONSENT_KINDS = new Set(["self-only", "care-team", "research", "withdrawn"]);
const SOURCE_KINDS = new Set(["device", "manual", "derived"]);

const MEDIA_RETENTION = Object.freeze({
  containsRawPhoto: false,
  containsReceiptImage: false,
  containsRawAudio: false,
  containsAppearanceEmbedding: false,
  containsRawWearablePayload: false,
});

const METRIC_FIELD_BY_ID = Object.freeze({
  [METRIC_IDS.restingHeartRate]: "restingHeartRate",
  [METRIC_IDS.hrv]: "hrv",
  [METRIC_IDS.sleep]: "sleepHours",
  [METRIC_IDS.activity]: "activityLevel",
});

let idCounter = 0;

/**
 * Builds one nutrition-biometric-observation-v1-shaped record
 * (urn:red-cup-science:nutrition:biometric-observation:1.0.0) from a
 * daily-entry form value for a single metric.
 * @param {{metric: string, day: string, value: (number|null), unit: string, precision?: string, status?: string, source?: {kind: string}}} input
 * @returns {object} a biometric-observation record ready for history storage
 * @throws {TypeError} if metric/day are missing or malformed, or value is missing while status isn't "missing"
 */
export function createObservation({ metric, day, value, unit, precision = "1", status = "observed", source = { kind: "manual" } }) {
  if (typeof metric !== "string" || metric.length === 0) throw new TypeError("metric is required");
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) throw new TypeError(`day must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(day)}`);
  const isMissing = status === "missing";
  if (!isMissing && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`value must be a finite number unless status is "missing", got ${JSON.stringify(value)}`);
  }
  idCounter += 1;
  const record = {
    recordType: RECORD_TYPE,
    schemaVersion: SCHEMA_VERSION,
    observationId: `pacing-app-${metric}-${day}-${idCounter}`.slice(0, 64),
    metric,
    measuredAt: `${day}T07:00:00Z`,
    source,
    missingness: { status },
    consentScope: { kind: "self-only" },
    mediaRetention: MEDIA_RETENTION,
  };
  if (!isMissing) record.measurement = { value: String(value), unit, precision };
  return record;
}

/**
 * Parses freeform pasted RR-interval text (comma/space/newline/semicolon
 * separated milliseconds) into a numeric array ready for the vendored
 * `rmssdFromRrIntervals`.
 * @param {string} text
 * @returns {number[]} finite positive RR intervals, in the pasted order
 * @throws {TypeError} if any token is not a finite positive number, or fewer than 2 remain
 */
export function parseRrIntervals(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const tokens = text.split(/[\s,;]+/u).map((token) => token.trim()).filter((token) => token.length > 0);
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError("RR intervals must be finite positive numbers, in milliseconds");
  }
  if (values.length < 2) throw new TypeError("at least 2 RR intervals are required to compute RMSSD");
  return values;
}

/** Formats an ISO day string (YYYY-MM-DD) for display, timezone-stable (always read as UTC). */
export function formatDay(day) {
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) throw new TypeError(`day must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(day)}`);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Formats a numeric value with fixed decimals and an optional suffix, or an em dash for a null/missing value. */
export function formatValue(value, { decimals = 1, suffix = "" } = {}) {
  if (value === null || value === undefined || typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}${suffix}`;
}

/** Formats a prior-day activity-level numeric value as its ACTIVITY_LEVELS label, or an em dash when absent/unrecognized. */
export function formatActivityLevel(value) {
  const level = ACTIVITY_LEVELS.find((entry) => entry.value === value);
  return level ? level.label : "—";
}

/**
 * Formats a `morningDeviation()` result for display. Never fabricates a
 * number for a non-"ok" status -- each status gets its own plain-words
 * placeholder instead.
 * @param {{status: string, deviation: (number|null)}} deviation - a morningDeviation() result
 * @returns {string}
 * @throws {TypeError} if deviation is not a morningDeviation()-shaped object
 */
export function formatDeviation(deviation) {
  if (!deviation || typeof deviation !== "object" || !("status" in deviation)) {
    throw new TypeError("deviation must be a morningDeviation() result");
  }
  switch (deviation.status) {
    case "ok":
      return `${deviation.deviation >= 0 ? "+" : ""}${deviation.deviation.toFixed(2)}`;
    case "missing-today":
      return "no reading today";
    case "insufficient-baseline":
      return "not enough history yet";
    case "baseline-zero-variance":
      return "baseline has no variation yet";
    default:
      return "unknown";
  }
}

/**
 * Projects `analyzePacing()`'s `risk.flags` into render-ready rows,
 * passing `code`, `message`, and `evidenceStatus` through byte-for-byte.
 * @param {{flags: Array<{code: string, message: string, evidenceStatus: string}>}} risk - a pemRiskFlags()/analyzePacing().risk result
 * @returns {Array<{code: string, message: string, evidenceStatus: string}>}
 * @throws {TypeError} if risk is not a pemRiskFlags()-shaped object
 */
export function projectRiskFlags(risk) {
  if (!risk || !Array.isArray(risk.flags)) throw new TypeError("risk must be a pemRiskFlags()/analyzePacing().risk result");
  return risk.flags.map((flag) => ({ code: flag.code, message: flag.message, evidenceStatus: flag.evidenceStatus }));
}

/**
 * Projects `heartRateThresholdEstimate()` into a render-ready row, passing
 * `formula` and `evidenceStatus` through byte-for-byte.
 * @param {({ceilingBpm: number, restingHr: number, formula: string, evidenceStatus: string}|null)} thresholdEstimate
 * @returns {({ceilingBpm: number, restingHr: number, formula: string, evidenceStatus: string}|null)}
 * @throws {TypeError} if thresholdEstimate is neither null nor a heartRateThresholdEstimate()-shaped object
 */
export function projectHeartRateThreshold(thresholdEstimate) {
  if (thresholdEstimate === null) return null;
  if (!thresholdEstimate || typeof thresholdEstimate !== "object") {
    throw new TypeError("thresholdEstimate must be a heartRateThresholdEstimate() result or null");
  }
  return {
    ceilingBpm: thresholdEstimate.ceilingBpm,
    restingHr: thresholdEstimate.restingHr,
    formula: thresholdEstimate.formula,
    evidenceStatus: thresholdEstimate.evidenceStatus,
  };
}

/**
 * Groups a flat observations array into one row per calendar day (from
 * each record's `measuredAt`/`enteredAt` date), pulling the four pacing
 * metrics into named fields. Rows are sorted ascending by day; a day with
 * more than one reading for a metric keeps the last one encountered.
 * @param {object[]} observations - biometric-observation records
 * @returns {Array<{day: string, restingHeartRate: (number|null), hrv: (number|null), sleepHours: (number|null), activityLevel: (number|null)}>}
 * @throws {TypeError} if observations is not an array
 */
export function groupObservationsByDay(observations) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  const byDay = new Map();
  for (const record of observations) {
    if (!record || typeof record !== "object") continue;
    const timestamp = record.measuredAt ?? record.enteredAt;
    if (typeof timestamp !== "string" || timestamp.length < 10) continue;
    const day = timestamp.slice(0, 10);
    const row = byDay.get(day) ?? { day, restingHeartRate: null, hrv: null, sleepHours: null, activityLevel: null };
    const field = METRIC_FIELD_BY_ID[record.metric];
    if (field && record.missingness?.status !== "missing" && record.measurement) {
      const value = Number(record.measurement.value);
      if (Number.isFinite(value)) row[field] = value;
    }
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Builds one history-table row's display strings from a
 * `groupObservationsByDay()` row and this day's optional note.
 * @param {{day: string, restingHeartRate: (number|null), hrv: (number|null), sleepHours: (number|null), activityLevel: (number|null)}} row
 * @param {Record<string,string>} [notes] - day -> note text, keyed the same as row.day
 * @returns {{day: string, dayLabel: string, restingHeartRate: string, hrv: string, sleepHours: string, activityLevel: string, notes: string}}
 */
export function buildHistoryRow(row, notes = {}) {
  return {
    day: row.day,
    dayLabel: formatDay(row.day),
    restingHeartRate: formatValue(row.restingHeartRate, { decimals: 0, suffix: " bpm" }),
    hrv: formatValue(row.hrv, { decimals: 1, suffix: " ms" }),
    sleepHours: formatValue(row.sleepHours, { decimals: 1, suffix: " h" }),
    activityLevel: formatActivityLevel(row.activityLevel),
    notes: typeof notes[row.day] === "string" ? notes[row.day] : "",
  };
}

/**
 * Structurally validates one imported record against the
 * nutrition-biometric-observation-v1 shape
 * (urn:red-cup-science:nutrition:biometric-observation:1.0.0) that both
 * this app and the paid pacing gateway expect. Not a full JSON-Schema
 * validator -- a plain structural check matching the schema's own
 * required fields and patterns, the same "callers supply their own
 * admission checking" discipline the compute package documents.
 * @param {unknown} record
 * @returns {string[]} validation error messages; empty means the record is admissible
 */
export function validateObservation(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return ["record must be an object"];

  const errors = [];
  if (record.recordType !== RECORD_TYPE) errors.push(`recordType must be "${RECORD_TYPE}"`);
  if (record.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be "${SCHEMA_VERSION}"`);
  if (typeof record.observationId !== "string" || !ID_PATTERN.test(record.observationId)) errors.push("observationId must match ^[a-z][a-z0-9-]{0,63}$");
  if (typeof record.metric !== "string" || !ID_PATTERN.test(record.metric)) errors.push("metric must match ^[a-z][a-z0-9-]{0,63}$");

  const hasMeasuredAt = typeof record.measuredAt === "string" && TIMESTAMP_PATTERN.test(record.measuredAt);
  const hasEnteredAt = typeof record.enteredAt === "string" && TIMESTAMP_PATTERN.test(record.enteredAt);
  if (!hasMeasuredAt && !hasEnteredAt) errors.push("measuredAt or enteredAt is required, as an ISO timestamp");

  if (!record.source || typeof record.source !== "object" || !SOURCE_KINDS.has(record.source.kind)) {
    errors.push('source.kind must be one of "device", "manual", "derived"');
  }

  const missingnessStatus = record.missingness?.status;
  if (!record.missingness || typeof record.missingness !== "object" || !MISSINGNESS_STATUSES.has(missingnessStatus)) {
    errors.push('missingness.status must be one of "observed", "estimated", "missing"');
  }

  if (!record.consentScope || typeof record.consentScope !== "object" || !CONSENT_KINDS.has(record.consentScope.kind)) {
    errors.push('consentScope.kind must be one of "self-only", "care-team", "research", "withdrawn"');
  }

  const retentionKeys = Object.keys(MEDIA_RETENTION);
  if (!record.mediaRetention || typeof record.mediaRetention !== "object" || retentionKeys.some((key) => record.mediaRetention[key] !== false)) {
    errors.push("mediaRetention must mark every retention flag false");
  }

  const isMissing = missingnessStatus === "missing";
  if (isMissing) {
    if (record.measurement !== undefined) errors.push("a missing observation must not carry a measurement");
  } else if (!record.measurement || typeof record.measurement !== "object") {
    errors.push('measurement is required unless missingness.status is "missing"');
  } else {
    if (typeof record.measurement.value !== "string" || !VALUE_PATTERN.test(record.measurement.value)) errors.push("measurement.value must be a non-negative decimal string");
    if (typeof record.measurement.unit !== "string" || record.measurement.unit.length === 0) errors.push("measurement.unit is required");
    if (typeof record.measurement.precision !== "string" || !VALUE_PATTERN.test(record.measurement.precision)) errors.push("measurement.precision must be a non-negative decimal string");
  }

  return errors;
}

/**
 * Validates a whole imported history file (this app's own export shape,
 * see `exportHistory`). Per-record errors are keyed by array index so the
 * UI can point at exactly which rows failed; one bad record does not stop
 * validation of the rest.
 * @param {unknown} parsed - the parsed JSON of an imported file
 * @returns {{valid: boolean, errors: string[], recordErrors: Record<number,string[]>, observations: object[], notes: Record<string,string>}}
 */
export function validateImportedHistory(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, errors: ["imported file must be a JSON object"], recordErrors: {}, observations: [], notes: {} };
  }
  if (!Array.isArray(parsed.observations)) {
    return { valid: false, errors: ['imported file must have an "observations" array'], recordErrors: {}, observations: [], notes: {} };
  }

  const recordErrors = {};
  parsed.observations.forEach((record, index) => {
    const recordProblems = validateObservation(record);
    if (recordProblems.length > 0) recordErrors[index] = recordProblems;
  });

  const notes = parsed.notes !== null && typeof parsed.notes === "object" && !Array.isArray(parsed.notes) ? parsed.notes : {};
  const valid = Object.keys(recordErrors).length === 0;
  return { valid, errors: [], recordErrors, observations: valid ? parsed.observations : [], notes: valid ? notes : {} };
}

/**
 * Builds this app's JSON export document: every observation record
 * unmodified, in the same nutrition-biometric-observation-v1 shape a
 * clinician or the paid pacing gateway can consume directly via
 * `observations`, plus this app's own day-note map and export provenance.
 * @param {object[]} observations - biometric-observation records
 * @param {{now: string, notes?: Record<string,string>}} clock - `now` is this module's only caller-supplied clock input
 * @returns {{kind: string, exportVersion: string, exportedAt: string, observationCount: number, observations: object[], notes: Record<string,string>}}
 * @throws {TypeError} if observations is not an array or now is not a non-empty string
 */
export function exportHistory(observations, { now, notes = {} } = {}) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  if (typeof now !== "string" || now.length === 0) throw new TypeError("clock.now is required (this module has no clock of its own)");
  return {
    kind: "pacing-app-history-export",
    exportVersion: "1.0.0",
    exportedAt: now,
    observationCount: observations.length,
    observations,
    notes,
  };
}
