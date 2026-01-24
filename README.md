# Anonymed Copilot

医療文書の個人情報を安全に匿名化するデスクトップアプリケーションです。
AIが自動で個人情報を検出し、適切な形式に置き換えます。

![Tauri](https://img.shields.io/badge/Tauri-2.0-blue)
![React](https://img.shields.io/badge/React-19-61DAFB)
![License](https://img.shields.io/badge/License-Apache%202.0-green)

---

## 🚀 すぐに試す（初心者向け）

### 1. アプリをダウンロード

[GitHub Releases](https://github.com/hokkey621/Anonymed-Copilot/releases) から、お使いのOSに合わせたファイルをダウンロードしてください：

| OS | ファイル |
|----|----------|
| macOS | `Anonymed-Copilot_x.x.x_aarch64.dmg` または `.app` |
| Windows | `Anonymed-Copilot_x.x.x_x64-setup.exe` |

### 2. APIキーを取得（無料）

このアプリはGoogle Gemini APIを使用しています。無料で取得できます。

1. [Google AI Studio](https://aistudio.google.com/apikey) にアクセス
2. Googleアカウントでログイン
3. 「Get API key」→「Create API key」をクリック
4. 表示されたキーをコピー

> 💡 **無料枠について**: Gemini APIは無料枠が十分にあり、通常の利用であれば料金は発生しません。

### 3. アプリを起動

1. ダウンロードしたアプリを開く
2. 初回起動時にAPIキー入力画面が表示される
3. 取得したキーを貼り付けて「保存して開始」

### 4. 使い方

1. **ファイルを開く**: メニュー「File」>「ファイルを開く」でテキストファイルを選択
2. **チャットで指示**: 右側のチャット欄で「匿名化して」「ワクチン開発用に匿名化して」などと入力
3. **確認**: AIが提案した変更箇所を確認し、必要に応じて修正
4. **保存**: 「変更を適用して保存」で匿名化されたファイルを保存

---

## 🛠 開発者向けセットアップ

ソースコードから実行したい場合はこちら：

### 前提条件

- Node.js 18+
- Rust 1.70+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### インストール

```bash
git clone https://github.com/your-repo/Anonymed-Copilot.git
cd Anonymed-Copilot
npm install
```

### 開発サーバー起動

```bash
npm run tauri dev
```

> ⚠️ 開発モードでは、`src-tauri/.env` に `GOOGLE_API_KEY=your-key` を設定するか、アプリ起動後にUIから設定してください。

### ビルド

```bash
npm run tauri build
```

---

## 📝 フィードバック

ユーザーテストにご協力いただきありがとうございます！
ご意見・ご感想は以下のフォームからお寄せください：

👉 [フィードバックフォーム](https://forms.google.com/your-id-here)

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | React 19, TypeScript, Tailwind CSS, Monaco Editor |
| Backend | Rust, Tauri 2.0 |
| AI | Google Gemini API |

## ライセンス

Apache License 2.0 - 詳細は [LICENSE](./LICENSE) を参照してください。
