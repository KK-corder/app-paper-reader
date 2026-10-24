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
- [ ] （本人・書き出しができたら）iPhone のホーム画面版で、横持ちで PDF をスクロールしながら右の要約を読めるか・縦持ちで崩れないかを確かめる（段階1の完了の確かめ方）

## 🟢 いつか

- 段階2（今日の一本・オフライン）・段階3（読んだボタン・メモ）。本人が段階1を数日使ってから

## 保留・判断待ち
