import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctxParseOnly() {
  const { sandbox } = buildSandbox();
  loadGasFiles(sandbox, ['config.js', 'claude.js']);
  return sandbox;
}

// ---------- B1: コードフェンス付きでもJSONパースできる ----------
test('parseReportJson_: プレーンJSON', () => {
  const s = ctxParseOnly();
  const out = s.parseReportJson_('{"status":"green","headline":"H","report":"R","proposals":[],"needs_decision":false}');
  assert.equal(out.status, 'green');
  assert.equal(out.headline, 'H');
});

test('parseReportJson_: ```json フェンス付きでもパース成功', () => {
  const s = ctxParseOnly();
  const text = '```json\n{"status":"yellow","headline":"H2","report":"R2","proposals":[],"needs_decision":true}\n```';
  const out = s.parseReportJson_(text);
  assert.equal(out.status, 'yellow');
  assert.equal(out.needs_decision, true);
});

test('parseReportJson_: 前後に説明文があってもJSON部分を抽出できる', () => {
  const s = ctxParseOnly();
  const text = 'はい、報告します。\n{"status":"green","headline":"H3","report":"R3","proposals":[],"needs_decision":false}\nご確認ください。';
  const out = s.parseReportJson_(text);
  assert.equal(out.headline, 'H3');
});

test('parseReportJson_: JSONが全く含まれない場合は例外を投げる', () => {
  const s = ctxParseOnly();
  assert.throws(() => s.parseReportJson_('すみません、うまく分析できませんでした。'));
});

// ---------- B3: キー欠損時のデフォルト補完 ----------
test('parseReportJson_: キー欠損時にデフォルト値で補完される', () => {
  const s = ctxParseOnly();
  const out = s.parseReportJson_('{"headline":"欠損テスト"}');
  assert.equal(out.status, 'green'); // status欠損 → green
  assert.equal(out.headline, '欠損テスト');
  assert.equal(out.report, '');
  assert.deepEqual(Array.from(out.proposals), []);
  assert.equal(out.needs_decision, false);
});

test('parseReportJson_: proposals内のneeds_decision欠損はfalse補完', () => {
  const s = ctxParseOnly();
  const out = s.parseReportJson_('{"proposals":[{"title":"提案A"}]}');
  assert.equal(out.proposals[0].title, '提案A');
  assert.equal(out.proposals[0].needs_decision, false);
  assert.equal(out.proposals[0].detail, '');
});

test('parseReportJson_: statusが"yellow"以外の値は"green"に丸められる', () => {
  const s = ctxParseOnly();
  const out = s.parseReportJson_('{"status":"red"}');
  assert.equal(out.status, 'green');
});

// ---------- B2: askClaude_ のリトライ・フォールバック ----------
function ctxAskClaude(fetchImpl) {
  const { sandbox, sheetsData } = buildSandbox({ ANTHROPIC_API_KEY: 'test-key' });
  sandbox.UrlFetchApp = { fetch: fetchImpl };
  loadGasFiles(sandbox, ['config.js', 'claude.js']);
  sheetsData['実行ログ'] = [['timestamp', 'level', 'message']];
  return sandbox;
}

function fakeRes(status, bodyObj) {
  return {
    getResponseCode: () => status,
    getContentText: () => JSON.stringify(bodyObj),
  };
}

test('askClaude_: 1回目が壊れたJSON、2回目が正常 → リトライ成功', () => {
  let calls = 0;
  const s = ctxAskClaude(() => {
    calls++;
    if (calls === 1) return fakeRes(200, { content: [{ type: 'text', text: '{not valid json' }] });
    return fakeRes(200, { content: [{ type: 'text', text: '{"status":"green","headline":"OK","report":"R","proposals":[],"needs_decision":false}' }] });
  });
  const out = s.askClaude_('role prompt', 'today data', null, null);
  assert.equal(calls, 2);
  assert.equal(out.headline, 'OK');
});

test('askClaude_: 2回とも失敗 → status=yellowの定型フォールバック', () => {
  let calls = 0;
  const s = ctxAskClaude(() => {
    calls++;
    return fakeRes(200, { content: [{ type: 'text', text: 'JSONではない応答' }] });
  });
  const out = s.askClaude_('role prompt', 'today data', null, null);
  assert.equal(calls, 2);
  assert.equal(out.status, 'yellow');
  assert.equal(out.needs_decision, false);
  assert.equal(out.proposals.length, 0);
  assert.match(out.headline, /エラー/);
});

test('askClaude_: HTTPエラー応答でもリトライ経路に入りフォールバックする', () => {
  let calls = 0;
  const s = ctxAskClaude(() => {
    calls++;
    return fakeRes(500, { error: 'server error' });
  });
  const out = s.askClaude_('role prompt', 'today data', null, null);
  assert.equal(calls, 2);
  assert.equal(out.status, 'yellow');
});
