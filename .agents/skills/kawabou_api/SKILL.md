---
name: 川の防災情報データ取得 API
description: 国土交通省「川の防災情報」サイトが内部で使用しているJSON APIから、全国のダム・水位・雨量等の観測データをスクレイピング（直接取得）するためのノウハウとエンドポイント仕様。
---

# 川の防災情報データ取得 (kawabou API)

国土交通省「川の防災情報 (www.river.go.jp)」は、フロントエンド層がVue等のJSフレームワークによりクライアントサイドで動的にレンダリングされているため、単純なHTMLスクレイピング（`cheerio` 等）ではデータを取得できない。

しかし、ブラウザの通信を解析した結果、背後で**全国網羅的かつ構造化されたJSON API**が直接叩かれていることが判明した。このJSONエンドポイントを直接叩くことで、スクレイピングよりも圧倒的に高速かつ低負荷で安定したデータ取得が可能となる。

全国対応の渇水モニターを構築するにあたり、中核となるデータソースである。

## 1. エンドポイントの構造と仕様

ベースURL: `https://www.river.go.jp/kawabou/file/files/`

すべてのAPIで、パスの末尾に**都道府県コード（独自の3桁コードまたは標準の2桁コード）**を指定することで、その都道府県内の全データが配列（JSON）として返却される。

### ① 都道府県コード (prefCode) マップ
標準的なJIS都道府県コード（01〜47）に加えて、川の防災情報独自の3桁コードが存在する。データの種類によって使い分ける場合がある。
- マスタ系API: `01`〜`47` の2桁を用いることが多い（例: 宮城県=04）
- 実況値系API: `401`〜 などの3桁コードを用いることが多い（例: 宮城県=401）

コードの一覧は以下のJSONで取得可能:
`https://www.river.go.jp/kawabou/file/files/map/pref/prefarea.json`

### ② 観測所マスタ (Master API)
各都道府県に存在する観測所（ダム、水位計など）のID、名称、住所、緯度経度などの静的マスタデータを取得する。

- **ダム**: `obslist/twninfo/obs/dam/{2桁コード}.json`
  - 例（宮城県）: `https://www.river.go.jp/kawabou/file/files/obslist/twninfo/obs/dam/04.json`
  - 主要フィールド:
    - `obsFcd`: 観測所ID（13桁）※実況データと紐付けるPキー
    - `obsNm`: ダム名（大倉ダムなど）
    - `rivNm`: 河川名
    - `wsNm`: 水系名
    - `lat`, `lon`: 緯度経度

### ③ 実況データ (Telemetry API)
直近の観測値（水位、貯水量、貯水率など）を取得する。10分〜数十分おきに更新される。

- **ダム**: `obslist/twninfo/tm/dam/{3桁コード}.json`
  - 例（宮城県）: `https://www.river.go.jp/kawabou/file/files/obslist/twninfo/tm/dam/401.json`
  - 主要フィールド:
    - `obsFcd`: 観測所ID（13桁）
    - `obsTime`: 観測時刻 (例: "2026/03/07 14:20")
    - `storLvl`: 貯水位 (m)
    - `storCap`: 貯水量 (千㎥)
    - `allSink`: 流入量 (㎥/s)
    - `allDisch`: 放流量 (㎥/s)
    - `storPcntIrr`: 貯水率（利水） (%)
    - `storPcntEff`: 貯水率（有効） (%)

## 2. 実装パターン (Node.js)

全国のダムデータを取得する場合の基本的な流れは以下の通り。

1. **マスタの取得と構築**
   起動時、または1日に1回程度、マスタAPI(`04.json`等)から `obsFcd` をキーとしたMapをメモリ上に構築する。
2. **実況値のポーリング**
   10分〜1時間ごとに実況API(`401.json`等)をフェッチする。
3. **データの結合**
   実況データの `obsFcd` を用いてマスタMapから「ダム名」等を牽き当てて、フロントエンドに返却するオブジェクトを構成する。

```javascript
import fetch from 'node-fetch';

// 例: 宮城県(04/401)のダムデータを取得する
async function fetchMiyagiDamsFromKawabou() {
    // 1. マスタ取得
    const masterRes = await fetch('https://www.river.go.jp/kawabou/file/files/obslist/twninfo/obs/dam/04.json');
    const masterData = await masterRes.json();
    const damMaster = new Map();
    masterData.prefTwn.forEach(twn => {
        if(twn.dam) {
            twn.dam.forEach(d => damMaster.set(d.obsFcd, d.obsNm));
        }
    });

    // 2. 実況取得
    const dataRes = await fetch('https://www.river.go.jp/kawabou/file/files/obslist/twninfo/tm/dam/401.json');
    const dataJson = await dataRes.json();

    const result = [];
    dataJson.prefTwn.forEach(twn => {
        if(twn.dam) {
            twn.dam.forEach(dam => {
                const name = damMaster.get(dam.obsFcd) || '不明';
                result.push({
                    id: dam.obsFcd,
                    name: name,
                    time: dam.obsTime,
                    level: dam.storLvl,
                    capacity: dam.storCap,
                    inflow: dam.allSink,
                    outflow: dam.allDisch,
                    rate: dam.storPcntIrr // または storPcntEff
                });
            });
        }
    });
    return result;
}
```

## 3. その他の拡張（水位計・雨量）
パスの一部を変更するだけで、ダム以外のデータも同様にJSONで取得可能。
- 観測所マスタ (水位計): `obslist/twninfo/obs/stg/{2桁コード}.json`
- 実況データ (水位計): `obslist/twninfo/tm/stg/{3桁コード}.json`
- 観測所マスタ (雨量): `obslist/twninfo/obs/rain/{2桁コード}.json`
- 実況データ (雨量): `obslist/twninfo/tm/rain/{3桁コード}.json`

これにより、全国版アプリにおいて「都道府県選択プルダウン」等のUIを設け、バックエンドで取得先コードを切り替えるだけで、日本全国の水文水質状況をシームレスにモニターできる。
