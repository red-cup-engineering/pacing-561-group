import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoryRow,
  createObservation,
  exportHistory,
  formatActivityLevel,
  formatDay,
  formatDeviation,
  formatValue,
  groupObservationsByDay,
  METRIC_IDS,
  parseRrIntervals,
  projectHeartRateThreshold,
  projectRiskFlags,
  validateImportedHistory,
  validateObservation,
} from "../public/js/view-model.mjs";

test("createObservation builds a schema-shaped observed record", () => {
  const record = createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42.3, unit: "ms" });
  assert.equal(record.recordType, "nutrition-biometric-observation");
  assert.equal(record.schemaVersion, "1.0.0");
  assert.equal(record.metric, "hrv-rmssd");
  assert.equal(record.measuredAt, "2026-09-01T07:00:00Z");
  assert.equal(record.missingness.status, "observed");
  assert.deepEqual(record.measurement, { value: "42.3", unit: "ms", precision: "1" });
  assert.deepEqual(record.consentScope, { kind: "self-only" });
  assert.equal(validateObservation(record).length, 0);
});

test("createObservation builds a missing record with no measurement", () => {
  const record = createObservation({ metric: METRIC_IDS.sleep, day: "2026-09-01", status: "missing" });
  assert.equal(record.missingness.status, "missing");
  assert.equal("measurement" in record, false);
  assert.equal(validateObservation(record).length, 0);
});

test("createObservation rejects a malformed day", () => {
  assert.throws(() => createObservation({ metric: "hrv-rmssd", day: "09/01/2026", value: 1, unit: "ms" }), TypeError);
});

test("createObservation rejects a non-missing record with no numeric value", () => {
  assert.throws(() => createObservation({ metric: "hrv-rmssd", day: "2026-09-01", value: null, unit: "ms" }), TypeError);
});

test("parseRrIntervals accepts mixed separators", () => {
  assert.deepEqual(parseRrIntervals("800, 810\n795;805"), [800, 810, 795, 805]);
});

test("parseRrIntervals rejects a single interval", () => {
  assert.throws(() => parseRrIntervals("800"), TypeError);
});

test("parseRrIntervals rejects a non-numeric token", () => {
  assert.throws(() => parseRrIntervals("800, abc"), TypeError);
});

test("formatDay is timezone-stable and human-readable", () => {
  assert.equal(formatDay("2026-09-02"), "Wed, Sep 2");
});

test("formatValue formats with decimals and suffix, and em-dashes null", () => {
  assert.equal(formatValue(58, { decimals: 0, suffix: " bpm" }), "58 bpm");
  assert.equal(formatValue(42.34, { decimals: 1, suffix: " ms" }), "42.3 ms");
  assert.equal(formatValue(null), "—");
  assert.equal(formatValue(undefined), "—");
});

test("formatActivityLevel maps known levels and em-dashes unknown", () => {
  assert.equal(formatActivityLevel(0), "Rest day");
  assert.equal(formatActivityLevel(4), "Very high / crash-inducing");
  assert.equal(formatActivityLevel(null), "—");
  assert.equal(formatActivityLevel(99), "—");
});

test("formatDeviation never fabricates a number for a non-ok status", () => {
  assert.equal(formatDeviation({ status: "ok", deviation: -3.8 }), "-3.80");
  assert.equal(formatDeviation({ status: "ok", deviation: 1.25 }), "+1.25");
  assert.equal(formatDeviation({ status: "missing-today", deviation: null }), "no reading today");
  assert.equal(formatDeviation({ status: "insufficient-baseline", deviation: null }), "not enough history yet");
  assert.equal(formatDeviation({ status: "baseline-zero-variance", deviation: null }), "baseline has no variation yet");
});

test("formatDeviation rejects a non-morningDeviation shape", () => {
  assert.throws(() => formatDeviation(null), TypeError);
  assert.throws(() => formatDeviation({}), TypeError);
});

test("projectRiskFlags passes code/message/evidenceStatus through byte-for-byte", () => {
  const message = "Today's HRV (RMSSD) deviates notably below this person's own rolling baseline.";
  const evidenceStatus = "Directionally consistent with Aboagye et al. 2025 (single post-COVID cohort, n=68, not externally validated). Not a diagnostic or predictive claim.";
  const risk = { flags: [{ code: "HRV_SUPPRESSED_VS_OWN_BASELINE", message, evidenceStatus, extra: "dropped-on-purpose-check" }] };
  const projected = projectRiskFlags(risk);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].code, "HRV_SUPPRESSED_VS_OWN_BASELINE");
  assert.equal(projected[0].message, message);
  assert.equal(projected[0].evidenceStatus, evidenceStatus);
});

test("projectRiskFlags rejects a non-pemRiskFlags shape", () => {
  assert.throws(() => projectRiskFlags({}), TypeError);
  assert.throws(() => projectRiskFlags(null), TypeError);
});

test("projectHeartRateThreshold passes formula/evidenceStatus through and null stays null", () => {
  const formula = "resting heart rate + 15 bpm";
  const evidenceStatus = "Workwell Foundation clinical rule of thumb; no validating primary study found. Present as an informal heuristic, never as a validated instrument.";
  const projected = projectHeartRateThreshold({ ceilingBpm: 73, restingHr: 58, formula, evidenceStatus });
  assert.deepEqual(projected, { ceilingBpm: 73, restingHr: 58, formula, evidenceStatus });
  assert.equal(projectHeartRateThreshold(null), null);
});

test("projectHeartRateThreshold rejects a malformed non-null input", () => {
  assert.throws(() => projectHeartRateThreshold("nope"), TypeError);
});

test("groupObservationsByDay merges the four metrics per calendar day, ignoring missing readings", () => {
  const observations = [
    createObservation({ metric: METRIC_IDS.restingHeartRate, day: "2026-09-01", value: 58, unit: "{beats}/min" }),
    createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" }),
    createObservation({ metric: METRIC_IDS.sleep, day: "2026-09-01", status: "missing" }),
    createObservation({ metric: METRIC_IDS.activity, day: "2026-08-31", value: 2, unit: "level" }),
  ];
  const rows = groupObservationsByDay(observations);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, "2026-08-31");
  assert.equal(rows[0].activityLevel, 2);
  assert.equal(rows[1].day, "2026-09-01");
  assert.equal(rows[1].restingHeartRate, 58);
  assert.equal(rows[1].hrv, 42);
  assert.equal(rows[1].sleepHours, null);
});

test("groupObservationsByDay rejects non-array input", () => {
  assert.throws(() => groupObservationsByDay(null), TypeError);
});

test("buildHistoryRow formats a grouped row and pulls its note by day", () => {
  const row = buildHistoryRow({ day: "2026-09-01", restingHeartRate: 58, hrv: 42.3, sleepHours: 7.5, activityLevel: 1 }, { "2026-09-01": "felt ok" });
  assert.equal(row.dayLabel, "Tue, Sep 1");
  assert.equal(row.restingHeartRate, "58 bpm");
  assert.equal(row.hrv, "42.3 ms");
  assert.equal(row.sleepHours, "7.5 h");
  assert.equal(row.activityLevel, "Light");
  assert.equal(row.notes, "felt ok");
});

test("buildHistoryRow defaults a missing note to an empty string", () => {
  const row = buildHistoryRow({ day: "2026-09-01", restingHeartRate: null, hrv: null, sleepHours: null, activityLevel: null });
  assert.equal(row.notes, "");
  assert.equal(row.restingHeartRate, "—");
});

test("validateObservation accepts a well-formed record", () => {
  const record = createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" });
  assert.deepEqual(validateObservation(record), []);
});

test("validateObservation reports every violation, not just the first", () => {
  const errors = validateObservation({ recordType: "wrong", schemaVersion: "9.9.9" });
  assert.ok(errors.some((message) => /recordType/u.test(message)));
  assert.ok(errors.some((message) => /schemaVersion/u.test(message)));
  assert.ok(errors.some((message) => /observationId/u.test(message)));
  assert.ok(errors.some((message) => /metric/u.test(message)));
  assert.ok(errors.some((message) => /measuredAt or enteredAt/u.test(message)));
});

test("validateObservation rejects a non-object", () => {
  assert.deepEqual(validateObservation(null), ["record must be an object"]);
  assert.deepEqual(validateObservation("nope"), ["record must be an object"]);
});

test("validateObservation rejects a missing observation that still carries a measurement", () => {
  const record = createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" });
  record.missingness = { status: "missing" };
  const errors = validateObservation(record);
  assert.ok(errors.some((message) => /must not carry a measurement/u.test(message)));
});

test("validateObservation rejects a mediaRetention flag set to true", () => {
  const record = createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" });
  record.mediaRetention = { ...record.mediaRetention, containsRawWearablePayload: true };
  const errors = validateObservation(record);
  assert.ok(errors.some((message) => /mediaRetention/u.test(message)));
});

test("validateImportedHistory accepts this app's own export shape round-trip", () => {
  const observations = [createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" })];
  const exported = exportHistory(observations, { now: "2026-09-02T00:00:00Z", notes: { "2026-09-01": "note" } });
  const result = validateImportedHistory(exported);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.recordErrors, {});
  assert.equal(result.observations.length, 1);
  assert.deepEqual(result.notes, { "2026-09-01": "note" });
});

test("validateImportedHistory rejects a non-object top level", () => {
  const result = validateImportedHistory([1, 2, 3]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /must be a JSON object/u);
});

test("validateImportedHistory rejects a missing observations array", () => {
  const result = validateImportedHistory({ notes: {} });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /observations/u);
});

test("validateImportedHistory keys per-record errors by index and does not stop at the first bad record", () => {
  const good = createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" });
  const result = validateImportedHistory({ observations: [good, { bad: true }, { alsoBad: true }] });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.recordErrors).sort(), ["1", "2"]);
  assert.equal(result.observations.length, 0);
});

test("exportHistory produces the documented shape and requires a caller-supplied clock", () => {
  const observations = [createObservation({ metric: METRIC_IDS.hrv, day: "2026-09-01", value: 42, unit: "ms" })];
  const exported = exportHistory(observations, { now: "2026-09-02T00:00:00Z" });
  assert.equal(exported.kind, "pacing-app-history-export");
  assert.equal(exported.exportVersion, "1.0.0");
  assert.equal(exported.exportedAt, "2026-09-02T00:00:00Z");
  assert.equal(exported.observationCount, 1);
  assert.equal(exported.observations, observations);
  assert.deepEqual(exported.notes, {});
  assert.throws(() => exportHistory(observations, {}), TypeError);
  assert.throws(() => exportHistory("nope", { now: "2026-09-02T00:00:00Z" }), TypeError);
});
