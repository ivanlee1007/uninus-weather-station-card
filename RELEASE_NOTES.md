# UNINUS Weather Station Card — Development Notes

## v0.1.0

- 新增 UNINUS Weather Station Card 自訂元素與繁體中文氣象站介面。
- 整合即時環境、降雨與裝置狀態，以及歷史風向玫瑰圖。
- 加入依卡片尺寸切換的寬版、緊湊、窄版與小型版配置。
- 保留 Windrose Card 的歷史區間、位移、播放及觸控操作。
- 加入非同步請求、播放、重新連線及重新設定的生命週期防護。
- 加強 Home Assistant action payload、設定驗證及文字模板安全。
- 將 HACS 發佈檔命名為 `uninus-weather-station-card.js`。

此版本供 Home Assistant 實機測試使用。
上游 Windrose Card 的版本歷史請查閱其原始儲存庫：
https://github.com/aukedejong/lovelace-windrose-card
