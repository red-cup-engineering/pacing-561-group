/**
 * Browser glue for pacing.561.group: wires the pure view-model
 * (./view-model.mjs) and the vendored compute layer
 * (../vendor/pacing-intelligence.mjs) to the DOM and to localStorage.
 * This is the app's only I/O boundary; it is deliberately thin and
 * DOM-dependent, so it is exercised by hand and by `npm run dev`/
 * `wrangler dev`, not by `node --test` (which covers view-model.mjs and
 * src/worker.mjs instead).
 *
 * Everything this module persists stays in the browser's own
 * localStorage. No fetch, no beacon, no analytics call exists anywhere
 * in this file -- the privacy banner in index.html states a fact this
 * module upholds.
 */
import { analyzePacing, rmssdFromRrIntervals } from "../vendor/pacing-intelligence.mjs";
import {
  ACTIVITY_LEVELS,
  buildHistoryRow,
  createObservation,
  EXPLAINERS,
  exportHistory,
  formatDeviation,
  formatValue,
  groupObservationsByDay,
  METRIC_IDS,
  parseRrIntervals,
  projectHeartRateThreshold,
  projectRiskFlags,
  validateImportedHistory,
} from "./view-model.mjs";

const OBSERVATIONS_KEY = "pacing-app:observations";
const NOTES_KEY = "pacing-app:notes";
const WINDOW_DAYS = 14;

function loadObservations() {
  try {
    const raw = localStorage.getItem(OBSERVATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveObservations(observations) {
  try {
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(observations));
  } catch {
    // Storage may be unavailable (private browsing, quota); the UI reports this at the call site.
  }
}

function saveNotes(notes) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // See saveObservations.
  }
}

function todayIso() {
  const now = new Date();
  const localMidnight = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localMidnight.toISOString().slice(0, 10);
}

let observations = loadObservations();
let notes = loadNotes();

const dayInput = document.getElementById("day");
const restingHrInput = document.getElementById("restingHr");
const hrvValueInput = document.getElementById("hrvValue");
const rrTextInput = document.getElementById("rrText");
const sleepHoursInput = document.getElementById("sleepHours");
const activityLevelSelect = document.getElementById("activityLevel");
const notesInput = document.getElementById("notes");
const entryForm = document.getElementById("entry-form");
const entryStatus = document.getElementById("entry-status");
const hrvRmssdField = document.getElementById("hrv-rmssd-field");
const hrvRrField = document.getElementById("hrv-rr-field");

const todayEmpty = document.getElementById("today-empty");
const todayGrid = document.getElementById("today-grid");
const riskFlagsContainer = document.getElementById("risk-flags");
const riskExplainer = document.getElementById("risk-explainer");

const historyEmpty = document.getElementById("history-empty");
const historyTable = document.getElementById("history-table");
const historyBody = document.getElementById("history-body");

const exportButton = document.getElementById("export-button");
const importInput = document.getElementById("import-input");
const clearButton = document.getElementById("clear-button");
const dataStatus = document.getElementById("data-status");

function setStatus(element, message, kind) {
  element.textContent = message;
  if (kind) element.dataset.kind = kind;
  else delete element.dataset.kind;
}

function populateActivitySelect() {
  for (const level of ACTIVITY_LEVELS) {
    const option = document.createElement("option");
    option.value = String(level.value);
    option.textContent = level.label;
    activityLevelSelect.appendChild(option);
  }
}

function wireHrvModeToggle() {
  const radios = entryForm.querySelectorAll('input[name="hrvMode"]');
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      const useRr = entryForm.querySelector('input[name="hrvMode"]:checked').value === "rr";
      hrvRmssdField.hidden = useRr;
      hrvRrField.hidden = !useRr;
    });
  }
}

/** Replaces any existing (metric, day) record before adding a new one -- the compute layer assumes at most one point per day. */
function upsertObservation(record) {
  observations = observations.filter((existing) => !(existing.metric === record.metric && (existing.measuredAt ?? existing.enteredAt ?? "").slice(0, 10) === record.measuredAt.slice(0, 10)));
  observations.push(record);
}

function handleEntrySubmit(event) {
  event.preventDefault();
  setStatus(entryStatus, "", null);

  const day = dayInput.value || todayIso();
  const restingHr = restingHrInput.value === "" ? null : Number(restingHrInput.value);
  const sleepHours = sleepHoursInput.value === "" ? null : Number(sleepHoursInput.value);
  const activityLevel = activityLevelSelect.value === "" ? null : Number(activityLevelSelect.value);
  const hrvMode = entryForm.querySelector('input[name="hrvMode"]:checked').value;

  let hrvValue = null;
  try {
    if (hrvMode === "rr") {
      if (rrTextInput.value.trim().length > 0) {
        const intervals = parseRrIntervals(rrTextInput.value);
        hrvValue = rmssdFromRrIntervals(intervals);
      }
    } else if (hrvValueInput.value !== "") {
      hrvValue = Number(hrvValueInput.value);
    }
  } catch (error) {
    setStatus(entryStatus, error.message, "error");
    return;
  }

  if (restingHr === null && hrvValue === null && sleepHours === null && activityLevel === null) {
    setStatus(entryStatus, "Enter at least one measurement before saving.", "error");
    return;
  }

  if (restingHr !== null) upsertObservation(createObservation({ metric: METRIC_IDS.restingHeartRate, day, value: restingHr, unit: "{beats}/min" }));
  if (hrvValue !== null) upsertObservation(createObservation({ metric: METRIC_IDS.hrv, day, value: hrvValue, unit: "ms" }));
  if (sleepHours !== null) upsertObservation(createObservation({ metric: METRIC_IDS.sleep, day, value: sleepHours, unit: "h" }));
  if (activityLevel !== null) upsertObservation(createObservation({ metric: METRIC_IDS.activity, day, value: activityLevel, unit: "level" }));

  if (notesInput.value.trim().length > 0) notes[day] = notesInput.value.trim();
  else delete notes[day];

  saveObservations(observations);
  saveNotes(notes);
  setStatus(entryStatus, "Saved.", "ok");
  notesInput.value = "";
  rrTextInput.value = "";
  render();
}

function metricCard(title, valueText, evidenceText) {
  const card = document.createElement("div");
  card.className = "metric-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const value = document.createElement("p");
  value.className = "value";
  value.textContent = valueText;
  const evidence = document.createElement("p");
  evidence.className = "evidence";
  evidence.textContent = evidenceText;
  card.append(heading, value, evidence);
  return card;
}

function renderToday() {
  todayGrid.replaceChildren();
  riskFlagsContainer.replaceChildren();

  if (observations.length === 0) {
    todayEmpty.hidden = false;
    todayGrid.hidden = true;
    riskExplainer.hidden = true;
    return;
  }

  const analysis = analyzePacing(observations, { windowDays: WINDOW_DAYS });
  todayEmpty.hidden = true;
  todayGrid.hidden = false;

  const threshold = projectHeartRateThreshold(analysis.restingHeartRate.thresholdEstimate);
  todayGrid.append(metricCard(
    "Resting heart rate",
    formatValue(analysis.restingHeartRate.latestValue, { decimals: 0, suffix: " bpm" }),
    threshold ? `Pacing ceiling heuristic: ${threshold.ceilingBpm} bpm (${threshold.formula}). ${threshold.evidenceStatus}` : "No resting heart rate logged yet.",
  ));

  todayGrid.append(metricCard("HRV deviation from your baseline", formatDeviation(analysis.hrv.deviation), EXPLAINERS.deviation));
  todayGrid.append(metricCard("Sleep deviation from your baseline", formatDeviation(analysis.sleep.deviation), EXPLAINERS.deviation));
  todayGrid.append(metricCard("Prior-day activity deviation from your baseline", formatDeviation(analysis.activity.deviation), EXPLAINERS.deviation));

  const flags = projectRiskFlags(analysis.risk);
  if (flags.length === 0) {
    const none = document.createElement("p");
    none.className = "hint";
    none.textContent = "No conservative deviation flags triggered today.";
    riskFlagsContainer.appendChild(none);
  } else {
    for (const flag of flags) {
      const flagEl = document.createElement("div");
      flagEl.className = "flag";
      const message = document.createElement("p");
      message.className = "message";
      message.textContent = flag.message;
      const evidence = document.createElement("p");
      evidence.className = "evidence";
      evidence.textContent = flag.evidenceStatus;
      flagEl.append(message, evidence);
      riskFlagsContainer.appendChild(flagEl);
    }
  }
  riskExplainer.hidden = false;
  riskExplainer.textContent = `${analysis.risk.note} ${EXPLAINERS.riskFlags}`;
}

function renderHistory() {
  const rows = groupObservationsByDay(observations).slice().reverse();
  if (rows.length === 0) {
    historyEmpty.hidden = false;
    historyTable.hidden = true;
    return;
  }
  historyEmpty.hidden = true;
  historyTable.hidden = false;

  historyBody.replaceChildren();
  for (const row of rows) {
    const display = buildHistoryRow(row, notes);
    const tr = document.createElement("tr");
    for (const value of [display.dayLabel, display.restingHeartRate, display.hrv, display.sleepHours, display.activityLevel]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    const notesCell = document.createElement("td");
    notesCell.className = "notes-cell";
    notesCell.textContent = display.notes;
    tr.appendChild(notesCell);
    historyBody.appendChild(tr);
  }
}

function render() {
  renderToday();
  renderHistory();
}

function handleExport() {
  const exported = exportHistory(observations, { now: new Date().toISOString(), notes });
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pacing-history-${todayIso()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(dataStatus, "Exported.", "ok");
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      setStatus(dataStatus, "That file is not valid JSON.", "error");
      return;
    }
    const result = validateImportedHistory(parsed);
    if (!result.valid) {
      const problemCount = result.errors.length + Object.keys(result.recordErrors).length;
      setStatus(dataStatus, `Import refused: ${problemCount} problem(s) found. Nothing was changed.`, "error");
      return;
    }
    observations = result.observations;
    notes = result.notes;
    saveObservations(observations);
    saveNotes(notes);
    setStatus(dataStatus, `Imported ${observations.length} observation(s).`, "ok");
    render();
  };
  reader.onerror = () => setStatus(dataStatus, "Could not read that file.", "error");
  reader.readAsText(file);
}

function handleClearAll() {
  if (!window.confirm("Delete every entry stored in this browser? This cannot be undone. Export a backup first if you want one.")) return;
  observations = [];
  notes = {};
  try {
    localStorage.removeItem(OBSERVATIONS_KEY);
    localStorage.removeItem(NOTES_KEY);
  } catch {
    // Nothing further to do if storage itself is unavailable.
  }
  setStatus(dataStatus, "All data cleared.", "ok");
  render();
}

function init() {
  populateActivitySelect();
  wireHrvModeToggle();
  dayInput.value = todayIso();
  dayInput.max = todayIso();

  entryForm.addEventListener("submit", handleEntrySubmit);
  exportButton.addEventListener("click", handleExport);
  importInput.addEventListener("change", () => {
    const [file] = importInput.files;
    if (file) handleImportFile(file);
    importInput.value = "";
  });
  clearButton.addEventListener("click", handleClearAll);

  render();
}

init();
