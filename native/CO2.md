# UD-CO2S取得システム

HomePanelは`chissoku.exe`を子プロセスとして起動しません。`northeye/chissoku`で実績のあるUD-CO2S通信手順をC++へ移植し、`HomePanel.exe`内部で直接実行します。

## 通信手順

```text
COMポートを開く
→ 115200bps / 8bit / parityなし / stop bit 1
→ RX/TXバッファをクリア
→ STP送信、OK応答確認
→ ID?送信、OK応答確認
→ STA送信、OK応答確認
→ CO2=...,HUM=...,TMP=... を継続受信
```

各コマンドと測定値には10秒の監視時間を設けます。応答停止、USB切断、読み取りエラー、`NG`応答が発生した場合はポートを閉じ、5秒から10秒後にCOMポート探索と初期化をやり直します。

## COMポート選択

優先順位:

1. `data/settings.json`の`co2.serialPort`
2. 旧Web版の`C:\HomePanel\.env`にある`HP_CO2_SERIAL_PORT`
3. `cloud\.env`の`HP_CO2_SERIAL_PORT`
4. Windowsのデバイス一覧から`UD-CO2S`またはCO2名称を検索
5. USBシリアルポートが1個だけならそれを使用

USBシリアルポートが複数存在する場合は、誤った機器を開かないよう自動選択しません。

設定例:

```json
{
  "co2": {
    "serialPort": "COM3",
    "temperatureOffset": -4.5
  }
}
```

または既存`.env`:

```dotenv
HP_CO2_SERIAL_PORT=COM3
```

## 測定後の処理

- CO2、温度、湿度を即時表示
- 温度オフセットを適用
- 補正後温度に対応する相対湿度を再計算
- `data/outbox.ndjson`へ原子的に近い追記方式で保存
- 約10分ごとに最大500件をCloudflare D1へ送信
- 送信失敗時はoutboxを保持
- 直近1時間のCO2傾向を在宅・睡眠判定の補助に使用

通信手順の出典とMITライセンス全文は`THIRD_PARTY_NOTICES.md`へ収録し、Windows更新ZIPにも同梱します。
