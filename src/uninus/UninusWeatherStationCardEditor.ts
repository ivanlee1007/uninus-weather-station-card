import { css, html, LitElement, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import type { HomeAssistant } from "../util/HomeAssistant";
import type {
    LayoutMode,
    UninusWeatherStationCardConfig,
    WeatherEntityConfig,
} from "./UninusWeatherHelpers";

export interface WeatherStationEditorData {
    name: string;
    device_label: string;
    layout: LayoutMode;
    disable_animations: boolean;
    refresh_interval: number;
    card_width: number;
    temperature_entity: string;
    humidity_entity: string;
    illuminance_entity: string;
    rain_entity: string;
    signal_strength_entity: string;
    connectivity_entity: string;
    wind_direction_entity: string;
    wind_speed_entity: string;
    output_speed_unit: string;
}

const optionalEntity = (
    entity: string,
    current: WeatherEntityConfig | undefined,
): WeatherEntityConfig | undefined => entity.trim()
    ? { ...(current ?? {}), entity: entity.trim() }
    : undefined;

export const editorDataFromConfig = (
    config: UninusWeatherStationCardConfig,
): WeatherStationEditorData => ({
    name: config.name ?? "UNINUS 氣象站",
    device_label: config.device_label ?? "外部環境氣象站",
    layout: config.layout ?? "auto",
    disable_animations: Boolean(config.disable_animations),
    refresh_interval: typeof config.refresh_interval === "number" ? config.refresh_interval : 300,
    card_width: typeof config.card_width === "number" ? config.card_width : 4,
    temperature_entity: config.weather_entities.temperature.entity,
    humidity_entity: config.weather_entities.humidity.entity,
    illuminance_entity: config.weather_entities.illuminance.entity,
    rain_entity: config.weather_entities.rain.entity,
    signal_strength_entity: config.weather_entities.signal_strength?.entity ?? "",
    connectivity_entity: config.weather_entities.connectivity?.entity ?? "",
    wind_direction_entity: config.wind_direction_entity.entity,
    wind_speed_entity: config.windspeed_entities[0]?.entity ?? "",
    output_speed_unit: String(config.windspeed_entities[0]?.output_speed_unit ?? "mps"),
});

export const configFromEditorData = (
    config: UninusWeatherStationCardConfig,
    data: WeatherStationEditorData,
): UninusWeatherStationCardConfig => {
    const firstWindSpeed = config.windspeed_entities[0] ?? { entity: "" };
    const weatherEntities = {
        ...config.weather_entities,
        temperature: { ...config.weather_entities.temperature, entity: data.temperature_entity.trim() },
        humidity: { ...config.weather_entities.humidity, entity: data.humidity_entity.trim() },
        illuminance: { ...config.weather_entities.illuminance, entity: data.illuminance_entity.trim() },
        rain: { ...config.weather_entities.rain, entity: data.rain_entity.trim() },
        signal_strength: optionalEntity(data.signal_strength_entity, config.weather_entities.signal_strength),
        connectivity: optionalEntity(data.connectivity_entity, config.weather_entities.connectivity),
    };
    if (!weatherEntities.signal_strength) delete weatherEntities.signal_strength;
    if (!weatherEntities.connectivity) delete weatherEntities.connectivity;

    return {
        ...config,
        name: data.name.trim(),
        device_label: data.device_label.trim(),
        layout: data.layout,
        disable_animations: data.disable_animations,
        refresh_interval: Number(data.refresh_interval),
        card_width: Number(data.card_width),
        weather_entities: weatherEntities,
        wind_direction_entity: {
            ...config.wind_direction_entity,
            entity: data.wind_direction_entity.trim(),
        },
        windspeed_entities: [
            {
                ...firstWindSpeed,
                entity: data.wind_speed_entity.trim(),
                output_speed_unit: data.output_speed_unit,
            },
            ...config.windspeed_entities.slice(1),
        ],
    };
};

const editorSchema: Array<Record<string, unknown>> = [
    { name: "name", selector: { text: {} } },
    { name: "device_label", selector: { text: {} } },
    {
        name: "layout",
        selector: {
            select: {
                mode: "dropdown",
                options: [
                    { value: "auto", label: "自動偵測" },
                    { value: "horizontal", label: "橫式排列" },
                    { value: "vertical", label: "直式排列" },
                ],
            },
        },
    },
    { name: "temperature_entity", required: true, selector: { entity: {} } },
    { name: "humidity_entity", required: true, selector: { entity: {} } },
    { name: "illuminance_entity", required: true, selector: { entity: {} } },
    { name: "rain_entity", required: true, selector: { entity: {} } },
    { name: "wind_direction_entity", required: true, selector: { entity: {} } },
    { name: "wind_speed_entity", required: true, selector: { entity: {} } },
    { name: "signal_strength_entity", selector: { entity: {} } },
    { name: "connectivity_entity", selector: { entity: {} } },
    {
        name: "output_speed_unit",
        selector: {
            select: {
                mode: "dropdown",
                options: [
                    { value: "mps", label: "m/s" },
                    { value: "kph", label: "km/h" },
                    { value: "mph", label: "mph" },
                    { value: "knots", label: "kn" },
                    { value: "fps", label: "ft/s" },
                ],
            },
        },
    },
    { name: "refresh_interval", selector: { number: { min: 30, max: 86400, mode: "box", unit_of_measurement: "秒" } } },
    { name: "card_width", selector: { number: { min: 2, max: 12, mode: "box" } } },
    { name: "disable_animations", selector: { boolean: {} } },
];

const labels: Record<keyof WeatherStationEditorData, string> = {
    name: "卡片標題",
    device_label: "裝置說明",
    layout: "排列方式",
    disable_animations: "停用動畫",
    refresh_interval: "歷史資料更新間隔",
    card_width: "建議欄寬",
    temperature_entity: "溫度實體",
    humidity_entity: "相對濕度實體",
    illuminance_entity: "光照度實體",
    rain_entity: "降雨實體",
    signal_strength_entity: "訊號強度實體（選填）",
    connectivity_entity: "連線狀態實體（選填）",
    wind_direction_entity: "風向實體",
    wind_speed_entity: "風速實體",
    output_speed_unit: "風速顯示單位",
};

@customElement("uninus-weather-station-card-editor")
export class UninusWeatherStationCardEditor extends LitElement {
    private _hass?: HomeAssistant;
    private config?: UninusWeatherStationCardConfig;

    public set hass(value: HomeAssistant) {
        this._hass = value;
        this.requestUpdate();
    }

    public setConfig(config: UninusWeatherStationCardConfig): void {
        this.config = config;
        this.requestUpdate();
    }

    protected render(): TemplateResult {
        if (!this.config || !this._hass) return html``;
        return html`
            <div class="editor">
                <ha-form
                    .hass=${this._hass}
                    .data=${editorDataFromConfig(this.config)}
                    .schema=${editorSchema}
                    .computeLabel=${(schema: { name: keyof WeatherStationEditorData }) => labels[schema.name] ?? schema.name}
                    @value-changed=${this.handleValueChanged}
                ></ha-form>
                <ha-alert alert-type="info">
                    進階風玫瑰、色階、期間按鈕與動作設定會原樣保留；如需修改請使用 YAML 模式。
                </ha-alert>
            </div>
        `;
    }

    private handleValueChanged = (event: CustomEvent<{ value: WeatherStationEditorData }>): void => {
        if (!this.config || !event.detail?.value) return;
        const updated = configFromEditorData(this.config, event.detail.value);
        this.config = updated;
        this.dispatchEvent(new CustomEvent("config-changed", {
            detail: { config: updated },
            bubbles: true,
            composed: true,
        }));
    };

    public static get styles(): CSSResultGroup {
        return css`
            :host { display: block; }
            .editor { display: grid; gap: 16px; }
            ha-form { display: block; }
            ha-alert { display: block; }
        `;
    }
}