import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

const SECRET = 'unit-test-hmac-secret';

function ctx(sheetsSeed, scriptProps) {
  const { sandbox, sheetsData } = buildSandbox(Object.assign({ HMAC_SECRET: SECRET }, scriptProps || {}));
  loadGasFiles(sandbox, ['config.js', 'webapi.js']);
  sheetsData['実行ログ'] = [['timestamp', 'level', 'message']];
  Object.assign(sheetsData, sheetsSeed || {});
  return { sandbox, sheetsData };
}

function sign(sandbox, id, action, exp) {
  return sandbox.hmacSignWithSecret_(id + ':' + action + ':' + exp, SECRET);
}

// ---------- D1: 不正な署名 ----------
test('D1: HMAC署名が不正な場合は署名エラー(403)相当のページを返す', () => {
  const { sandbox } = ctx();
  const check = sandbox.verifyApprovalLink_('id1', 'approve', String(Date.now() + 100000), 'bogus-signature', SECRET);
  assert.equal(check.ok, false);
  assert.equal(check.title, '署名エラー（403）');
});

// ---------- D2: 期限切れ ----------
test('D2: 発行から72時間相当を過ぎたリンクは期限切れになり状態は変更されない', () => {
  const { sandbox, sheetsData } = ctx({
    '承認キュー': [
      ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at'],
      ['exp-1', new Date(), 'market', '{"title":"t"}', 'pending', ''],
    ],
  });
  const pastExp = String(Date.now() - 1000); // 既に期限切れ
  const sig = sign(sandbox, 'exp-1', 'approve', pastExp);
  const res = sandbox.doGet({ parameter: { action: 'approve', id: 'exp-1', exp: pastExp, sig } });
  assert.match(res._html, /期限切れ/);
  assert.equal(sheetsData['承認キュー'][1][4], 'pending'); // 状態は変更されない
  assert.equal(sheetsData['承認キュー'][1][5], '');
});

// ---------- D3 + D4: 承認・二重承認防止・decided_at記録 ----------
test('D3/D4: pendingの提案を承認するとapproved+decided_atが記録され、再アクセスでは上書きされない', () => {
  const { sandbox, sheetsData } = ctx({
    '承認キュー': [
      ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at'],
      ['app-1', new Date(), 'market', '{"title":"t"}', 'pending', ''],
    ],
  });
  const futureExp = String(Date.now() + 72 * 3600000);
  const sig = sign(sandbox, 'app-1', 'approve', futureExp);

  const res1 = sandbox.doGet({ parameter: { action: 'approve', id: 'app-1', exp: futureExp, sig } });
  assert.match(res1._html, /承認しました/);
  assert.equal(sheetsData['承認キュー'][1][4], 'approved');
  const decidedAt1 = sheetsData['承認キュー'][1][5];
  assert.equal(Object.prototype.toString.call(decidedAt1), '[object Date]');

  // 同じリンクに再アクセス
  const res2 = sandbox.doGet({ parameter: { action: 'approve', id: 'app-1', exp: futureExp, sig } });
  assert.match(res2._html, /処理済み/);
  assert.equal(sheetsData['承認キュー'][1][4], 'approved'); // 上書きされない
  assert.equal(sheetsData['承認キュー'][1][5], decidedAt1);
});

test('却下(reject)でrejected状態になる', () => {
  const { sandbox, sheetsData } = ctx({
    '承認キュー': [
      ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at'],
      ['rej-1', new Date(), 'seo', '{"title":"t"}', 'pending', ''],
    ],
  });
  const futureExp = String(Date.now() + 1000000);
  const sig = sign(sandbox, 'rej-1', 'reject', futureExp);
  const res = sandbox.doGet({ parameter: { action: 'reject', id: 'rej-1', exp: futureExp, sig } });
  assert.match(res._html, /却下しました/);
  assert.equal(sheetsData['承認キュー'][1][4], 'rejected');
});

test('存在しないIDへのアクセスは「見つかりません」', () => {
  const { sandbox } = ctx({
    '承認キュー': [['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']],
  });
  const futureExp = String(Date.now() + 1000000);
  const sig = sign(sandbox, 'nope', 'approve', futureExp);
  const res = sandbox.doGet({ parameter: { action: 'approve', id: 'nope', exp: futureExp, sig } });
  assert.match(res._html, /見つかりません/);
});

// ---------- XSSリグレッション: idをエスケープしてHTMLに埋め込む ----------
test('見つからないIDにHTMLタグを含めても実行可能なタグとして出力されない', () => {
  const { sandbox } = ctx({
    '承認キュー': [['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']],
  });
  const maliciousId = '<script>alert(1)</script>';
  const futureExp = String(Date.now() + 1000000);
  const sig = sign(sandbox, maliciousId, 'approve', futureExp);
  const res = sandbox.doGet({ parameter: { action: 'approve', id: maliciousId, exp: futureExp, sig } });
  assert.doesNotMatch(res._html, /<script>alert\(1\)<\/script>/);
  assert.match(res._html, /&lt;script&gt;/);
});

// ---------- DATA_KEY: action=data の簡易アクセスキー ----------
test('verifyDataKey_: キーが一致すればtrue', () => {
  const { sandbox } = ctx();
  assert.equal(sandbox.verifyDataKey_('abc123', 'abc123'), true);
});

test('verifyDataKey_: キーが不一致ならfalse', () => {
  const { sandbox } = ctx();
  assert.equal(sandbox.verifyDataKey_('wrong', 'abc123'), false);
});

test('verifyDataKey_: DATA_KEY未設定（expectedKeyが空）なら常にfalse（全公開を防ぐ）', () => {
  const { sandbox } = ctx();
  assert.equal(sandbox.verifyDataKey_('anything', ''), false);
  assert.equal(sandbox.verifyDataKey_('', ''), false);
  assert.equal(sandbox.verifyDataKey_(undefined, null), false);
});

test('doGet(action=data): keyが正しければダッシュボードJSONを返す', () => {
  const { sandbox } = ctx(
    {
      '部署定義': [['id', '部署名', '有効', 'モデル', '役割プロンプト'], ['market', 'マーケ', true, '', 'p']],
      '報告履歴': [['timestamp', 'dept_id', 'status', 'headline', 'report', 'proposals_json']],
      '承認キュー': [['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']],
    },
    { DATA_KEY: 'secret-key-1' }
  );
  const res = sandbox.doGet({ parameter: { action: 'data', key: 'secret-key-1' } });
  const body = JSON.parse(res._text);
  assert.equal(body.depts.length, 1);
});

test('doGet(action=data): keyが不一致なら空のエラーJSONを返す（シートは読まれない）', () => {
  const { sandbox } = ctx({}, { DATA_KEY: 'secret-key-1' });
  const res = sandbox.doGet({ parameter: { action: 'data', key: 'wrong-key' } });
  const body = JSON.parse(res._text);
  assert.deepEqual(body, { error: 'unauthorized' });
});

test('doGet(action=data): keyが未指定でも空のエラーJSONを返す', () => {
  const { sandbox } = ctx({}, { DATA_KEY: 'secret-key-1' });
  const res = sandbox.doGet({ parameter: { action: 'data' } });
  const body = JSON.parse(res._text);
  assert.deepEqual(body, { error: 'unauthorized' });
});

// ---------- doGet(action=dashboard): GAS直接配信 ----------
test('doGet(action=dashboard): keyが正しければdashboard.htmlをgasUrl/dataKey注入済みで返す', () => {
  const { sandbox } = ctx({}, { DATA_KEY: 'secret-key-1', WEBAPP_URL: 'https://script.google.com/macros/s/xxx/exec' });
  const res = sandbox.doGet({ parameter: { action: 'dashboard', key: 'secret-key-1' } });
  assert.equal(res._title, 'DEPT-OPS');
  assert.deepEqual(Array.from(res._metaTags), [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]);
  assert.match(res.getContent(), /gasUrl: 'https:\/\/script\.google\.com\/macros\/s\/xxx\/exec'/);
  assert.match(res.getContent(), /dataKey: 'secret-key-1'/);
});

test('doGet(action=dashboard): keyが不一致なら何も漏らさないエラーページを返す（HTMLにgasUrl/dataKeyを含まない）', () => {
  const { sandbox } = ctx({}, { DATA_KEY: 'secret-key-1', WEBAPP_URL: 'https://script.google.com/macros/s/xxx/exec' });
  const res = sandbox.doGet({ parameter: { action: 'dashboard', key: 'wrong-key' } });
  assert.doesNotMatch(res._html, /xxx/);
  assert.doesNotMatch(res._html, /secret-key-1/);
});

test('doGet(action=dashboard): keyが未指定でもエラーページを返す', () => {
  const { sandbox } = ctx({}, { DATA_KEY: 'secret-key-1' });
  const res = sandbox.doGet({ parameter: { action: 'dashboard' } });
  assert.doesNotMatch(res._html, /secret-key-1/);
});

test('doGet(action=dashboard): DATA_KEY未設定の環境では常に拒否される', () => {
  const { sandbox } = ctx({}, {});
  const res = sandbox.doGet({ parameter: { action: 'dashboard', key: '' } });
  assert.doesNotMatch(res._html, /gasUrl/);
});

// ---------- E1: doGet(action=data) の集計ロジック ----------
test('E1: mapDeptRows_/mapHistoryRows_/pickLatestByDept_/mapApprovalRows_ が正しく集計される', () => {
  const { sandbox } = ctx();
  const depts = sandbox.mapDeptRows_([
    ['market', 'マーケティング部', true, '', 'prompt'],
    ['seo', 'SEO室', 'TRUE', '', 'prompt'],
    ['items', '商品管理部', false, '', 'prompt'],
  ]);
  assert.equal(depts.length, 3);
  assert.equal(depts[2].enabled, false);

  const history = sandbox.mapHistoryRows_([
    [new Date('2026-07-01T06:00:00Z'), 'market', 'green', 'H1', 'R1', '[]'],
    [new Date('2026-07-02T06:00:00Z'), 'market', 'yellow', 'H2', 'R2', '[{"title":"p"}]'],
    [new Date('2026-07-03T06:00:00Z'), 'seo', 'green', 'H3', 'R3', '[]'],
  ]);
  assert.equal(history.length, 3);
  assert.equal(history[0].dept_id, 'seo'); // 新しい順(newest-first)で先頭

  const latest = sandbox.pickLatestByDept_(history);
  assert.equal(latest.market.headline, 'H2'); // marketの最新はH2
  assert.equal(latest.seo.headline, 'H3');

  const approvals = sandbox.mapApprovalRows_([
    ['a1', new Date(), 'market', '{"title":"t1"}', 'pending', ''],
    ['a2', new Date(), 'seo', '{"title":"t2"}', 'approved', new Date()],
  ]);
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].id, 'a2'); // reverse順
  assert.equal(approvals[0].proposal.title, 't2');
});

test('E1: mapHistoryRows_は全部署合算ではなく部署ごとに直近14件を残す', () => {
  const { sandbox } = ctx();
  // marketだけ20件（シートは古い→新しい順で追記される）、seoは3件
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    rows.push([new Date('2026-07-' + String(i).padStart(2, '0') + 'T06:00:00Z'), 'market', 'green', 'M' + i, 'R' + i, '[]']);
  }
  for (let i = 1; i <= 3; i++) {
    rows.push([new Date('2026-07-' + String(i).padStart(2, '0') + 'T07:00:00Z'), 'seo', 'green', 'S' + i, 'R' + i, '[]']);
  }
  const history = sandbox.mapHistoryRows_(rows);
  const marketEntries = history.filter((h) => h.dept_id === 'market');
  const seoEntries = history.filter((h) => h.dept_id === 'seo');
  assert.equal(marketEntries.length, 14, 'marketは20件中直近14件のみ残る');
  assert.equal(seoEntries.length, 3, 'seoは3件しかないため3件とも残る（全部署合算の上限に食われない）');
  assert.equal(marketEntries[0].headline, 'M20'); // 最新が先頭
  assert.equal(marketEntries[marketEntries.length - 1].headline, 'M7'); // 直近14件の最古はM7(20-14+1)
});

test('E1: mapHistoryRows_の返り値は部署混在でも常にタイムスタンプ降順（newest-first）', () => {
  const { sandbox } = ctx();
  const rows = [
    [new Date('2026-07-01T06:00:00Z'), 'market', 'green', 'M1', 'R', '[]'],
    [new Date('2026-07-05T06:00:00Z'), 'seo', 'green', 'S1', 'R', '[]'],
    [new Date('2026-07-03T06:00:00Z'), 'items', 'green', 'I1', 'R', '[]'],
  ];
  const history = sandbox.mapHistoryRows_(rows);
  const timestamps = Array.from(history).map((h) => new Date(h.timestamp).getTime());
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert.deepEqual(timestamps, sorted);
  assert.equal(history[0].headline, 'S1'); // 2026-07-05が最新
});

test('buildDashboardData_: 3シートを統合したJSONを返す（E1の統合確認）', () => {
  const { sandbox } = ctx({
    '部署定義': [
      ['id', '部署名', '有効', 'モデル', '役割プロンプト'],
      ['market', 'マーケティング部', true, '', 'p'],
    ],
    '報告履歴': [
      ['timestamp', 'dept_id', 'status', 'headline', 'report', 'proposals_json'],
      [new Date(), 'market', 'green', 'H', 'R', '[]'],
    ],
    '承認キュー': [
      ['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at'],
      ['a1', new Date(), 'market', '{"title":"t"}', 'pending', ''],
    ],
  });
  const data = sandbox.buildDashboardData_();
  assert.equal(data.depts.length, 1);
  assert.equal(data.latest.market.headline, 'H');
  assert.equal(data.approvals.length, 1);
  assert.ok(data.generated_at);
});
