# UNINUS Weather Station Card 範例

主要安裝方式、完整選項表與最小／完整 YAML 請見 [README](./README.md)。

## 使用固定 24 小時期間

若不需要期間按鈕，請省略 `buttons_config` 並使用 `data_period`：

```yaml
type: custom:uninus-weather-station-card
wind_direction_entity:
  entity: sensor.wind_direction
windspeed_entities:
  - entity: sensor.wind_speed
weather_entities:
  temperature:
    entity: sensor.outdoor_temperature
  humidity:
    entity: sensor.outdoor_humidity
  illuminance:
    entity: sensor.outdoor_illuminance
  rain:
    entity: binary_sensor.rain
data_period:
  period_back: -24h
```

## 使用長期統計

只有在風向與風速實體確實提供 Home Assistant statistics 時才啟用：

```yaml
type: custom:uninus-weather-station-card
wind_direction_entity:
  entity: sensor.wind_direction
  use_statistics: true
  statistics_period: hour
windspeed_entities:
  - entity: sensor.wind_speed
    use_statistics: true
    statistics_period: hour
    statistics_type: mean
weather_entities:
  temperature:
    entity: sensor.outdoor_temperature
  humidity:
    entity: sensor.outdoor_humidity
  illuminance:
    entity: sensor.outdoor_illuminance
  rain:
    entity: binary_sensor.rain
buttons_config:
  buttons:
    - type: period_selector
      button_text: 7D
      preset_period: last_7_days
      use_statistics: true
      statistics_period: hour
      active: true
```

`example/` 與 `examples/` 內既有圖片來自上游 Windrose Card，只用於底層玫瑰圖功能參考，並非 UNINUS 卡片完整外觀。
