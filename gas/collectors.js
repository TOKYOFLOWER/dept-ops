/**
 * 部署ごとのデータコレクター
 * 返り値はClaudeに渡すテキスト（要点だけを整形。生JSONを全部渡さない＝トークン節約）
 */
function collectFor_(deptId) {
  switch (deptId) {
    case 'market': return collectMarket_();
    case 'seo': return collectSeo_();
    case 'items': return collectItems_();
    default: throw new Error('未知の部署ID: ' + deptId);
  }
}

/** 全コレクター共通：出力冒頭に付ける「本日の日付」行（時系列幻覚防止） */
function todayLine_() {
  return '# 本日の日付（JST）: ' + Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd (E)');
}

// ---------- マーケティング部: クーポン状況 ----------
// 仮説: CouponAPI 2.0 の検索はItemAPI 2.0と同様POST+JSONボディ形式（GET+クエリ文字列は404の原因になり得るため見直し）。
// 実際のRMS仕様が異なる場合はCONF.RMS_BASE以下のパス・メソッドをここで調整すること。
function collectMarket_() {
  const url = CONF.RMS_BASE + '/es/2.0/coupon/search';
  const requestBody = { couponStatus: 'ACTIVE', hits: 30 };
  let lines = [todayLine_(), '# 本日のクーポン状況（RMS CouponAPI 2.0）', '# 照会URL: ' + url];
  try {
    const data = jsonFetch_(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: rmsAuthHeader_() },
      payload: JSON.stringify(requestBody),
    });
    const coupons = (data.couponList || data.coupons || []);
    lines = lines.concat(summarizeCoupons_(coupons, new Date()));
  } catch (e) {
    // e.message には jsonFetch_ が付与したHTTPステータスコードと試行URLが含まれる（config.js参照）
    lines.push('（CouponAPI取得エラー: ' + e.message + '）');
    lines.push('（注記: 404の場合はAPIバージョン・パスの設定を見直してください）');
  }
  lines.push('');
  lines.push('楽天イベントのカレンダーはあなたの知識で補完し、直近イベントへの対応状況を推定してください。');
  return lines.join('\n');
}

/** クーポン一覧 → 報告用テキスト行（純粋関数。モックデータでテスト可能） */
function summarizeCoupons_(coupons, now) {
  if (!coupons || !coupons.length) return ['有効なクーポンが1件もありません。'];
  return coupons.map(function (c) {
    const cp = c.coupon || c;
    const end = cp.couponEndDate ? new Date(cp.couponEndDate) : null;
    const daysLeft = end ? Math.ceil((end - now) / 86400000) : null;
    return '- ' + (cp.couponName || cp.couponCode) +
      ' / 割引: ' + (cp.discountFactor || cp.discountType || '不明') +
      ' / 残り' + (daysLeft === null ? '?' : daysLeft) + '日' +
      ' / 利用数: ' + (cp.usedCount != null ? cp.usedCount : '不明');
  });
}

// ---------- SEO室: Search Console ----------
function collectSeo_() {
  const siteUrl = prop_('GSC_SITE_URL'); // 例: https://www.rakuten.co.jp/ 側は不可。自社ドメイン or sc-domain:tokyoflower.jp
  const end = new Date(Date.now() - 2 * 86400000); // GSCは2日遅れ
  const start7 = new Date(end.getTime() - 6 * 86400000);
  const prevEnd = new Date(start7.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - 6 * 86400000);

  function query(s, e) {
    const body = {
      startDate: Utilities.formatDate(s, 'JST', 'yyyy-MM-dd'),
      endDate: Utilities.formatDate(e, 'JST', 'yyyy-MM-dd'),
      dimensions: ['query'],
      rowLimit: 15,
    };
    return jsonFetch_(
      'https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify(body),
      }
    ).rows || [];
  }

  let lines = [todayLine_(), '# Search Console 直近7日 vs 前週（上位クエリ）'];
  try {
    const cur = query(start7, end);
    const prev = query(prevStart, prevEnd);
    lines = lines.concat(formatSeoComparison_(cur, prev));
  } catch (e) {
    lines.push('（GSC取得エラー: ' + e.message + '）');
  }
  return lines.join('\n');
}

/** 今週/前週の検索クエリ行を比較テキストに整形（純粋関数。モックデータでテスト可能） */
function formatSeoComparison_(curRows, prevRows) {
  const prevMap = {};
  (prevRows || []).forEach(function (r) { prevMap[r.keys[0]] = r; });
  const lines = (curRows || []).map(function (r) {
    const q = r.keys[0];
    const p = prevMap[q];
    return '- 「' + q + '」 クリック' + r.clicks + '（前週' + (p ? p.clicks : 0) + '）' +
      ' 表示' + r.impressions + ' CTR' + (r.ctr * 100).toFixed(1) + '% 順位' + r.position.toFixed(1);
  });
  if (!curRows || !curRows.length) lines.push('データなし（サイトURL設定を確認）');
  return lines;
}

// ---------- 商品管理部: 全商品スキャン ----------
// 在庫の有無は ItemAPI 2.0 (items/search) には含まれないため、在庫API 2.1 (inventories) から取得する。
// 在庫API権限がない環境では「在庫不明」として異常カウントから除外し、全件在庫ゼロ誤検知を防止する。
function collectItems_() {
  let lines = [todayLine_(), '# 商品スキャン結果（RMS ItemAPI 2.0 + 在庫API 2.1）'];
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '治す', '効能', '効果があります', '医薬', 'アンチエイジング', '痩せる'];
  let cursor = null, pages = 0;
  let inventoryOk = true;
  let inventoryErrorMessage = '';

  try {
    do {
      let url = CONF.RMS_BASE + '/es/2.0/items/search?hits=100' + (cursor ? '&cursorMark=' + encodeURIComponent(cursor) : '');
      const data = jsonFetch_(url, { headers: { Authorization: rmsAuthHeader_() } });
      const items = data.results || [];

      let inventoryMap = null;
      if (inventoryOk && items.length) {
        try {
          inventoryMap = fetchInventoryMap_(items.map(function (r) { return (r.item || r).manageNumber; }));
        } catch (e) {
          inventoryOk = false;
          inventoryErrorMessage = e.message;
        }
      }

      aggregateItemStats_(items, stats, RISK, inventoryOk ? inventoryMap : null);
      cursor = data.nextCursorMark && items.length ? data.nextCursorMark : null;
      pages++;
    } while (cursor && pages < 20); // 最大2000商品

    lines.push('総商品数: ' + stats.total + '（スキャン' + pages + 'ページ）');
    if (inventoryOk) {
      lines.push('在庫ゼロ: ' + stats.noStock + '件 / 在庫不明: ' + stats.stockUnknown + '件 / 説明文100字未満: ' + stats.shortDesc + '件 / 画像なし: ' + stats.noImage + '件 / 非公開: ' + stats.hidden + '件');
    } else {
      lines.push('（在庫API 2.1が利用できないため、在庫状況はすべて「在庫不明」として異常カウントから除外しています。詳細: ' + inventoryErrorMessage + '）');
      lines.push('在庫不明: ' + stats.stockUnknown + '件（在庫ゼロ件数は判定していません） / 説明文100字未満: ' + stats.shortDesc + '件 / 画像なし: ' + stats.noImage + '件 / 非公開: ' + stats.hidden + '件');
    }
    lines.push('薬機法リスク語検出: ' + (stats.riskWords.length ? stats.riskWords.join(', ') : 'なし'));
  } catch (e) {
    lines.push('（ItemAPI取得エラー: ' + e.message + '）');
  }
  return lines.join('\n');
}

/**
 * 在庫API 2.1（仮説: エンドポイント形式は要検証。実仕様が異なる場合はここを調整すること）
 * manageNumberの配列を渡し、{ manageNumber: 在庫数 } のマップを返す。
 */
function fetchInventoryMap_(manageNumbers) {
  const targets = (manageNumbers || []).filter(Boolean);
  if (!targets.length) return {};
  const url = CONF.RMS_BASE + '/es/2.1/inventories/manage-numbers/batch/get';
  const data = jsonFetch_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: rmsAuthHeader_() },
    payload: JSON.stringify({ manageNumbers: targets }),
  });
  const map = {};
  (data.inventories || data.results || []).forEach(function (inv) {
    const q = inv.mergedQuantity != null ? inv.mergedQuantity : (inv.quantity != null ? inv.quantity : null);
    map[inv.manageNumber] = q;
  });
  return map;
}

/**
 * 商品ページ1件分の集計を stats に加算（純粋関数。モックデータでテスト可能）
 * inventoryMap: { manageNumber: 在庫数 } を渡すと在庫ゼロ判定を行う。
 * null を渡すと在庫API権限なしとみなし、全件 stockUnknown に計上する（在庫ゼロの誤検知を防止）。
 */
function aggregateItemStats_(items, stats, RISK, inventoryMap) {
  if (stats.stockUnknown == null) stats.stockUnknown = 0;
  (items || []).forEach(function (r) {
    const it = r.item || r;
    stats.total++;
    if (inventoryMap) {
      const q = inventoryMap[it.manageNumber];
      if (q == null) stats.stockUnknown++;
      else if (q <= 0) stats.noStock++;
    } else {
      stats.stockUnknown++;
    }
    const desc = ((it.productDescription && (it.productDescription.pc || it.productDescription.sp)) || '');
    if (desc.length < 100) stats.shortDesc++;
    if (!(it.images && it.images.length)) stats.noImage++;
    if (it.hideItem) stats.hidden++;
    RISK.forEach(function (w) {
      if (desc.indexOf(w) >= 0 && stats.riskWords.length < 10) {
        stats.riskWords.push(it.manageNumber + ':「' + w + '」');
      }
    });
  });
  return stats;
}
