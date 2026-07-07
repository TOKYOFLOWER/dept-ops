# SETUP手順（人間の作業・約30分）

この手順だけで、真っさらな状態から「DEPT-OPS」を動作状態まで持っていけます。
（開発側の自動テストは `npm test` で実行済み・全PASSです。詳細は docs/TEST_RESULTS.md 参照。この章は人間が行う本番セットアップの手順です。）

## 1. スプレッドシート＋GASプロジェクト

1. 新規スプレッドシート「DEPT-OPS」を作成 → メニュー「拡張機能」→「Apps Script」
2. Apps Scriptエディタで、gas/ 配下の7ファイル（config / setup / collectors / claude / notify / orchestrator / webapi）を1つずつ作成して貼り付ける
   - 左メニューの「ファイル」の＋ボタン →「スクリプト」→ ファイル名を拡張子なしで入力（例: `config`）すると `config.gs` が作られる
   - 最初から存在する `コード.gs` は削除するか、1つ目のファイル（config）としてリネームして使う
   - gas/*.js の中身をそのまま該当ファイルに貼り付ける（拡張子は.jsだが中身はGAS用JavaScriptなのでそのままコピペでよい）
   - 7ファイルすべて貼り終えたら Ctrl+S（または💾アイコン）で保存
3. マニフェストファイル（appsscript.json）を編集する
   - 左下の歯車アイコン「プロジェクトの設定」→「"appsscript.json" マニフェスト ファイルをエディタで表示する」にチェック
   - エディタに現れた `appsscript.json` の中身を gas/appsscript.json の内容で丸ごと置き換えて保存
4. 関数 `initSheets` を実行する
   - エディタ上部の関数選択プルダウンで `initSheets` を選ぶ → ▶実行
   - 初回は「承認が必要です」ダイアログが出るので、自分のGoogleアカウントで許可（Search Console readonly 含む・下記5）
   - 実行後、スプレッドシートに4シート（部署定義／報告履歴／承認キュー／実行ログ）と部署定義3行（market/seo/items）が生成されていることを確認
5. 初回実行時にGoogle認可（Search Console readonly を含む）を許可
   - 「詳細」→「（プロジェクト名）に移動」と進めば許可できる（Googleの「確認されていないアプリ」警告は自作スクリプトなので想定内）

## 2. Script Properties（プロジェクト設定 → スクリプトプロパティ）

左メニューの歯車アイコン「プロジェクトの設定」→ 一番下「スクリプト プロパティ」→「スクリプト プロパティを追加」で以下をすべて登録する。

| キー | 値 |
|------|-----|
| RMS_SERVICE_SECRET / RMS_LICENSE_KEY | 既存RMS自動化と同じ |
| ANTHROPIC_API_KEY | Claude APIキー |
| GSC_SITE_URL | 例: `sc-domain:tokyoflower.jp`（URLプレフィックスなら `https://...` 完全一致） |
| CHATWORK_TOKEN / CHATWORK_ROOM_ID | 通知に使う任意のChatworkルームのトークン・ルームID |
| LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID / LW_CHANNEL_ID | LINE WORKS Developer Consoleで発行したService Account情報（PRIVATE_KEYは改行を `\n` で1行化） |
| HMAC_SECRET | ランダムな長い文字列（例: `openssl rand -hex 32` の出力） |
| DATA_KEY | ダッシュボードの `action=data` 用アクセスキー。ランダムな文字列（例: `openssl rand -hex 16` の出力）。手順4で dashboard/config.js に同じ値を設定する |
| WEBAPP_URL | 手順3のデプロイ後に設定（それまでは未設定でOK） |
| DASHBOARD_URL | 手順4の公開後に設定（それまでは未設定でOK。未設定でもChatwork報告は「(未設定)」と表示されるだけで動作する） |

これで全16キー。過不足がないかは docs/acceptance_criteria.md の F2 でも確認できる。

## 3. Webアプリのデプロイ

1. 右上「デプロイ」→「新しいデプロイ」→ 種類の歯車アイコンで「ウェブアプリ」を選択
2. 実行ユーザー: 自分 / アクセスできるユーザー: 全員（匿名を含む）
3. 「デプロイ」をクリックし、発行された「ウェブアプリのURL」をコピー
4. 手順2の Script Properties に戻り、`WEBAPP_URL` にこのURLを設定
5. コードを修正した後にURLを変えずに更新したい場合は「デプロイを管理」→ 対象デプロイの✏️ →「バージョン: 新バージョン」→ デプロイ（URLは変わらない）

## 4. ダッシュボード公開（GitHub Pages）

1. `dashboard/config.sample.js` を `dashboard/config.js` としてコピーし、以下を設定する（`config.js` は `.gitignore` 対象なので、これを公開リポジトリにコミットしても中身は追跡されない。実際に配置するサーバー/リポジトリ側にだけこのファイルを置く）
   ```js
   window.DEPT_OPS_CONFIG = {
     gasUrl: "（手順3のWEBAPP_URL）",
     dataKey: "（Script Propertiesに設定したDATA_KEYと同じ値）",
   };
   ```
2. `dashboard/index.html` と `dashboard/config.js` の2ファイルを公開先に配置する
   - 既存の GitHub Pages リポジトリがある場合: 任意のサブディレクトリ（例: `dept-ops/`）にこの2ファイルを配置
   - 新規の場合: 新しいGitHubリポジトリを作成 → 2ファイルをリポジトリ直下（または任意のサブフォルダ）に置く → 「Settings」→「Pages」→ Branch を `main` / フォルダを `/ (root)` に設定して保存 → 数分後に公開URLが表示される
3. 公開URLを Script Properties の `DASHBOARD_URL` に設定（Chatwork報告の末尾リンクに使われる）

**注意**: `dashboard/config.js` にはWebアプリURLとアクセスキーが平文で入るため、この2つの値自体は
「知っていれば誰でも報告データを読める」性質のものになる。閲覧を限定したい場合は
DATA_KEYを長いランダム値にする、配置先リポジトリ/サイトを非公開にする、等で運用すること。

## 5. 動作確認 → 本稼働

1. `test_lwToken()` を実行 → 実行ログに「LW token OK: ...」と出ることを確認（LINE WORKSトークン取得OK）
2. `test_runMarketOnly()` を実行 → 実行完了後、報告履歴シートに market の行が追加され、実行ログにエラーがないことを確認
3. `runMorningCycle()` を手動実行 → Chatworkに朝会報告（3部署まとめ）が届き、needs_decision な提案があればLINE WORKSに承認依頼が届くことを確認
4. LINE WORKSに届いた承認/却下リンクをタップ → ブラウザに結果ページが表示され、承認キューシートの該当行が approved/rejected・decided_at付きになることを確認
5. 同じリンクをもう一度タップ →「処理済み」と表示され、状態が上書きされないことを確認（二重承認防止）
6. ダッシュボードの公開URLを開き、3部署のカードと承認待ちバッジが表示されることを確認。スマホでも開いて崩れないことを目視確認（375px相当。docs/TEST_RESULTS.md のE4手順を参照）
7. `installTrigger()` を実行 → 毎朝6時の自動実行（`runMorningCycle`）が設置される。トリガー一覧は左メニューの時計アイコンで確認できる

## トラブルシューティング

- **GSCが「データなし」**: GSC_SITE_URL の形式（sc-domain: か URLプレフィックスか）とプロパティ所有権（Search Consoleにそのアカウントが登録されているか）を確認
- **RMSが403**: serviceSecret:licenseKey の順序（この順で固定）とAPI利用申請状況を確認
- **LWが401**: PRIVATE_KEY の改行が `\n` として保存されているか確認（貼り付け時に実改行のままだとScript Propertiesが1行にまとめてしまうことがあるため、必ず `\n` エスケープ済みの1行文字列にする）
- **承認リンクが「署名エラー（403）」になる**: HMAC_SECRET を後から変更していないか確認（変更すると発行済みリンクは全て無効になる）
- **承認リンクが常に「期限切れ」になる**: サーバー（GAS）とリンク発行時刻のタイムゾーン・時計のずれではなく、`APPROVAL_TTL_HOURS`（72時間）を過ぎていないか、リンクをブラウザのキャッシュから古いものを開いていないかを確認
- **Chatworkに届かない**: CHATWORK_TOKEN / CHATWORK_ROOM_ID と、そのトークンがそのルームに投稿権限を持っているかを確認
- **ダッシュボードが「データを取得できませんでした」と出る**: dashboard/config.js の gasUrl が正しいデプロイURLになっているか、Webアプリのアクセス権限が「全員」になっているかを確認
- **ダッシュボードが「unauthorized」エラーになる**: dashboard/config.js の dataKey と Script Properties の DATA_KEY が完全に一致しているか確認
