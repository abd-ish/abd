// Persists the latest snapshot and per-IPO GMP history, prunes IPOs whose
// closing date has passed, and detects IPOs that newly crossed the alert
// threshold since the last run.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(ROOT, 'docs', 'data');
const IPOS_FILE = resolve(DATA_DIR, 'ipos.json');
const HISTORY_FILE = resolve(DATA_DIR, 'history.json');

// Keep history for an IPO until this many days after its closing date.
const RETAIN_DAYS_AFTER_CLOSE = 3;

// Statuses for which a threshold-crossing alert is meaningful.
const ALERTABLE_STATUSES = new Set(['Open', 'Closing Today', 'Upcoming']);

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function todayStr(now) {
  return now.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toDate) {
  const from = new Date(fromISO + 'T00:00:00Z');
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((toDate.getTime() - from.getTime()) / 86400000);
}

export async function updateStore(ipos, { threshold = 10, now = new Date() } = {}) {
  await mkdir(DATA_DIR, { recursive: true });

  const historyDoc = await readJson(HISTORY_FILE, { ipos: {} });
  const history = historyDoc.ipos || {};
  const nowISO = now.toISOString();
  const day = todayStr(now);

  const crossedAbove = [];

  for (const ipo of ipos) {
    let entry = history[ipo.id];
    if (!entry) {
      entry = {
        name: ipo.name,
        category: ipo.category,
        close: ipo.close,
        series: [],
        alertedAbove: false,
        lastGmpPercent: null,
      };
      history[ipo.id] = entry;
    }

    // Refresh metadata.
    entry.name = ipo.name;
    entry.category = ipo.category;
    entry.close = ipo.close;
    entry.status = ipo.status;

    // Append a history point when the GMP% changes or it's a new day, so the
    // series stays compact but always records daily state.
    if (ipo.gmpPercent !== null) {
      const last = entry.series[entry.series.length - 1];
      const lastDay = last ? String(last.t).slice(0, 10) : null;
      const changed = !last || last.gmpPercent !== ipo.gmpPercent;
      const newDay = lastDay !== day;
      if (changed || newDay) {
        entry.series.push({ t: nowISO, gmp: ipo.gmp, gmpPercent: ipo.gmpPercent });
      }
    }

    // Threshold-crossing detection (edge-triggered, de-duplicated).
    const pct = ipo.gmpPercent;
    if (pct !== null && pct > threshold && ALERTABLE_STATUSES.has(ipo.status)) {
      if (!entry.alertedAbove) {
        crossedAbove.push(ipo);
        entry.alertedAbove = true;
      }
    } else if (pct === null || pct <= threshold) {
      entry.alertedAbove = false; // reset so a future crossing alerts again
    }
    entry.lastGmpPercent = pct;
  }

  // Prune IPOs whose closing date is well in the past.
  for (const [id, entry] of Object.entries(history)) {
    if (entry.close) {
      const age = daysBetween(entry.close, now);
      if (age !== null && age > RETAIN_DAYS_AFTER_CLOSE) {
        delete history[id];
      }
    }
  }

  // Write history.
  await writeFile(
    HISTORY_FILE,
    JSON.stringify({ updatedAt: nowISO, ipos: history }, null, 2)
  );

  // Write latest snapshot (sorted: Open first, then by GMP% desc).
  const statusRank = {
    'Closing Today': 0,
    Open: 1,
    Upcoming: 2,
    Listed: 3,
    Closed: 4,
    Unknown: 5,
  };
  const sorted = [...ipos].sort((a, b) => {
    const sr = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (sr !== 0) return sr;
    return (b.gmpPercent ?? -1) - (a.gmpPercent ?? -1);
  });

  await writeFile(
    IPOS_FILE,
    JSON.stringify(
      { generatedAt: nowISO, count: sorted.length, threshold, ipos: sorted },
      null,
      2
    )
  );

  return { crossedAbove, history };
}

export { IPOS_FILE, HISTORY_FILE, DATA_DIR };
