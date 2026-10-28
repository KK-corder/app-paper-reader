# 設計判断の記録

あとから「なぜこうなっているか」を、別のセッションや別のエージェントが再検討せずに済むように残す。
書くのは、選択肢があって1つに決めたことだけ（実装の細部は書かない）。新しいものを上に追記する。

書き方:

```
## YYYY-MM-DD <決めたこと>
- 決定: 
- 理由: 
- 却下した案: （あれば、なぜ却下したか）
- 決めた人: ユーザー / Claude（ユーザー確認済み）
```

---

## 2026-10-28 今日の一本の PDF の名前は Mac が決め、アプリは papers.json の `pdf_name` を使う
- 決定: アプリが `survey/` に入れる PDF の名前は、Mac（WorkSpace）が `insert_to_notion.py` の `sanitize_filename(題).pdf` で計算して `feed[].pdf_name` に入れる。アプリは名前を作らず、同名が `survey/` にあればアップロードしない
- 理由: Notion に登録するときに名前が変わると、`papers.json` の `pdf.name` とずれて開けなくなる。規則を 2 か所に書くとずれるので、正を Mac 側の 1 か所にする
- 却下した案: アプリが同じ規則を JavaScript で持つ（規則が変わったときに追いつかない）
- 決めた人: Claude（要件 §2.2「細かい規則は Dev と WorkSpace で合わせる」の範囲内）

## 2026-10-28 フィードの論文は `papers` に混ぜず `feed` に分け、PDF を入れた・見送ったは `_reader/feed_log.json` に書く
- 決定: `papers.json` の今の形は変えず `feed` を足す（`today` はもう使わない）。アプリは `reading_log.json` とは別の `feed_log.json` に追記する。書き込みのスコープは `drive.readonly` と `drive.file` のまま
- 理由: フィードの論文は Notion のページ ID を持たないので、`papers` の `id` の約束に乗らない。`reading_log.json` を変えると Mac の反映処理（`apply_reading_log.py`）も変える必要がある
- 決めた人: Claude（形）・ユーザー（2026-10-28: 7 日の表示は PDF を入れた日だけを数える・メモ欄は次のブリーフ・Mac 側は依頼書を書いて WorkSpace で）

## 2026-10-24 読了はドライブの reading_log.json に追記し、Mac が Notion に戻す
- 決定: アプリは `drive.file` を足して `survey/_reader/reading_log.json` に追記だけする。Mac（WorkSpace）が 30 分ごとに読んで Notion の Read Status を書き換え、papers.json を書き出し直す。押した時刻が papers.json の `generated` より新しい間は、端末の値で表示を上書きする
- 理由: Notion のキーを iPhone に置かない（要件 §3）。`drive.file` ならアプリが作ったファイルしか書けず、PDF や papers.json を壊せない
- 却下した案: `drive`（全部書ける。広すぎる）／Notion を iPhone から直接呼ぶ（キーを置くことになる）
- 決めた人: Claude（本人の依頼「読了ボタンと Notion への同期」の範囲内の方式の選択）

## 2026-10-24 ログインはリダイレクトとポップアップの 2 方式を持ち、設定で切り替える
- 決定: 既定は同じ画面のリダイレクト（OAuth 2.0 のトークンを URL のフラグメントで受け取る）。Google Identity Services のポップアップも選べるようにする
- 理由: iPhone のホーム画面版から Google のログインへ移ると、Safari の別画面に渡されて戻ってこない報告がある（iOS の版で違い、実機でしか分からない）。どちらも駄目なときは Safari のタブで使える
- 却下した案: ポップアップだけ（ホーム画面版で戻らない報告が多い）／サーバーを置いてリフレッシュトークンを持つ（要件 §7 でサーバーを置かない）
- 決めた人: Claude（要件 §3 の範囲内の方式の選択）

## 2026-10-24 PDF は pdf.js を同梱して描画する
- 決定: `pdfjs-dist@4.10.38` の legacy の build を `vendor/pdfjs/` に置く。CDN は使わない
- 理由: iPhone の Safari の標準の PDF 表示は、画面の半分に置くと 1 ページ目しか出ず、PDF だけのピンチ拡大もできない。同梱なら段階2のオフラインにもそのまま使える
- 却下した案: CDN から読む（電波が無いと開けない）／Safari の標準表示（左右分割で使えない）
- 決めた人: ユーザー（2026-10-24「同梱してよい」）

## 2026-10-24 データは Google ドライブの papers.json と survey の PDF を Drive API で読む
- 決定: 要件 §3 のとおり。PWA は `drive.readonly` だけを使い、サーバーを置かない
- 理由: 外でも読みたい（本人 2026-10-24）。Notion のキーを iPhone に置かない
- 決めた人: ユーザー（要件 §6-1）
