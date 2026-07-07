import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctx() {
  const { sandbox } = buildSandbox();
  loadGasFiles(sandbox, ['config.js', 'notify.js']);
  return sandbox;
}

// ---------- Chatworkメッセージ組み立て ----------
test('buildChatworkBody_: [info][title]記法で3部署分がまとまる', () => {
  const s = ctx();
  const results = [
    { deptName: 'マーケティング部', result: { status: 'green', headline: 'H1', report: 'R1', proposals: [] } },
    { deptName: 'SEO室', result: { status: 'yellow', headline: 'H2', report: 'R2', proposals: [{ title: '提案X', needs_decision: true }] } },
    { deptName: '商品管理部', result: { status: 'green', headline: 'H3', report: 'R3', proposals: [] } },
  ];
  const body = s.buildChatworkBody_(results, '2026-07-07', 'https://example.com/dash');
  assert.match(body, /^\[info\]\[title\]🏢 朝の部署報告 2026-07-07\[\/title\]/);
  assert.match(body, /🟢 マーケティング部：H1/);
  assert.match(body, /🟡 SEO室：H2/);
  assert.match(body, /💡 提案X（要承認→LINE WORKSへ送信済）/);
  assert.match(body, /ダッシュボード: https:\/\/example\.com\/dash\[\/info\]$/);
  assert.equal((body.match(/\[hr\]/g) || []).length, 3);
});

test('buildChatworkBody_: DASHBOARD_URL未設定時は(未設定)と表示', () => {
  const s = ctx();
  const body = s.buildChatworkBody_([], '2026-07-07', null);
  assert.match(body, /ダッシュボード: \(未設定\)/);
});

test('buildChatworkBody_: 提案なしの部署では💡行が出ない', () => {
  const s = ctx();
  const body = s.buildChatworkBody_(
    [{ deptName: 'X部', result: { status: 'green', headline: 'H', report: 'R', proposals: [] } }],
    '2026-07-07', 'url'
  );
  assert.doesNotMatch(body, /💡/);
});

// ---------- LINE WORKS JWT: header/claim構造 ----------
test('buildLwJwtHeaderClaim_: header/claimのJSON構造が正しい', () => {
  const s = ctx();
  const now = 1700000000;
  const parts = s.buildLwJwtHeaderClaim_('client-123', 'service-account-abc', now);
  const decode = (b64url) => JSON.parse(Buffer.from(b64url, 'base64').toString('utf8'));
  const header = decode(parts.header);
  const claim = decode(parts.claim);
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claim.iss, 'client-123');
  assert.equal(claim.sub, 'service-account-abc');
  assert.equal(claim.iat, now);
  assert.equal(claim.exp, now + 3600);
  assert.equal(parts.signingInput, parts.header + '.' + parts.claim);
});

test('buildLwJwtHeaderClaim_ + RSA署名: 実際にRS256として検証可能なJWTが組み立てられる', () => {
  const s = ctx();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const parts = s.buildLwJwtHeaderClaim_('client-123', 'service-account-abc', 1700000000);

  // notify.js の lwAccessToken_ と同じ手順（Utilities.computeRsaSha256Signature相当）でJWTを完成させる
  const sig = s.Utilities.base64EncodeWebSafe(s.Utilities.computeRsaSha256Signature(parts.signingInput, privateKey));
  const jwt = parts.signingInput + '.' + sig;

  const [h, c, sigPart] = jwt.split('.');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(h + '.' + c);
  const sigBuf = Buffer.from(sigPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.ok(verifier.verify(publicKey, sigBuf), 'RS256署名がpublicKeyで検証できること');
});

// ---------- HMAC署名: Node標準cryptoとの相互検証 ----------
test('hmacSignWithSecret_: Node crypto.createHmacと同一のhex文字列になる', () => {
  const s = ctx();
  const payload = 'approval-id-1:approve:1700000000000';
  const secret = 'unit-test-secret-not-real';
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const actual = s.hmacSignWithSecret_(payload, secret);
  assert.equal(actual, expected);
});

test('hmacSignWithSecret_: secretが変わると署名も変わる', () => {
  const s = ctx();
  const a = s.hmacSignWithSecret_('same-payload', 'secret-A');
  const b = s.hmacSignWithSecret_('same-payload', 'secret-B');
  assert.notEqual(a, b);
});
