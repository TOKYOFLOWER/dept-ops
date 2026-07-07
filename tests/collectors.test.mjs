import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandbox, loadGasFiles } from './sandbox.mjs';

function ctx(scriptProps) {
  const { sandbox } = buildSandbox(Object.assign(
    { RMS_SERVICE_SECRET: 'test-secret', RMS_LICENSE_KEY: 'test-license' },
    scriptProps || {}
  ));
  loadGasFiles(sandbox, ['config.js', 'collectors.js']);
  return sandbox;
}

function fakeRes(status, text) {
  return {
    getResponseCode: () => status,
    getContentText: () => text,
  };
}
function fakeJsonRes(status, obj) {
  return fakeRes(status, JSON.stringify(obj));
}

function couponXml(coupons) {
  const items = (coupons || []).map((c) => (
    '<coupon>' +
    '<couponName>' + c.couponName + '</couponName>' +
    '<couponEndDate>' + c.couponEndDate + '</couponEndDate>' +
    '<discountType>' + c.discountType + '</discountType>' +
    '<discountFactor>' + c.discountFactor + '</discountFactor>' +
    '<issueCount>' + (c.issueCount != null ? c.issueCount : '') + '</issueCount>' +
    '<getCount>' + (c.getCount != null ? c.getCount : '') + '</getCount>' +
    '<availCount>' + (c.availCount != null ? c.availCount : '') + '</availCount>' +
    '</coupon>'
  )).join('');
  return '<result><coupons>' + items + '</coupons></result>';
}

// ================= collectMarket_ / CouponAPI 1.0 =================

test('collectMarket_: GETメソッドでCouponAPI 1.0（/es/1.0/coupon/search）を呼ぶ。couponStatusは送らない', () => {
  const s = ctx();
  let capturedUrl = null, capturedOpts = null;
  s.UrlFetchApp = {
    fetch: (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return fakeRes(200, couponXml([]));
    },
  };
  s.collectMarket_();
  assert.match(capturedUrl, /\/es\/1\.0\/coupon\/search/);
  assert.doesNotMatch(capturedUrl, /\/es\/2\.0\/coupon/);
  assert.doesNotMatch(capturedUrl, /couponStatus/);
  assert.equal(capturedOpts.method, 'get');
  assert.equal(capturedOpts.payload, undefined);
});

test('collectMarket_: 404エラー時にHTTPステータスコードと試行URLが出力に含まれる', () => {
  const s = ctx();
  s.UrlFetchApp = { fetch: () => fakeRes(404, 'not found') };
  const out = s.collectMarket_();
  assert.match(out, /404/);
  assert.match(out, /\/es\/1\.0\/coupon\/search/);
});

test('collectMarket_: XML応答から有効クーポンの行が整形される（統合）', () => {
  const s = ctx();
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  s.UrlFetchApp = {
    fetch: () => fakeRes(200, couponXml([
      { couponName: '送料無料クーポン', couponEndDate: future, discountType: 4, discountFactor: 0, issueCount: 100, getCount: 80, availCount: 20 },
    ])),
  };
  const out = s.collectMarket_();
  assert.match(out, /送料無料クーポン/);
  assert.match(out, /送料無料/);
  assert.match(out, /発行100・取得80・利用20/);
});

test('collectMarket_: 出力が「# 本日の日付（JST）」で始まる', () => {
  const s = ctx();
  s.UrlFetchApp = { fetch: () => fakeRes(200, couponXml([])) };
  assert.match(s.collectMarket_(), /^# 本日の日付（JST）: \d{4}-\d{2}-\d{2}/);
});

// ---------- parseCouponXml_ ----------
test('parseCouponXml_: result > coupons > coupon の各フィールドを読み取る', () => {
  const s = ctx();
  const xml = couponXml([
    { couponName: 'A', couponEndDate: '2026-08-01', discountType: 2, discountFactor: 10, issueCount: 5, getCount: 4, availCount: 3 },
  ]);
  const coupons = s.parseCouponXml_(xml);
  assert.equal(coupons.length, 1);
  assert.equal(coupons[0].couponName, 'A');
  assert.equal(coupons[0].couponEndDate, '2026-08-01');
  assert.equal(coupons[0].discountType, '2');
  assert.equal(coupons[0].discountFactor, '10');
});

test('parseCouponXml_: coupons要素が無ければ空配列', () => {
  const s = ctx();
  const coupons = s.parseCouponXml_('<result></result>');
  assert.deepEqual(Array.from(coupons), []);
});

// ---------- describeDiscount_ ----------
test('describeDiscount_: discountType 1=定額値引 2=定率 4=送料無料、それ以外は不明', () => {
  const s = ctx();
  assert.equal(s.describeDiscount_('1', '500'), '500円引き');
  assert.equal(s.describeDiscount_('2', '10'), '10%OFF');
  assert.equal(s.describeDiscount_('4', '0'), '送料無料');
  assert.match(s.describeDiscount_('9', '0'), /不明/);
});

// ---------- summarizeCoupons_ ----------
test('summarizeCoupons_: couponEndDateが未来のものだけを有効クーポンとして整形する', () => {
  const s = ctx();
  const now = new Date('2026-07-08T00:00:00+09:00');
  const coupons = [
    { couponName: '有効クーポン', couponEndDate: '2026-07-11T00:00:00+09:00', discountType: '2', discountFactor: '10', issueCount: '100', getCount: '90', availCount: '80' },
    { couponName: '期限切れクーポン', couponEndDate: '2026-07-01T00:00:00+09:00', discountType: '1', discountFactor: '500' },
  ];
  const out = s.summarizeCoupons_(coupons, now);
  assert.equal(out.length, 1);
  assert.match(out[0], /有効クーポン/);
  assert.doesNotMatch(out.join('\n'), /期限切れクーポン/);
  assert.match(out[0], /残り3日/);
  assert.match(out[0], /10%OFF/);
  assert.match(out[0], /発行100・取得90・利用80/);
});

test('summarizeCoupons_: 有効なクーポンが0件なら「有効なクーポンが1件もありません」', () => {
  const s = ctx();
  const out = s.summarizeCoupons_([], new Date());
  assert.deepEqual(Array.from(out), ['有効なクーポンが1件もありません。']);
});

test('summarizeCoupons_: 件数フィールドが欠損している場合は「不明」と表示する', () => {
  const s = ctx();
  const out = s.summarizeCoupons_([
    { couponName: 'X', couponEndDate: new Date(Date.now() + 86400000).toISOString(), discountType: '2', discountFactor: '5' },
  ], new Date());
  assert.match(out[0], /発行不明・取得不明・利用不明/);
});

// ================= collectItems_ / 在庫API 2.1 (variants単位) =================

test('fetchVariantQuantity_: manageNumber/variantId単位のURLをGETで呼びquantityを返す', () => {
  const s = ctx();
  let capturedUrl = null, capturedOpts = null;
  s.UrlFetchApp = {
    fetch: (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return fakeJsonRes(200, { quantity: 7 });
    },
  };
  const qty = s.fetchVariantQuantity_('M001', 'SKU1');
  assert.equal(qty, 7);
  assert.match(capturedUrl, /\/es\/2\.1\/inventories\/manage-numbers\/M001\/variants\/SKU1$/);
  assert.equal(capturedOpts.method, 'get');
});

test('determineStockStatuses_: 全バリアントが0なら在庫ゼロ(out)', () => {
  const s = ctx();
  const items = [{ item: { manageNumber: 'A', variants: { s1: {}, s2: {} } } }];
  const fetchQty = () => 0;
  const result = s.determineStockStatuses_(items, fetchQty, { count: 0, cap: 200, capped: false });
  assert.equal(result.A, 'out');
});

test('determineStockStatuses_: 1つでも在庫ありなら在庫あり(in)', () => {
  const s = ctx();
  const items = [{ item: { manageNumber: 'A', variants: { s1: {}, s2: {} } } }];
  let call = 0;
  const fetchQty = () => (call++ === 0 ? 0 : 5);
  const result = s.determineStockStatuses_(items, fetchQty, { count: 0, cap: 200, capped: false });
  assert.equal(result.A, 'in');
});

test('determineStockStatuses_: variantsが無い商品はAPIを呼ばずunknown', () => {
  const s = ctx();
  const items = [{ item: { manageNumber: 'A' } }];
  const fetchQty = () => { throw new Error('呼ばれないはず'); };
  const result = s.determineStockStatuses_(items, fetchQty, { count: 0, cap: 200, capped: false });
  assert.equal(result.A, 'unknown');
});

test('determineStockStatuses_: 全バリアントが404/403相当の例外ならunknown（クラッシュしない）', () => {
  const s = ctx();
  const items = [{ item: { manageNumber: 'A', variants: { s1: {}, s2: {} } } }];
  const fetchQty = () => { throw new Error('HTTP 404 ...'); };
  const result = s.determineStockStatuses_(items, fetchQty, { count: 0, cap: 200, capped: false });
  assert.equal(result.A, 'unknown');
});

test('determineStockStatuses_: 200SKU上限に達したら以降のバリアントは呼ばずunknown、capped=trueになる', () => {
  const s = ctx();
  const items = [{ item: { manageNumber: 'A', variants: { s1: {}, s2: {} } } }];
  const capState = { count: 200, cap: 200, capped: false };
  let calls = 0;
  const fetchQty = () => { calls++; return 5; };
  const result = s.determineStockStatuses_(items, fetchQty, capState);
  assert.equal(calls, 0, '上限到達後は在庫APIを呼ばないこと');
  assert.equal(result.A, 'unknown');
  assert.equal(capState.capped, true);
});

test('determineStockStatuses_: 上限は複数商品にまたがって共有される', () => {
  const s = ctx();
  const items = [
    { item: { manageNumber: 'A', variants: { s1: {}, s2: {} } } }, // 2バリアント消費
    { item: { manageNumber: 'B', variants: { s3: {} } } },        // 残り1のみ許可
  ];
  const capState = { count: 199, cap: 200, capped: false };
  let calls = 0;
  const fetchQty = () => { calls++; return 3; };
  s.determineStockStatuses_(items, fetchQty, capState);
  assert.equal(calls, 1, '上限199+1=200までしか呼ばれないこと');
  assert.equal(capState.capped, true);
});

// ---------- aggregateItemStats_ ----------
test('aggregateItemStats_: stockStatusが"out"ならnoStock、"unknown"ならstockUnknown、"in"はどちらも増えない', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const items = [
    { item: { manageNumber: 'A001', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
    { item: { manageNumber: 'A002', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
    { item: { manageNumber: 'A003', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
  ];
  s.aggregateItemStats_(items, stats, [], { A001: 'out', A002: 'in', A003: 'unknown' });
  assert.equal(stats.total, 3);
  assert.equal(stats.noStock, 1);
  assert.equal(stats.stockUnknown, 1);
});

test('aggregateItemStats_: stockStatusByManageNumberがnullなら全件stockUnknown（誤検知防止）', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const items = [
    { item: { manageNumber: 'B001', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
  ];
  s.aggregateItemStats_(items, stats, [], null);
  assert.equal(stats.noStock, 0, '在庫状況不明の場合、在庫ゼロと誤判定してはならない');
  assert.equal(stats.stockUnknown, 1);
});

test('aggregateItemStats_: 説明文短い・画像なし・非公開・薬機法リスク語の検出は従来通り', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '効果があります'];
  const items = [
    { item: { manageNumber: 'A001', productDescription: { pc: '短い説明' }, images: [], hideItem: false } },
    { item: { manageNumber: 'A002', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }], hideItem: true } },
    { item: { manageNumber: 'A003', productDescription: { pc: 'この商品は治ることが期待できます' + 'x'.repeat(100) }, images: [{ url: 'a' }], hideItem: false } },
  ];
  s.aggregateItemStats_(items, stats, RISK, { A001: 'in', A002: 'in', A003: 'in' });
  assert.equal(stats.shortDesc, 1);
  assert.equal(stats.noImage, 1);
  assert.equal(stats.hidden, 1);
  assert.equal(stats.riskWords.length, 1);
  assert.match(stats.riskWords[0], /A003/);
});

// ---------- collectItems_: 統合 ----------
test('collectItems_: 通常時は在庫ゼロ/在庫不明が報告に含まれ、200SKU注記は出ない', () => {
  const s = ctx();
  s.UrlFetchApp = {
    fetch: (url) => {
      if (url.includes('/items/search')) {
        return fakeJsonRes(200, {
          results: [{ item: { manageNumber: 'I1', variants: { s1: {} }, productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }],
        });
      }
      if (url.includes('/inventories/')) {
        return fakeJsonRes(200, { quantity: 0 });
      }
      throw new Error('unexpected url: ' + url);
    },
  };
  const out = s.collectItems_();
  assert.match(out, /在庫ゼロ: 1件/);
  assert.doesNotMatch(out, /200SKUまで/);
});

test('collectItems_: 在庫APIが404を返すSKUは在庫不明として除外される', () => {
  const s = ctx();
  s.UrlFetchApp = {
    fetch: (url) => {
      if (url.includes('/items/search')) {
        return fakeJsonRes(200, {
          results: [{ item: { manageNumber: 'I1', variants: { s1: {} }, productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }],
        });
      }
      if (url.includes('/inventories/')) {
        return fakeRes(404, 'not found');
      }
      throw new Error('unexpected url: ' + url);
    },
  };
  const out = s.collectItems_();
  assert.match(out, /在庫不明: 1件/);
  assert.match(out, /在庫ゼロ: 0件/);
});

test('collectItems_: 200SKUを超える場合はサンプリング注記が出力される', () => {
  const s = ctx();
  // 1商品に201バリアント→上限200を超える
  const variants = {};
  for (let i = 0; i < 201; i++) variants['s' + i] = {};
  s.UrlFetchApp = {
    fetch: (url) => {
      if (url.includes('/items/search')) {
        return fakeJsonRes(200, {
          results: [{ item: { manageNumber: 'I1', variants: variants, productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }],
        });
      }
      if (url.includes('/inventories/')) {
        return fakeJsonRes(200, { quantity: 5 });
      }
      throw new Error('unexpected url: ' + url);
    },
  };
  const out = s.collectItems_();
  assert.match(out, /200SKUまでサンプリング/);
});

// ---------- 全コレクター共通: 本日の日付 ----------
test('collectItems_/collectSeo_の出力も「# 本日の日付（JST）」で始まる', () => {
  const s = ctx({ GSC_SITE_URL: 'sc-domain:example.jp' });
  s.UrlFetchApp = { fetch: () => fakeJsonRes(200, { results: [], rows: [] }) };
  const datePattern = /^# 本日の日付（JST）: \d{4}-\d{2}-\d{2}/;
  assert.match(s.collectSeo_(), datePattern);
  assert.match(s.collectItems_(), datePattern);
});

// ---------- formatSeoComparison_ (変更なし・回帰確認) ----------
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
