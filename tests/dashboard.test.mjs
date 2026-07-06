// dashboard/index.html のJSロジックをjsdom上で実行し、モックデータでの表示・XSS安全性・
// エラー時表示を検証する（レイアウト崩れの目視確認は docs/TEST_RESULTS.md の手動手順を参照）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, '../dashboard/index.html');

// jsdomは scrollIntoView 未実装のためスタブする（実ブラウザでは何もしないダミー呼び出し）
function stubScrollIntoView(dom) {
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
}

async function renderWithMock() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  stubScrollIntoView(dom);
  await dom.window.load(); // GAS_URLが空なのでMOCKデータで描画される
  return dom;
}

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

test('yellowステータスの部署カードにはyellowクラスと要確認表示が付く（E2）', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const yellowCards = doc.querySelectorAll('#cards .card.yellow');
  assert.equal(yellowCards.length, 1); // MOCKのseoがyellow
  assert.match(yellowCards[0].textContent, /要確認/);
});

test('提案(needs_decision)には「要承認」バッジが表示される（E2）', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const text = doc.getElementById('cards').innerHTML;
  assert.match(text, /要承認/);
});

test('承認待ちバッジがpending件数を表示する', async () => {
  const dom = await renderWithMock();
  const doc = dom.window.document;
  const badge = doc.getElementById('pendingBadge');
  assert.equal(badge.style.display, 'inline-block');
  assert.match(badge.textContent, /承認待ち 1件/);
});

async function renderWithServerData(serverData) {
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace('const GAS_URL = "";', 'const GAS_URL = "https://example.invalid/exec";');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  stubScrollIntoView(dom);
  dom.window.fetch = async () => ({ ok: true, json: async () => serverData });
  await dom.window.load();
  return dom;
}

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

// ---------- XSS安全性: esc()がヘッドライン・報告・提案に適用されている ----------
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

// ---------- E5: データ取得失敗時にエラーメッセージと再読込ボタン ----------
test('fetch失敗時にエラーメッセージと再読込ボタンが表示される（E5）', async () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace('const GAS_URL = "";', 'const GAS_URL = "https://example.invalid/exec";');
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
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace('const GAS_URL = "";', 'const GAS_URL = "https://example.invalid/exec";');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  const { window } = dom;
  window.fetch = async () => ({ ok: false, status: 500 });
  await window.load();
  assert.equal(window.document.getElementById('stateBox').hidden, false);
  assert.match(window.document.getElementById('stateBox').innerHTML, /HTTP 500/);
});

test('fetch成功時はGAS応答のJSONがそのまま描画に使われる', async () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace('const GAS_URL = "";', 'const GAS_URL = "https://example.invalid/exec";');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/dashboard/' });
  const { window } = dom;
  const serverData = {
    generated_at: new Date().toISOString(),
    depts: [{ id: 'market', name: 'マーケ実データ', enabled: true }],
    latest: { market: { timestamp: new Date().toISOString(), status: 'green', headline: '実データ見出し', report: 'r', proposals: [] } },
    history: [], approvals: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => serverData });
  await window.load();
  assert.match(window.document.getElementById('cards').textContent, /実データ見出し/);
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
