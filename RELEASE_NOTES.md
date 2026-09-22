# UNINUS Weather Station Card — Development Notes

## v0.3.1

- 因儲存庫沿用的上游歷史標籤已占用 `v0.3.0`，正式功能版本改以 `v0.3.1` 發布。
- 新增符合 Home Assistant Lovelace 規範的圖形化卡片設定介面，可直接選取氣象實體並調整常用選項。
- 新增 `layout: auto | horizontal | vertical`；自動模式依卡片自身尺寸判斷，亦可強制橫式或直式排列。
- 圖形介面 round-trip 會保留未顯示的進階 Windrose、色階、期間按鈕與 Home Assistant action 設定。
- 修正 414 px 窄寬度下強制橫式排列的 timeline 水平溢位。

## v0.2.2

- 重新發布獨立版本標籤，修復部分 Home Assistant 主機在舊 `v0.2.1` 標籤快取期間安裝後，HACS 顯示已安裝但 `/hacsfiles/uninus-weather-station-card/uninus-weather-station-card.js` 實際回傳 404 的問題。
- 卡片功能與 Atmospheric Atlas V2 視覺維持不變。

## v0.1.2

- 將實機部署由外部 CDN resource 轉為 HACS 管理的 `/hacsfiles/` resource。
- 更新永久驗證紀錄，反映 HACS 安裝與單一 resource 回讀結果。

## v0.1.1

- 修正正式 Release tag，使其指向已合併的 `main` 成果。
- 新增 HACS 可辨識的實機預覽圖。
- 新增 Home Assistant 2026.9.1 實機驗證紀錄與寬／窄版截圖。
- 保留可操作的測試 Dashboard View 與 8 個測試 Helpers。

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
