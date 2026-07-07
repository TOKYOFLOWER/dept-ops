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
// 公式仕様: クーポンAPI 1.0（2.0は存在しない） GET https://api.rms.rakuten.co.jp/es/1.0/coupon/search
// パラメータ: couponName/couponCode/itemUrl/couponStartDate/couponEndDate/hits/page のみ（couponStatusは非対応）。
// レスポンスはXML（text/xml）。result > coupons > coupon を読む。
function collectMarket_() {
  const url = CONF.RMS_BASE + '/es/1.0/coupon/search?hits=30&page=1';
  let lines = [todayLine_(), '# 本日のクーポン状況（RMS CouponAPI 1.0）', '# 照会URL: ' + url];
  try {
    const xmlText = xmlFetch_(url, { method: 'get', headers: { Authorization: rmsAuthHeader_() } });
    const coupons = parseCouponXml_(xmlText);
    lines = lines.concat(summarizeCoupons_(coupons, new Date()));
  } catch (e) {
    // e.message には fetchText_ が付与したHTTPステータスコードと試行URLが含まれる（config.js参照）
    lines.push('（CouponAPI取得エラー: ' + e.message + '）');
  }
  lines.push('');
  lines.push('楽天イベントのカレンダーはあなたの知識で補完し、直近イベントへの対応状況を推定してください。');
  return lines.join('\n');
}

/** CouponAPI 1.0 のXML応答を { couponName, couponEndDate, discountType, discountFactor, issueCount, getCount, availCount } の配列にパースする */
function parseCouponXml_(xmlText) {
  const doc = XmlService.parse(xmlText);
  const root = doc.getRootElement();
  const couponsEl = root.getChild('coupons');
  const couponEls = couponsEl ? couponsEl.getChildren('coupon') : [];
  return couponEls.map(function (el) {
    return {
      couponName: el.getChildText('couponName'),
      couponEndDate: el.getChildText('couponEndDate'),
      discountType: el.getChildText('discountType'),
      discountFactor: el.getChildText('discountFactor'),
      issueCount: el.getChildText('issueCount'),
      getCount: el.getChildText('getCount'),
      availCount: el.getChildText('availCount'),
    };
  });
}

/** discountType(1:定額値引 2:定率 4:送料無料) を割引内容の文言に変換する */
function describeDiscount_(discountType, discountFactor) {
  const t = String(discountType);
  if (t === '1') return discountFactor + '円引き';
  if (t === '2') return discountFactor + '%OFF';
  if (t === '4') return '送料無料';
  return '不明(discountType=' + discountType + ')';
}

function fmtCount_(v) {
  return v == null || v === '' ? '不明' : v;
}

/**
 * クーポン一覧 → 報告用テキスト行（純粋関数。モックデータでテスト可能）
 * couponEndDate が現在時刻以降のものだけを有効クーポンとして扱う。
 */
function summarizeCoupons_(coupons, now) {
  const active = (coupons || []).filter(function (c) {
    const end = c.couponEndDate ? new Date(c.couponEndDate) : null;
    return end && !isNaN(end.getTime()) && end.getTime() >= now.getTime();
  });
  if (!active.length) return ['有効なクーポンが1件もありません。'];
  return active.map(function (c) {
    const end = new Date(c.couponEndDate);
    const daysLeft = Math.ceil((end - now) / 86400000);
    return '- ' + c.couponName + ' / ' + describeDiscount_(c.discountType, c.discountFactor) +
      ' / 残り' + daysLeft + '日' +
      ' / 発行' + fmtCount_(c.issueCount) + '・取得' + fmtCount_(c.getCount) + '・利用' + fmtCount_(c.availCount);
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
// 在庫の有無は ItemAPI 2.0 (items/search) には含まれないため、公式仕様の在庫API 2.1
// （inventories.variants.get: GET /es/2.1/inventories/manage-numbers/{manageNumber}/variants/{variantId}）
// でmanageNumber×variantId単位に取得する。実行時間対策として最大200バリアントで打ち切る。
var INVENTORY_VARIANT_CAP = 200;

function collectItems_() {
  let lines = [todayLine_(), '# 商品スキャン結果（RMS ItemAPI 2.0 + 在庫API 2.1）'];
  const stats = { total: 0, noStock: 0, stockUnknown: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '治す', '効能', '効果があります', '医薬', 'アンチエイジング', '痩せる'];
  let cursor = null, pages = 0;
  const capState = { count: 0, cap: INVENTORY_VARIANT_CAP, capped: false, firstFailureLogged: false };

  try {
    do {
      let url = CONF.RMS_BASE + '/es/2.0/items/search?hits=100' + (cursor ? '&cursorMark=' + encodeURIComponent(cursor) : '');
      const data = jsonFetch_(url, { headers: { Authorization: rmsAuthHeader_() } });
      const items = data.results || [];

      const stockStatus = determineStockStatuses_(items, fetchVariantQuantity_, capState);
      aggregateItemStats_(items, stats, RISK, stockStatus);

      cursor = data.nextCursorMark && items.length ? data.nextCursorMark : null;
      pages++;
    } while (cursor && pages < 20); // 最大2000商品

    lines.push('総商品数: ' + stats.total + '（スキャン' + pages + 'ページ）');
    lines.push('在庫ゼロ: ' + stats.noStock + '件 / 在庫不明: ' + stats.stockUnknown + '件 / 説明文100字未満: ' + stats.shortDesc + '件 / 画像なし: ' + stats.noImage + '件 / 非公開: ' + stats.hidden + '件');
    if (capState.capped) {
      lines.push('（在庫確認は200SKUまでサンプリングしています。それ以降の商品は在庫チェックを省略し「在庫不明」に計上しています）');
    }
    lines.push('薬機法リスク語検出: ' + (stats.riskWords.length ? stats.riskWords.join(', ') : 'なし'));
  } catch (e) {
    lines.push('（ItemAPI取得エラー: ' + e.message + '）');
  }
  return lines.join('\n');
}

/**
 * 在庫API 2.1: manageNumber×variantId 単位で在庫数(quantity)を取得する。
 * GET /es/2.1/inventories/manage-numbers/{manageNumber}/variants/{variantId}
 */
function fetchVariantQuantity_(manageNumber, variantId) {
  const url = CONF.RMS_BASE + '/es/2.1/inventories/manage-numbers/' +
    encodeURIComponent(manageNumber) + '/variants/' + encodeURIComponent(variantId);
  const data = jsonFetch_(url, { method: 'get', headers: { Authorization: rmsAuthHeader_() } });
  return data.quantity;
}

/**
 * 商品ごとの在庫状況（'in'|'out'|'unknown'）を、バリアントごとの在庫API呼び出しで判定する。
 * capState（{count, cap, capped, firstFailureLogged}）は複数ページ・複数商品にまたがって共有し、
 * 上限到達後は以降のバリアントを呼び出さず全て'unknown'扱いにする（実行時間対策）。
 * fetchQuantity(manageNumber, variantId) が投げた例外（404/403等）はそのSKUを在庫不明として扱う。
 * デバッグ支援として、最初の1件の失敗だけHTTPコード・レスポンス本文先頭200字・試行URLを
 * 実行ログ（log_）にWARNで残す（全件ログはノイズになるため2件目以降は記録しない）。
 */
function determineStockStatuses_(items, fetchQuantity, capState) {
  const result = {};
  (items || []).forEach(function (r) {
    const it = r.item || r;
    const variantIds = it.variants ? Object.keys(it.variants) : [];
    let anyKnown = false;
    let anyInStock = false;
    variantIds.forEach(function (vid) {
      if (capState.capped) return;
      if (capState.count >= capState.cap) { capState.capped = true; return; }
      capState.count++;
      try {
        const qty = fetchQuantity(it.manageNumber, vid);
        if (qty != null) {
          anyKnown = true;
          if (qty > 0) anyInStock = true;
        }
      } catch (e) {
        if (!capState.firstFailureLogged) {
          capState.firstFailureLogged = true;
          log_('WARN', '在庫API取得失敗（最初の1件のみ記録）: manageNumber=' + it.manageNumber +
            ' variantId=' + vid +
            ' HTTPコード=' + (e.httpCode != null ? e.httpCode : '不明') +
            ' 試行URL=' + (e.requestUrl || '不明') +
            ' レスポンス本文(先頭200字)=' + String(e.responseBody != null ? e.responseBody : e.message).slice(0, 200));
        }
        // このSKUは在庫不明として扱う（除外）。404/403以外の例外も同様に安全側へ倒す。
      }
    });
    result[it.manageNumber] = !anyKnown ? 'unknown' : (anyInStock ? 'in' : 'out');
  });
  return result;
}

/**
 * 商品ページ1件分の集計を stats に加算（純粋関数。モックデータでテスト可能）
 * stockStatusByManageNumber: { manageNumber: 'in'|'out'|'unknown' }
 */
function aggregateItemStats_(items, stats, RISK, stockStatusByManageNumber) {
  if (stats.stockUnknown == null) stats.stockUnknown = 0;
  (items || []).forEach(function (r) {
    const it = r.item || r;
    stats.total++;
    const status = stockStatusByManageNumber ? stockStatusByManageNumber[it.manageNumber] : 'unknown';
    if (status === 'out') stats.noStock++;
    else if (status !== 'in') stats.stockUnknown++;
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
