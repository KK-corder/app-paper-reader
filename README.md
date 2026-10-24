# PaperReader

iPhone で PDF と要約を並べて論文を読む PWA

| 項目 | 内容 |
|---|---|
| カテゴリ | アプリ |
| 状態 | 試作中 |
| 作る環境 | Mac（Dev） |
| 公開 | 公開（https://kk-corder.github.io/app-paper-reader/） |

<!-- 型の決まりは ~/Dev/_system/rules/repo_format.md §4。見出しの名前と順番を変えない -->

## 何か

本人が iPhone を横に持ち、左で論文の PDF を、右で要約と基本情報（Notion の論文 DB に載せているもの）を見ながら読むための PWA。App Store には出さず、Safari でホーム画面に追加して使う。
データは Mac が毎朝 Google ドライブに書き出す `survey/_reader/papers.json` と、`survey/` の PDF を、本人の Google アカウントで Drive API から読む（読むだけ）。サーバーは置かない。
要件は `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー要件.md`。今は段階1（読むだけ）。

## 使い方

iPhone の Safari で https://kk-corder.github.io/app-paper-reader/ を開き、共有 →「ホーム画面に追加」。ホーム画面のアイコンから開いて「Google でログイン」。ログインから戻ってこられないときは、設定でログインの方式を変えるか、Safari のタブのまま使う。

架空の論文のデモ: https://kk-corder.github.io/app-paper-reader/?demo=1

ローカルで開くとき:

```bash
cd ~/Dev/4_アプリ && python3 -m http.server 8080   # http://localhost:8080/PaperReader/?demo=1
```

## 構成

```text
AGENTS.md          プロジェクトのルール（両エージェント共通の正）
CLAUDE.md          Claude Code の入口（AGENTS.md を取り込む）
_TODO.md           タスクの状態
vendor/pdfjs/      PDF の表示（pdfjs-dist 4.10.38 の legacy の build。同梱）
docs/briefs/       Codex へ渡す実装ブリーフ
docs/decisions.md  設計判断の記録
```

## 開発と検証

ルールは `AGENTS.md`。

```bash
node --test tests/
git diff --check
```

## 状態と次の一手

- 2026-10-24 作成。段階1（読むだけ）をデモで確認し、GitHub Pages で公開。iPhone で使うには、WorkSpace 側の `papers.json` の書き出しが要る。細かい TODO は `_TODO.md`
