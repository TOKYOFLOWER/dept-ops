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
