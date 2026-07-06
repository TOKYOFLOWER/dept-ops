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
gas/                       ← Apps Script 一式（7ファイル）
dashboard/index.html       ← GitHub Pages ダッシュボード
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

CONFIDENTIAL — 株式会社東京フラワー / 株式会社GSD 社内用
