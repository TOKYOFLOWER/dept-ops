/**
 * Web API
 *  - doGet?action=data           → ダッシュボード用JSON
 *  - doGet?action=dashboard      → ダッシュボードHTML（GAS直接配信。GitHub Pages不要）
 *  - doGet?action=approve|reject → 承認リンク（HMAC署名＋期限つき）
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'data') {
      const expectedKey = PropertiesService.getScriptProperties().getProperty('DATA_KEY');
      if (!verifyDataKey_(p.key, expectedKey)) return jsonOut_({ error: 'unauthorized' });
      return jsonOut_(buildDashboardData_());
    }
    if (p.action === 'dashboard') {
      const expectedKey = PropertiesService.getScriptProperties().getProperty('DATA_KEY');
      if (!verifyDataKey_(p.key, expectedKey)) return htmlOut_('DEPT-OPS', 'アクセスできません。');
      return renderDashboardPage_();
    }
    if (p.action === 'approve' || p.action === 'reject') return handleDecision_(p);
    return htmlOut_('DEPT-OPS', 'action を指定してください。');
  } catch (err) {
    log_('ERROR', 'doGet: ' + err.message);
    return htmlOut_('エラー', escHtml_(err.message));
  }
}

/**
 * action=data 用の簡易アクセスキー検証（純粋関数。モックデータでテスト可能）
 * DATA_KEY が未設定の場合は常に拒否する（設定漏れによる全公開を防ぐ）。
 */
function verifyDataKey_(providedKey, expectedKey) {
  return Boolean(expectedKey) && String(providedKey) === String(expectedKey);
}

/**
 * action=dashboard: gas/dashboard.html をHtmlServiceテンプレートとして評価し、
 * gasUrl(=WEBAPP_URL) / dataKey(=DATA_KEY) をスクリプトレットに注入して返す。
 * スマホ表示用にタイトルとviewportメタタグを明示的に設定する（IFRAMEサンドボックスのため
 * HTML内の<title>/<meta viewport>だけでは反映されない）。
 */
function renderDashboardPage_() {
  const tmpl = HtmlService.createTemplateFromFile('dashboard');
  tmpl.gasUrl = prop_('WEBAPP_URL');
  tmpl.dataKey = prop_('DATA_KEY');
  return tmpl.evaluate()
    .setTitle('DEPT-OPS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildDashboardData_() {
  const deptRows = sheet_(CONF.SHEET.DEPTS).getDataRange().getValues().slice(1);
  const repRows = sheet_(CONF.SHEET.REPORTS).getDataRange().getValues().slice(1);
  const apprRows = sheet_(CONF.SHEET.APPROVALS).getDataRange().getValues().slice(1);

  const depts = mapDeptRows_(deptRows);
  const history = mapHistoryRows_(repRows);
  const latest = pickLatestByDept_(history);
  const approvals = mapApprovalRows_(apprRows);

  return { generated_at: new Date().toISOString(), depts: depts, latest: latest, history: history, approvals: approvals };
}

/** 部署定義シート行 → ダッシュボード用配列（純粋関数。モックデータでテスト可能） */
function mapDeptRows_(rows) {
  return (rows || []).filter(function (r) { return r[0]; })
    .map(function (r) { return { id: r[0], name: r[1], enabled: r[2] === true || r[2] === 'TRUE' }; });
}

/**
 * 報告履歴シート行 → 部署ごと直近14件の履歴配列（純粋関数。モックデータでテスト可能）
 * 全部署合算ではなく部署ごとに直近14件を残す（ダッシュボードの14日分状況推移ドット表示のため）。
 * シート行は追記順（古い→新しい）を前提とし、返り値は新しい順（newest-first）に統一する。
 */
function mapHistoryRows_(rows) {
  const byDept = {};
  (rows || []).forEach(function (r) {
    const deptId = r[1];
    const entry = {
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      dept_id: deptId, status: r[2], headline: r[3], report: r[4],
      proposals: safeParse_(r[5], []),
    };
    if (!byDept[deptId]) byDept[deptId] = [];
    byDept[deptId].push(entry);
  });
  let result = [];
  Object.keys(byDept).forEach(function (deptId) {
    result = result.concat(byDept[deptId].slice(-14));
  });
  result.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return result;
}

/** 履歴配列から部署ごとの最新1件を抽出（純粋関数。モックデータでテスト可能） */
function pickLatestByDept_(history) {
  const latest = {};
  (history || []).forEach(function (h) { if (!latest[h.dept_id]) latest[h.dept_id] = h; });
  return latest;
}

/** 承認キューシート行 → 直近50件の配列（純粋関数。モックデータでテスト可能） */
function mapApprovalRows_(rows) {
  return (rows || []).slice(-50).reverse().map(function (r) {
    return {
      id: r[0],
      created: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      dept_id: r[2], proposal: safeParse_(r[3], { title: String(r[3]) }),
      status: r[4],
      decided_at: r[5] ? (r[5] instanceof Date ? r[5].toISOString() : String(r[5])) : null,
    };
  });
}

function handleDecision_(p) {
  const action = p.action, id = p.id, exp = p.exp, sig = p.sig;
  const check = verifyApprovalLink_(id, action, exp, sig, prop_('HMAC_SECRET'));
  if (!check.ok) return htmlOut_(check.title, check.body);

  const sh = sheet_(CONF.SHEET.APPROVALS);
  const values = sh.getDataRange().getValues();
  const dataRows = values.slice(1); // ヘッダー除く
  const outcome = decideApprovalRow_(dataRows, id, action);

  if (outcome.notFound) return htmlOut_('見つかりません', '提案ID ' + escHtml_(id) + ' は存在しません。');
  if (outcome.alreadyDecided) {
    return htmlOut_('処理済み', 'この提案はすでに「' + escHtml_(outcome.status) + '」です。状態は変更されていません。');
  }

  const sheetRow = outcome.rowIndex + 2; // ヘッダー分+1、1始まり分+1
  sh.getRange(sheetRow, 5).setValue(outcome.newStatus);
  sh.getRange(sheetRow, 6).setValue(new Date());
  log_('INFO', '承認キュー ' + id + ' → ' + outcome.newStatus);
  return htmlOut_(outcome.newStatus === 'approved' ? '✅ 承認しました' : '❌ 却下しました',
    '提案ID: ' + escHtml_(id) + '。第2弾で実行部を接続すると、承認済み提案は自動実行キューへ入ります。');
}

/**
 * 承認リンクの署名・期限を検証（純粋関数。モックデータでテスト可能）
 * now を渡すとその時刻で判定（テスト用）。省略時は Date.now()。
 */
function verifyApprovalLink_(id, action, exp, sig, secret, now) {
  if (!id || !exp || !sig) return { ok: false, title: '不正なリンク', body: 'パラメータが不足しています。' };
  if (hmacSignWithSecret_(id + ':' + action + ':' + exp, secret) !== sig) {
    return { ok: false, title: '署名エラー（403）', body: 'このリンクは無効です。' };
  }
  if ((now != null ? now : Date.now()) > Number(exp)) {
    return { ok: false, title: '期限切れ', body: 'このリンクの有効期限（' + CONF.APPROVAL_TTL_HOURS + '時間）が過ぎています。状態は変更されていません。' };
  }
  return { ok: true };
}

/**
 * 承認キューの行データ（ヘッダー除く配列）から対象idの状態遷移を決定（純粋関数。モックデータでテスト可能）
 * rows の列: [id, created, dept_id, 提案内容, status, decided_at]
 */
function decideApprovalRow_(rows, id, action) {
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      if (rows[i][4] !== 'pending') {
        return { notFound: false, alreadyDecided: true, status: rows[i][4], rowIndex: i };
      }
      return { notFound: false, alreadyDecided: false, newStatus: action === 'approve' ? 'approved' : 'rejected', rowIndex: i };
    }
  }
  return { notFound: true };
}

function safeParse_(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function htmlOut_(title, body) {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px">' +
    '<h2>' + title + '</h2><p>' + body + '</p></body>';
  return HtmlService.createHtmlOutput(html).setTitle('DEPT-OPS');
}

/** HTML特殊文字のエスケープ（ユーザー入力をhtmlOut_へ渡す前に使用） */
function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
