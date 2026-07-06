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

// ---------- マーケティング部: クーポン状況 ----------
function collectMarket_() {
  const url = CONF.RMS_BASE + '/es/2.0/coupon/search?couponStatus=ACTIVE&hits=30';
  let lines = ['# 本日のクーポン状況（RMS CouponAPI）'];
  try {
    const data = jsonFetch_(url, { headers: { Authorization: rmsAuthHeader_() } });
    const coupons = (data.couponList || data.coupons || []);
    if (!coupons.length) {
      lines.push('有効なクーポンが1件もありません。');
    } else {
      const now = new Date();
      coupons.forEach(function (c) {
        const cp = c.coupon || c;
        const end = cp.couponEndDate ? new Date(cp.couponEndDate) : null;
        const daysLeft = end ? Math.ceil((end - now) / 86400000) : null;
        lines.push('- ' + (cp.couponName || cp.couponCode) +
          ' / 割引: ' + (cp.discountFactor || cp.discountType || '不明') +
          ' / 残り' + (daysLeft === null ? '?' : daysLeft) + '日' +
          ' / 利用数: ' + (cp.usedCount != null ? cp.usedCount : '不明'));
      });
    }
  } catch (e) {
    lines.push('（CouponAPI取得エラー: ' + e.message + '）');
  }
  lines.push('');
  lines.push('# 今日の日付: ' + Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd (E)'));
  lines.push('楽天イベントのカレンダーはあなたの知識で補完し、直近イベントへの対応状況を推定してください。');
  return lines.join('\n');
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

  let lines = ['# Search Console 直近7日 vs 前週（上位クエリ）'];
  try {
    const cur = query(start7, end);
    const prev = query(prevStart, prevEnd);
    const prevMap = {};
    prev.forEach(function (r) { prevMap[r.keys[0]] = r; });
    cur.forEach(function (r) {
      const q = r.keys[0];
      const p = prevMap[q];
      lines.push('- 「' + q + '」 クリック' + r.clicks + '（前週' + (p ? p.clicks : 0) + '）' +
        ' 表示' + r.impressions + ' CTR' + (r.ctr * 100).toFixed(1) + '% 順位' + r.position.toFixed(1));
    });
    if (!cur.length) lines.push('データなし（サイトURL設定を確認）');
  } catch (e) {
    lines.push('（GSC取得エラー: ' + e.message + '）');
  }
  return lines.join('\n');
}

// ---------- 商品管理部: 全商品スキャン ----------
function collectItems_() {
  let lines = ['# 商品スキャン結果（RMS ItemAPI 2.0）'];
  const stats = { total: 0, noStock: 0, shortDesc: 0, noImage: 0, hidden: 0, riskWords: [] };
  const RISK = ['治る', '治す', '効能', '効果があります', '医薬', 'アンチエイジング', '痩せる'];
  let cursor = null, pages = 0;

  try {
    do {
      let url = CONF.RMS_BASE + '/es/2.0/items/search?hits=100' + (cursor ? '&cursorMark=' + encodeURIComponent(cursor) : '');
      const data = jsonFetch_(url, { headers: { Authorization: rmsAuthHeader_() } });
      (data.results || []).forEach(function (r) {
        const it = r.item || r;
        stats.total++;
        const inv = it.variants ? Object.keys(it.variants).some(function (k) {
          return (it.variants[k].normalDeliveryQuantity || 0) > 0;
        }) : true;
        if (!inv) stats.noStock++;
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
      cursor = data.nextCursorMark && data.results && data.results.length ? data.nextCursorMark : null;
      pages++;
    } while (cursor && pages < 20); // 最大2000商品

    lines.push('総商品数: ' + stats.total + '（スキャン' + pages + 'ページ）');
    lines.push('在庫ゼロ: ' + stats.noStock + '件 / 説明文100字未満: ' + stats.shortDesc + '件 / 画像なし: ' + stats.noImage + '件 / 非公開: ' + stats.hidden + '件');
    lines.push('薬機法リスク語検出: ' + (stats.riskWords.length ? stats.riskWords.join(', ') : 'なし'));
  } catch (e) {
    lines.push('（ItemAPI取得エラー: ' + e.message + '）');
  }
  return lines.join('\n');
}
