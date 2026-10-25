# PaperReader TODO

最終更新: 2026-10-24

書き方: 1項目＝1つの具体的な行動（何を・どこで・どこまでやれば完了か）。期限があれば日付を入れる。
完了したら削除せず `- [x] ~~項目~~ → 結果` にする。Codex に委任する項目には、ブリーフのパスを添える。

## 🔴 次にやる

- [x] ~~要件を決める~~ → `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー要件.md`（WorkSpace 側の Claude が 10/24 に書いた）
- [x] ~~段階1を Codex に作らせてレビューする（`docs/briefs/20261024-01-stage1-reader.md`）~~ → 2026-10-24 修正なしで通過（テスト 21 件。デモで横長 844×390・縦長のスクロール・ドラッグ・ピンチ・ページの記憶・BibTeX のコピーを Chrome で確認。報告 `docs/reports/20261024-stage1.md`）

## 🟡 そのあと

- [x] ~~（本人）Google Cloud に OAuth のクライアント（ウェブ）を 1 つ作り、クライアント ID を Claude に渡す（手順 `~/Dev/.claude/skills/mobile-pwa/references/google-oauth.md`）。承認済みのリダイレクト URI は `https://kk-corder.github.io/app-paper-reader/` と `…/index.html` の両方（ログイン後の戻り先が開いた URL のままのため）~~ → 2026-10-24 受け取り、`config.js` に入れた
- [x] ~~（本人に確かめてから Claude）GitHub に `app-paper-reader` を作って Pages で公開し、`config.js` にクライアント ID を入れる~~ → 2026-10-24 公開（https://kk-corder.github.io/app-paper-reader/）。公開先でデモと PDF の表示を Chrome で確認
- [x] ~~（WorkSpace 側）Notion の論文 DB を `survey/_reader/papers.json` に書き出すスクリプトを作る（依頼 `~/Dev/_system/docs/20261024-論文リーダー-書き出し要件.md`）~~ → 2026-10-24 WorkSpace が作った（毎朝 7:50）。Claude が中身を点検: 121 本・項目と型の欠けなし・PDF と drive_id が全部ディスクの実物と一致・アプリの読み込みで落ちない
- [x] ~~（本人）iPhone で一覧と論文を開く~~ → 10/24 本人「予想以上にいいかんじ」。Safari の fetch の呼び方のバグを直した（`fc1be99`）。新しい論文を一番上から・文字を一回り小さく（10/24）
- [x] ~~読了ボタンを Codex に作らせてレビューする（`docs/briefs/20261024-02-read-button.md`）~~ → 2026-10-24 修正なしで通過（テスト 36 件。デモの 844×390・390×844 で切り替え・基本情報・一覧の表示と並び・再読み込み後も残る・上の帯が重ならないを Chrome で確認）。1 回目は Codex の上限で止まり、解除後に再実行
- [x] ~~一覧の絞り込み（タグ・未読／読了）を Codex に作らせてレビューする（`docs/briefs/20261025-01-list-filters.md`）~~ → 2026-10-25 修正なしで通過（テスト 40 件。デモの 844×390・390×844 で、未読／読了・タグ 2 つの「かつ」・検索との組み合わせ・解除・再読み込み後も残る・読了にすると未読の一覧から消えるを確認）
- [ ] （本人）Google Cloud の「データアクセス」に `.../auth/drive.file` を足し、iPhone でログインし直す（読了ボタンができてから）
- [x] ~~（WorkSpace 側）reading_log.json を読んで Notion の Read Status に戻すスクリプト~~ → 2026-10-24 WorkSpace が作った（`apply_reading_log.py`・30 分ごと）。本物の 1 件が Notion と papers.json に反映されたのを確認
- [x] ~~端末の上書きを papers.json が追いつくまで残すよう Codex に直させてレビューする（`docs/briefs/20261025-02-read-override-until-match.md`）~~ → 2026-10-25 修正なしで通過（テスト 44 件。未送信の間・値が一致するまで・送信済みで 24 時間たったら、を確認）
- [x] ~~（本人）iPhone で 1 本「読了」→ Notion が「読了」になるか~~ → 10/25 Notion に反映（13:07。夜は Mac が眠っていて、朝は WorkSpace の処理が失敗していたので、Claude が手で動かした）
- [ ] （WorkSpace 側）反映処理がドライブのファイルを読めない（`Resource deadlock avoided`）・朝の書き出しが Notion の時間切れで落ちる、の 2 つを直す（10/25 本人に伝言を渡した）
- [ ] （本人）「未読に戻す」で Notion も「未読」に戻るかを、使うついでに確かめる
- [ ] （本人・書き出しができたら）iPhone のホーム画面版で、横持ちで PDF をスクロールしながら右の要約を読めるか・縦持ちで崩れないかを確かめる（段階1の完了の確かめ方）

## 🟢 いつか

- 本人が使ってみて不具合や要望があれば直す（10/25 本人「一旦完了。使ってみて不具合あったら言う」）

- 段階2（今日の一本・オフライン）・段階3（読んだボタン・メモ）。本人が段階1を数日使ってから

## 保留・判断待ち
