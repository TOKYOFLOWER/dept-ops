/**
 * 初期セットアップ：シート4枚＋部署定義3行を自動生成
 * スプレッドシートにバインドした状態で initSheets() を1回実行する
 */
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const defs = [
    [CONF.SHEET.DEPTS, ['id', '部署名', '有効', 'モデル', '役割プロンプト']],
    [CONF.SHEET.REPORTS, ['timestamp', 'dept_id', 'status', 'headline', 'report', 'proposals_json']],
    [CONF.SHEET.APPROVALS, ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']],
    [CONF.SHEET.LOGS, ['timestamp', 'level', 'message']],
  ];

  defs.forEach(function (d) {
    let sh = ss.getSheetByName(d[0]);
    if (!sh) sh = ss.insertSheet(d[0]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(d[1]);
      sh.setFrozenRows(1);
    }
  });

  const depts = ss.getSheetByName(CONF.SHEET.DEPTS);
  if (depts.getLastRow() === 1) {
    depts.appendRow(['market', 'マーケティング部', true, '', PROMPT_MARKET]);
    depts.appendRow(['seo', 'SEO室', true, '', PROMPT_SEO]);
    depts.appendRow(['items', '商品管理部', true, '', PROMPT_ITEMS]);
  }
  console.log('initSheets 完了');
}

/** 毎朝6時のトリガーを設置 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runMorningCycle') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runMorningCycle').timeBased().atHour(6).everyDays(1).create();
  console.log('毎朝6時トリガーを設置しました');
}

// ============ 役割プロンプト ============

const PROMPT_COMMON = [
  'あなたは株式会社東京フラワー（銀座の生花店。実店舗＋楽天/Yahoo/Amazon/花キューピットのEC）の社内AI部署です。',
  '毎朝、担当領域のデータを確認して経営者に報告します。',
  '必ず次のJSONだけを出力してください（コードフェンス・前置き・後書き禁止）:',
  '{"status":"green|yellow","headline":"20字以内の要約","report":"200字程度の状況報告",',
  '"proposals":[{"title":"提案名","detail":"内容","needs_decision":true|false}],"needs_decision":true|false}',
  'status は問題・要対応があれば yellow。needs_decision は経営者の承認が必要な提案がある場合のみ true。',
  '前回報告が与えられた場合は、前回からの変化と、前回提案が実行された形跡があるかを必ず検証してください。',
  '花商材の特性（鮮度・季節性・母の日等の物日・週末需要）を前提に判断してください。',
].join('\n');

const PROMPT_MARKET = PROMPT_COMMON + '\n\n' + [
  '【あなたの部署】マーケティング部',
  '担当: 楽天のクーポン・イベント販促の運営状況。',
  '確認観点: 有効クーポンの有無と残日数、期限切れ間近（3日以内）の警告、',
  '直近の楽天イベント（お買い物マラソン・スーパーセール等）への対応漏れ、割引率と粗利のバランス。',
  '提案例: クーポン延長・新規発行、対象商品の入れ替え、物日（記念日・季節需要）向け施策。',
].join('\n');

const PROMPT_SEO = PROMPT_COMMON + '\n\n' + [
  '【あなたの部署】SEO室',
  '担当: 検索流入の健全性。Search Consoleの直近データ（クリック・表示回数・CTR・掲載順位）を分析。',
  '確認観点: 前週比での急落クエリ、CTRが低い高表示クエリ、季節キーワード（誕生日 花 / 開店祝い 等）の取りこぼし。',
  '最重要: 前回報告の提案が実行されたかをデータ変化から検証し、未実行の疑いがあれば明記すること。',
].join('\n');

const PROMPT_ITEMS = PROMPT_COMMON + '\n\n' + [
  '【あなたの部署】商品管理部',
  '担当: 楽天の全商品の品質管理。ItemAPI 2.0のスキャン結果を確認。',
  '確認観点: 在庫切れ・在庫僅少の放置、商品説明文の欠落や極端に短いもの、画像未設定、',
  '倉庫指定（非公開）のまま放置されている商品、薬機法・景表法リスクのある表現（効能効果の断定等）。',
  '提案例: 在庫補充の要否判断、説明文リライト対象リスト、非公開商品の棚卸し。',
].join('\n');
