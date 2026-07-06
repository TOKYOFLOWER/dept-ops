# SETUP手順（人間の作業・約30分）

## 1. スプレッドシート＋GASプロジェクト

1. 新規スプレッドシート「DEPT-OPS」を作成 → 拡張機能 → Apps Script
2. gas/ 配下の5ファイル（config / setup / collectors / claude / notify / orchestrator / webapi）を貼り付け
3. appsscript.json を表示（プロジェクト設定 → マニフェスト表示ON）し、gas/appsscript.json の内容で置き換え
4. `initSheets()` を実行 → 4シートと部署定義3行が生成される
5. 初回実行時にGoogle認可（Search Console readonly を含む）を許可

## 2. Script Properties（プロジェクト設定 → スクリプトプロパティ）

| キー | 値 |
|------|-----|
| RMS_SERVICE_SECRET / RMS_LICENSE_KEY | 既存RMS自動化と同じ |
| ANTHROPIC_API_KEY | Claude APIキー |
| GSC_SITE_URL | 例: `sc-domain:tokyoflower.jp`（URLプレフィックスなら `https://...` 完全一致） |
| CHATWORK_TOKEN / CHATWORK_ROOM_ID | ai_companyと同じルームでOK |
| LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID / LW_CHANNEL_ID | 週次売上レポートの設定を流用（PRIVATE_KEYは改行を \n で1行化） |
| HMAC_SECRET | ランダムな長い文字列（例: `openssl rand -hex 32` の出力） |
| WEBAPP_URL | 手順3のデプロイ後に設定 |
| DASHBOARD_URL | 手順4の公開後に設定 |

## 3. Webアプリのデプロイ

1. デプロイ → 新しいデプロイ → 種類: ウェブアプリ
2. 実行ユーザー: 自分 / アクセス: 全員（匿名）
3. 発行されたURLを `WEBAPP_URL` に設定

## 4. ダッシュボード公開（GitHub Pages）

1. dashboard/index.html の `GAS_URL` に WEBAPP_URL を記入
2. 既存の GitHub Pages リポジトリに `dept-ops/index.html` として配置（buyer-badge や jinja と同じ流れ）
3. 公開URLを `DASHBOARD_URL` に設定（Chatwork報告の末尾リンクに使われる）

## 5. 動作確認 → 本稼働

1. `test_lwToken()` → LINE WORKSトークン取得OKを確認
2. `test_runMarketOnly()` → 1部署だけ実行してログとシートを確認
3. `runMorningCycle()` を手動実行 → Chatworkに朝会報告、要承認提案があればLINE WORKSに届く
4. 承認リンクをタップ → 承認キューが approved になることを確認
5. `installTrigger()` → 毎朝6時の自動実行が開始

## トラブルシューティング

- **GSCが「データなし」**: GSC_SITE_URL の形式（sc-domain: か URLプレフィックスか）とプロパティ所有権を確認
- **RMSが403**: serviceSecret:licenseKey の順序（この順で固定）とAPI利用申請状況を確認
- **LWが401**: PRIVATE_KEY の改行が `\n` として保存されているか確認
