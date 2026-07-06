import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctx() {
  const { sandbox, sheetsData } = buildSandbox();
  loadGasFiles(sandbox, ['config.js', 'setup.js']);
  return { sandbox, sheetsData };
}

// ---------- G2: initSheets() が4シート＋ヘッダー＋部署定義3行を生成する ----------
test('G2: initSheets() で4シートが作成される', () => {
  const { sandbox, sheetsData } = ctx();
  sandbox.initSheets();
  assert.deepEqual(Object.keys(sheetsData).sort(), ['実行ログ', '報告履歴', '承認キュー', '部署定義'].sort());
});

test('G2: 各シートに正しいヘッダー行が入る', () => {
  const { sandbox, sheetsData } = ctx();
  sandbox.initSheets();
  assert.deepEqual(Array.from(sheetsData['部署定義'][0]), ['id', '部署名', '有効', 'モデル', '役割プロンプト']);
  assert.deepEqual(Array.from(sheetsData['報告履歴'][0]), ['timestamp', 'dept_id', 'status', 'headline', 'report', 'proposals_json']);
  assert.deepEqual(Array.from(sheetsData['承認キュー'][0]), ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']);
  assert.deepEqual(Array.from(sheetsData['実行ログ'][0]), ['timestamp', 'level', 'message']);
});

test('G2: 部署定義に3部署（market/seo/items）が有効=trueで登録される', () => {
  const { sandbox, sheetsData } = ctx();
  sandbox.initSheets();
  const rows = sheetsData['部署定義'].slice(1);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r[0]), ['market', 'seo', 'items']);
  rows.forEach((r) => assert.equal(r[2], true));
  rows.forEach((r) => assert.ok(String(r[4]).length > 0, '役割プロンプトが空でないこと'));
});

test('G2: 既にシート・データがある状態で再実行してもデータは重複しない（冪等性）', () => {
  const { sandbox, sheetsData } = ctx();
  sandbox.initSheets();
  sandbox.initSheets(); // 2回目
  assert.equal(sheetsData['部署定義'].length, 4); // ヘッダー+3行のまま
  assert.equal(sheetsData['報告履歴'].length, 1); // ヘッダーのみ
});
