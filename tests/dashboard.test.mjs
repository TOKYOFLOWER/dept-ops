// gas/dashboard.html（GASが doGet?action=dashboard で直接配信するテンプレート）のJSロジックを
// jsdom上で実行し、モックデータでの表示・XSS安全性・エラー時表示・スタッフ向けUI（サマリーバー・
// 3層カード・用語タップ説明・承認キュータブ・状況推移ドット）を検証する
// （375pxレイアウト崩れの目視確認は docs/TEST_RESULTS.md の手動手順を参照）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, '../gas/dashboard.html');
const RAW_HTML = fs.readFileSync(HTML_PATH, 'utf8');

// jsdomは scrollIntoView 未実装のためスタブする（実ブラウザでは何もしないダミー呼び出し）
function stubScrollIntoView(dom) {
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
}

// gas/dashboard.html はGASのHtmlServiceテンプレート（<?= gasUrl ?> / <?= dataKey ?>）を
// 使っているため、GAS実行環境の代わりにテスト側でその場置換して評価済みHTML相当を作る
// （webapi.js の renderDashboardPage_ が本番で行う注入と同じ値を渡す）。
function withInlineConfig(config) {
  const replaced = RAW_HTML
    .replace('<?= gasUrl ?>', config.gasUrl || '')
    .replace('<?= dataKey ?>', config.dataKey || '');
  assert.notEqual(replaced, RAW_HTML, 'gasUrl/dataKeyのスクリプトレットが見つからない（dashboard.htmlの構造が変わった？）');
  return replaced;
}

async function renderWithMock() {
  const html = withInlineConfig({ gasUrl: '', dataKey: '' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  stubScrollIntoView(dom);
  await dom.window.load(); // gasUrlが空なのでMOCKデータで描画される
  return dom;
}

async function renderWithServerData(serverData) {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'test-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  stubScrollIntoView(dom);
  dom.window.fetch = async () => ({ ok: true, json: async () => serverData });
  await dom.window.load();
  return dom;
}

function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// ---------- E2: 3部署カードの基本表示 ----------
test('モックデータで3部署分のカードが描画される（E2）', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const cards = doc.querySelectorAll('#cards .card');
  assert.equal(cards.length, 3);
  const text = doc.getElementById('cards').textContent;
  assert.match(text, /マーケティング部/);
  assert.match(text, /SEO室/);
  assert.match(text, /商品管理部/);
});

test('yellowステータスの部署カードにはyellowクラスと「要確認」の文字ラベルが付く（E2・色以外の手がかり）', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const yellowCards = doc.querySelectorAll('#cards .card.yellow');
  assert.equal(yellowCards.length, 1); // MOCKのseoがyellow
  assert.match(yellowCards[0].textContent, /要確認/);
  const greenCards = doc.querySelectorAll('#cards .card:not(.yellow)');
  assert.match(greenCards[0].textContent, /順調/);
});

// ---------- E6: 今朝のサマリーバー ----------
test('E6: サマリーバーに部署の状態件数と承認待ち件数が文字で表示される', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const bar = doc.getElementById('summaryBar');
  assert.equal(bar.hidden, false);
  assert.match(bar.textContent, /2部署/);
  assert.match(bar.textContent, /順調/);
  assert.match(bar.textContent, /1部署/);
  assert.match(bar.textContent, /要確認/);
  assert.match(bar.textContent, /承認待ち/);
  assert.match(bar.textContent, /2件/); // MOCKには承認待ち2件(m-1,m-2)
});

test('E6: 承認待ちが0件のときは「なし」と表示する', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: { market: { timestamp: new Date().toISOString(), status: 'green', headline: 'H', report: 'R', proposals: [] } },
    history: [], approvals: [],
  });
  assert.match(dom.window.document.getElementById('summaryBar').textContent, /承認待ち\s*なし/);
});

test('サマリーバーは取得エラー時に非表示になる', async () => {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'test-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  dom.window.fetch = async () => { throw new Error('network error'); };
  await dom.window.load();
  assert.equal(dom.window.document.getElementById('summaryBar').hidden, true);
});

// ---------- E7: 部署カードの3層化（根拠の折りたたみ／今日のアクションの出し分け） ----------
test('E7: 根拠（report本文＋取得時刻）はdetails要素で折りたたまれ、デフォルトで閉じている', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const details = doc.querySelectorAll('#cards details.evidence');
  assert.ok(details.length >= 1);
  details.forEach(d => assert.equal(d.hasAttribute('open'), false, 'デフォルトで折りたたまれていること'));
  assert.match(details[0].querySelector('summary').textContent, /根拠/);
  assert.ok(details[0].querySelector('.report').textContent.length > 0);
  assert.match(details[0].querySelector('.time').textContent, /データ取得/);
});

test('E7: 承認済みの提案は「✅実行OK」として表示される', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: {
      market: {
        timestamp: new Date().toISOString(), status: 'green', headline: 'H', report: 'R',
        proposals: [{ title: '承認済み提案', detail: 'd', needs_decision: true, approval_id: 'a-1' }],
      },
    },
    history: [],
    approvals: [{ id: 'a-1', dept_id: 'market', proposal: { title: '承認済み提案' }, status: 'approved', decided_at: new Date().toISOString() }],
  });
  const html = dom.window.document.getElementById('cards').innerHTML;
  assert.match(html, /実行OK/);
  assert.match(html, /✅/);
  assert.match(html, /承認済み提案/);
});

test('E7: 承認待ちの提案は「⏳社長の承認待ち」として表示される', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: {
      market: {
        timestamp: new Date().toISOString(), status: 'green', headline: 'H', report: 'R',
        proposals: [{ title: '承認待ち提案', detail: 'd', needs_decision: true, approval_id: 'a-2' }],
      },
    },
    history: [],
    approvals: [{ id: 'a-2', dept_id: 'market', proposal: { title: '承認待ち提案' }, status: 'pending', decided_at: null }],
  });
  const html = dom.window.document.getElementById('cards').innerHTML;
  assert.match(html, /社長の承認待ち/);
  assert.match(html, /⏳/);
});

test('E7: 却下された提案はカードに表示されない', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: {
      market: {
        timestamp: new Date().toISOString(), status: 'green', headline: 'H', report: 'R',
        proposals: [{ title: '却下された提案', detail: 'd', needs_decision: true, approval_id: 'a-3' }],
      },
    },
    history: [],
    approvals: [{ id: 'a-3', dept_id: 'market', proposal: { title: '却下された提案' }, status: 'rejected', decided_at: new Date().toISOString() }],
  });
  const html = dom.window.document.getElementById('cards').innerHTML;
  assert.doesNotMatch(html, /却下された提案/);
});

test('E7: needs_decision=falseの提案は承認不要の情報として常に表示される', async () => {
  const dom = await renderWithMock();
  const html = dom.window.document.getElementById('cards').innerHTML;
  assert.match(html, /titleタグ修正の再提案/); // MOCKのseoの提案（needs_decision:false）
  assert.match(html, /class="action info"/);
});

// ---------- E8: 専門用語のタップ説明 ----------
test('E8: 専門用語がタップ可能な要素になっている（title属性だけに依存しない）', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const termBtn = doc.querySelector('.term[data-term="CTR"]');
  assert.ok(termBtn, 'CTRの用語ボタンが存在すること');
  assert.equal(termBtn.tagName, 'BUTTON');
});

test('E8: 用語をタップすると説明ポップアップが開き、他の場所をタップすると閉じる', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const termBtn = doc.querySelector('.term[data-term="CTR"]');
  click(termBtn);
  const tip = doc.getElementById('tooltipPopup');
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /クリック率/);

  click(doc.body);
  assert.equal(tip.hidden, true);
});

// ---------- E9: 承認キュータブ ----------
test('E9: 承認キューはpending/approved/rejectedタブで切り替えて一覧表示できる', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }, { id: 'seo', name: 'SEO室', enabled: true }],
    latest: {}, history: [],
    approvals: [
      { id: 'p1', dept_id: 'market', proposal: { title: '保留中の提案' }, status: 'pending', decided_at: null },
      { id: 'p2', dept_id: 'seo', proposal: { title: '承認済みの提案' }, status: 'approved', decided_at: new Date().toISOString() },
      { id: 'p3', dept_id: 'seo', proposal: { title: '却下された提案' }, status: 'rejected', decided_at: new Date().toISOString() },
    ],
  });
  const doc = dom.window.document;

  // 初期表示はpendingタブ
  assert.match(doc.getElementById('apprList').textContent, /保留中の提案/);
  assert.match(doc.getElementById('apprList').textContent, /マーケティング部/);
  assert.match(doc.getElementById('apprList').textContent, /LINE WORKSに依頼済み/);

  click(doc.querySelector('.apprTabBtn[data-tab="approved"]'));
  assert.match(doc.getElementById('apprList').textContent, /承認済みの提案/);
  assert.match(doc.getElementById('apprList').textContent, /SEO室/);
  assert.doesNotMatch(doc.getElementById('apprList').textContent, /LINE WORKSに依頼済み/);

  click(doc.querySelector('.apprTabBtn[data-tab="rejected"]'));
  assert.match(doc.getElementById('apprList').textContent, /却下された提案/);
});

test('E9: 承認待ちが0件のタブでは分かりやすい空状態メッセージが出る', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(), depts: [], latest: {}, history: [], approvals: [],
  });
  const doc = dom.window.document;
  assert.match(doc.getElementById('apprList').textContent, /ありません/);
});

// ---------- 状況推移ドット列（履歴の改善） ----------
test('部署カードに直近の状況推移がドット列（絵文字＋テキストラベル）で表示される', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: { market: { timestamp: new Date().toISOString(), status: 'green', headline: 'H', report: 'R', proposals: [] } },
    // backendのmapHistoryRows_は新しい順（newest-first）で返すため、テストでも同順で与える
    history: [
      { dept_id: 'market', timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'green', headline: 'h2', report: 'r2' },
      { dept_id: 'market', timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), status: 'yellow', headline: 'h1', report: 'r1' },
    ],
    approvals: [],
  });
  const doc = dom.window.document;
  const dots = doc.querySelectorAll('#cards .dots .dot');
  assert.equal(dots.length, 2);
  assert.match(dots[0].getAttribute('aria-label'), /要確認/); // 古い方が先頭（時系列順）
  assert.match(dots[1].getAttribute('aria-label'), /順調/);
});

// ---------- E3: 履歴 ----------
test('履歴を見るボタンで該当部署の履歴が表示される（E3）', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: {},
    history: [
      { dept_id: 'market', timestamp: new Date().toISOString(), status: 'green', headline: '過去の報告A', report: 'r' },
      { dept_id: 'seo', timestamp: new Date().toISOString(), status: 'yellow', headline: '過去の報告B', report: 'r' },
    ],
    approvals: [],
  });
  dom.window.showHistory('market', 'マーケティング部');
  const doc = dom.window.document;
  assert.equal(doc.getElementById('historyArea').style.display, 'block');
  assert.match(doc.getElementById('histList').textContent, /過去の報告A/);
  assert.doesNotMatch(doc.getElementById('histList').textContent, /過去の報告B/);
});

test('履歴が0件のときは「履歴がまだありません」と表示される（E3）', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'items', name: '商品管理部', enabled: true }],
    latest: {}, history: [], approvals: [],
  });
  dom.window.showHistory('items', '商品管理部');
  assert.match(dom.window.document.getElementById('histList').textContent, /履歴がまだありません/);
});

// ---------- テンプレートスクリプトレット経由のURL組み立て ----------
test('gasUrl/dataKey（テンプレートから注入）が action=data のfetch URLに正しく反映される', async () => {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'my-secret-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  stubScrollIntoView(dom);
  let calledUrl = null;
  dom.window.fetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ generated_at: new Date().toISOString(), depts: [], latest: {}, history: [], approvals: [] }) };
  };
  await dom.window.load();
  assert.equal(calledUrl, 'https://example.invalid/exec?action=data&key=my-secret-key');
});

// ---------- XSS安全性 ----------
test('headline/report/proposalにHTMLタグが含まれてもエスケープされ実行されない', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケティング部', enabled: true }],
    latest: {
      market: {
        timestamp: new Date().toISOString(), status: 'green',
        headline: '<img src=x onerror=alert(1)>',
        report: '<script>alert(2)</script>',
        proposals: [{ title: '<b>危険</b>', detail: '<i>detail</i>', needs_decision: false }],
      },
    },
    history: [], approvals: [],
  });
  const html2 = dom.window.document.getElementById('cards').innerHTML;
  assert.doesNotMatch(html2, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html2, /<script>alert\(2\)<\/script>/);
  assert.doesNotMatch(html2, /<b>危険<\/b>/);
  assert.match(html2, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('承認キュータブの部署名・提案タイトルもエスケープされる', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'x', name: '<b>部署</b>', enabled: true }],
    latest: {}, history: [],
    approvals: [{ id: 'p1', dept_id: 'x', proposal: { title: '<script>alert(1)</script>' }, status: 'pending', decided_at: null }],
  });
  const html = dom.window.document.getElementById('apprList').innerHTML;
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<b>部署<\/b>/);
});

// ---------- E5: データ取得失敗時にエラーメッセージと再読込ボタン ----------
test('fetch失敗時にエラーメッセージと再読込ボタンが表示される（E5）', async () => {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'test-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  const { window } = dom;
  window.fetch = async () => { throw new Error('network error'); };
  await window.load();
  const doc = window.document;
  assert.equal(doc.getElementById('stateBox').hidden, false);
  assert.match(doc.getElementById('stateBox').innerHTML, /データを取得できませんでした/);
  assert.match(doc.getElementById('stateBox').innerHTML, /<button onclick="load\(\)">再読み込み<\/button>/);
  assert.equal(doc.getElementById('meta').textContent, '取得エラー');
});

test('fetchが非OKレスポンスの場合もエラー表示になる（E5）', async () => {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'test-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  const { window } = dom;
  window.fetch = async () => ({ ok: false, status: 500 });
  await window.load();
  assert.equal(window.document.getElementById('stateBox').hidden, false);
  assert.match(window.document.getElementById('stateBox').innerHTML, /HTTP 500/);
});

test('サーバーがアクセスキー不一致で {error:"unauthorized"} を返した場合もエラー表示になる', async () => {
  const html = withInlineConfig({ gasUrl: 'https://example.invalid/exec', dataKey: 'wrong-key' });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => ({ error: 'unauthorized' }) });
  await window.load();
  assert.equal(window.document.getElementById('stateBox').hidden, false);
  assert.match(window.document.getElementById('stateBox').innerHTML, /unauthorized/);
});

test('fetch成功時はGAS応答のJSONがそのまま描画に使われる', async () => {
  const serverData = {
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケ実データ', enabled: true }],
    latest: { market: { timestamp: new Date().toISOString(), status: 'green', headline: '実データ見出し', report: 'r', proposals: [] } },
    history: [], approvals: [],
  };
  const dom = await renderWithServerData(serverData);
  assert.match(dom.window.document.getElementById('cards').textContent, /実データ見出し/);
});

// ---------- 未報告部署のフォールバック ----------
test('報告が1件もない部署は「まだ報告がありません」を表示する', async () => {
  const dom = await renderWithServerData({
    generated_at: new Date().toISOString(),
    depts: [{ id: 'new_dept', name: '新部署', enabled: true }],
    latest: {}, history: [], approvals: [],
  });
  assert.match(dom.window.document.getElementById('cards').textContent, /まだ報告がありません/);
});

// ---------- アクセシビリティ: 文字サイズ14px以上（スタイルシートの静的検査） ----------
test('アクセシビリティ: スタイルシート中のfont-sizeはすべて14px相当以上である', () => {
  const styleMatch = RAW_HTML.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'styleブロックが見つからないこと');
  const css = styleMatch[1];
  const rootPx = 16; // html{font-size:16px}
  const sizes = [...css.matchAll(/font-size\s*:\s*([\d.]+)(px|rem)/g)];
  assert.ok(sizes.length > 5, '検出されたfont-size宣言が少なすぎる（正規表現が壊れていないか確認）');
  sizes.forEach(([, num, unit]) => {
    const px = unit === 'px' ? parseFloat(num) : parseFloat(num) * rootPx;
    assert.ok(px >= 14, `font-size ${num}${unit} (=${px}px) が14px未満`);
  });
});
