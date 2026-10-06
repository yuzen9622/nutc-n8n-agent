import {load} from 'cheerio';

export interface ComposeDefaults {
  cpid: string;
  crumb: string;
  fromText: string;
  referer: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  content: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
}

function parseAddressList(input?: string): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function parseHiddenInputs(html: string): Record<string, string> {
  const $ = load(html);
  const fields: Record<string, string> = Object.create(null);
  $('input[name]').each((_, element) => {
    const name = $(element).attr('name')?.trim();
    if (!name) return;
    fields[name] = ($(element).attr('value') ?? '').trim();
  });
  return fields;
}

export function parseGenMailPath(submenuHtml: string): string | undefined {
  const $ = load(submenuHtml);
  return $('a[href*="genMail"]').first().attr('href');
}

export function buildMailSendForm(
  payload: SendMailInput,
  composeDefaults: ComposeDefaults,
): Record<string, string> {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const bound = String(Math.floor(1000000 + Math.random() * 9000000));
  const toList = parseAddressList(payload.to);
  const ccList = parseAddressList(payload.cc);
  const bccList = parseAddressList(payload.bcc);
  const formattedContent = payload.isHtml
    ? payload.content
    : escapeHtml(payload.content).replaceAll('\n', '<br>');

  return {
    attcheck: '0',
    attcount: '0',
    fileidlist: '',
    newdraft: '0',
    BgnBound: bound,
    UseSign: '0',
    mbox: 'msg',
    mailsource: 'draft',
    draft: '0',
    blog: '',
    preview: '0',
    forward: '',
    incforward: '',
    bounce: '',
    sended: '0',
    multiforward: '',
    batchforward: '',
    reply: '',
    force: '0',
    cpid: composeDefaults.cpid,
    charset: 'big5',
    from: '0',
    tmplname: '',
    MGEncZip: '0',
    MGEncPdf: '0',
    subjname: '',
    MailType: '2',
    stationery: '',
    resid: '',
    crumb: composeDefaults.crumb,
    bMakeContact: '1',
    draft_msgid: '',
    rcptdet_checked: '0',
    rcpt_domain_detect_checked: '0',
    pdata_checked: '0',
    preview_alert: '0',
    FromText: composeDefaults.fromText,
    tox: toList.join(', '),
    to: toList.join(', '),
    ccx: ccList.join(', '),
    cc: ccList.join(', '),
    bccx: bccList.join(', '),
    bcc: bccList.join(', '),
    exx: '',
    ex: '',
    mailSubject: payload.subject,
    keep: '1',
    rmdraft: '1',
    od_year: year,
    od_mon: month,
    od_day: day,
    od_hour: hour,
    od_min: minute,
    mailText: formattedContent,
    EndBound: bound,
  };
}
