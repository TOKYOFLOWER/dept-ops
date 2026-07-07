import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctx() {
  const { sandbox } = buildSandbox();
  loadGasFiles(sandbox, ['config.js', 'collectors.js']);
  return sandbox;
}

test('summarizeCoupons_: 空配列 → 「有効なクーポンが1件もありません」', () => {
  const s = ctx();
  const out = s.summarizeCoupons_([], new Date());
  assert.deepEqual(Array.from(out), ['有効なクーポンが1件もありません。']);
});

test('summarizeCoupons_: 残日数・割引・利用数を整形する', () => {
  const s = ctx();
  const now = new Date('2026-07-07T00:00:00+09:00');
  const coupons = [
    { coupon: { couponName: '送料無料クーポン', discountFactor: '10%OFF', couponEndDate: '2026-07-10T00:00:00+09:00', usedCount: 42 } },
  ];
  const out = s.summarizeCoupons_(coupons, now);
  assert.equal(out.length, 1);
  assert.match(out[0], /送料無料クーポン/);
  assert.match(out[0], /10%OFF/);
  assert.match(out[0], /残り3日/);
  assert.match(out[0], /利用数: 42/);
});

test('summarizeCoupons_: 終了日欠損は「残り?日」', () => {
  const s = ctx();
  const out = s.summarizeCoupons_([{ coupon: { couponName: 'X' } }], new Date());
  assert.match(out[0], /残り\?日/);
});

test('formatSeoComparison_: 前週データありで比較整形', () => {
  const s = ctx();
  const cur = [{ keys: ['開店祝い 花'], clicks: 10, impressions: 200, ctr: 0.05, position: 4.2 }];
  const prev = [{ keys: ['開店祝い 花'], clicks: 15, impressions: 210, ctr: 0.07, position: 3.1 }];
  const out = s.formatSeoComparison_(cur, prev);
  assert.equal(out.length, 1);
  assert.match(out[0], /開店祝い 花/);
  assert.match(out[0], /クリック10（前週15）/);
  assert.match(out[0], /CTR5\.0%/);
  assert.match(out[0], /順位4\.2/);
});

test('formatSeoComparison_: 前週に存在しないクエリは前週0件扱い', () => {
  const s = ctx();
  const out = s.formatSeoComparison_([{ keys: ['新規クエリ'], clicks: 3, impressions: 50, ctr: 0.06, position: 8 }], []);
  assert.match(out[0], /前週0/);
});

test('formatSeoComparison_: 空配列は「データなし」', () => {
  const s = ctx();
  const out = s.formatSeoComparison_([], []);
  assert.deepEqual(Array.from(out), ['データなし（サイトURL設定を確認）']);
});

test('aggregateItemStats_: 在庫ゼロ・説明文短い・画像なし・非公開・薬機法リスク語を検出', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '効果があります'];
  const items = [
    { item: { manageNumber: 'A001', variants: { v1: { normalDeliveryQuantity: 0 } }, productDescription: { pc: '短い説明' }, images: [], hideItem: false } },
    { item: { manageNumber: 'A002', variants: { v1: { normalDeliveryQuantity: 5 } }, productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }], hideItem: true } },
    { item: { manageNumber: 'A003', variants: { v1: { normalDeliveryQuantity: 5 } }, productDescription: { pc: 'この商品は治ることが期待できます' + 'x'.repeat(100) }, images: [{ url: 'a' }], hideItem: false } },
  ];
  s.aggregateItemStats_(items, stats, RISK);
  assert.equal(stats.total, 3);
  assert.equal(stats.noStock, 1);
  assert.equal(stats.shortDesc, 1);
  assert.equal(stats.noImage, 1);
  assert.equal(stats.hidden, 1);
  assert.equal(stats.riskWords.length, 1);
  assert.match(stats.riskWords[0], /A003/);
  assert.match(stats.riskWords[0], /治る/);
});

test('aggregateItemStats_: variantsなし商品は在庫ありとみなす（既存挙動の確認）', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  s.aggregateItemStats_([{ item: { manageNumber: 'B001', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }], stats, []);
  assert.equal(stats.noStock, 0);
});

test('aggregateItemStats_: 複数ページ分の呼び出しでstatsが累積される（ページング相当）', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  s.aggregateItemStats_([{ item: { manageNumber: 'P1', images: [{ url: 'a' }], productDescription: { pc: 'x'.repeat(120) } } }], stats, []);
  s.aggregateItemStats_([{ item: { manageNumber: 'P2', images: [{ url: 'a' }], productDescription: { pc: 'x'.repeat(120) } } }], stats, []);
  assert.equal(stats.total, 2);
});
