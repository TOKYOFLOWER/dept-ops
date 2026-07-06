/**
 * Web API
 *  - doGet?action=data           → ダッシュボード用JSON
 *  - doGet?action=approve|reject → 承認リンク（HMAC署名＋期限つき）
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'data') return jsonOut_(buildDashboardData_());
    if (p.action === 'approve' || p.action === 'reject') return handleDecision_(p);
    return htmlOut_('DEPT-OPS', 'action を指定してください。');
  } catch (err) {
    log_('ERROR', 'doGet: ' + err.message);
    return htmlOut_('エラー', err.message);
  }
}

function buildDashboardData_() {
  const depts = sheet_(CONF.SHEET.DEPTS).getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { id: r[0], name: r[1], enabled: r[2] === true || r[2] === 'TRUE' }; });

  const repRows = sheet_(CONF.SHEET.REPORTS).getDataRange().getValues().slice(1);
  const history = repRows.slice(-30).reverse().map(function (r) {
    return {
      timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      dept_id: r[1], status: r[2], headline: r[3], report: r[4],
      proposals: safeParse_(r[5], []),
    };
  });

  const latest = {};
  history.forEach(function (h) { if (!latest[h.dept_id]) latest[h.dept_id] = h; });

  const apprRows = sheet_(CONF.SHEET.APPROVALS).getDataRange().getValues().slice(1);
  const approvals = apprRows.slice(-50).reverse().map(function (r) {
    return {
      id: r[0],
      created: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      dept_id: r[2], proposal: safeParse_(r[3], { title: String(r[3]) }),
      status: r[4],
      decided_at: r[5] ? (r[5] instanceof Date ? r[5].toISOString() : String(r[5])) : null,
    };
  });

  return { generated_at: new Date().toISOString(), depts: depts, latest: latest, history: history, approvals: approvals };
}

function handleDecision_(p) {
  const action = p.action, id = p.id, exp = p.exp, sig = p.sig;
  if (!id || !exp || !sig) return htmlOut_('不正なリンク', 'パラメータが不足しています。');
  if (hmacSign_(id + ':' + action + ':' + exp) !== sig) {
    return htmlOut_('署名エラー（403）', 'このリンクは無効です。');
  }
  if (Date.now() > Number(exp)) {
    return htmlOut_('期限切れ', 'このリンクの有効期限（' + CONF.APPROVAL_TTL_HOURS + '時間）が過ぎています。状態は変更されていません。');
  }

  const sh = sheet_(CONF.SHEET.APPROVALS);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      if (values[i][4] !== 'pending') {
        return htmlOut_('処理済み', 'この提案はすでに「' + values[i][4] + '」です。状態は変更されていません。');
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      sh.getRange(i + 1, 5).setValue(newStatus);
      sh.getRange(i + 1, 6).setValue(new Date());
      log_('INFO', '承認キュー ' + id + ' → ' + newStatus);
      return htmlOut_(newStatus === 'approved' ? '✅ 承認しました' : '❌ 却下しました',
        '提案ID: ' + id + '。第2弾で実行部を接続すると、承認済み提案は自動実行キューへ入ります。');
    }
  }
  return htmlOut_('見つかりません', '提案ID ' + id + ' は存在しません。');
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
