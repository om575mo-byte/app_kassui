---
name: Water Information System Scraper (水文水質データベース)
description: 国土交通省「水文水質データベース (www1.river.go.jp)」からリアルタイム水位データを安定してスクレイピング・パースするためのノウハウと実装パターン。
---

# 水文水質データベース スクレイピング Skill

## 概要
国土交通省の「水文水質データベース (https://www1.river.go.jp/)」から、リアルタイムの水位観測所データをスクレイピングするための手順と罠（Pitfalls）をまとめたSkillです。

## 1. 観測所ID (waterDbId) の特定方法

水文水質データベースの各観測所は、**15桁の固有ID**（例: `302031282207150`）を持っています。
これをプログラム的に自動検索しようとすると、サーバー側のEUC-JP/Shift-JISエンコーディングの挙動により文字化けやパース失敗が頻発します。

**【推奨されるID特定アプローチ】**
自動スクレイピングで検索API（`SrchSite.exe` や `SiteList.exe`）を叩くのではなく、**ブラウザサブエージェント（Browser Subagent）を使用して検索結果ページを直接DOM操作する**のが最も確実です。

```javascript
/* ブラウザサブエージェントでのID抽出スクリプト（参考） */
const rows = document.querySelectorAll('table tr');
const results = [];
rows.forEach(row => {
    const links = row.querySelectorAll('a[href*="DspWaterData"]');
    if (links.length > 0) {
        const href = links[0].href;
        const idMatch = href.match(/ID=(\d+)/);
        if (idMatch) results.push({ id: idMatch[1], name: row.textContent.trim() });
    }
});
JSON.stringify(results);
```

## 2. リアルタイム水位の取得フロー（2段階フェッチ構造）

水位データはメインページには存在せず、安全にデータを取り出すためには**iframeの中のページ**にアクセスする必要があります。

### Step 1: メインページからiframe URLを抽出
メインの観測所ページ（`DspWaterData.exe`）にアクセスし、ソースコード内から `WaterFree` を含むiframeのURLを探します。

- **URL:** `https://www1.river.go.jp/cgi-bin/DspWaterData.exe?KIND=9&ID={15桁のID}`
- **抽出正規表現:** `/src="([^"]*WaterFree[^"]*)"/i`

### Step 2: iframe内ページから水位テーブルを抽出
抽出したパスにアクセスします。

- **URL:** `https://www1.river.go.jp{抽出したパス}` (※ドメインを補完すること)
- **HTML構造:** iframeのページには、直近の10分間隔の水位データが `<TR>` タグのパターンのテーブル行として新しい順に並んでいます。

```html
<TR>
  <TD>2026/02/22</TD> <!-- 日付 -->
  <TD>00:30</TD>      <!-- 時刻 -->
  <TD><FONT color="#0000ff">-0.07</FONT></TD> <!-- 水位(m) -->
</TR>
```

### パース時の重要ポイント & 罠（Gotchas）
1. 水位の `<FONT>` タグはあったりなかったりします。
2. 欠測やデータが存在しない場合は `-`（ハイフン）や全角ハイフンが格納されます。
3. 取得したHTMLの最新行（一番最初の有効なデータ行）を取得するように実装してください。

**【堅牢なパース用正規表現】**
```javascript
const rowPattern = /<TR>\s*<TD[^>]*>(\d{4}\/\d{2}\/\d{2})<\/TD>\s*<TD[^>]*>([\d:]+)<\/TD>\s*<TD[^>]*>(?:<FONT[^>]*>)?([-\d.]+|-)(?:<\/FONT>)?<\/TD>\s*<\/TR>/gi;
// match[1]: 日付 (YYYY/MM/DD)
// match[2]: 時刻 (HH:MM)
// match[3]: 水位 (実数値または '-')
```

## 3. 代替データソース（CSV直接ダウンロード）

iframe内解析の他に、もう1つアプローチがあります。
メインページには、CSVデータが直接ダウンロードできる `.dat` ファイルへのリンクが隠されています。
- **抽出正規表現:** `/href="([^"]*\.dat)"/`
- ただし、このDATファイルはサイズが大きいため（1ヶ月分など）、メモリ節約や速度が要求されるリアルタイムAPIでは iframe解析法（最大でも数百件程度）の方が適している場合があります。要件に応じて使い分けてください。
