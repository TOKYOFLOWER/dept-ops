# TEST_RESULTS（受け入れ基準 一項目ずつの検証結果）

自動テストは `npm install && npm test` で誰でも再実行できる（Node.js 20+）。
実行方法・実装の考え方は docs/DECISIONS.md の3を参照。

最終実行結果（2026-07-07時点）:

```
tests 54
suites 0
pass 54
fail 0
cancelled 0
skipped 0
todo 0
```

内訳: collectors 9 / claude(parseReportJson_・askClaude_) 10 / notify 8 /
setup(initSheets) 4 / orchestrator 5 / webapi 8 / dashboard(jsdom) 11 / E1統合 1 = 計54。
テストコードは tests/ 配下（`sandbox.mjs` が gas/*.js を実ファイルのままNodeの `vm` 上に
ロードし、GASビルトインを最小スタブに差し替える。詳細はdocs/DECISIONS.mdの3を参照）。

---

## A. オーケストレーター

- **A1** 有効=TRUEの部署だけが実行される（無効部署はスキップされログに残る）
  → **PASS（自動）** `tests/orchestrator.test.mjs` > "A1: 有効な部署だけがrunDept_される。無効部署はログにスキップ記録される"
- **A2** 1部署でエラーが起きても残りの部署は実行され、エラーは実行ログシートとChatworkに通知される
  → **PASS（自動）** 同ファイル > "A2: 1部署でエラーが起きても残りの部署は実行され、エラーがログとChatworkに反映される"
- **A3** 各部署の実行で「前回の報告履歴（最新1件）」がプロンプトに含まれる
  → **PASS（自動）** 同ファイル > "A3: 2回目の実行では前回報告(最新1件)がaskClaude_のprevReportに渡される" / "A3: 前回報告には最新1件のみが使われる"

## B. Claude応答

- **B1** 応答は必ずJSONにパースできる（```json フェンス付き応答でも成功する）
  → **PASS（自動）** `tests/claude.test.mjs` > "parseReportJson_: プレーンJSON" / "```json フェンス付きでもパース成功" / "前後に説明文があってもJSON部分を抽出できる"
- **B2** パース失敗時は1回リトライし、それでも失敗ならstatus=yellowの定型報告でフォールバック
  → **PASS（自動）** 同ファイル > "askClaude_: 1回目が壊れたJSON、2回目が正常 → リトライ成功" / "askClaude_: 2回とも失敗 → status=yellowの定型フォールバック" / "HTTPエラー応答でもリトライ経路に入りフォールバックする"
- **B3** JSONにstatus/headline/report/proposals/needs_decisionの全キーが揃う（欠損時はデフォルト補完）
  → **PASS（自動）** 同ファイル > "キー欠損時にデフォルト値で補完される" / "proposals内のneeds_decision欠損はfalse補完" / "statusが\"yellow\"以外の値は\"green\"に丸められる"

## C. 通知

- **C1** Chatwork報告は3部署分が1メッセージにまとまり、info/title記法で整形される
  → **PASS（自動）** `tests/notify.test.mjs` > "buildChatworkBody_: [info][title]記法で3部署分がまとまる"
- **C2** needs_decision=trueの提案がある場合のみLINE WORKSに承認依頼が送られる
  → **PASS（自動）** `tests/orchestrator.test.mjs` > "needs_decision=trueの提案のみ承認キューに登録されLINE WORKS送信が試みられる"（要承認の提案だけがsendLwApprovalRequest_に渡ることを確認。参考提案では呼ばれない）
- **C3** LINE WORKSのJWTが生成でき、アクセストークン取得→メッセージ送信が成功する（ドライラン関数あり）
  → **一部PASS（自動）+ 要手動確認**
  - 自動: `tests/notify.test.mjs` > "buildLwJwtHeaderClaim_: header/claimのJSON構造が正しい" / "buildLwJwtHeaderClaim_ + RSA署名: 実際にRS256として検証可能なJWTが組み立てられる"（Node標準cryptoで生成した鍵ペアでRS256署名を検証し、header.claim.signature形式が正しいことを確認）
  - 手動（実際のLINE WORKSサーバーとの通信が必要なため）:
    1. Script Propertiesに実際のLW_*キーを設定した状態でGASエディタから `test_lwToken()` を実行
    2. 期待結果: 実行ログに `LW token OK: xxxxxxxxxxxx...` の形式でアクセストークンの先頭12文字が出力される（例外が投げられない）
    3. 続けて `runMorningCycle()` を実行し、needs_decision=trueの提案が1件以上ある状態でLINE WORKSのチャンネルに承認依頼メッセージが実際に届くことを目視確認

## D. 承認フロー

- **D1** 承認リンクのHMAC署名が不正な場合は403相当のエラーページを返す
  → **PASS（自動）** `tests/webapi.test.mjs` > "D1: HMAC署名が不正な場合は署名エラー(403)相当のページを返す"
- **D2** 発行から72時間を過ぎたリンクは「期限切れ」を表示し状態を変更しない
  → **PASS（自動）** 同ファイル > "D2: 発行から72時間相当を過ぎたリンクは期限切れになり状態は変更されない"
- **D3** 既にapproved/rejectedの提案に再アクセスしても状態が上書きされない
  → **PASS（自動）** 同ファイル > "D3/D4: pendingの提案を承認するとapproved+decided_atが記録され、再アクセスでは上書きされない"（同一リンクへの2回目のアクセスで「処理済み」表示・状態不変を確認）
- **D4** 承認/却下の結果が承認キューシートにdecided_at付きで記録される
  → **PASS（自動）** 同上テスト内で decided_at が Date値として記録されることを確認

## E. ダッシュボード

- **E1** doGet(action=data)が最新報告・承認キュー・履歴30件を含むJSONを返す
  → **PASS（自動）** `tests/webapi.test.mjs` > "E1: mapDeptRows_/mapHistoryRows_/pickLatestByDept_/mapApprovalRows_が正しく集計される" / "buildDashboardData_: 3シートを統合したJSONを返す" / `tests/dashboard.test.mjs` > "fetch成功時はGAS応答のJSONがそのまま描画に使われる"
- **E2** 3部署のカードに信号色・headline・報告・提案が表示される
  → **PASS（自動・jsdom）** `tests/dashboard.test.mjs` > "モックデータで3部署分のカードが描画される" / "yellowステータスの部署カードにはyellowクラスと要確認表示が付く" / "提案(needs_decision)には「要承認」バッジが表示される"
- **E3** 部署を選ぶと過去の報告履歴を遡って読める
  → **PASS（自動・jsdom）** 同ファイル > "履歴を見るボタンで該当部署の履歴が表示される" / "履歴が0件のときは「履歴がまだありません」と表示される"
- **E4** スマホ幅(375px)でレイアウトが崩れない
  → **要手動確認**（jsdomはCSSレイアウトを計算しないため自動化不可。docs/DECISIONS.mdの6参照）
  1. dashboard/index.html をブラウザで開く（`GAS_URL=""` のままならモックデータで表示される）
  2. Chrome DevToolsのデバイスツールバーで幅375px（iPhone SE相当）に設定
  3. 期待結果: 横スクロールが発生しない。3部署カードが縦積みになり、木札部分（縦書き部署名）とカード本文が横に並んだまま崩れない。ヘッダーの承認待ちバッジが折り返されても他要素と重ならない
- **E5** データ取得失敗時にエラーメッセージと再読込ボタンが表示される
  → **PASS（自動・jsdom）** `tests/dashboard.test.mjs` > "fetch失敗時にエラーメッセージと再読込ボタンが表示される" / "fetchが非OKレスポンスの場合もエラー表示になる"

## F. セキュリティ

- **F1** リポジトリ全体をgrepしてAPIキー・トークン・秘密鍵の直書きがゼロ
  → **PASS（自動確認済み）** 実行コマンドと結果:
    ```
    grep -rEn "sk-ant-|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |)PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]+" \
      --include="*.js" --include="*.mjs" --include="*.html" --include="*.json" --include="*.md" .
    ```
    → マッチ0件（node_modules除く）。コード中の秘密情報はすべて `prop_('KEY_NAME')` / `PropertiesService` 経由の参照のみで、値の直書きは存在しない。
  補足: tests/notify.test.mjs のHMAC/JWTテストで使う `'unit-test-hmac-secret'` 等の文字列は
  ユニットテスト専用のダミー値であり、実運用の認証情報ではない。
- **F2** Script Propertiesの必要キー一覧がSETUP_手順.mdに過不足なく記載されている
  → **PASS（コードレビューで確認）** gas/*.js 内の `prop_('KEY_NAME')` 呼び出しをすべて洗い出し
    （RMS_SERVICE_SECRET, RMS_LICENSE_KEY, ANTHROPIC_API_KEY, GSC_SITE_URL, CHATWORK_TOKEN,
    CHATWORK_ROOM_ID, LW_CLIENT_ID, LW_CLIENT_SECRET, LW_SERVICE_ACCOUNT, LW_PRIVATE_KEY,
    LW_BOT_ID, LW_CHANNEL_ID, HMAC_SECRET, WEBAPP_URL, DASHBOARD_URL の15キー）、
    docs/SETUP_手順.md の一覧と1:1で一致することを確認済み。

## G. セットアップ再現性

- **G1** SETUP_手順.mdの手順だけで、新しいGASプロジェクトから動作状態まで到達できる（手順の抜けがない）
  → **文書レビューでPASS（要人手での最終確認）**。GASエディタでの具体的な操作手順・
    ファイル数の誤記・GitHub Pagesが未存在の場合の代替手順を補い、抜けを解消したが、
    実際に人間が手を動かして完走できるかまでは未検証。詳細はdocs/DECISIONS.mdの5参照。
- **G2** setup.gsのinitSheets()実行で4シート＋ヘッダー＋部署定義3行が自動生成される
  → **PASS（自動）** `tests/setup.test.mjs` 全4件（4シート作成／ヘッダー一致／3部署が有効=trueで登録／再実行しても重複しない冪等性）

---

## 実データでの1サイクル確認（要件定義書9章 Definition of Done）

「実データでの1サイクル（収集→報告→CW通知→LW承認リンク→ダッシュボード表示）が通ること」は
本物のRMS/Anthropic/Chatwork/LINE WORKSの認証情報と実際のネットワーク通信が必要なため、
本エージェントでは実行できない（Script Propertiesを持たず、`clasp run` も使用不可のため）。
docs/SETUP_手順.md の「5. 動作確認 → 本稼働」の手順どおりに人間が実施することで検証できる。
期待結果:
1. `test_runMarketOnly()` 実行後、報告履歴シートにmarketの行が1行追加される
2. `runMorningCycle()` 実行後、Chatworkに朝会報告メッセージが1件届く
3. needs_decision=trueの提案がある場合、LINE WORKSに承認依頼が届く
4. 承認リンクをタップすると承認キューシートが更新され、再タップでは変化しない
5. ダッシュボードURLを開くと最新の報告がカードとして表示される
