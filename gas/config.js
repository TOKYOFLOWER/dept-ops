/**
 * DEPT-OPS 共通設定
 * 認証情報はすべて Script Properties から取得（直書き禁止）
 */
const CONF = {
  SHEET: {
    DEPTS: '部署定義',
    REPORTS: '報告履歴',
    APPROVALS: '承認キュー',
    LOGS: '実行ログ',
  },
  DEFAULT_MODEL: 'claude-haiku-4-5',
  APPROVAL_TTL_HOURS: 72,
  RMS_BASE: 'https://api.rms.rakuten.co.jp',
};

function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Script Property 未設定: ' + key);
  return v;
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません: ' + name + '（setup.gs の initSheets() を実行してください）');
  return sh;
}

function log_(level, message) {
  try {
    sheet_(CONF.SHEET.LOGS).appendRow([new Date(), level, String(message).slice(0, 5000)]);
  } catch (e) {
    console.error('log_ failed: ' + e);
  }
  console.log('[' + level + '] ' + message);
}

/** RMS API 用 Authorization ヘッダー */
function rmsAuthHeader_() {
  const raw = prop_('RMS_SERVICE_SECRET') + ':' + prop_('RMS_LICENSE_KEY');
  return 'ESA ' + Utilities.base64Encode(raw);
}

/** HMAC-SHA256 署名（承認リンク用） */
function hmacSign_(payload) {
  return hmacSignWithSecret_(payload, prop_('HMAC_SECRET'));
}

/** シークレットを引数で受け取る版（ユニットテスト用に分離） */
function hmacSignWithSecret_(payload, secret) {
  const sig = Utilities.computeHmacSha256Signature(payload, secret);
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function jsonFetch_(url, options) {
  const res = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, options || {}));
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ' ' + url + ' :: ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}
