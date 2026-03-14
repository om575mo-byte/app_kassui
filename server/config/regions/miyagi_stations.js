/**
 * 宮城県 水位観測所マスタデータ
 * suiikannsokujyo.txt をベースに、座標・stationNoを含むマスタ定義。
 * 観測所の追加・削除はこの配列を編集するだけでOK。
 *
 * normalFlow / droughtFlow が null の場合は渇水判定をスキップし、
 * 水位データの表示のみ行う。
 * droughtFlow が null で normalFlow が設定済みの場合は normalFlow と同値として扱う。
 *
 * waterDbId: 水文水質データベース (www1.river.go.jp) 上のID (15桁)
 * stationNo: 宮城県河川流域情報システム上のID (参考用)
 *
 * ※ 市名坂(七北田川)は水文水質DBに存在しないため、別途データソース検討
 */
export const MIYAGI_STATIONS = [
    {
        id: 'hirosebashi',
        name: '広瀬橋',
        river: '広瀬川',
        waterSystem: '名取川',
        lat: 38.2355556,
        lng: 140.8891667,
        waterDbId: '302021282206050',
        stationNo: '104004208',
        normalFlow: 2.0,
        droughtFlow: 1.0,
    },
    {
        id: 'natoribashi',
        name: '名取橋',
        river: '名取川',
        waterSystem: '名取川',
        lat: 38.2061111,
        lng: 140.8861111,
        waterDbId: '302021282206030',
        stationNo: '104004207',
        normalFlow: 1.5,
        droughtFlow: null,
    },
    {
        id: 'iwanuma',
        name: '岩沼',
        river: '阿武隈川',
        waterSystem: '阿武隈川',
        lat: 38.0958333,
        lng: 140.8716667,
        waterDbId: '302011282206030',
        stationNo: '104004223',
        normalFlow: null,
        droughtFlow: null,
    },
    {
        id: 'ochiai',
        name: '落合',
        river: '吉田川',
        waterSystem: '鳴瀬川',
        lat: 38.4280556,
        lng: 140.9294444,
        waterDbId: '302031282207150',
        stationNo: '104004024',
        normalFlow: 1.0,
        droughtFlow: null,
    },
    {
        id: 'nodabashi',
        name: '野田橋',
        river: '鳴瀬川',
        waterSystem: '鳴瀬川',
        lat: 38.5272222,
        lng: 141.0586111,
        waterDbId: '302031282207050',
        stationNo: '104004097',
        normalFlow: null,
        droughtFlow: null,
    },
    {
        id: 'tome',
        name: '登米',
        river: '旧北上川',
        waterSystem: '北上川',
        lat: 38.6586111,
        lng: 141.2863889,
        waterDbId: '302041282207080',
        stationNo: '104004230',
        normalFlow: null,
        droughtFlow: null,
    },
];
