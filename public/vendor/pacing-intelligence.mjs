/**
 * Pure biometric math for infection-associated chronic illness pacing.
 * No I/O, no clock, no diagnosis -- every input, including "today", is
 * caller-supplied. Full evidence dossier this module implements against:
 * ../../../../../../../../../science-services-section/services/natural-science-services-section/services/biological-science-services-section/services/medical-science-services-section/services/myalgic-encephalomyelitis-services-section/content/text/documents/articles/notes/2026/09/02/2026-09-02-note-on-biometric-guided-pacing-evidence.md
 */

/** Minimum usable points before a rolling baseline is trusted for deviation scoring. */
const MIN_BASELINE_POINTS = 3;

/** Iglewicz & Hoaglin (1993) modified z-score scaling constant, converting median-absolute-deviation units toward standard-deviation units under a normal-distribution assumption. */
const MODIFIED_Z_CONSTANT = 0.6745;

/** Iglewicz & Hoaglin's own suggested "notably deviates" cutoff for the modified z-score; used here as this module's single conservative deviation threshold. */
const NOTABLE_DEVIATION_THRESHOLD = 3.5;

/** Workwell Foundation heuristic offset; see heartRateThresholdEstimate for its evidence status. */
const WORKWELL_RHR_OFFSET_BPM = 15;

const DEFAULT_METRIC_IDS = Object.freeze({
  restingHeartRate: "resting-heart-rate",
  hrv: "hrv-rmssd",
  sleep: "sleep-duration",
  activity: "activity-load",
});

const DEFAULT_WINDOW_DAYS = 14;

/**
 * Computes RMSSD (root mean square of successive differences) from a
 * sequence of consecutive RR intervals, in time order. This module
 * deliberately does not compare two days' worth of any measure the way
 * two-day CPET does: that marker (Keller et al. 2014, J Transl Med, DOI
 * 10.1186/1479-5876-12-104, n=22, VO2peak -13.8% day-two decline, no
 * control arm) has a live, unresolved 2026 replication conflict (Mancini
 * et al., Front Physiol, DOI 10.3389/fphys.2026.1816082, n=58 patients +
 * 25 controls, no day-two decline in either group; versus Snell et al.
 * 2013, Phys Ther, DOI 10.2522/ptj.20110368, n=51+10 controls, which does
 * find a day-two decline). This module computes only single-day
 * descriptive statistics and deviation from a person's own rolling
 * baseline -- never a two-day comparison against a population marker.
 *
 * Literature basis for RMSSD itself: the standard time-domain
 * heart-rate-variability statistic (Task Force of the European Society of
 * Cardiology and NASPE, 1996, "Heart rate variability: standards of
 * measurement, physiological interpretation, and clinical use",
 * Circulation, 93(5), 1043-1065), and the measure HEARTLOC's biofeedback
 * trial reported a significant pre/post improvement on (Corrado et al.
 * 2024, DOI 10.1177/27536351241227261, n=13 completers, RMSSD p=.047).
 *
 * Epistemic status: this is an unweighted implementation of a textbook
 * formula, not itself a clinical claim. What RMSSD predicts about pacing
 * or PEM risk is a separate, weaker claim handled by rollingBaseline,
 * morningDeviation, and pemRiskFlags below.
 *
 * @param {number[]} rrMs - consecutive RR (beat-to-beat) intervals in milliseconds, in time order
 * @returns {number} RMSSD in milliseconds
 * @throws {TypeError} if rrMs is not an array of finite positive numbers
 * @throws {RangeError} if rrMs has fewer than 2 intervals (RMSSD needs at least one successive difference)
 */
export function rmssdFromRrIntervals(rrMs) {
  if (!Array.isArray(rrMs)) throw new TypeError("rrMs must be an array of numbers");
  if (rrMs.length < 2) throw new RangeError("rmssdFromRrIntervals requires at least 2 RR intervals to form one successive difference");
  for (const interval of rrMs) {
    if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
      throw new TypeError(`rrMs must contain only finite positive numbers, got ${JSON.stringify(interval)}`);
    }
  }
  let sumSquaredDiffs = 0;
  for (let i = 1; i < rrMs.length; i += 1) {
    const diff = rrMs[i] - rrMs[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (rrMs.length - 1));
}

/**
 * Computes a robust rolling baseline (median + median absolute deviation,
 * MAD) over the most recent `windowDays` points of a caller-supplied
 * series. Assumes at most one point per day for a given metric -- callers
 * reduce same-day repeat readings before calling. Points are sorted
 * ascending by timestamp; the trailing `windowDays` points are used;
 * null-valued (missing) points within that window are excluded from the
 * statistic but counted in `missingCount`.
 *
 * Literature basis: median + MAD is a standard robust-statistics choice
 * for a short, likely-non-normal, outlier-prone personal series (Iglewicz,
 * B., & Hoaglin, D. C. (1993). "How to Detect and Handle Outliers", ASQC
 * Quality Press) -- a general statistical method, not a pacing-specific
 * validated instrument. Which window length best characterizes a person's
 * own biometric baseline for pacing purposes has not itself been studied;
 * `windowDays` is a caller-chosen parameter, not a value this module
 * asserts as clinically optimal.
 *
 * @param {Array<{timestamp: string, value: (number|null)}>} series - points for one metric, any order
 * @param {number} windowDays - positive integer; how many trailing points to use
 * @returns {{median: (number|null), mad: (number|null), n: number, windowDays: number, missingCount: number, insufficientData: boolean}}
 * @throws {TypeError} if series is not an array or windowDays is not a positive integer
 */
export function rollingBaseline(series, windowDays) {
  if (!Array.isArray(series)) throw new TypeError("series must be an array of { timestamp, value } points");
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new TypeError("windowDays must be a positive integer");

  const sorted = [...series].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  const window = sorted.slice(Math.max(0, sorted.length - windowDays));
  const values = window.map((point) => point.value).filter((value) => typeof value === "number" && Number.isFinite(value));
  const missingCount = window.length - values.length;

  if (values.length === 0) {
    return Object.freeze({ median: null, mad: null, n: 0, windowDays, missingCount, insufficientData: true });
  }
  const med = median(values);
  const mad = medianAbsoluteDeviation(values, med);
  return Object.freeze({
    median: med,
    mad,
    n: values.length,
    windowDays,
    missingCount,
    insufficientData: values.length < MIN_BASELINE_POINTS,
  });
}

/**
 * Scores how far today's value sits from a rolling baseline, as a modified
 * z-score (Iglewicz & Hoaglin, 1993: 0.6745 * (x - median) / MAD), with
 * explicit missingness handling on both sides: a missing today, an
 * insufficient baseline (fewer than 3 usable points), and a zero-variance
 * baseline (MAD = 0, which would otherwise divide by zero) each report a
 * distinct `status` instead of a fabricated number.
 *
 * This is a general robust-statistics deviation score, not a validated
 * pacing or PEM-risk instrument by itself -- see pemRiskFlags for the one
 * place this module attaches a pacing-relevant interpretation to it, and
 * that interpretation's own caveats.
 *
 * @param {{value: (number|null), status: (string|undefined)}} today - today's reading; status "missing" or a null value is treated as missing
 * @param {{median: (number|null), mad: (number|null), insufficientData: boolean}} baseline - a rollingBaseline() result
 * @returns {{deviation: (number|null), rawDelta: (number|null), status: string, median: (number|null), mad: (number|null)}}
 * @throws {TypeError} if today or baseline are not objects of the expected shape
 */
export function morningDeviation(today, baseline) {
  if (today === null || typeof today !== "object") throw new TypeError("today must be an object with a value field");
  if (baseline === null || typeof baseline !== "object" || !("median" in baseline) || !("mad" in baseline)) {
    throw new TypeError("baseline must be a rollingBaseline() result");
  }

  if (today.status === "missing" || today.value === null || today.value === undefined) {
    return Object.freeze({ deviation: null, rawDelta: null, status: "missing-today", median: baseline.median, mad: baseline.mad });
  }
  if (typeof today.value !== "number" || !Number.isFinite(today.value)) {
    throw new TypeError(`today.value must be a finite number or null, got ${JSON.stringify(today.value)}`);
  }
  if (baseline.insufficientData || baseline.median === null || baseline.mad === null) {
    return Object.freeze({ deviation: null, rawDelta: null, status: "insufficient-baseline", median: baseline.median, mad: baseline.mad });
  }

  const rawDelta = today.value - baseline.median;
  if (baseline.mad === 0) {
    // Zero-variance baseline: report the raw gap, not a fabricated (and JSON-unsafe) Infinity.
    return Object.freeze({ deviation: null, rawDelta, status: "baseline-zero-variance", median: baseline.median, mad: baseline.mad });
  }
  const deviation = (MODIFIED_Z_CONSTANT * rawDelta) / baseline.mad;
  return Object.freeze({ deviation, rawDelta, status: "ok", median: baseline.median, mad: baseline.mad });
}

/**
 * Implements the Workwell Foundation resting-heart-rate-plus-15-bpm pacing
 * ceiling.
 *
 * Epistemic status, stated verbatim because this is the product: this is
 * an UNVALIDATED clinical rule of thumb, not a tested instrument. A
 * targeted PubMed search for a primary validation study of this specific
 * threshold (searched 2026-09-01, terms combining Workwell, heart-rate
 * ceiling, resting heart rate +15, and chronic fatigue) returned zero
 * results. It originates as clinical practice guidance from the Workwell
 * Foundation, a specialty rehabilitation practice whose founders include
 * the Snell/Stevens/Davenport/Van Ness group behind the 2013 two-day-CPET
 * study (DOI 10.2522/ptj.20110368) -- not from a published, tested
 * threshold. Callers displaying this value to a user must label it a
 * clinical heuristic in wide informal use, never present it with the
 * authority of a validated instrument, and never use it as the basis of a
 * diagnostic or treatment claim.
 *
 * @param {{restingHr: number}} input - restingHr in beats per minute
 * @returns {{ceilingBpm: number, restingHr: number, formula: string, evidenceStatus: string}}
 * @throws {TypeError} if restingHr is not a finite positive number
 */
export function heartRateThresholdEstimate({ restingHr } = {}) {
  if (typeof restingHr !== "number" || !Number.isFinite(restingHr) || restingHr <= 0) {
    throw new TypeError(`restingHr must be a finite positive number, got ${JSON.stringify(restingHr)}`);
  }
  return Object.freeze({
    ceilingBpm: restingHr + WORKWELL_RHR_OFFSET_BPM,
    restingHr,
    formula: `resting heart rate + ${WORKWELL_RHR_OFFSET_BPM} bpm`,
    evidenceStatus:
      "Workwell Foundation clinical rule of thumb; no validating primary study found (targeted PubMed search, 2026-09-01). Present as an informal heuristic, never as a validated instrument.",
  });
}

/**
 * Produces conservative, evidence-labeled PEM risk flags from three
 * baseline-deviation signals: HRV deviation, sleep deviation, and prior-day
 * activity deviation (each shaped like a morningDeviation() result).
 *
 * These flags are INSPIRED BY, but are NOT, the Aboagye et al. (2025)
 * next-day-fatigue prediction model (Front Digit Health, DOI
 * 10.3389/fdgth.2025.1689846): 68 participants with post-COVID fatigue, up
 * to 21 days of cardiac/activity monitoring, an XGBoost model predicting
 * next-day fatigue from HRV and activity-sleep features at R^2 = 0.789.
 * That model's own strongest predictors were HRV sample entropy,
 * low-frequency power, and approximate entropy -- frequency- and
 * complexity-domain HRV features this module does not compute. v1 computes
 * only a time-domain RMSSD-based deviation score, combined with sleep and
 * activity deviation, run through simple conservative thresholds -- not
 * Aboagye's trained model, and not validated as a predictor itself.
 * Sample-entropy/LF-power-class HRV features are explicitly out of scope
 * for v1.
 *
 * Further caveats this function's flags inherit and must never drop when
 * displayed: Aboagye's cohort is post-COVID fatigue, not diagnosed ME/CFS
 * (a related but distinct population), is a single cohort with no external
 * validation, and the one meta-analysis of pacing itself (Sanal-Hayes et
 * al. 2024, DOI 10.1080/21641846.2024.2433390, k=4 studies) found a large
 * fatigue effect (SMD -1.09) whose 95% CI crosses zero (p=.0998) -- not a
 * statistically significant result. Nothing this function returns may be
 * presented as diagnosing, predicting, or confirming PEM.
 *
 * @param {{hrvDeviation: object, sleepDeviation: object, priorDayActivity: object}} input - each a morningDeviation() result
 * @returns {{flags: Array<{code: string, message: string, evidenceStatus: string}>, dataQuality: {hrv: string, sleep: string, activity: string}, note: string}}
 * @throws {TypeError} if any input is not a morningDeviation()-shaped object
 */
export function pemRiskFlags({ hrvDeviation, sleepDeviation, priorDayActivity } = {}) {
  for (const [name, value] of [
    ["hrvDeviation", hrvDeviation],
    ["sleepDeviation", sleepDeviation],
    ["priorDayActivity", priorDayActivity],
  ]) {
    if (value === null || typeof value !== "object" || !("status" in value) || !("deviation" in value)) {
      throw new TypeError(`${name} must be a morningDeviation() result`);
    }
  }

  const flags = [];
  const hrvSuppressed = hrvDeviation.status === "ok" && hrvDeviation.deviation <= -NOTABLE_DEVIATION_THRESHOLD;
  const sleepShort = sleepDeviation.status === "ok" && sleepDeviation.deviation <= -NOTABLE_DEVIATION_THRESHOLD;
  const activityElevated = priorDayActivity.status === "ok" && priorDayActivity.deviation >= NOTABLE_DEVIATION_THRESHOLD;

  if (hrvSuppressed) {
    flags.push({
      code: "HRV_SUPPRESSED_VS_OWN_BASELINE",
      message: "Today's HRV (RMSSD) deviates notably below this person's own rolling baseline.",
      evidenceStatus:
        "Directionally consistent with Aboagye et al. 2025 (HRV among the top next-day-fatigue predictors, single post-COVID cohort, n=68, not externally validated) and with Ruijgt et al. 2026 (DOI 10.1007/s40279-026-02487-4, HRV suppression for 24h after exertion near ventilatory threshold, n=121 long-COVID + 21 controls, observational, no validated threshold). Not a diagnostic or predictive claim.",
    });
  }
  if (sleepShort) {
    flags.push({
      code: "SLEEP_SHORT_VS_OWN_BASELINE",
      message: "Last night's sleep deviates notably below this person's own rolling baseline.",
      evidenceStatus:
        "Sleep/activity features were part of Aboagye et al. 2025's next-day-fatigue model (single post-COVID cohort, n=68, R^2=0.789, not externally validated). This flag reuses the same feature category as a simple threshold rule, not the trained model.",
    });
  }
  if (activityElevated) {
    flags.push({
      code: "PRIOR_DAY_ACTIVITY_ELEVATED_VS_OWN_BASELINE",
      message: "Yesterday's activity deviates notably above this person's own rolling baseline.",
      evidenceStatus:
        "Consistent with the pacing rationale generally (elevated exertion preceding symptom flares) and with Ruijgt et al. 2026's finding that exertion near/above ventilatory threshold associates with prolonged next-day HRV suppression. Not a validated exertion ceiling.",
    });
  }
  if (hrvSuppressed && sleepShort && activityElevated) {
    flags.push({
      code: "MULTIPLE_CONSERVATIVE_INDICATORS_PRESENT",
      message: "HRV, sleep, and prior-day activity all deviate notably from this person's own baseline at once.",
      evidenceStatus:
        "Co-occurrence of these three signals is not itself a studied predictor; this flag only reports that three separately-motivated conservative thresholds triggered together. It is not a PEM detection or prediction claim.",
    });
  }

  return Object.freeze({
    flags: Object.freeze(flags),
    dataQuality: Object.freeze({ hrv: hrvDeviation.status, sleep: sleepDeviation.status, activity: priorDayActivity.status }),
    note: "Descriptive deviation-from-own-baseline flags only. No output of this function diagnoses, predicts, or confirms post-exertional malaise.",
  });
}

/**
 * Composes the above over a caller-supplied set of biometric observations
 * shaped like `biometric-observation-v1` records (owned by
 * health-services-section, `urn:red-cup-science:health:biometric-observation:1.0.0`;
 * the nutrition-domain profile `nutrition-biometric-observation-v1` is
 * accepted too, since only the fields below are read):
 * `{ metric, measuredAt|enteredAt, measurement: { value, unit, precision },
 * missingness: { status } }`. Groups observations by metric, splits each
 * metric's most recent point as "today" against a rolling baseline built
 * from the points before it, and runs the resulting deviations through
 * pemRiskFlags and the resting-heart-rate observation (if present) through
 * heartRateThresholdEstimate.
 *
 * This function does not itself validate observations against that
 * schema -- it has no schema-validator port, by the same no-I/O
 * discipline as the rest of this module; a caller that needs strict
 * admission checking validates before calling. Malformed individual
 * observations (non-objects, unrecognized metric ids) are skipped rather
 * than thrown on, so sparse or partially-invalid real-world data degrades
 * to "insufficient data" statuses rather than a hard failure.
 *
 * @param {Array<object>} observations - biometric-observation-shaped records
 * @param {{windowDays: (number|undefined), metricIds: (object|undefined)}} [options] - windowDays defaults to 14; metricIds overrides which metric id names resting-heart-rate/hrv/sleep/activity
 * @returns {object} composed analysis: per-metric today/baseline/deviation, the resting-heart-rate threshold estimate (if computable), pemRiskFlags output, and observation counts
 * @throws {TypeError} if observations is not an array
 */
export function analyzePacing(observations, options = {}) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  const windowDays = Number.isInteger(options.windowDays) && options.windowDays > 0 ? options.windowDays : DEFAULT_WINDOW_DAYS;
  const metricIds = { ...DEFAULT_METRIC_IDS, ...(options.metricIds ?? {}) };

  const usable = observations.filter((observation) => observation !== null && typeof observation === "object");

  const restingHrSeries = seriesForMetric(usable, metricIds.restingHeartRate);
  const hrvSeries = seriesForMetric(usable, metricIds.hrv);
  const sleepSeries = seriesForMetric(usable, metricIds.sleep);
  const activitySeries = seriesForMetric(usable, metricIds.activity);

  const hrv = todayAndDeviation(hrvSeries, windowDays);
  const sleep = todayAndDeviation(sleepSeries, windowDays);
  const activity = todayAndDeviation(activitySeries, windowDays);

  const latestRestingHr = latestObservedValue(restingHrSeries);
  const restingHeartRate = {
    latestValue: latestRestingHr,
    thresholdEstimate: latestRestingHr === null ? null : heartRateThresholdEstimate({ restingHr: latestRestingHr }),
  };

  const risk = pemRiskFlags({ hrvDeviation: hrv.deviation, sleepDeviation: sleep.deviation, priorDayActivity: activity.deviation });

  return Object.freeze({
    observationCount: observations.length,
    usableObservationCount: usable.length,
    windowDays,
    restingHeartRate: Object.freeze(restingHeartRate),
    hrv: Object.freeze(hrv),
    sleep: Object.freeze(sleep),
    activity: Object.freeze(activity),
    risk,
    note: "Descriptive statistics and labeled heuristic flags only. No diagnosis, prediction, or confirmation of post-exertional malaise is made or implied.",
  });
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianAbsoluteDeviation(numbers, centerMedian) {
  const deviations = numbers.map((value) => Math.abs(value - centerMedian));
  return median(deviations);
}

function seriesForMetric(observations, metricId) {
  return observations
    .filter((observation) => observation.metric === metricId)
    .map(toSeriesPoint)
    .filter((point) => typeof point.timestamp === "string" && point.timestamp.length > 0);
}

function toSeriesPoint(observation) {
  const timestamp = observation.measuredAt ?? observation.enteredAt;
  const status = observation.missingness?.status ?? "observed";
  const rawValue = status === "missing" ? null : Number(observation.measurement?.value);
  const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
  return { timestamp, value, status };
}

function todayAndDeviation(series, windowDays) {
  const sorted = [...series].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  if (sorted.length === 0) {
    const baseline = rollingBaseline([], windowDays);
    return { today: null, baseline, deviation: morningDeviation({ value: null, status: "missing" }, baseline) };
  }
  const today = sorted[sorted.length - 1];
  const history = sorted.slice(0, -1);
  const baseline = rollingBaseline(history, windowDays);
  const deviation = morningDeviation(today, baseline);
  return { today, baseline, deviation };
}

function latestObservedValue(series) {
  const sorted = [...series].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].value !== null) return sorted[i].value;
  }
  return null;
}
