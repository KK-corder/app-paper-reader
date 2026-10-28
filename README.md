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
データは Mac が毎朝 Google ドライブに書き出す `survey/_reader/papers.json` と、`survey/` の PDF を、本人の Google アカウントで Drive API から読む。PDF の追加と読了・フィードの記録だけを書き込む。サーバーは置かない。
要件は `/Users/kakeru/Dev/_system/docs/20261024-論文リーダー要件.md`。段階2で今日の一本と PDF を入れる流れを追加。

## 使い方

iPhone の Safari で https://kk-corder.github.io/app-paper-reader/ を開き、共有 →「ホーム画面に追加」。ホーム画面のアイコンから開いて「Google でログイン」。ログインから戻ってこられないときは、設定でログインの方式を変えるか、Safari のタブのまま使う。

架空の論文のデモ: https://kk-corder.github.io/app-paper-reader/?demo=1

ローカルで開くとき:

```bash
cd ~/Dev/4_アプリ && python3 -m http.server 8080   # http://localhost:8080/PaperReader/?demo=1
```

### 朝の合図（iPhone のショートカット）

iPhone で一度だけ設定します。

1. 「ショートカット」→「オートメーション」→ 新規 →「時刻」を選びます。
2. 好きな時刻・毎日を選び、「すぐに実行」にします。
3. アクション「通知を表示」を追加します。本文例:「今日の一本が届いています」。

通知を押しても論文リーダーは開きません。読みたいタイミングで、ホーム画面の論文リーダーから開いてください。

### 今日の一本に PDF を入れる

「PDF を取ってくる」で開いたページから Safari でダウンロードし、「PDF を入れる」でファイルを選びます。指定された名前で Google ドライブの `survey/` に保存し、その場で読めます。同名のファイルがある場合は、それを開きます。保存できない場合は、画面の案内に従って「ファイル」から移してください。

デモでは Drive に書き込みません。選んだ PDF は開いている間だけ表示し、再読み込み後は同梱の架空 PDF に戻ります。「読む」・見送り・PDF を入れた日の記録は端末に残ります。

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
