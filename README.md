# Anonymed Copilot

医療文書の匿名化を支援するデスクトップアプリケーション。Gemini APIを活用したAIアシスタントが、個人情報の検出と置換をサポートします。

![Tauri](https://img.shields.io/badge/Tauri-2.0-blue)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Rust](https://img.shields.io/badge/Rust-1.70+-orange)

## 特徴

- **AI匿名化**: Gemini 2.5 Flash APIによる高精度な個人情報検出
- **Diff表示**: 変更前後を並べて確認できるエディタ
- **コンテキストチャット**: 文書についてAIに相談可能
- **一括処理**: フォルダ配下のファイルをまとめて匿名化
- **セキュア**: 元テキストのメモリゼロ化による安全な処理

## スクリーンショット

<!-- TODO: Add screenshot -->

## セットアップ

### 前提条件

- Node.js 18+
- Rust 1.70+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### インストール

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp src-tauri/.env.example src-tauri/.env
# .env に GOOGLE_API_KEY と ANONYMED_HMAC_KEY を設定
```

### 開発サーバー起動

```bash
npm run tauri dev
```

### ビルド

```bash
npm run tauri build
```

## 使い方

1. **ファイル/フォルダを開く**: 左サイドバーからファイルまたはフォルダを選択
2. **AI相談**: 右サイドバーのチャットで「どこを匿名化すべき？」などと質問
3. **匿名化実行**: 「Run Anonymization」ボタンをクリック
4. **確認・適用**: Diffエディタで変更を確認し、「Apply Changes」で確定
5. **一括処理**: チャットで「全件に適用して」と送信 → 実行で `anonymized_outputs` に出力

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | React 19, TypeScript, Tailwind CSS, Monaco Editor |
| Backend | Rust, Tauri 2.0 |
| AI | Google Gemini 2.5 Flash API |

## プロジェクト構造

```
src/                    # React Frontend
├── components/layout/  # UI Components (MainLayout, EditorPanel, etc.)
└── lib/               # Utilities

src-tauri/             # Rust Backend
├── src/commands/      # Tauri Commands (anonymizer, audit, batch)
├── src/infrastructure/# External APIs (GeminiHandler)
└── src/domain/        # Domain Models
```

## ライセンス

MIT License
