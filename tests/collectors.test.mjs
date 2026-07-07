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

function fakeRes(status, bodyObj) {
  return {
    getResponseCode: () => status,
    getContentText: () => JSON.stringify(bodyObj),
  };
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

// ---------- aggregateItemStats_: 在庫API連携版 ----------
test('aggregateItemStats_: inventoryMapありなら在庫ゼロ・在庫不明を区別する', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '効果があります'];
  const items = [
    { item: { manageNumber: 'A001', productDescription: { pc: '短い説明' }, images: [], hideItem: false } },
    { item: { manageNumber: 'A002', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }], hideItem: true } },
    { item: { manageNumber: 'A003', productDescription: { pc: 'この商品は治ることが期待できます' + 'x'.repeat(100) }, images: [{ url: 'a' }], hideItem: false } },
  ];
  const inventoryMap = { A001: 0, A002: 5 }; // A003は在庫API未回答→不明
  s.aggregateItemStats_(items, stats, RISK, inventoryMap);
  assert.equal(stats.total, 3);
  assert.equal(stats.noStock, 1); // A001のみ
  assert.equal(stats.stockUnknown, 1); // A003（マップに無い）
  assert.equal(stats.shortDesc, 1);
  assert.equal(stats.noImage, 1);
  assert.equal(stats.hidden, 1);
  assert.equal(stats.riskWords.length, 1);
  assert.match(stats.riskWords[0], /A003/);
  assert.match(stats.riskWords[0], /治る/);
});

test('aggregateItemStats_: inventoryMapがnull（在庫API権限なし）なら全件stockUnknownでnoStockは0のまま（誤検知防止）', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const items = [
    { item: { manageNumber: 'B001', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
    { item: { manageNumber: 'B002', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } },
  ];
  s.aggregateItemStats_(items, stats, [], null);
  assert.equal(stats.total, 2);
  assert.equal(stats.noStock, 0, '在庫API権限がない場合、在庫ゼロと誤判定してはならない');
  assert.equal(stats.stockUnknown, 2);
});

test('aggregateItemStats_: 複数ページ分の呼び出しでstatsが累積される（ページング相当）', () => {
  const s = ctx();
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const page1 = [{ item: { manageNumber: 'P1', images: [{ url: 'a' }], productDescription: { pc: 'x'.repeat(120) } } }];
  const page2 = [{ item: { manageNumber: 'P2', images: [{ url: 'a' }], productDescription: { pc: 'x'.repeat(120) } } }];
  s.aggregateItemStats_(page1, stats, [], { P1: 3 });
  s.aggregateItemStats_(page2, stats, [], { P2: 0 });
  assert.equal(stats.total, 2);
  assert.equal(stats.noStock, 1);
});

// ---------- fetchInventoryMap_ ----------
test('fetchInventoryMap_: manageNumberごとの在庫数マップを返す', () => {
  const s = ctx();
  s.UrlFetchApp = {
    fetch: (url, opts) => {
      assert.match(url, /\/inventories\//);
      const body = JSON.parse(opts.payload);
      assert.deepEqual(body.manageNumbers, ['X1', 'X2']);
      return fakeRes(200, { inventories: [{ manageNumber: 'X1', mergedQuantity: 5 }, { manageNumber: 'X2', mergedQuantity: 0 }] });
    },
  };
  const map = s.fetchInventoryMap_(['X1', 'X2']);
  assert.equal(map.X1, 5);
  assert.equal(map.X2, 0);
});

test('fetchInventoryMap_: 空配列を渡すとAPIを呼ばずに{}を返す', () => {
  const s = ctx();
  s.UrlFetchApp = { fetch: () => { throw new Error('呼ばれないはず'); } };
  assert.deepEqual({ ...s.fetchInventoryMap_([]) }, {});
});

// ---------- collectItems_: 統合（在庫API利用可否の両パターン） ----------
test('collectItems_: 在庫APIが正常な場合は在庫ゼロ件数が報告に含まれる', () => {
  const s = ctx();
  s.UrlFetchApp = {
    fetch: (url) => {
      if (url.includes('/items/search')) {
        return fakeRes(200, { results: [{ item: { manageNumber: 'I1', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }] });
      }
      if (url.includes('/inventories/')) {
        return fakeRes(200, { inventories: [{ manageNumber: 'I1', mergedQuantity: 0 }] });
      }
      throw new Error('unexpected url: ' + url);
    },
  };
  const out = s.collectItems_();
  assert.match(out, /在庫ゼロ: 1件/);
  assert.doesNotMatch(out, /在庫API.*利用できない/);
});

test('collectItems_: 在庫APIが403の場合は「在庫不明」として異常カウントから除外する', () => {
  const s = ctx();
  s.UrlFetchApp = {
    fetch: (url) => {
      if (url.includes('/items/search')) {
        return fakeRes(200, { results: [{ item: { manageNumber: 'I1', productDescription: { pc: 'x'.repeat(120) }, images: [{ url: 'a' }] } }] });
      }
      if (url.includes('/inventories/')) {
        return fakeRes(403, { error: 'forbidden' });
      }
      throw new Error('unexpected url: ' + url);
    },
  };
  const out = s.collectItems_();
  assert.match(out, /在庫API.*利用できないため/);
  assert.match(out, /在庫不明: 1件/);
  assert.doesNotMatch(out, /在庫ゼロ: \d+件/, '在庫API権限がない場合に在庫ゼロ件数を報告してはならない（誤検知防止）');
});

// ---------- collectMarket_: POST+JSONボディ・404時のURL/コード明示 ----------
test('collectMarket_: POSTでJSONボディを送信する', () => {
  const s = ctx();
  let capturedOpts = null;
  s.UrlFetchApp = {
    fetch: (url, opts) => {
      capturedOpts = opts;
      return fakeRes(200, { couponList: [] });
    },
  };
  s.collectMarket_();
  assert.equal(capturedOpts.method, 'post');
  const body = JSON.parse(capturedOpts.payload);
  assert.equal(body.couponStatus, 'ACTIVE');
});

test('collectMarket_: 404エラー時にレスポンスコードと試行URLが出力に含まれる', () => {
  const s = ctx();
  s.UrlFetchApp = { fetch: () => fakeRes(404, { message: 'not found' }) };
  const out = s.collectMarket_();
  assert.match(out, /404/);
  assert.match(out, /\/es\/2\.0\/coupon\/search/);
});

// ---------- 全コレクター共通: 出力冒頭に本日の日付（JST） ----------
test('全コレクターの出力が「# 本日の日付（JST）」で始まる', () => {
  const s = ctx({ GSC_SITE_URL: 'sc-domain:example.jp' });
  s.UrlFetchApp = { fetch: () => fakeRes(200, { couponList: [], results: [], rows: [] }) };
  const datePattern = /^# 本日の日付（JST）: \d{4}-\d{2}-\d{2}/;
  assert.match(s.collectMarket_(), datePattern);
  assert.match(s.collectSeo_(), datePattern);
  assert.match(s.collectItems_(), datePattern);
});
