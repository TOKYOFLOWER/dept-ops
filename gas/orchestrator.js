/**
 * オーケストレーター：毎朝6時に全部署を実行
 * initSheets() → Script Properties設定 → installTrigger() で稼働開始
 */
function runMorningCycle() {
  const deptRows = sheet_(CONF.SHEET.DEPTS).getDataRange().getValues().slice(1);
  const results = [];

  deptRows.forEach(function (row) {
    const dept = { id: row[0], name: row[1], enabled: row[2] === true || row[2] === 'TRUE', model: row[3], prompt: row[4] };
    if (!dept.id) return;
    if (!dept.enabled) {
      log_('INFO', 'スキップ（無効）: ' + dept.name);
      return;
    }
    try {
      results.push({ deptId: dept.id, deptName: dept.name, result: runDept_(dept) });
    } catch (e) {
      log_('ERROR', dept.name + ' 実行エラー: ' + e.message);
      results.push({
        deptId: dept.id, deptName: dept.name,
        result: { status: 'yellow', headline: '実行エラー', report: e.message, proposals: [], needs_decision: false },
      });
    }
  });

  if (results.length) {
    try { sendChatworkReport_(results); } catch (e) { log_('ERROR', 'Chatwork送信失敗: ' + e.message); }
  }
  log_('INFO', '朝サイクル完了: ' + results.length + '部署');
}

function runDept_(dept) {
  // 1. データ収集
  const todayData = collectFor_(dept.id);

  // 2. 前回報告（最新1件）
  const prev = latestReport_(dept.id);

  // 3. Claudeに分析させる
  const result = askClaude_(dept.prompt, todayData, prev, dept.model || null);

  // 4. 報告履歴に保存
  sheet_(CONF.SHEET.REPORTS).appendRow([
    new Date(), dept.id, result.status, result.headline, result.report,
    JSON.stringify(result.proposals),
  ]);

  // 5. 要承認の提案を承認キュー＋LINE WORKSへ
  result.proposals.filter(function (p) { return p.needs_decision; }).forEach(function (p) {
    const id = dept.id + '-' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMddHHmmss') + '-' +
      Math.floor(Math.random() * 1000);
    sheet_(CONF.SHEET.APPROVALS).appendRow([id, new Date(), dept.id, JSON.stringify(p), 'pending', '']);
    try { sendLwApprovalRequest_(id, dept.name, p); } catch (e) { log_('ERROR', 'LW送信失敗: ' + e.message); }
  });

  return result;
}

function latestReport_(deptId) {
  const rows = sheet_(CONF.SHEET.REPORTS).getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][1] === deptId) {
      return '報告日時: ' + rows[i][0] + '\nstatus: ' + rows[i][2] + '\n' + rows[i][3] + '\n' + rows[i][4] +
        '\n提案: ' + rows[i][5];
    }
  }
  return null;
}

// ---------- テスト用（1部署だけ実行） ----------
function test_runMarketOnly() {
  const rows = sheet_(CONF.SHEET.DEPTS).getDataRange().getValues().slice(1);
  const row = rows.filter(function (r) { return r[0] === 'market'; })[0];
  const out = runDept_({ id: row[0], name: row[1], enabled: true, model: row[3], prompt: row[4] });
  console.log(JSON.stringify(out, null, 2));
}
