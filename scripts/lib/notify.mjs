// Sends notifications via Telegram and/or WhatsApp.
// Every channel is optional — a channel is used only if its env vars are set.
//
// Env vars:
//   TELEGRAM_BOT_TOKEN   Telegram bot token from @BotFather
//   TELEGRAM_CHAT_ID     Your chat id (message the bot, then read getUpdates)
//
//   -- WhatsApp Cloud API (official Meta, recommended / safe) --
//   WHATSAPP_TOKEN            access token (system-user token recommended)
//   WHATSAPP_PHONE_NUMBER_ID  sender phone number id (from Meta dashboard)
//   WHATSAPP_TO               recipient number, country code, no "+" (e.g. 9198...)
//   WHATSAPP_TEMPLATE         template name (required to push outside the 24h window)
//   WHATSAPP_TEMPLATE_LANG    template language code (default en_US)
//
//   -- Unofficial WhatsApp bridges (optional) --
//   GREENAPI_ID_INSTANCE / GREENAPI_TOKEN / GREENAPI_TO
//   CALLMEBOT_PHONE / CALLMEBOT_APIKEY
//
//   DRY_RUN=1            Print messages instead of sending

const GRAPH_VERSION = 'v21.0';

function isDry() {
  return process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
}

// WhatsApp has no HTML; convert <b> to WhatsApp bold (*) and decode entities.
function toWhatsApp(text) {
  return text
    .replace(/<\/?b>/g, '*')
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// Plain text (no formatting markers) with entities decoded.
function plainText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// WhatsApp template parameters may not contain newlines, tabs, or >4 spaces.
// Flatten the message to a single compliant line.
function flattenForTemplate(text) {
  return plainText(text)
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { channel: 'telegram', skipped: 'not configured' };
  if (isDry()) return { channel: 'telegram', dryRun: text };

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return { channel: 'telegram', ok: true };
}

// Meta WhatsApp Cloud API — the official, safe path (no account-ban risk).
// A scheduled push that arrives outside the recipient's 24h service window must
// use an approved TEMPLATE. If WHATSAPP_TEMPLATE is unset, a freeform text is
// sent instead (only delivered if you messaged the business number in the last
// 24h — handy for testing).
async function sendWhatsAppCloud(text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_TO;
  if (!token || !phoneId || !to)
    return { channel: 'whatsapp-cloud', skipped: 'not configured' };

  const template = process.env.WHATSAPP_TEMPLATE;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en_US';
  const recipient = to.replace(/[^\d]/g, '');

  let payload;
  if (template) {
    payload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: flattenForTemplate(text) }],
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: toWhatsApp(text) },
    };
  }

  if (isDry()) {
    return {
      channel: 'whatsapp-cloud',
      dryRun: template
        ? `template=${template} lang=${lang}\n{{1}}=${flattenForTemplate(text)}`
        : toWhatsApp(text),
    };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const code = body.error?.code;
    // 131047 = re-engagement / 24h service window closed (freeform mode).
    const hint =
      !template && (code === 131047 || code === 131051 || code === 131026)
        ? ' — the free 24h window is closed. Send any WhatsApp message to your' +
          ' business number to reopen it, or use an approved template.'
        : '';
    throw new Error(
      `WhatsApp Cloud failed: HTTP ${res.status} ${JSON.stringify(
        body.error || body
      )}${hint}`
    );
  }
  return { channel: 'whatsapp-cloud', ok: true };
}

async function sendWhatsApp(text) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return { channel: 'whatsapp', skipped: 'not configured' };

  const plain = toWhatsApp(text);
  if (isDry()) return { channel: 'whatsapp', dryRun: plain };

  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(plain)}&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return { channel: 'whatsapp', ok: true };
}

// Green API — free "Developer" tier WhatsApp sender (no CallMeBot waitlist).
// Create an instance at https://green-api.com, scan the QR with your WhatsApp,
// then copy idInstance + apiTokenInstance.
//   GREENAPI_ID_INSTANCE  instance id
//   GREENAPI_TOKEN        apiTokenInstance
//   GREENAPI_TO           recipient number, country code, no "+" (e.g. 9198...)
//   GREENAPI_API_URL      optional override (defaults to https://api.green-api.com)
async function sendGreenApi(text) {
  const id = process.env.GREENAPI_ID_INSTANCE;
  const token = process.env.GREENAPI_TOKEN;
  const to = process.env.GREENAPI_TO;
  if (!id || !token || !to) return { channel: 'greenapi', skipped: 'not configured' };

  const message = toWhatsApp(text);
  if (isDry()) return { channel: 'greenapi', dryRun: message };

  const base = (process.env.GREENAPI_API_URL || 'https://api.green-api.com').replace(/\/$/, '');
  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
  const res = await fetch(`${base}/waInstance${id}/sendMessage/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Green API failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return { channel: 'greenapi', ok: true };
}

// Send the same message to every configured channel. Errors on one channel do
// not block the others.
export async function notify(text) {
  const results = await Promise.allSettled([
    sendTelegram(text),
    sendWhatsAppCloud(text),
    sendWhatsApp(text),
    sendGreenApi(text),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (v.ok) console.log(`  ✓ sent via ${v.channel}`);
      else if (v.dryRun) console.log(`  [dry-run ${v.channel}]\n${v.dryRun}\n`);
      else console.log(`  – ${v.channel}: ${v.skipped}`);
    } else {
      console.error(`  ✗ ${r.reason?.message || r.reason}`);
    }
  }
}
