/**
 * 通知: 報告=Chatwork / 承認=LINE WORKS
 */

// ---------- Chatwork: 朝会形式の一括報告 ----------
function sendChatworkReport_(results) {
  const today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  let body = '[info][title]🏢 朝の部署報告 ' + today + '[/title]';
  results.forEach(function (r) {
    const icon = r.result.status === 'green' ? '🟢' : '🟡';
    body += icon + ' ' + r.deptName + '：' + r.result.headline + '\n' + r.result.report + '\n';
    r.result.proposals.forEach(function (p) {
      body += '　💡 ' + p.title + (p.needs_decision ? '（要承認→LINE WORKSへ送信済）' : '') + '\n';
    });
    body += '[hr]';
  });
  body += 'ダッシュボード: ' + (PropertiesService.getScriptProperties().getProperty('DASHBOARD_URL') || '(未設定)') + '[/info]';

  UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + prop_('CHATWORK_ROOM_ID') + '/messages', {
    method: 'post',
    headers: { 'X-ChatWorkToken': prop_('CHATWORK_TOKEN') },
    payload: { body: body },
    muteHttpExceptions: true,
  });
}

// ---------- LINE WORKS: Service Account JWT ----------
function lwAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('lw_token');
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=+$/, '');
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: prop_('LW_CLIENT_ID'),
    sub: prop_('LW_SERVICE_ACCOUNT'),
    iat: now,
    exp: now + 3600,
  })).replace(/=+$/, '');
  const key = prop_('LW_PRIVATE_KEY').replace(/\\n/g, '\n');
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(header + '.' + claim, key)
  ).replace(/=+$/, '');
  const jwt = header + '.' + claim + '.' + sig;

  const data = jsonFetch_('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'post',
    payload: {
      assertion: jwt,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: prop_('LW_CLIENT_ID'),
      client_secret: prop_('LW_CLIENT_SECRET'),
      scope: 'bot',
    },
  });
  cache.put('lw_token', data.access_token, 3000);
  return data.access_token;
}

function sendLwApprovalRequest_(approvalId, deptName, proposal) {
  const webUrl = prop_('WEBAPP_URL'); // GAS WebアプリURL
  const exp = Date.now() + CONF.APPROVAL_TTL_HOURS * 3600000;
  function link(action) {
    const payload = approvalId + ':' + action + ':' + exp;
    return webUrl + '?action=' + action + '&id=' + encodeURIComponent(approvalId) +
      '&exp=' + exp + '&sig=' + hmacSign_(payload);
  }
  const text = [
    '📋 承認依頼【' + deptName + '】',
    '■ ' + proposal.title,
    proposal.detail,
    '',
    '✅ 承認: ' + link('approve'),
    '❌ 却下: ' + link('reject'),
    '（有効期限 ' + CONF.APPROVAL_TTL_HOURS + '時間）',
  ].join('\n');

  UrlFetchApp.fetch(
    'https://www.worksapis.com/v1.0/bots/' + prop_('LW_BOT_ID') + '/channels/' + prop_('LW_CHANNEL_ID') + '/messages',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + lwAccessToken_() },
      payload: JSON.stringify({ content: { type: 'text', text: text } }),
      muteHttpExceptions: true,
    }
  );
}

/** C3用ドライラン: トークン取得だけ試す */
function test_lwToken() {
  console.log('LW token OK: ' + lwAccessToken_().slice(0, 12) + '...');
}
