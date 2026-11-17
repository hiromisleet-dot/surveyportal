# surveyportal

アンケート回答状況の見える化システムの画面です。GitHub Pagesで公開し、裏側の処理はGoogle Apps Script（GAS）のウェブアプリが担当します。

| ファイル | 中身 |
| --- | --- |
| `index.html` | 回答する人の画面 |
| `admin.html` | 作る人の画面（合言葉で入る） |
| `assets/common.css` / `assets/common.js` | 2つの画面で共通の見た目と道具 |
| `assets/config.js` | GASのウェブアプリのURL |
| `gas/API.gs` | GASに足す窓口（doPost）。画面からの呼び出しを受ける |

## 動かし方

1. 本体GASに `gas/API.gs` の中身を「API」というファイルで足し、デプロイを新しいバージョンに更新する。アクセスできるユーザーは「全員」のまま。
2. `assets/config.js` の `GAS_URL` に、ウェブアプリのURL（/exec で終わる）を入れる。
3. GitHubの Settings → Pages で、ブランチ `main` のルートを公開する。

公開後のURL：

- 回答する人：`https://<ユーザー名>.github.io/surveyportal/`
- 作る人：`https://<ユーザー名>.github.io/surveyportal/admin.html`

## 注意

- このリポジトリは公開されています。合言葉や連携キーなどの秘密は書かないでください（合言葉はNotionの設定ページにあります）。
- 画面を直したら、このリポジトリに上げるだけで反映されます。GASの処理を直したときは、GAS側のデプロイの更新が必要です。
- 納品のときは、リポジトリをお客さんのGitHubアカウントへ Transfer し、`GAS_URL` をお客さんの管理用アカウントのGASに書き換えます。
