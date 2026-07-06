# DEPT-OPS — AI部署運営システム

各部署（AIエージェント）が毎朝、自社ECの運営状況を調査・報告・提案し、
経営者は承認判断だけに集中するための仕組み。

- スタック: GAS + Google Sheets + GitHub Pages + Claude API
- 第1弾部署: マーケティング部（RMSクーポン）/ SEO室（Search Console＋前回提案検証）/ 商品管理部（ItemAPI全スキャン）
- 通知: 報告=Chatwork（朝会形式）/ 承認=LINE WORKS（HMAC署名リンク、72h期限）

## 構成

```
docs/
  00_指示_まず読む.md      ← Claude Code 夜間自律実行用のマスター指示書
  01_要件定義.md
  acceptance_criteria.md   ← 全PASSで完成（Definition of Done）
  SETUP_手順.md            ← 人間の作業（約30分）
  DECISIONS.md             ← 自律実行中の判断ログ（要判断事項を含む）
  TEST_RESULTS.md          ← 受け入れ基準を1項目ずつ検証した結果
gas/                       ← Apps Script 一式（7ファイル）
dashboard/index.html       ← GitHub Pages ダッシュボード
tests/                     ← Node上の自動ユニットテスト（gas/*.jsを実ファイルのままvmでロード）
package.json               ← `npm test` で54件のテストを実行
```

## 使い方（2通り）

**A. すぐ動かす**: docs/SETUP_手順.md に従って手動セットアップ（コードは完成済み）

**B. Claude Codeに仕上げさせる（夜間自律実行）**:
```bash
cd dept-ops
claude --dangerously-skip-permissions
> docs/00_指示_まず読む.md を読んで、タスクリストを完了まで実行してください
```
テスト全PASS・TEST_RESULTS.md 生成・PR作成まで無人で走ります。

## テストの実行

```bash
npm install
npm test
```

gas/*.js の中から副作用のない関数（JSON応答パース・HMAC署名・Chatwork本文組み立て・
LINE WORKS JWT組み立て・承認リンクの検証ロジック・ダッシュボード用データ整形など）を
Node.jsの `vm` 上に実ファイルのままロードし、`node:test` で検証している
（54件、GASの実行環境無しで再現できる自動テスト）。
実際のRMS/Anthropic/Chatwork/LINE WORKS/Search Consoleとの通信が必要なテストと、
ブラウザでの見た目確認（375px幅）は docs/TEST_RESULTS.md に手動確認手順を記載している。

## セキュリティ

認証情報・接続先URL（GAS Script ID、WebアプリURL、各種APIキー等）はコードに直書きせず、
GAS側は Script Properties、ダッシュボード側は `dashboard/config.js`（`.gitignore` 対象、
`dashboard/config.sample.js` をコピーして使う）で管理する（非公開）。セットアップ手順は
docs/SETUP_手順.md を参照。
