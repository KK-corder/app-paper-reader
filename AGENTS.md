# PaperReader

iPhone で PDF と要約を並べて論文を読む PWA

Dev 共通ルール: `/Users/kakeru/Dev/_system/rules/agent_management.md`・`collaboration.md`（Claude はリード、Codex は実装）
Claude は `_system/rules/claude.md`、Codex は `_system/rules/codex.md` も読む。
作業開始時に `README.md`・`_TODO.md`・`docs/decisions.md` を読む。

## このプロジェクトのルール

- 依存の追加は、ブリーフに明記されたものだけ。今あるのは `vendor/pdfjs/`（`pdfjs-dist@4.10.38` の legacy の build）だけで、中身を書き換えない。
- Google ドライブで書いてよいのは、`survey/_reader/reading_log.json` と `survey/_reader/feed_log.json` の追記、本人が選んだ PDF を `survey/` の直下に新しく作ること（`feed[].pdf_name` の名前で、同名が無いときだけ）だけ（スコープは `drive.readonly` と `drive.file`）。ほかのファイルは読むだけ。`reading_log.json` の形は `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー-読了の同期要件.md` §3、`feed_log.json` の形は `/Users/kakeru/Dev/_system/docs/20261028-論文リーダー-フィード書き出し要件.md` §3 が正（2026-10-28 本人と決定）。
- 本人の論文の中身・要約・PDF・`papers.json`・本人のメモを、リポジトリに入れない（公開リポジトリになる予定）。デモのデータは作り物だけ。
- Notion の API を呼ばない。Notion のキーを扱わない（Mac の WorkSpace 側だけが持つ）。
- `papers.json` の形は要件 `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー要件.md` §4 が正。`feed` は `/Users/kakeru/Dev/_system/docs/20261028-論文リーダー-フィード書き出し要件.md` §2 が正。形を変えたいときは実装を止めて報告する（書き出しは WorkSpace 側が作る）。
- 端末への保存は `localStorage` のキー `paper-reader-v1` だけ。キーの名前を変えない。
- Service Worker はアプリの殻だけをキャッシュし、Google のドメインへの通信をキャッシュしない。変えたら `sw.js` のキャッシュ名を上げる。
- push（= GitHub Pages への公開）は本人の確認を取ってから行う。

## 検証方法

1. `node --test tests/`
2. `vendor/` 以外の JS に `node --check`
3. `git diff --check`
4. `python3 -m http.server 8080`（`Dev/4_アプリ` で起動）→ `http://localhost:8080/PaperReader/?demo=1` で、横長 844×390・縦長 390×844 の両方を操作する（画面の確認は Claude。Codex はブラウザを起動しない）
5. 本番の Drive とログインは、iPhone の実機で本人が確かめる
