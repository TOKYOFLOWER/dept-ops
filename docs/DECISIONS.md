# DECISIONS（開発エージェントによる判断ログ）

自律実行中に人間の確認なしで進めた判断と、その理由をここに記録する。
異論があれば該当箇所を書き換えて再実行してよい。

## 1. ファイル名の文字化け修正（要判断ではないが記録）

docs/ 配下の3ファイル（00_指示_まず読む.md / 01_要件定義.md / SETUP_手順.md）が
リポジトリ上でファイル名の文字化け（Shift_JIS↔UTF-8のダブルエンコード相当の破損）を
起こしていた。中身は正しいUTF-8だったため、ファイル名のみ正しい日本語名にリネームした。
中身の内容は一切変更していない。

## 2. gitリポジトリの初期化

作業開始時点でこのディレクトリはgitリポジトリではなかった（README.mdやdocsが
「PR作成」を前提にしているため）。`git init` してベースラインをコミットし、
以降タスクごとにコミットを積む方針にした。
リモート（GitHub等）は設定されていないため、タスク10では実際のPR発行はできず、
ローカルの完成した履歴をもって代替する（[[decision-pr-remote]]参照）。

## 3. テスト方式: clasp run を使わず、Node上のvmサンドボックスで自動テストを実施（要判断ではないが記録）

ユーザー指示により `clasp run` は使用禁止、GASエディタでの手動実行が必要なテストは
手順と期待結果を docs/TEST_RESULTS.md に書くことになっている。
一方で「テストで自己検証し、全PASSするまで反復する」という指示もあるため、
実際に自動実行できるテストは可能な限り自動化する方針とした。

具体的には、gas/*.js のコードのうち **GASのビルトインAPI（Utilities / SpreadsheetApp等）に
依存しない純粋関数** を抽出し、Node.jsの `vm` モジュールで実ファイルをそのままロードし、
Utilities.computeHmacSha256Signature 等を Node標準の `crypto` で再実装したスタブに差し替えて
`node:test` で検証した（tests/ 配下、`npm test` で実行、54件全PASS）。
HMAC-SHA256とRSA-SHA256（LINE WORKS JWT）はNode標準cryptoの計算結果と突き合わせて
アルゴリズムそのものの正しさもクロス検証している。

この方針のため、gas/*.js 側にはテスト専用コードを増やさず、代わりに以下の**副作用のない
関数を抽出するリファクタリング**を行った（本番の呼び出し経路の挙動は変えていない）:
- collectors.js: summarizeCoupons_ / formatSeoComparison_ / aggregateItemStats_
- claude.js: parseReportJson_（既存のまま。副作用なしだったため抽出不要）
- notify.js: buildChatworkBody_ / buildLwJwtHeaderClaim_
- config.js: hmacSignWithSecret_（hmacSign_はこれを呼ぶだけに変更）
- webapi.js: verifyApprovalLink_ / decideApprovalRow_ / mapDeptRows_ / mapHistoryRows_ /
  pickLatestByDept_ / mapApprovalRows_

実際の外部API呼び出し（RMS / Anthropic / Chatwork / LINE WORKS本番トークン交換 /
Search Console）は本物の認証情報がないと検証できないため、これらは
docs/TEST_RESULTS.md に手動実行手順と期待結果を記載し、人間が本番のScript Propertiesを
設定した後にGASエディタで実行して確認する運用とした。

## 4. webapi.js の XSS修正（仕様にない防御的修正）

コードレビュー中に、承認リンクの `id` パラメータ（利用者が自由に指定できるURLクエリ値）が
`htmlOut_` の生成するHTMLにエスケープなしで埋め込まれる箇所を発見した
（存在しない提案IDへのアクセス時のメッセージ、doGetの汎用エラーメッセージ）。
acceptance_criteria.md には直接の項目はないが、システムプロンプトの
「セキュリティ脆弱性を作り込まない」という原則と、そもそも要件定義書7章の
セキュリティ方針（改ざん・使い回し防止）の精神に反すると判断し、`escHtml_` を追加して
該当箇所をすべてエスケープした。tests/webapi.test.mjs にXSS回帰テストを追加済み。

## 5. SETUP_手順.md の完全性は文書レビューでの確認にとどまる（要判断）

acceptance_criteria.md の G1「SETUP_手順.mdの手順だけで、新しいGASプロジェクトから
動作状態まで到達できる（手順の抜けがない）」について、手順を読み直して抜けていた
記述（ファイル数の誤記、GASエディタでの具体的な操作手順、GitHub Pagesが未存在の場合の
代替手順など）を補ったが、**実際に人間がゼロから手順通りに操作して完走できるかは
未検証（仮説）**。理由: 本エージェントはGASエディタのUIを操作できず、実在の
Script Properties（RMS/Anthropic/Chatwork/LINE WORKS等の認証情報）も持たないため。
人間が一度通しで実施し、つまずいた箇所があればSETUP_手順.mdにフィードバックしてほしい。

## 6. E4（375px幅でのレイアウト崩れ確認）は自動化していない

dashboard/index.html のJSロジック（データ取得・カード生成・XSS安全性・エラー表示）は
jsdom上でNode自動テスト化した（tests/dashboard.test.mjs）が、jsdomはCSSレイアウト
エンジンを持たないため、実際の画面幅375pxでの視覚的な崩れの有無は判定できない。
docs/TEST_RESULTS.md に手動確認手順（ブラウザのモバイルエミュレーションで開く）を記載した。

## 7. タスク10「PR（またはブランチ）作成」について（要判断）

<a id="decision-pr-remote"></a>
このリポジトリにはGitHubなどのリモートが設定されていない。そのためGitHub上の
実際のプルリクエストは発行できない。ローカルの `master` ブランチに全タスクの
コミット履歴を積み上げる形で完成させ、リモートを追加してpushする判断は
人間に委ねる（GitHubリポジトリのURLが分かれば、`git remote add origin <URL> && git push -u origin master`
でそのままPRを作成できる状態にしてある）。

（追記: 後日 github.com/TOKYOFLOWER/dept-ops にリモートを追加し、PR #1を作成済み。
詳細は本ファイル末尾の追記日付の新しいセクションを参照。）

## 8. RMS 在庫API 2.1・CouponAPI 2.0のエンドポイント仕様は未検証（仮説）

`gas/collectors.js` の `fetchInventoryMap_`（在庫API 2.1想定、
`POST /es/2.1/inventories/manage-numbers/batch/get`）と `collectMarket_`
（CouponAPI 2.0をGET+クエリ文字列からPOST+JSONボディに変更）は、実際のRakuten RMS
APIドキュメントを直接参照して検証したものではなく、既存コードの他API呼び出しパターン
（ItemAPI 2.0・Search Console APIがPOST+JSONボディを使っていること）から類推した仮説実装である。
**理由**: 本エージェントは外部ドキュメントへのアクセスが制限されており、実環境のRMS認証情報も
持たないため、実際にAPIを呼んで検証することができない。**How to apply**: 実環境で403/404等の
エラーが出た場合は、まずこの2つの関数（`fetchInventoryMap_` / `collectMarket_`内のURL・
リクエスト形式）を実際のRMS APIドキュメントと突き合わせて修正すること。エラー時のフォールバック
（在庫API失敗時は「在庫不明」として異常カウントから除外／CouponAPI失敗時はHTTPコードと
試行URLを報告に含める）は、たとえエンドポイントの仮説が外れていても安全側に倒れる設計にしてある。

## 9. ダッシュボードの状況推移ドット列は「直近14日」を保証できない（既知の制約）

タスクAでは各部署カードに直近14日分の状況推移ドットを表示する仕様としたが、
`gas/webapi.js` の `mapHistoryRows_` は受け入れ基準E1で定義された「履歴30件」を
そのまま踏襲しており、これは**全部署合算**での上限である。3部署が毎日実行される運用では
1部署あたり実質10日分程度しか遡れない可能性が高い。
**理由**: E1は既存の合格基準であり、指示の対象外であるこの上限を無断で変更すると
既存の受け入れ基準の文言（「履歴30件」）と実装がずれるため、変更を見送った。
**How to apply**: 14日分の表示を確実にしたい場合は、E1の記述自体を「履歴50件」等に
更新したうえで `mapHistoryRows_` の `slice(-30)` を拡張する対応が必要。現状は
表示できる範囲でドットを描画し、データが無い日は単に表示しない（空白日を埋めない）
実装になっている。

## 10. approval_id付与のためorchestrator.jsを変更（Task Aの対象範囲を超える最小限の追加）

タスクAは「対象: dashboard/index.html」と指示されていたが、部署カードの「今日のアクション」で
提案ごとに承認状態（承認済み/承認待ち/却下）を出し分けるには、報告に保存された各提案が
どの承認キューIDに対応するかをダッシュボード側で判定できる必要がある。既存の実装では
報告履歴（REPORTS）の提案JSONと承認キュー（APPROVALS）の行は別々にIDなしで保存されており、
突き合わせる手段がなかった。
**理由**: dashboard/index.htmlだけの変更ではこの要件を満たせないと判断し、
`gas/orchestrator.js` に `attachApprovalIds_` を追加して、needs_decisionな提案にのみ
`approval_id` を事前付番し、報告履歴・承認キューの両方に同じIDで記録するようにした。
**How to apply**: この変更はA1-A3・C2の既存テストに影響しないことを確認済み（`npm test`で
回帰なし）。もし将来この設計が望ましくない場合は、`runDept_`内の`attachApprovalIds_`呼び出しを
削除し、ダッシュボード側はapproval_idが無い提案を常に「承認待ち」扱いにフォールバックさせる
（`dashboard/index.html`の`renderAction`は`p.approval_id`が無い場合でも安全に動作する設計にしてある）。
