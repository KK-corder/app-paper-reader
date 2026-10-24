# ブリーフ: 読了の端末での上書きを「papers.json が追いつくまで」残す

> 種別: 機能の変更（公開済みの読了ボタンの挙動）。Claude が作成し Codex に渡す実装仕様。

- **プロジェクト**: `/Users/kakeru/Dev/4_アプリ/PaperReader`
- **出典**: WorkSpace 側から 2026-10-24 の伝言（Mac の反映処理 `apply_reading_log.py`・launchd `com.kakeru.paper-reader-sync` を作り、本物の 1 件で確認済み）。取り決めの正は `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー-読了の同期要件.md` §3（今回 Claude が追記した）。元のブリーフ `docs/briefs/20261024-02-read-button.md`
- **委任設定**: effort=`medium` / model=既定

## 目的

読了ボタンを押したあと、Mac が Notion に戻して papers.json を書き出し直すまでの間、一覧と画面の表示が「未読」に戻らないようにする。

## 今の問題

`js/reading.mjs` の `paper()` は、押した時刻（`at`）が papers.json の `generated` 以前になったら端末の上書きを消す。次の場合に、Notion に反映される前に表示が古い値へ戻る:

- 押した直後に、毎朝 7:50 の書き出しが Mac の反映（30 分ごと）より先に走った
- 通信がなく、記録がまだドライブに送れていない（未送信）間に、新しい papers.json が来た

## 作るもの（WHAT）

端末の上書きを消してよいのは、次のどちらかのときだけにする。

1. **papers.json の `read_status` が、端末の上書きと同じ値になった**（Mac が追いついた）
2. その記録が**送信済み**で、かつ papers.json の `generated` が押した時刻より **24 時間以上**あと（本人が Notion を直接書き換えたなどで、永久に一致しない場合の逃げ道）

- 未送信の記録が残っている論文の上書きは、どんなに新しい papers.json が来ても消さない
- 「送信済みかどうか」は、送り直しの待ち行列（`pending`）に同じ論文・同じ `at` の記録が残っているかで判断してよい
- デモは今のまま（端末の状態を保ち続ける）

## 不可侵（壊してはいけないもの）

- `reading_log.json` の形と書き方（要件 §3）。特に、**行は `at` が増える順に足す**（Mac は反映済みの一番新しい `at` より前の行を見ない）。今の `lastAt` で単調に増やす仕組みを変えない
- `at` に `+09:00` を付ける今の書き方
- 読了ボタン・送り直し・絞り込み・段階1の受け入れ条件
- `localStorage` のキー `paper-reader-v1` と、すでに保存されている上書き・待ち行列（読めるまま）
- `fetch` は普通の関数として呼ぶ

## 制約

- 依存: 追加なし
- Service Worker を変えたらキャッシュ名を上げる（今 `paper-reader-shell-v4`）
- 範囲外: 「読中」など「未読」「読了」以外の値をボタンで扱うこと／複数の端末（Safari のタブとホーム画面版）の間で記録の順番をそろえること

## 受け入れ条件（これが観測できたら完了）

- [ ] `node --test tests/` が通る。少なくとも次を確かめる:
  - 押して送信済み・`generated` が押した時刻より新しいが papers.json はまだ「未読」→ 表示は「読了」のまま
  - 同じ状態で papers.json が「読了」になった → 上書きが消え、papers.json の値で表示される（保存からも消える）
  - 未送信のまま、`generated` が押した時刻より 2 日新しい papers.json が来て値が違う → 表示は端末の値のまま
  - 送信済みで、`generated` が押した時刻より 24 時間以上新しく、値が違う → 上書きを消し、papers.json の値を出す
  - 読了 → 未読に戻すを続けて押したとき、papers.json が途中の「読了」になっても、表示は最後に押した「未読」のまま（最後の上書きと比べる）
- [ ] 既存のテストがすべて通る。`git diff --check` が通る

## 検証方法

```bash
cd /Users/kakeru/Dev/4_アプリ/PaperReader
node --test tests/
for f in $(git ls-files '*.js' '*.mjs' | grep -v '^vendor/'); do node --check "$f"; done
git diff --check
```

Codex はブラウザを起動しない。

## 参考

- `js/reading.mjs`（`paper()`・`record()`・`send()`）、`tests/reading.test.mjs`
