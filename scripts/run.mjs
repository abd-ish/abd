// Orchestrator: fetch live GMP -> update snapshot & history -> send alerts.
//
// Modes (RUN_MODE):
//   digest  Morning summary of all open IPOs with GMP above the threshold.
//           (default when run manually / at the 6am schedule)
//   watch   Only alert IPOs that newly crossed the threshold since last run.
//   none    Update data only, send nothing (set NOTIFY=0).

import { fetchGmp } from './lib/fetchGmp.mjs';
import { updateStore } from './lib/store.mjs';
import { notify } from './lib/notify.mjs';

const THRESHOLD = Number(process.env.GMP_THRESHOLD || 10);
const MODE = process.env.RUN_MODE || 'digest';
const NOTIFY = process.env.NOTIFY !== '0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

function today() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
}

function line(ipo) {
  const dot = ipo.status === 'Closing Today' ? '🔴' : '🟢';
  const gmp = ipo.gmp !== null ? `₹${ipo.gmp}` : '₹--';
  const close = ipo.close ? ` · closes ${fmtDate(ipo.close)}` : '';
  return (
    `${dot} <b>${ipo.name}</b> (${ipo.category})\n` +
    `   GMP ${gmp} · ${ipo.gmpPercent?.toFixed(2)}%${close}`
  );
}

function buildDigest(ipos) {
  const open = ipos
    .filter(
      (i) =>
        (i.status === 'Open' || i.status === 'Closing Today') &&
        i.gmpPercent !== null &&
        i.gmpPercent > THRESHOLD
    )
    .sort((a, b) => b.gmpPercent - a.gmpPercent);

  const header = `📈 <b>IPO GMP Digest</b> — ${today()}`;
  if (open.length === 0) {
    return `${header}\n\nNo open IPOs above ${THRESHOLD}% today.`;
  }
  return (
    `${header}\nOpen IPOs with GMP &gt; ${THRESHOLD}%:\n\n` +
    open.map(line).join('\n\n')
  );
}

function buildCrossing(ipos) {
  if (ipos.length === 0) return null;
  const header = `🚨 <b>GMP Alert</b> — crossed ${THRESHOLD}%`;
  return header + '\n\n' + ipos.map(line).join('\n\n');
}

async function main() {
  console.log(`[${new Date().toISOString()}] mode=${MODE} threshold=${THRESHOLD}%`);

  const ipos = await fetchGmp();
  console.log(`Fetched ${ipos.length} IPOs.`);

  const { crossedAbove } = await updateStore(ipos, { threshold: THRESHOLD });
  console.log(`Data written. ${crossedAbove.length} newly crossed ${THRESHOLD}%.`);

  if (!NOTIFY) {
    console.log('NOTIFY=0 — skipping notifications.');
    return;
  }

  if (MODE === 'digest') {
    console.log('Sending morning digest...');
    await notify(buildDigest(ipos));
  } else if (MODE === 'watch') {
    const msg = buildCrossing(crossedAbove);
    if (msg) {
      console.log('Sending crossing alert...');
      await notify(msg);
    } else {
      console.log('No new crossings — nothing to send.');
    }
  }
}

main().catch((err) => {
  console.error('Run failed:', err);
  process.exitCode = 1;
});
