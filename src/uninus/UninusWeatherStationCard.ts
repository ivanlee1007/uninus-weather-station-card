import { Svg, SVG } from "@svgdotjs/svg.js";
import { css, CSSResultGroup, html, LitElement, TemplateResult } from "lit";
import { customElement, query } from "lit/decorators.js";
import { CardConfigWrapper } from "../config/CardConfigWrapper";
import { ButtonInterface } from "../config/buttons/ButtonInterface";
import { PeriodSelectorButton } from "../config/buttons/types/PeriodSelectorButton";
import { PeriodShiftButton } from "../config/buttons/types/PeriodShiftButton";
import { PeriodShiftPlayButton } from "../config/buttons/types/PeriodShiftPlayButton";
import { WindRoseSpeedSelectButton } from "../config/buttons/types/WindRoseSpeedSelectButton";
import { EntityChecker } from "../entity-checker/EntityChecker";
import { EntityStatesProcessor } from "../entity-state-processing/EntityStatesProcessor";
import { DateTimeFormatter } from "../formatter/DateTimeFormatter";
import { HAMeasurementProvider } from "../measurement-provider/HAMeasurementProvider";
import { HAWebservice } from "../measurement-provider/HAWebservice";
import { MeasurementHolder } from "../measurement-provider/MeasurementHolder";
import { WindRoseDirigent } from "../renderer/WindRoseDirigent";
import { HomeAssistant } from "../util/HomeAssistant";
import {
    buildWindRoseConfig,
    classifyRainState,
    classifyResponsiveMode,
    createMoreInfoEvent,
    formatEntityState,
    normalizeWeatherStationConfig,
    type EntityDisplay,
    type NormalizedWeatherStationConfig,
    type ResponsiveMode,
    type UninusWeatherStationCardConfig,
} from "./UninusWeatherHelpers";

declare global {
    interface Window {
        customCards?: Array<Record<string, unknown>>;
    }
}

window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "uninus-weather-station-card")) {
    window.customCards.push({
        type: "uninus-weather-station-card",
        name: "UNINUS Weather Station Card",
        description: "A responsive UNINUS current-weather and windrose card.",
        preview: true,
    });
}

@customElement("uninus-weather-station-card")
export class UninusWeatherStationCard extends LitElement {
    public static getStubConfig(): Record<string, unknown> {
        return {
            type: "custom:uninus-weather-station-card",
            name: "UNINUS 氣象站",
            device_label: "外部環境氣象站",
            wind_direction_entity: { entity: "sensor.wind_direction" },
            windspeed_entities: [{ entity: "sensor.wind_speed", name: "風速" }],
            weather_entities: {
                temperature: { entity: "sensor.temperature", name: "溫度" },
                humidity: { entity: "sensor.humidity", name: "相對濕度" },
                illuminance: { entity: "sensor.illuminance", name: "光照度" },
                rain: { entity: "binary_sensor.rain", name: "降雨" },
            },
        };
    }

    @query("#svg-container") private svgContainer?: HTMLElement;
    @query("#text-block-top") private textBlockTop?: HTMLDivElement;
    @query("#text-block-bottom") private textBlockBottom?: HTMLDivElement;

    private readonly svg: Svg = SVG().height("100%").width("100%");
    private readonly windRoseDirigent = new WindRoseDirigent(this.svg, event => this.dispatchEvent(event));
    private readonly entityStateProcessor = new EntityStatesProcessor();
    private readonly entityChecker = new EntityChecker();
    private config?: NormalizedWeatherStationConfig;
    private cardConfig?: CardConfigWrapper;
    private _hass?: HomeAssistant;
    private measurementProvider?: HAMeasurementProvider;
    private updateInterval?: ReturnType<typeof setInterval>;
    private resizeObserver?: ResizeObserver;
    private responsiveMode: ResponsiveMode = "wide";
    private initialized = false;
    private errorMessage = "";

    public setConfig(config: UninusWeatherStationCardConfig): void {
        this.config = normalizeWeatherStationConfig(config);
        this.cardConfig = new CardConfigWrapper(buildWindRoseConfig(this.config) as never);
        this.initialized = false;
        this.stopInterval();
        if (this._hass) {
            this.initializeWindRose();
        }
        this.requestUpdate();
    }

    public set hass(hass: HomeAssistant) {
        this._hass = hass;
        if (this.cardConfig && !this.initialized) {
            this.initializeWindRose();
        }
        this.entityStateProcessor.updateHass(hass);
        if (this.initialized && this.entityStateProcessor.hasUpdates()) {
            this.windRoseDirigent.updateStateRender();
        }
        this.requestUpdate();
    }

    public get hass(): HomeAssistant | undefined {
        return this._hass;
    }

    public getCardSize(): number {
        return this.responsiveMode === "narrow" ? 14 : 9;
    }

    public getLayoutOptions(): Record<string, number> {
        return {
            grid_columns: this.cardConfig?.cardWidth ?? 4,
            grid_rows: this.responsiveMode === "narrow" ? 14 : 9,
            min_grid_columns: 2,
        };
    }

    protected firstUpdated(): void {
        this.attachSvg();
        this.observeSize();
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.startInterval();
        if (this.hasUpdated) {
            this.observeSize();
        }
    }

    public disconnectedCallback(): void {
        this.stopInterval();
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        super.disconnectedCallback();
    }

    protected render(): TemplateResult {
        const weather = this.config?.weather_entities;
        const states = this._hass?.states ?? {};
        const temperature = formatEntityState(states, weather?.temperature);
        const humidity = formatEntityState(states, weather?.humidity);
        const illuminance = formatEntityState(states, weather?.illuminance);
        const rain = formatEntityState(states, weather?.rain);
        const signal = formatEntityState(states, weather?.signal_strength);
        const connectivity = formatEntityState(states, weather?.connectivity);
        const windDirection = formatEntityState(states, this.config?.wind_direction_entity);
        const windSpeed = formatEntityState(states, this.config?.windspeed_entities[0]);
        const rainClass = classifyRainState(
            rain.available ? rain.value : undefined,
            this.config?.rain_states ?? { wet: [], dry: [] },
        );
        const connected = connectivity.available && !["off", "false", "disconnected"].includes(connectivity.value.trim().toLowerCase());

        return html`
            <ha-card class=${this.responsiveMode}>
                <header>
                    <div class="logo" aria-hidden="true">U</div>
                    <div class="identity">
                        <strong>${this.config?.name ?? "UNINUS 氣象站"}</strong>
                        <span>${this.config?.device_label ?? "外部環境氣象站"}</span>
                    </div>
                    <div class="status">
                        ${this.renderMetric(signal, "⌁", "status-chip")}
                        <button class="status-chip ${connected ? "online" : ""}"
                            ?disabled=${!connectivity.entity}
                            @click=${() => this.showMoreInfo(connectivity.entity)}>
                            ${connectivity.available ? connectivity.value : "連線狀態 —"}
                        </button>
                    </div>
                </header>

                <main>
                    <aside class="column environment-column">
                        <section class="panel environment">
                            <span class="eyebrow">室外環境</span>
                            ${this.renderMetric(temperature, "", "temperature")}
                            <div class="humidity-row">
                                <span>相對濕度</span>${this.renderMetric(humidity, "", "inline-value")}
                            </div>
                        </section>
                        <section class="panel sensor-panel">
                            <span class="eyebrow">☀ ${illuminance.name || "光照度"}</span>
                            ${this.renderMetric(illuminance, "", "sensor-value")}
                        </section>
                    </aside>

                    <section class="panel wind-panel">
                        <div class="wind-header">
                            <strong>風速／風向圖</strong>
                            ${this.renderButtons()}
                        </div>
                        <div id="text-block-top" class="engine-text"></div>
                        <div class="wind-content">
                            <div id="svg-container" aria-label="歷史風向玫瑰圖"></div>
                            <div class="wind-current">
                                <span class="eyebrow">目前風況</span>
                                ${this.renderMetric(windSpeed, "", "wind-speed")}
                                <div class="wind-direction">
                                    <span>風向</span>${this.renderMetric(windDirection, "", "inline-value")}
                                </div>
                            </div>
                        </div>
                        <div id="text-block-bottom" class="engine-text"></div>
                        ${this.errorMessage ? html`<div class="error" role="alert">${this.errorMessage}</div>` : ""}
                    </section>

                    <aside class="column device-column">
                        <section class="panel rain ${rainClass}">
                            <span class="eyebrow">☂ ${rain.name || "降雨狀態"}</span>
                            <button class="rain-value" ?disabled=${!rain.entity}
                                @click=${() => this.showMoreInfo(rain.entity)}>
                                ${this.rainLabel(rainClass)}
                            </button>
                            <span class="rain-detail">${rain.available ? rain.value : "感測資料無法使用"}</span>
                        </section>
                        <section class="panel device">
                            <span class="eyebrow">裝置狀態</span>
                            <div><span>訊號強度</span>${this.renderMetric(signal, "", "inline-value")}</div>
                            <div><span>連線</span>${this.renderMetric(connectivity, "", "inline-value")}</div>
                        </section>
                    </aside>
                </main>

                <footer>
                    <span>UNINUS WEATHER STATION</span>
                    <span>最後更新 ${this.formatLastUpdated(temperature.lastUpdated)}</span>
                </footer>
            </ha-card>
        `;
    }

    private renderMetric(display: EntityDisplay, prefix: string, className: string): TemplateResult {
        return html`<button class="metric ${className}" ?disabled=${!display.entity}
            title=${display.name || display.entity || "資料未設定"}
            @click=${() => this.showMoreInfo(display.entity)}>
            ${prefix ? html`<span>${prefix}</span>` : ""}
            <strong>${display.value}</strong>${display.unit ? html`<small>${display.unit}</small>` : ""}
        </button>`;
    }

    private renderButtons(): TemplateResult {
        const buttons = this.cardConfig?.buttonsConfig?.buttons;
        if (!buttons?.length) {
            return html``;
        }
        return html`<div class="periods">
            ${buttons.map(button => html`
                <button class=${button.baseConfig.active ? "active" : ""}
                    style=${button.baseConfig.buttonColors.getCss(button.baseConfig.active)}
                    @click=${this.handleButtonClickFunc(button)}>
                    ${button.baseConfig.buttonText}
                </button>
            `)}
        </div>`;
    }

    private handleButtonClickFunc(button: ButtonInterface): () => void {
        if (button instanceof PeriodSelectorButton) {
            return () => {
                this.cardConfig?.buttonsConfig?.disablePeriodSelectors();
                this.cardConfig?.buttonsConfig?.undoPausedPlays();
                button.baseConfig.active = true;
                if (this.cardConfig) {
                    this.cardConfig.activePeriod = button.period.clone();
                }
                this.refreshMeasurements(!(this.cardConfig?.disableAnimations ?? false));
                this.requestUpdate();
            };
        }
        if (button instanceof PeriodShiftButton) {
            return () => {
                this.cardConfig?.buttonsConfig?.disablePeriodSelectors();
                this.cardConfig?.buttonsConfig?.undoPausedPlays();
                if (this.cardConfig?.activePeriod.movePeriod(button.shiftPeriod)) {
                    button.baseConfig.active = true;
                    this.refreshMeasurements(false);
                    this.requestUpdate();
                    window.setTimeout(() => {
                        button.baseConfig.active = false;
                        this.requestUpdate();
                    }, 150);
                }
            };
        }
        if (button instanceof PeriodShiftPlayButton) {
            return () => {
                if (button.baseConfig.active) {
                    button.baseConfig.active = false;
                    button.paused = true;
                    this.requestUpdate();
                    return;
                }
                this.cardConfig?.buttonsConfig?.disablePeriodSelectors();
                button.baseConfig.active = true;
                if (!button.paused && this.cardConfig) {
                    this.cardConfig.activePeriod = button.getFirstPeriod();
                }
                button.paused = false;
                this.refreshMeasurementsPlay(button);
                this.requestUpdate();
            };
        }
        if (button instanceof WindRoseSpeedSelectButton) {
            return () => {
                if (!this.cardConfig) return;
                this.cardConfig.buttonsConfig?.disableWindRoseSpeedSelectors();
                button.baseConfig.active = true;
                this.cardConfig.windspeedEntities.forEach(entity => entity.useForWindRose = false);
                this.cardConfig.windspeedEntities[button.index].useForWindRose = true;
                this.refreshMeasurements(false);
                this.requestUpdate();
            };
        }
        return () => undefined;
    }

    private initializeWindRose(): void {
        if (!this._hass || !this.cardConfig) return;
        try {
            this.svg.clear();
            this.entityChecker.checkEntities(this.cardConfig, this._hass);
            const formatter = new DateTimeFormatter(this._hass.locale, this._hass.config.time_zone);
            this.measurementProvider = new HAMeasurementProvider(new HAWebservice(this._hass), formatter, this.cardConfig);
            this.windRoseDirigent.init(this.cardConfig, this.measurementProvider, this.entityStateProcessor, formatter, this._hass);
            this.entityStateProcessor.init(this.cardConfig);
            this.initialized = true;
            this.errorMessage = "";
            this.attachSvg();
            this.refreshMeasurements(!this.cardConfig.disableAnimations);
            this.startInterval();
        } catch (error) {
            this.initialized = false;
            this.errorMessage = error instanceof Error ? error.message : String(error);
        }
    }

    private attachSvg(): void {
        if (!this.svgContainer) return;
        if (this.svg.node.parentElement !== this.svgContainer) {
            this.svg.addTo(this.svgContainer);
        }
        if (this.initialized && this.textBlockTop && this.textBlockBottom) {
            this.windRoseDirigent.setTextBlocks(this.textBlockTop, this.textBlockBottom);
            this.windRoseDirigent.renderBackground();
        }
    }

    private refreshMeasurements(animate: boolean): void {
        if (!this.initialized) return;
        this.errorMessage = "";
        this.windRoseDirigent.refreshData()
            .then((holder: MeasurementHolder) => {
                this.windRoseDirigent.renderGraphs(animate);
                this.windRoseDirigent.updateStateRender();
                this.errorMessage = holder?.error?.message ?? "";
                this.requestUpdate();
            })
            .catch(error => {
                this.errorMessage = error instanceof Error ? error.message : String(error ?? "無法載入風況歷史");
                this.requestUpdate();
            });
    }

    private refreshMeasurementsPlay(button: PeriodShiftPlayButton): void {
        if (!this.initialized || !this.cardConfig) return;
        this.windRoseDirigent.refreshData().then((holder: MeasurementHolder) => {
            this.windRoseDirigent.renderGraphs(false);
            this.windRoseDirigent.updateStateRender();
            this.errorMessage = holder?.error?.message ?? "";
            this.requestUpdate();
            window.setTimeout(() => {
                if (!this.cardConfig) return;
                const moved = this.cardConfig.activePeriod.movePeriod(button.stepPeriod);
                if (button.baseConfig.active && moved && this.cardConfig.activePeriod.endTime <= button.period.endTime) {
                    this.refreshMeasurementsPlay(button);
                } else if (button.baseConfig.active) {
                    button.paused = false;
                    button.baseConfig.active = false;
                    this.requestUpdate();
                }
            }, button.delay);
        }).catch(error => {
            button.baseConfig.active = false;
            this.errorMessage = error instanceof Error ? error.message : String(error ?? "無法載入風況歷史");
            this.requestUpdate();
        });
    }

    private startInterval(): void {
        if (!this.isConnected || !this.cardConfig || this.updateInterval !== undefined) return;
        this.updateInterval = setInterval(() => {
            this.cardConfig?.activePeriod.recalculateTimeRange();
            this.refreshMeasurements(!(this.cardConfig?.disableAnimations ?? false));
        }, this.cardConfig.refreshInterval * 1000);
    }

    private stopInterval(): void {
        if (this.updateInterval !== undefined) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }
    }

    private observeSize(): void {
        if (this.resizeObserver || typeof ResizeObserver === "undefined") return;
        this.resizeObserver = new ResizeObserver(entries => {
            const box = entries[0]?.contentRect;
            if (!box) return;
            const mode = classifyResponsiveMode(box.width, box.height);
            if (mode !== this.responsiveMode) {
                this.responsiveMode = mode;
                this.requestUpdate();
            }
        });
        this.resizeObserver.observe(this);
    }

    private showMoreInfo(entityId: string | undefined): void {
        if (entityId) this.dispatchEvent(createMoreInfoEvent(entityId));
    }

    private rainLabel(classification: ReturnType<typeof classifyRainState>): string {
        if (classification === "wet") return "偵測到降雨";
        if (classification === "dry") return "目前沒有降雨";
        if (classification === "unknown") return "未知降雨狀態";
        return "降雨資料無法使用";
    }

    private formatLastUpdated(value: string | undefined): string {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat(this._hass?.locale?.language || undefined, {
            hour: "2-digit", minute: "2-digit",
        }).format(date);
    }

    public static get styles(): CSSResultGroup {
        return css`
            :host { display: block; color: var(--primary-text-color); }
            * { box-sizing: border-box; }
            ha-card {
                --uninus-green: var(--primary-color, #1d745e);
                --uninus-muted: var(--secondary-text-color, #71827b);
                --uninus-line: var(--divider-color, #dce7e0);
                overflow: hidden;
                border-radius: var(--ha-card-border-radius, 20px);
                background: linear-gradient(145deg, var(--card-background-color, #fff), color-mix(in srgb, var(--primary-color, #1d745e) 5%, var(--card-background-color, #fff)));
            }
            header { min-height: 68px; padding: 10px 18px; display: flex; align-items: center; border-bottom: 1px solid var(--uninus-line); gap: 10px; }
            .logo { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 12px; display: grid; place-items: center; color: var(--text-primary-color, #fff); background: var(--uninus-green); font-weight: 900; }
            .identity { display: grid; gap: 2px; }
            .identity strong { font-size: 16px; }
            .identity span, .eyebrow, footer { color: var(--uninus-muted); font-size: 10px; letter-spacing: .06em; }
            .status { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
            button { font: inherit; }
            .metric, .status-chip, .rain-value { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
            .metric:disabled, .status-chip:disabled, .rain-value:disabled { cursor: default; opacity: 1; }
            .status-chip { padding: 6px 8px; border-radius: 9px; background: color-mix(in srgb, var(--uninus-muted) 10%, transparent); color: var(--uninus-muted); font-size: 10px; }
            .status-chip.online { color: var(--uninus-green); background: color-mix(in srgb, var(--uninus-green) 12%, transparent); }
            main { display: grid; grid-template-columns: minmax(160px, 190px) minmax(330px, 1fr) minmax(160px, 190px); gap: 12px; padding: 12px; }
            .column { display: grid; align-content: start; gap: 10px; }
            .panel { min-width: 0; padding: 14px; border: 1px solid var(--uninus-line); border-radius: 15px; background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent); }
            .environment { display: grid; gap: 11px; }
            .temperature { display: inline-flex; align-items: start; justify-content: flex-start; gap: 3px; }
            .temperature strong { color: var(--uninus-green); font-size: 42px; line-height: 1; font-weight: 400; }
            .temperature small { font-size: 16px; }
            .humidity-row, .wind-direction, .device div { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--uninus-muted); font-size: 12px; }
            .inline-value { display: inline-flex; gap: 2px; color: var(--primary-text-color); }
            .sensor-panel { display: grid; gap: 12px; }
            .sensor-value { display: inline-flex; align-items: baseline; gap: 4px; justify-content: flex-start; }
            .sensor-value strong { font-size: 24px; color: #d98b2b; }
            .wind-panel { padding: 0; overflow: hidden; }
            .wind-header { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--uninus-line); }
            .periods { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
            .periods button { border: 1px solid var(--uninus-line); border-radius: 8px; padding: 4px 7px; color: var(--uninus-muted); background: transparent; cursor: pointer; font-size: 10px; }
            .periods button.active { color: var(--text-primary-color, #fff); background: var(--uninus-green); border-color: var(--uninus-green); }
            .wind-content { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(95px, .34fr); min-height: 300px; }
            #svg-container { min-width: 0; min-height: 300px; padding: 8px; }
            .wind-current { display: grid; align-content: center; gap: 12px; padding: 12px; border-left: 1px solid var(--uninus-line); }
            .wind-speed { display: inline-flex; align-items: baseline; justify-content: center; gap: 4px; }
            .wind-speed strong { font-size: 30px; color: var(--uninus-green); }
            .engine-text { padding: 0 12px; overflow-wrap: anywhere; font-size: 11px; }
            .engine-text:empty { display: none; }
            .rain { display: grid; gap: 11px; }
            .rain-value { text-align: left; color: var(--uninus-green); font-size: 17px; font-weight: 700; }
            .rain.wet { border-color: color-mix(in srgb, #e7832f 50%, var(--uninus-line)); background: color-mix(in srgb, #e7832f 8%, var(--card-background-color, #fff)); }
            .rain.wet .rain-value { color: #d86e1d; }
            .rain-detail { color: var(--uninus-muted); font-size: 11px; }
            .device { display: grid; gap: 12px; }
            .error { margin: 8px 12px 12px; padding: 8px; border-radius: 8px; color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 8%, transparent); font-size: 12px; }
            footer { min-height: 34px; padding: 8px 18px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--uninus-line); }
            ha-card.compact main { grid-template-columns: minmax(150px, .7fr) minmax(320px, 1.5fr); }
            ha-card.compact .device-column { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; }
            ha-card.narrow header { align-items: flex-start; flex-wrap: wrap; }
            ha-card.narrow .status { width: 100%; margin-left: 50px; justify-content: flex-start; }
            ha-card.narrow main { grid-template-columns: 1fr; }
            ha-card.narrow .environment-column { grid-template-columns: 1fr 1fr; }
            ha-card.narrow .wind-panel { grid-row: 2; }
            ha-card.narrow .device-column { grid-template-columns: 1fr 1fr; }
            ha-card.narrow .wind-header { align-items: flex-start; flex-direction: column; }
            ha-card.narrow .periods { margin-left: 0; justify-content: flex-start; }
            ha-card.narrow .wind-content { grid-template-columns: 1fr; }
            ha-card.narrow .wind-current { grid-template-columns: 1fr 1fr; border-left: 0; border-top: 1px solid var(--uninus-line); }
            ha-card.narrow #svg-container { min-height: 330px; }
            @media (max-width: 390px) {
                ha-card.narrow .environment-column, ha-card.narrow .device-column { grid-template-columns: 1fr; }
                footer { align-items: flex-start; flex-direction: column; gap: 3px; }
            }
        `;
    }
}
