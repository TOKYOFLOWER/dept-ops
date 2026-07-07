import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctx(deptRows) {
  const { sandbox, sheetsData } = buildSandbox({ HMAC_SECRET: 's', WEBAPP_URL: 'https://example.com' });
  loadGasFiles(sandbox, ['config.js', 'collectors.js', 'claude.js', 'notify.js', 'orchestrator.js']);
  sheetsData['部署定義'] = [['id', '部署名', '有効', 'モデル', '役割プロンプト']].concat(deptRows);
  sheetsData['報告履歴'] = [['timestamp', 'dept_id', 'status', 'headline', 'report', 'proposals_json']];
  sheetsData['承認キュー'] = [['id', 'created', 'dept_id', '提案内容', 'status', 'decided_at']];
  sheetsData['実行ログ'] = [['timestamp', 'level', 'message']];
  return { sandbox, sheetsData };
}

// ---------- A1: 有効=TRUEの部署だけが実行される ----------
test('A1: 有効な部署だけがrunDept_される。無効部署はログにスキップ記録される', () => {
  const { sandbox, sheetsData } = ctx([
    ['market', 'マーケティング部', true, '', 'prompt-m'],
    ['seo', 'SEO室', false, '', 'prompt-s'],
  ]);
  const executed = [];
  sandbox.collectFor_ = (id) => { executed.push(id); return 'mock data for ' + id; };
  sandbox.askClaude_ = () => ({ status: 'green', headline: 'H', report: 'R', proposals: [], needs_decision: false });
  sandbox.sendChatworkReport_ = () => {};

  sandbox.runMorningCycle();

  assert.deepEqual(executed, ['market']); // seoは実行されない
  const skipLog = sheetsData['実行ログ'].some((r) => r[1] === 'INFO' && String(r[2]).includes('スキップ') && String(r[2]).includes('SEO室'));
  assert.ok(skipLog, '無効部署のスキップがログに残ること');
});

// ---------- A2: 1部署のエラーが他部署の実行を止めない ----------
test('A2: 1部署でエラーが起きても残りの部署は実行され、エラーがログとChatworkに反映される', () => {
  const { sandbox, sheetsData } = ctx([
    ['market', 'マーケティング部', true, '', 'prompt-m'],
    ['seo', 'SEO室', true, '', 'prompt-s'],
  ]);
  const executed = [];
  sandbox.collectFor_ = (id) => {
    executed.push(id);
    if (id === 'market') throw new Error('RMS接続エラー');
    return 'mock data for ' + id;
  };
  sandbox.askClaude_ = () => ({ status: 'green', headline: 'H', report: 'R', proposals: [], needs_decision: false });
  let reportedResults = null;
  sandbox.sendChatworkReport_ = (results) => { reportedResults = results; };

  sandbox.runMorningCycle();

  assert.deepEqual(executed, ['market', 'seo']); // seoも実行される
  assert.equal(reportedResults.length, 2);
  const marketResult = reportedResults.find((r) => r.deptId === 'market');
  assert.equal(marketResult.result.status, 'yellow');
  assert.match(marketResult.result.report, /RMS接続エラー/);
  const errLog = sheetsData['実行ログ'].some((r) => r[1] === 'ERROR' && String(r[2]).includes('RMS接続エラー'));
  assert.ok(errLog, 'エラーが実行ログに記録されること');
});

// ---------- A3: 前回報告履歴（最新1件）がプロンプトに含まれる ----------
test('A3: 2回目の実行では前回報告(最新1件)がaskClaude_のprevReportに渡される', () => {
  const { sandbox, sheetsData } = ctx([['market', 'マーケティング部', true, '', 'prompt-m']]);
  sandbox.collectFor_ = () => 'today data';
  sandbox.sendChatworkReport_ = () => {};

  const seenPrevReports = [];
  sandbox.askClaude_ = (rolePrompt, todayData, prevReport) => {
    seenPrevReports.push(prevReport);
    return { status: 'green', headline: 'H' + seenPrevReports.length, report: 'R' + seenPrevReports.length, proposals: [], needs_decision: false };
  };

  sandbox.runMorningCycle(); // 1回目: 前回報告なし
  sandbox.runMorningCycle(); // 2回目: 1回目の報告が前回報告として渡る

  assert.equal(seenPrevReports[0], null);
  assert.ok(seenPrevReports[1], '2回目は前回報告がnullではないこと');
  assert.match(seenPrevReports[1], /H1/);
  assert.match(seenPrevReports[1], /R1/);
});

test('A3: 前回報告には最新1件のみが使われる（複数履歴があっても最後の1件）', () => {
  const { sandbox, sheetsData } = ctx([['market', 'マーケティング部', true, '', 'prompt-m']]);
  sheetsData['報告履歴'].push(
    [new Date('2026-07-01'), 'market', 'green', '古い報告', 'R-old', '[]'],
    [new Date('2026-07-06'), 'market', 'yellow', '最新報告', 'R-new', '[]']
  );
  sandbox.collectFor_ = () => 'today data';
  sandbox.sendChatworkReport_ = () => {};
  let capturedPrev = null;
  sandbox.askClaude_ = (rolePrompt, todayData, prevReport) => {
    capturedPrev = prevReport;
    return { status: 'green', headline: 'H', report: 'R', proposals: [], needs_decision: false };
  };

  sandbox.runMorningCycle();

  assert.match(capturedPrev, /最新報告/);
  assert.doesNotMatch(capturedPrev, /古い報告/);
});

// ---------- needs_decision=true の提案だけが承認キュー+LINE WORKSに送られる（C2連動） ----------
test('needs_decision=trueの提案のみ承認キューに登録されLINE WORKS送信が試みられる', () => {
  const { sandbox, sheetsData } = ctx([['market', 'マーケティング部', true, '', 'prompt-m']]);
  sandbox.collectFor_ = () => 'today data';
  sandbox.sendChatworkReport_ = () => {};
  sandbox.askClaude_ = () => ({
    status: 'green', headline: 'H', report: 'R',
    proposals: [
      { title: '要承認提案', detail: 'd1', needs_decision: true },
      { title: '参考提案', detail: 'd2', needs_decision: false },
    ],
    needs_decision: true,
  });
  const lwCalls = [];
  sandbox.sendLwApprovalRequest_ = (id, deptName, proposal) => { lwCalls.push(proposal.title); };

  sandbox.runMorningCycle();

  assert.equal(lwCalls.length, 1);
  assert.equal(lwCalls[0], '要承認提案');
  const approvalRows = sheetsData['承認キュー'].slice(1);
  assert.equal(approvalRows.length, 1);
  assert.equal(approvalRows[0][4], 'pending');
});
