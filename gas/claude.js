/**
 * Claude API 呼び出し
 * 役割プロンプト + 今日のデータ + 前回報告 → 構造化JSON
 */
function askClaude_(rolePrompt, todayData, prevReport, model) {
  const userMsg = [
    '## 今日のデータ',
    todayData,
    '',
    '## 前回のあなたの報告',
    prevReport || '（初回のため前回報告なし）',
  ].join('\n');

  const payload = {
    model: model || CONF.DEFAULT_MODEL,
    max_tokens: 1500,
    system: rolePrompt,
    messages: [{ role: 'user', content: userMsg }],
  };

  function call() {
    const data = jsonFetch_('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': prop_('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify(payload),
    });
    const text = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('\n');
    return parseReportJson_(text);
  }

  try {
    return call();
  } catch (e1) {
    log_('WARN', 'Claude呼び出し/パース失敗、リトライ: ' + e1.message);
    try {
      return call();
    } catch (e2) {
      log_('ERROR', 'Claudeリトライも失敗: ' + e2.message);
      return {
        status: 'yellow',
        headline: 'AI応答エラー（要確認）',
        report: 'Claude APIの応答を解析できませんでした。実行ログを確認してください。エラー: ' + e2.message,
        proposals: [],
        needs_decision: false,
      };
    }
  }
}

/** コードフェンス除去 + キー補完つきJSONパース */
function parseReportJson_(text) {
  let t = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  // 前後に余計な文があってもJSON部分を抽出
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('JSONが見つかりません: ' + t.slice(0, 120));
  const obj = JSON.parse(t.slice(s, e + 1));

  return {
    status: obj.status === 'yellow' ? 'yellow' : 'green',
    headline: String(obj.headline || '報告').slice(0, 40),
    report: String(obj.report || ''),
    proposals: Array.isArray(obj.proposals) ? obj.proposals.map(function (p) {
      return {
        title: String((p && p.title) || '提案'),
        detail: String((p && p.detail) || ''),
        needs_decision: !!(p && p.needs_decision),
      };
    }) : [],
    needs_decision: !!obj.needs_decision,
  };
}
