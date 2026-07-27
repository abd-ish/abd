// Fetches and normalizes live IPO GMP data from InvestorGain's public JSON API.
//
// The API is the same one the investorgain.com "Live IPO GMP" page calls in the
// browser. It is an unofficial source and its URL shape can change over time.
// If it ever breaks, only this file needs to be updated — everything downstream
// consumes the normalized shape returned by fetchGmp().

const REPORT_ID = 331; // "Live IPO GMP" report

// Build the current API URL. The report is keyed by the current month / year /
// Indian financial year (Apr–Mar), matching what the website itself requests.
function buildUrl(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  // Indian financial year: Apr (4) -> Mar (3). e.g. Jul 2026 => "2026-27".
  const fyStart = month >= 4 ? year : year - 1;
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  return (
    `https://webnodejs.investorgain.com/cloud/v2/report/data-read/` +
    `${REPORT_ID}/1/${month}/${year}/${fy}/0/all?search=`
  );
}

function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8377;/g, '₹')
    .replace(/&#37;/g, '%')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Second (short) badge in the Name cell encodes the IPO status.
const STATUS_MAP = {
  O: 'Open',
  U: 'Upcoming',
  C: 'Closed',
  CT: 'Closing Today',
  L: 'Listed',
};

function parseBadges(nameHtml = '') {
  const badges = [];
  const re = /class="badge[^"]*"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(nameHtml)) !== null) {
    badges.push(m[1].replace(/&amp;/g, '&').trim());
  }
  return badges;
}

function num(value) {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row, now = new Date()) {
  const name = (row['~ipo_name'] || stripTags(row['Name'])).trim();
  const badges = parseBadges(row['Name'] || '');
  const today = now.toISOString().slice(0, 10);

  // Status: find whichever badge matches a known status code.
  let status = 'Unknown';
  for (const b of badges) {
    if (STATUS_MAP[b]) {
      status = STATUS_MAP[b];
      break;
    }
  }

  // Listed IPOs carry no status badge — infer from close / listing dates.
  const closeDate = row['~Srt_Close'] || '';
  const listingDate = row['~Str_Listing'] || '';
  if (status === 'Unknown') {
    if (listingDate && listingDate <= today) status = 'Listed';
    else if (closeDate && closeDate < today) status = 'Closed';
  }

  // Exchange / segment badge (first badge, e.g. "BSE SME", "NSE SME", "IPO").
  const exchange = badges[0] && !STATUS_MAP[badges[0]] ? badges[0] : '';

  const category = row['~IPO_Category'] === 'SME' ? 'SME' : 'Mainboard';

  // GMP value + percent.
  const gmpText = stripTags(row['GMP'] || ''); // e.g. "₹75 (17.65%) 60 ↓ / 75 ↑"
  const hasGmp = /₹\s*\d/.test(gmpText); // "₹--" means no GMP yet
  const gmp = hasGmp ? num((gmpText.match(/₹\s*(-?\d+)/) || [])[1]) : null;
  let gmpPercent = null;
  if (hasGmp) {
    const fromCalc = num(row['~gmp_percent_calc']);
    const fromText = num((gmpText.match(/\(([-\d.]+)%\)/) || [])[1]);
    gmpPercent = fromCalc !== null ? fromCalc : fromText;
  }

  return {
    id: String(row['~id']),
    name,
    category, // "Mainboard" | "SME"
    exchange,
    status, // Open | Upcoming | Closed | Closing Today | Listed | Unknown
    gmp, // ₹ per share, or null
    gmpPercent, // % of issue price, or null
    price: num(row['Price (₹)']),
    lot: num(row['Lot']),
    ipoSize: stripTags(row['IPO Size'] || ''),
    open: row['~Srt_Open'] || '',
    close: row['~Srt_Close'] || '',
    listing: row['~Str_Listing'] || '',
    openDisplay: row['Open'] || '',
    closeDisplay: row['Close'] || '',
    url: row['~urlrewrite_folder_name']
      ? `https://www.investorgain.com${row['~urlrewrite_folder_name']}`
      : '',
    updatedOn: stripTags(row['Updated-On'] || ''),
  };
}

export async function fetchGmp(date = new Date()) {
  const url = buildUrl(date);
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      Referer: 'https://www.investorgain.com/',
      Accept: 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) {
    throw new Error(`GMP API returned HTTP ${res.status} for ${url}`);
  }
  const data = await res.json();
  const rows = data.reportTableData;
  if (!Array.isArray(rows)) {
    throw new Error(
      `Unexpected GMP API response (no reportTableData). Got keys: ${Object.keys(
        data
      ).join(', ')}`
    );
  }
  return rows.map((r) => normalizeRow(r, date)).filter((r) => r.name && r.id);
}

export { buildUrl, normalizeRow, stripTags };
