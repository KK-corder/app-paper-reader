# ブリーフ置き場

Codex に渡す実装ブリーフを置く。1タスク＝1ファイル。

- 命名: `<YYYYMMDD>-<slug>.md`（バグ修正は `<YYYYMMDD>-fix-<slug>.md`）
- テンプレート: `/Users/kakeru/Dev/_system/templates/brief-feature.md` / `brief-bugfix.md` / `brief-experiment.md` / `brief-atelier.md`（使い分けは `/Users/kakeru/Dev/_system/templates/README.md`）
- 書いたらコミットし、Dev の `TODO.md`「Codex の実行順」に並べる（`$next` は未コミットの変更があるプロジェクトを飛ばす）
