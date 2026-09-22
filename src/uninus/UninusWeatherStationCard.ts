import { Svg, SVG } from "@svgdotjs/svg.js";
import { css, CSSResultGroup, html, LitElement, TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
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
import { SpeedUnits } from "../converter/SpeedUnits";
import { WindSpeedConverter } from "../converter/WindSpeedConverter";
import "./UninusWeatherStationCardEditor";

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
    getRainLabel,
    groupButtonsForLocation,
    isRainAnimationEnabled,
    isSafeCssColor,
    normalizeSpeedRanges,
    normalizeWeatherStationConfig,
    resolveActiveWindSpeedIndex,
    resolveEightDirection,
    resolveLayoutOrientation,
    resolveSpeedRange,
    resolveValueRange,
    resolveWindSpeedDisplayUnit,
    type EightDirectionKey,
    type EntityDisplay,
    type NormalizedWeatherStationConfig,
    type ResponsiveMode,
    type SpeedColorRange,
    type UninusWeatherStationCardConfig,
    type ValueRange,
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
    public static getConfigElement(): HTMLElement {
        return document.createElement("uninus-weather-station-card-editor");
    }

    public static getStubConfig(): Record<string, unknown> {
        return {
            type: "custom:uninus-weather-station-card",
            name: "UNINUS 氣象站",
            device_label: "外部環境氣象站",
            layout: "auto",
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
    private lastMeasurementHolder?: MeasurementHolder;
    private updateInterval?: ReturnType<typeof setInterval>;
    private resizeObserver?: ResizeObserver;
    private responsiveMode: ResponsiveMode = "wide";
    private initialized = false;
    private errorMessage = "";
    private requestGeneration = 0;
    private playbackTimeout?: number;
    private playbackButton?: PeriodShiftPlayButton;
    private periodShiftHighlightTimeout?: number;
    private windRosePolishTimeout?: number;
    private periodShiftHighlightButton?: PeriodShiftButton;
    private refreshOnReconnect = false;

    public setConfig(config: UninusWeatherStationCardConfig): void {
        this.cancelPendingWork();
        this.config = normalizeWeatherStationConfig(config);
        this.cardConfig = new CardConfigWrapper(buildWindRoseConfig(this.config) as never);
        this.initialized = false;
        this.lastMeasurementHolder = undefined;
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
        return this.responsiveMode === "narrow" || this.responsiveMode === "small" ? 14 : 9;
    }

    public getLayoutOptions(): Record<string, number> {
        return {
            grid_columns: this.cardConfig?.cardWidth ?? 4,
            grid_rows: this.responsiveMode === "narrow" || this.responsiveMode === "small" ? 14 : 9,
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
        if (this.initialized && this.refreshOnReconnect) {
            this.refreshOnReconnect = false;
            this.refreshMeasurements(!(this.cardConfig?.disableAnimations ?? false));
        }
    }

    public disconnectedCallback(): void {
        this.refreshOnReconnect = this.initialized;
        this.cancelPendingWork();
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
        const illuminanceDisplay = this.formatIlluminance(illuminance.value, illuminance.unit);
        const rain = formatEntityState(states, weather?.rain);
        const signal = formatEntityState(states, weather?.signal_strength);
        const connectivity = formatEntityState(states, weather?.connectivity);
        const windDirection = formatEntityState(states, this.config?.wind_direction_entity);
        const activeWindSpeedIndex = this.cardConfig?.windspeedEntities
            ? resolveActiveWindSpeedIndex(this.cardConfig.windspeedEntities)
            : 0;
        const windSpeedIndex = activeWindSpeedIndex >= 0 ? activeWindSpeedIndex : 0;
        const windSpeedConfig = this.config?.windspeed_entities[windSpeedIndex];
        const windSpeed = formatEntityState(states, windSpeedConfig);
        const rawRainState = weather?.rain.entity ? states[weather.rain.entity]?.state : undefined;
        const rainClass = classifyRainState(
            rawRainState,
            this.config?.rain_states ?? { wet: [], dry: [] },
        );
        const rainMotion = isRainAnimationEnabled(rainClass, this.cardConfig?.disableAnimations ?? false);
        const directionConfig = this.config?.direction_labels as {
            custom_labels?: Partial<Record<EightDirectionKey, string>>;
        } | undefined;
        const processedDirection = this.initialized ? this.entityStateProcessor.getWindDirection() : undefined;
        const direction = resolveEightDirection(processedDirection ?? windDirection.value, directionConfig?.custom_labels);
        const processedSpeed = this.initialized ? this.entityStateProcessor.getWindSpeed(windSpeedIndex, false) : undefined;
        const currentSpeedValue = processedSpeed ?? windSpeed.value;
        const activeWindSpeedConfig = this.cardConfig?.windspeedEntities?.[windSpeedIndex];
        const currentSpeedUnit = resolveWindSpeedDisplayUnit(
            processedSpeed,
            windSpeed.unit,
            activeWindSpeedConfig?.outputSpeedUnit,
            activeWindSpeedConfig?.outputSpeedUnitLabel,
        );
        const configuredSpeedRanges = (windSpeedConfig?.speed_ranges ?? undefined) as
            SpeedColorRange[] | undefined;
        const speedRanges = normalizeSpeedRanges(configuredSpeedRanges);
        const speedRange = resolveSpeedRange(currentSpeedValue, speedRanges);
        const connected = connectivity.available &&
            !["off", "false", "disconnected"].includes(connectivity.value.trim().toLowerCase());
        const signalNumber = signal.available ? Number(signal.value) : Number.NaN;
        const maintenanceTone = connectivity.entity && !connected ? "offline" :
            Number.isFinite(signalNumber) && signalNumber <= -75 ? "weak" : "normal";
        const configuredDirectionArrowColor = (this.config?.colors as Record<string, unknown> | undefined)
            ?.rose_current_direction_arrow;
        const directionArrowColor = isSafeCssColor(configuredDirectionArrowColor)
            ? configuredDirectionArrowColor
            : "#d94b3f";
        const temperatureRanges = weather?.temperature.value_ranges ?? [];
        const humidityRanges = weather?.humidity.value_ranges ?? [];
        const temperatureRange = resolveValueRange(
            temperature.available ? temperature.value : undefined,
            temperatureRanges,
        );
        const humidityRange = resolveValueRange(
            humidity.available ? humidity.value : undefined,
            humidityRanges,
        );
        const conditionSummary = temperature.available
            ? [this.describeTemperature(Number(temperature.value)), this.describeWind(
                typeof currentSpeedValue === "number" ? currentSpeedValue : Number(currentSpeedValue),
            )].filter(Boolean).join("、")
            : "溫度資料無法使用";
        const windSummary = this.summarizeWindHistory(windSpeedIndex);
        const periodHours = this.cardConfig?.activePeriod
            ? Math.round((this.cardConfig.activePeriod.endTime.getTime() - this.cardConfig.activePeriod.startTime.getTime()) / 3_600_000)
            : undefined;
        const periodSummaryLabel = periodHours && periodHours < 24 ? `${periodHours}H` :
            periodHours ? `${Math.round(periodHours / 24)}D` : "時段";
        const deviceLabel = (this.config?.device_label ?? "WS-01").trim();
        const maintenanceDeviceLabel = deviceLabel.match(/\bWS[-–]\d+\b/i)?.[0] ?? deviceLabel.split(/\s+/)[0] ?? "WS-01";
        const layoutOrientation = resolveLayoutOrientation(this.config?.layout ?? "auto", this.responsiveMode);

        return html`
            <ha-card class=${`${this.responsiveMode} layout-${layoutOrientation}`}>
                <header class="topbar">
                    <div class="logo" aria-hidden="true"><span>U</span></div>
                    <div class="identity">
                        <strong>${this.config?.name ?? "UNINUS 氣象站"}</strong>
                        <span>${this.config?.device_label ?? "外部環境氣象站"}</span>
                    </div>
                    <div class="live-mark ${connectivity.entity && !connected ? "offline" : ""}"><i></i><span>${connected || !connectivity.entity ? "線上" : "離線"}</span></div>
                </header>

                <div class="dashboard">
                    <section class="overview">
                        <span class="atlas-kicker">現在 · 室外環境</span>
                        <div class="temperature-row">
                            <button class="temperature-hero" style=${styleMap({
                                "--metric-color": temperatureRange?.color || "var(--uninus-muted)",
                            })} ?disabled=${!temperature.entity}
                                aria-label=${`${temperature.name || "溫度"} ${temperature.value}${temperature.unit}，點擊查看詳細資料`}
                                title=${temperature.name || "溫度"}
                                @click=${() => this.showMoreInfo(temperature.entity)}>
                                <strong>${temperature.value}</strong><small>${temperature.unit}</small>
                            </button>
                            <span class="level-tag" style=${styleMap({
                                "--metric-color": temperatureRange?.color || "var(--uninus-muted)",
                            })}>${temperature.available ? (temperatureRange?.label || "正常") : "資料無法使用"}</span>
                        </div>
                        <div class="condition">
                            ${conditionSummary}
                            <span>資料更新於 ${this.formatLastUpdated(temperature.lastUpdated)}</span>
                        </div>
                        <div class="level-scale" aria-label="溫度色階">
                            <div class="scale-label ${temperatureRanges.length > 3 ? "condensed" : ""}">
                                ${temperatureRanges.map(item => html`<span style=${styleMap({ color: item.color })}>${item.label || item.from_value}</span>`)}
                            </div>
                            <div class="range-track temperature-track" aria-hidden="true">
                                ${temperatureRanges.map(item => html`<i class=${item === temperatureRange ? "active" : ""}
                                    style=${styleMap({ "--range-color": item.color })}></i>`)}
                            </div>
                        </div>

                        <div class="metrics">
                            <button class="metric-row humidity-row" ?disabled=${!humidity.entity}
                                @click=${() => this.showMoreInfo(humidity.entity)}>
                                <span class="metric-name">${humidity.name || "相對濕度"}<small>${humidity.available ? (humidityRange?.label ? `濕度${humidityRange.label}` : "正常") : "資料無法使用"}</small></span>
                                <span class="metric-value" style=${styleMap({ color: humidityRange?.color || "var(--uninus-muted)" })}>
                                    <strong>${humidity.value}</strong><small>${humidity.unit}</small>
                                </span>
                                <span class="range-track humidity-track" aria-hidden="true">
                                    ${humidityRanges.map(item => html`<i class=${item === humidityRange ? "active" : ""}
                                        style=${styleMap({ "--range-color": item.color })}></i>`)}
                                </span>
                            </button>
                            <button class="metric-row illuminance-row" ?disabled=${!illuminance.entity}
                                @click=${() => this.showMoreInfo(illuminance.entity)}>
                                <span class="metric-name">${illuminance.name || "光照度"}<small>${illuminance.available && Number(illuminance.value) >= 10000 ? "日照充足" : "即時感測值"}</small></span>
                                <span class="metric-value illuminance-value"><strong>${illuminanceDisplay.value}</strong><small>${illuminanceDisplay.unit}</small></span>
                            </button>
                        </div>

                        <button class="rain-state ${rainClass} ${rainMotion ? "animated" : ""}"
                            ?disabled=${!rain.entity} @click=${() => this.showMoreInfo(rain.entity)}>
                            <span class="rain-drops" aria-hidden="true">${rainMotion ? html`<i></i><i></i><i></i><i></i>` : ""}</span>
                            <span class="rain-icon" aria-hidden="true">☂</span>
                            <span class="rain-copy"><strong>${getRainLabel(rainClass)}</strong>
                                <small>${rainClass === "wet" ? "感測器狀態：下雨中" : rainClass === "dry" ? "感測器狀態：乾燥" : "感測器狀態無法使用"}</small></span>
                            <span class="rain-action">點擊查看</span>
                        </button>
                    </section>

                    <section class="wind-panel">
                        <div class="wind-header">
                            <div class="wind-title"><strong>風速／風向圖</strong><small>過去${periodSummaryLabel}風向頻率 × 即時風況</small></div>
                            ${this.renderAtlasButtons("period")}
                            ${this.renderAuxiliaryButtons("top")}
                        </div>
                        <div id="text-block-top" class="engine-text"></div>
                        ${this.renderAuxiliaryButtons("top-below-text")}
                        <div class="wind-main">
                            <div id="svg-container" role="img" aria-label="歷史風向玫瑰圖">
                                <span class="rose-center-overlay" aria-hidden="true"><small>現在</small><strong>${direction?.label ?? "—"}</strong></span>
                            </div>
                            <aside class="wind-current">
                                <div><span class="atlas-kicker">即時風速</span>
                                    <button class="wind-speed" style=${styleMap({ "--speed-color": speedRange?.color || "var(--uninus-green)" })}
                                        ?disabled=${!windSpeed.entity}
                                        aria-label=${`${windSpeed.name || "即時風速"} ${processedSpeed === undefined ? windSpeed.value : processedSpeed.toFixed(1)} ${currentSpeedUnit}，點擊查看詳細資料`}
                                        title=${windSpeed.name || "即時風速"}
                                        @click=${() => this.showMoreInfo(windSpeed.entity)}>
                                        <strong>${processedSpeed === undefined ? windSpeed.value : processedSpeed.toFixed(1)}</strong><small>${currentSpeedUnit}</small>
                                    </button>
                                </div>
                                <button class="wind-direction-readout" ?disabled=${!windDirection.entity}
                                    @click=${() => this.showMoreInfo(windDirection.entity)}>
                                    <span class="direction-arrow" style=${styleMap({
                                        "--direction-angle": `${direction?.degrees ?? 0}deg`,
                                        "--direction-arrow-color": directionArrowColor,
                                    })}>↑</span>
                                    <span><small>即時風向</small><strong>${direction ? `${direction.label}風` : "—"}</strong>
                                        <em>${direction ? `${direction.degrees.toFixed(0)}° · ${direction.key.toUpperCase()}` : "—"}</em></span>
                                </button>
                                <div class="stats">
                                    <div><span>${periodSummaryLabel}平均</span><strong>${windSummary.average === undefined ? "—" : `${windSummary.average.toFixed(1)} ${currentSpeedUnit}`}</strong></div>
                                    <div><span>${periodSummaryLabel}最大</span><strong>${windSummary.maximum === undefined ? "—" : `${windSummary.maximum.toFixed(1)} ${currentSpeedUnit}`}</strong></div>
                                    <div><span>靜風比例</span><strong>${windSummary.calmPercentage === undefined ? "—" : `${windSummary.calmPercentage}%`}</strong></div>
                                </div>
                            </aside>
                        </div>
                        ${speedRanges.length ? html`<div class="speed-legend" role="list" aria-label="風速色階">
                            ${speedRanges.map((range, index) => html`<span role="listitem" class=${range === speedRange ? "active" : ""}
                                style=${styleMap({ "--range-color": range.color })} title=${`${range.from_value} ${currentSpeedUnit}`}>
                                <i></i><small>${range.from_value}${index === speedRanges.length - 1 ? `+ ${currentSpeedUnit}` : `–${speedRanges[index + 1]?.from_value}`}</small>
                            </span>`)}
                        </div>` : ""}
                        <div class="timeline">
                            ${this.renderAtlasButtons("transport")}
                            ${this.renderAuxiliaryButtons("bottom-above-text")}
                            <div id="text-block-bottom" class="engine-text"></div>
                            ${this.renderAuxiliaryButtons("bottom")}
                            <span class="range">${this.formatActivePeriodRange()}</span>
                        </div>
                        ${this.errorMessage ? html`<div class="error" role="alert">${this.errorMessage}</div>` : ""}
                    </section>
                </div>

                <footer class="maintenance-strip ${maintenanceTone}">
                    <span class="maintenance-brand">UNINUS WEATHER STATION</span>
                    <span class="maintenance-summary">${maintenanceDeviceLabel}</span>
                    ${signal.entity ? html`<button @click=${() => this.showMoreInfo(signal.entity)}>
                        <span class="signal-label">訊號 </span>${signal.available ? `${signal.value}${signal.unit ? ` ${signal.unit}` : ""}` : "無法使用"}
                    </button>` : ""}
                    ${connectivity.entity ? html`<button @click=${() => this.showMoreInfo(connectivity.entity)}>
                        <i></i>${connectivity.available ? (connected ? "已連線" : "離線") : "連線狀態無法使用"}
                    </button>` : ""}
                    <span class="updated">更新 ${this.formatLastUpdated(temperature.lastUpdated)}</span>
                </footer>
            </ha-card>
        `;
    }

    private renderWeatherMetric(
        display: EntityDisplay,
        ranges: ValueRange[] | undefined,
        className: string,
        fallbackName: string,
    ): TemplateResult {
        const range = resolveValueRange(display.available ? display.value : undefined, ranges);
        return html`<section class="panel weather-metric ${className}"
            style=${styleMap({ "--metric-color": range?.color || "var(--uninus-muted)" })}>
            <div class="metric-heading"><span>${display.name || fallbackName}</span>
                <strong>${display.available ? (range?.label || "正常") : "資料無法使用"}</strong></div>
            ${this.renderMetric(display, "", "primary-reading")}
            <div class="range-track" aria-hidden="true">
                ${(ranges ?? []).map(item => html`<i class=${item === range ? "active" : ""}
                    style=${styleMap({ "--range-color": item.color })}></i>`)}
            </div>
        </section>`;
    }

    private renderMetric(display: EntityDisplay, prefix: string, className: string): TemplateResult {
        return html`<button class="metric ${className}" ?disabled=${!display.entity}
            title=${display.name || display.entity || "資料未設定"}
            @click=${() => this.showMoreInfo(display.entity)}>
            ${prefix ? html`<span>${prefix}</span>` : ""}
            <strong>${display.value}</strong>${display.unit ? html`<small>${display.unit}</small>` : ""}
        </button>`;
    }

    private renderAtlasButtons(kind: "period" | "transport"): TemplateResult {
        const buttons = (this.cardConfig?.buttonsConfig?.buttons ?? []).filter(button => kind === "period"
            ? button instanceof PeriodSelectorButton
            : button instanceof PeriodShiftButton || button instanceof PeriodShiftPlayButton);
        return this.renderButtonRows(buttons, kind === "period" ? "atlas-period-controls" : "atlas-transport-controls");
    }

    private renderAuxiliaryButtons(location: string): TemplateResult {
        const buttonsConfig = this.cardConfig?.buttonsConfig;
        const auxiliaryButtons = (buttonsConfig?.buttons ?? []).filter(button => button instanceof WindRoseSpeedSelectButton);
        if (!auxiliaryButtons.length) return html``;
        const rows = groupButtonsForLocation(
            buttonsConfig?.location ?? "",
            location,
            auxiliaryButtons,
        );
        return this.renderButtonRows(rows.flat(), `periods ${location}`);
    }

    private renderButtonRows(buttons: ButtonInterface[], className: string): TemplateResult {
        if (!buttons.length) return html``;
        const rows: ButtonInterface[][] = [];
        buttons.forEach(button => {
            if (!rows.length || button.baseConfig.newRow) rows.push([]);
            rows[rows.length - 1].push(button);
        });
        return html`<div class=${className}>
            ${rows.map(row => html`<div class="period-row">
                ${row.map(button => {
                    const shiftClass = button instanceof PeriodShiftButton
                        ? (button.shiftPeriod.startsWith("-") ? "shift-back" : "shift-forward")
                        : "";
                    const typeClass = button instanceof PeriodShiftPlayButton ? "play-button"
                        : button instanceof PeriodShiftButton ? `shift-button ${shiftClass}`
                            : button instanceof PeriodSelectorButton ? "selector-button" : "auxiliary-button";
                    const label = button.baseConfig.buttonText;
                    const stateful = button instanceof PeriodSelectorButton || button instanceof PeriodShiftPlayButton;
                    const content = button instanceof PeriodShiftPlayButton ? (button.baseConfig.active ? "Ⅱ" : "▶")
                        : button instanceof PeriodShiftButton ? (shiftClass === "shift-back" ? "‹" : "›") : label;
                    return html`<button class=${`${typeClass}${button.baseConfig.active ? " active" : ""}`}
                        aria-label=${label} title=${label}
                        aria-pressed=${stateful ? String(Boolean(button.baseConfig.active)) : undefined}
                        style=${button.baseConfig.buttonColors.getCss(button.baseConfig.active)}
                        @click=${this.handleButtonClickFunc(button)}>
                        ${content}
                    </button>`;
                })}
            </div>`)}
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
                    this.cancelPeriodShiftHighlight();
                    button.baseConfig.active = true;
                    this.periodShiftHighlightButton = button;
                    this.refreshMeasurements(false);
                    this.requestUpdate();
                    this.periodShiftHighlightTimeout = window.setTimeout(() => {
                        this.periodShiftHighlightTimeout = undefined;
                        this.periodShiftHighlightButton = undefined;
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
                    this.stopPlayback(false);
                    this.requestGeneration++;
                    this.cancelWindRosePolish();
                    this.windRoseDirigent.cancelPendingRender();
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
            this.polishWindRoseSvg();
        }
    }

    private polishWindRoseSvg(): void {
        if (!this.svg?.node) return;
        this.svg.node.querySelectorAll<SVGTextElement>("text").forEach(label => {
            if (/^\s*\d+(?:[.,]\d+)?%\s*$/.test(label.textContent ?? "")) {
                label.style.opacity = "0";
            }
        });
        this.svg.node.querySelectorAll<SVGCircleElement>("circle").forEach(ring => {
            if (Math.round(Number(ring.getAttribute("r"))) === 148 && !ring.getAttribute("fill")) {
                ring.style.opacity = "0";
            }
        });
    }

    private refreshMeasurements(animate: boolean): void {
        if (!this.initialized) return;
        this.stopPlayback();
        this.cancelWindRosePolish();
        this.windRoseDirigent.cancelPendingRender();
        const requestGeneration = ++this.requestGeneration;
        this.errorMessage = "";
        this.windRoseDirigent.refreshData(() => requestGeneration === this.requestGeneration)
            .then((holder: MeasurementHolder) => {
                if (requestGeneration !== this.requestGeneration) return;
                this.lastMeasurementHolder = holder;
                this.windRoseDirigent.renderGraphs(animate);
                this.scheduleWindRosePolish(animate);
                this.windRoseDirigent.updateStateRender();
                this.errorMessage = holder?.error?.message ?? "";
                this.requestUpdate();
            })
            .catch(error => {
                if (requestGeneration !== this.requestGeneration) return;
                this.errorMessage = error instanceof Error ? error.message : String(error ?? "無法載入風況歷史");
                this.requestUpdate();
            });
    }

    private refreshMeasurementsPlay(button: PeriodShiftPlayButton): void {
        if (!this.initialized || !this.cardConfig) return;
        this.stopPlayback(false);
        this.cancelWindRosePolish();
        this.windRoseDirigent.cancelPendingRender();
        this.playbackButton = button;
        const requestGeneration = ++this.requestGeneration;
        const cardConfig = this.cardConfig;
        this.windRoseDirigent.refreshData(() => requestGeneration === this.requestGeneration).then((holder: MeasurementHolder) => {
            if (requestGeneration !== this.requestGeneration || cardConfig !== this.cardConfig) return;
            this.lastMeasurementHolder = holder;
            this.windRoseDirigent.renderGraphs(false);
            this.scheduleWindRosePolish(false);
            this.windRoseDirigent.updateStateRender();
            this.errorMessage = holder?.error?.message ?? "";
            this.requestUpdate();
            this.playbackTimeout = window.setTimeout(() => {
                this.playbackTimeout = undefined;
                if (requestGeneration !== this.requestGeneration || cardConfig !== this.cardConfig) return;
                const moved = cardConfig.activePeriod.movePeriod(button.stepPeriod);
                if (button.baseConfig.active && moved && cardConfig.activePeriod.endTime <= button.period.endTime) {
                    this.refreshMeasurementsPlay(button);
                } else if (button.baseConfig.active) {
                    button.paused = false;
                    button.baseConfig.active = false;
                    this.requestUpdate();
                }
            }, button.delay);
        }).catch(error => {
            if (requestGeneration !== this.requestGeneration) return;
            button.baseConfig.active = false;
            this.errorMessage = error instanceof Error ? error.message : String(error ?? "無法載入風況歷史");
            this.requestUpdate();
        });
    }

    private stopPlayback(deactivate = true): void {
        if (this.playbackTimeout !== undefined) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = undefined;
        }
        if (deactivate && this.playbackButton) {
            this.playbackButton.baseConfig.active = false;
            this.playbackButton.paused = false;
            this.playbackButton = undefined;
        }
    }

    private cancelPeriodShiftHighlight(): void {
        if (this.periodShiftHighlightTimeout !== undefined) {
            clearTimeout(this.periodShiftHighlightTimeout);
            this.periodShiftHighlightTimeout = undefined;
        }
        if (this.periodShiftHighlightButton) {
            this.periodShiftHighlightButton.baseConfig.active = false;
            this.periodShiftHighlightButton = undefined;
        }
    }

    private cancelPendingWork(): void {
        this.requestGeneration++;
        this.stopPlayback();
        this.cancelPeriodShiftHighlight();
        this.cancelWindRosePolish();
        this.windRoseDirigent.cancelPendingRender();
    }

    private scheduleWindRosePolish(animate: boolean): void {
        this.cancelWindRosePolish();
        this.windRosePolishTimeout = window.setTimeout(() => {
            this.windRosePolishTimeout = undefined;
            this.polishWindRoseSvg();
        }, animate ? 300 : 0);
    }

    private cancelWindRosePolish(): void {
        if (this.windRosePolishTimeout !== undefined) {
            clearTimeout(this.windRosePolishTimeout);
            this.windRosePolishTimeout = undefined;
        }
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

    private describeTemperature(value: number | undefined): string {
        if (value === undefined || !Number.isFinite(value)) return "環境狀態待確認";
        if (value < 18) return "偏涼";
        if (value <= 25) return "舒適";
        if (value <= 30) return "溫暖";
        return "炎熱";
    }

    private describeWind(value: number | undefined): string {
        if (value === undefined || !Number.isFinite(value)) return "";
        if (value <= 0.5) return "靜風";
        if (value <= 5.4) return "微風";
        if (value <= 10.7) return "和風";
        return "強風";
    }

    private summarizeWindHistory(index: number): {
        average: number | undefined;
        maximum: number | undefined;
        calmPercentage: number | undefined;
    } {
        const windEntity = this.cardConfig?.windspeedEntities?.[index];
        let convertSpeed = (value: number): number => value;
        let calmThreshold = 0.5;
        if (windEntity?.outputSpeedUnit && windEntity.speedUnit) {
            const stateAttributes = this._hass?.states[windEntity.entity]?.attributes;
            const inputUnit = windEntity.speedUnit === "auto"
                ? String(stateAttributes?.unit_of_measurement ?? stateAttributes?.wind_speed_unit ?? "").toLowerCase()
                : windEntity.speedUnit;
            if (!inputUnit) return { average: undefined, maximum: undefined, calmPercentage: undefined };
            try {
                const outputUnit = SpeedUnits.getSpeedUnit(windEntity.outputSpeedUnit);
                const converter = new WindSpeedConverter(
                    outputUnit,
                    windEntity.compensationFactor,
                    windEntity.compensationAbsolute,
                );
                convertSpeed = converter.getSpeedConverterFunc(inputUnit);
                calmThreshold = converter.getSpeedConverterFunc("mps")(0.5);
            } catch {
                return { average: undefined, maximum: undefined, calmPercentage: undefined };
            }
        }
        const activePeriod = this.cardConfig?.activePeriod;
        const periodStart = activePeriod ? activePeriod.startTime.getTime() / 1000 : Number.NaN;
        const periodEnd = activePeriod ? activePeriod.endTime.getTime() / 1000 : Number.NaN;
        const boundedPeriod = Number.isFinite(periodStart) && Number.isFinite(periodEnd);
        const samples = (this.lastMeasurementHolder?.speedMeasurements[index] ?? [])
            .map(measurement => {
                const start = Number(measurement.startTime);
                const end = Number(measurement.endTime);
                const duration = Number.isFinite(start) && Number.isFinite(end)
                    ? Math.max(0, Math.min(end, boundedPeriod ? periodEnd : end) -
                        Math.max(start, boundedPeriod ? periodStart : start))
                    : 0;
                return { value: convertSpeed(Number(measurement.value)), duration };
            })
            .filter(sample => Number.isFinite(sample.value) && (!boundedPeriod || sample.duration > 0));
        if (!samples.length) return { average: undefined, maximum: undefined, calmPercentage: undefined };
        const totalDuration = samples.reduce((sum, sample) => sum + sample.duration, 0);
        const weighted = totalDuration > 0;
        const average = weighted
            ? samples.reduce((sum, sample) => sum + sample.value * sample.duration, 0) / totalDuration
            : samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
        const calmPercentage = weighted
            ? samples.filter(sample => sample.value <= calmThreshold)
                .reduce((sum, sample) => sum + sample.duration, 0) / totalDuration * 100
            : samples.filter(sample => sample.value <= calmThreshold).length / samples.length * 100;
        return {
            average,
            maximum: Math.max(...samples.map(sample => sample.value)),
            calmPercentage: Math.round(calmPercentage),
        };
    }

    private formatIlluminance(value: string, unit: string): { value: string; unit: string } {
        const numericValue = Number(value);
        if (unit.trim().toLowerCase() === "lx" && Number.isFinite(numericValue) && numericValue >= 1000) {
            return { value: (numericValue / 1000).toFixed(1), unit: "klx" };
        }
        return { value, unit };
    }

    private formatActivePeriodRange(): string {
        const period = this.cardConfig?.activePeriod;
        if (!period?.startTime || !period?.endTime) return "—";
        const formatter = new Intl.DateTimeFormat(this._hass?.locale?.language || undefined, {
            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        return `${formatter.format(period.startTime)} — ${formatter.format(period.endTime)}`;
    }

    private formatLastUpdated(value: string | undefined): string {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat(this._hass?.locale?.language || undefined, {
            hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(date);
    }

    public static get styles(): CSSResultGroup {
        return css`
            :host { display: block; color: var(--primary-text-color); }
            * { box-sizing: border-box; }
            ha-card {
                --uninus-surface: #fbfaf5;
                --uninus-ink: #173c3b;
                --uninus-muted: #5f746f;
                --uninus-line: #d7dfd8;
                --uninus-teal: #087f72;
                --uninus-green: #168e72;
                container-type: inline-size;
                display: block;
                width: 100%; overflow: hidden;
                border: 1px solid rgba(23, 60, 59, .14);
                border-radius: 28px;
                color: var(--uninus-ink);
                background: var(--uninus-surface);
                box-shadow: 0 22px 55px rgba(23, 60, 59, .14);
                font-family: "Avenir Next", "Segoe UI Variable", "Noto Sans TC", sans-serif;
                -webkit-font-smoothing: antialiased;
            }
            button { font: inherit; }
            button:focus-visible { outline: 2px solid var(--uninus-teal); outline-offset: 2px; }
            .topbar { height: 76px; padding: 0 28px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--uninus-line); }
            .logo { width: 42px; height: 42px; flex: 0 0 42px; position: relative; display: grid; place-items: center; border-radius: 50%; background: var(--uninus-ink); color: #fff; }
            .logo::after { content: ""; position: absolute; inset: 5px; border: 1px solid #ffffff80; border-radius: 50%; }
            .logo span { font: 700 18px/1 Georgia, serif; }
            .identity { min-width: 0; display: grid; gap: 2px; }
            .identity strong { font: 700 17px/1.1 Georgia, "Noto Serif TC", serif; letter-spacing: .03em; }
            .identity > span { color: var(--uninus-muted); font-size: 11px; letter-spacing: .1em; }
            .atlas-kicker { color: var(--uninus-teal); font-size: 11px; font-weight: 800; letter-spacing: .15em; }
            .live-mark { margin-left: auto; display: flex; align-items: center; gap: 9px; color: var(--uninus-teal); font-size: 12px; font-weight: 800; white-space: nowrap; }
            .live-mark i, .maintenance-strip button i { width: 7px; height: 7px; border-radius: 50%; background: #20a879; box-shadow: 0 0 0 5px #20a8791f; }
            .live-mark.offline { color: var(--error-color, #c7443e); }
            .live-mark.offline i { background: currentColor; box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 12%, transparent); }
            .dashboard { display: grid; grid-template-columns: minmax(0, .88fr) minmax(0, 1.42fr); min-height: 548px; }
            .overview { min-width: 0; padding: 30px 30px 24px; display: flex; flex-direction: column; border-right: 1px solid var(--uninus-line); background: linear-gradient(150deg, #fbfaf5 5%, #edf3ec 100%); }
            .temperature-row { margin-top: 12px; display: flex; align-items: flex-start; gap: 14px; }
            .temperature-hero, .metric-row, .rain-state, .wind-speed, .wind-direction-readout, .maintenance-strip button { appearance: none; border: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; }
            .temperature-hero:disabled, .metric-row:disabled, .rain-state:disabled, .wind-speed:disabled, .wind-direction-readout:disabled { cursor: default; opacity: 1; }
            .temperature-hero { display: inline-flex; align-items: flex-start; color: var(--metric-color); letter-spacing: -.06em; }
            .temperature-hero strong { font-family: Georgia, "Times New Roman", serif; font-size: clamp(76px, 8cqi, 104px); font-weight: 400; line-height: .88; }
            .temperature-hero small { margin: 8px 0 0 7px; color: inherit; font-size: 21px; font-weight: 600; letter-spacing: 0; }
            .level-tag { margin-top: 8px; padding: 6px 9px; border: 1px solid color-mix(in srgb, var(--metric-color) 45%, var(--uninus-line)); border-radius: 99px; background: color-mix(in srgb, var(--metric-color) 9%, transparent); color: var(--metric-color); font-size: 11px; font-weight: 800; white-space: nowrap; }
            .condition { margin-top: 12px; font: 600 18px/1.25 Georgia, "Noto Serif TC", serif; }
            .condition span { display: block; margin-top: 5px; color: var(--uninus-muted); font: 400 12px/1.5 "Segoe UI Variable", sans-serif; }
            .level-scale { margin-top: 18px; }
            .scale-label { display: flex; justify-content: space-between; gap: 8px; color: var(--uninus-muted); font-size: 10px; }
            .scale-label.condensed span:last-child { display: none; }
            .range-track { display: flex; gap: 0; }
            .range-track i { flex: 1; position: relative; border-radius: 0; background: color-mix(in srgb, var(--range-color) 65%, #eef2ed); }
            .range-track i:first-child { border-radius: 99px 0 0 99px; }
            .range-track i:last-child { border-radius: 0 99px 99px 0; }
            .range-track i.active { background: var(--range-color); }
            .range-track i.active::after { content: ""; position: absolute; z-index: 1; left: 50%; top: 50%; width: 9px; height: 9px; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; background: var(--range-color); box-shadow: 0 1px 4px rgba(23, 60, 59, .35); }
            .temperature-track { height: 5px; margin-top: 8px; }
            .metrics { margin-top: 25px; border-top: 1px solid var(--uninus-line); }
            .metric-row { width: 100%; min-height: 70px; display: grid; grid-template-columns: 1fr auto; align-items: center; text-align: left; border-bottom: 1px solid var(--uninus-line); }
            .metric-row:hover .metric-name { color: var(--uninus-teal); }
            .metric-name { display: grid; gap: 4px; color: var(--uninus-muted); font-size: 13px; }
            .metric-name small { font-size: 10px; }
            .metric-value { display: flex; align-items: baseline; gap: 4px; }
            .metric-value strong { font: 600 29px/1 Georgia, serif; }
            .metric-value small { color: var(--uninus-muted); font-size: 11px; }
            .humidity-track { grid-column: 1 / -1; height: 3px; margin: -9px 0 11px; }
            .illuminance-value { color: #b57325; }
            .rain-state { width: 100%; margin-top: 16px; min-height: 74px; padding: 14px 15px; position: relative; overflow: hidden; display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 12px; border: 1px solid var(--uninus-line); border-radius: 16px; background: #f6f7f1; text-align: left; transition: .3s; }
            .rain-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; background: #e8efea; color: var(--uninus-teal); font-size: 20px; }
            .rain-copy { display: grid; gap: 3px; }
            .rain-copy strong { font-size: 14px; }
            .rain-copy small, .rain-action { color: var(--uninus-muted); font-size: 10px; }
            .rain-drops { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
            .rain-drops i { position: absolute; top: -16px; width: 2px; height: 13px; border-radius: 99px; background: #67a8cc; transform: rotate(12deg); animation: rain-fall 1.1s linear infinite; }
            .rain-drops i:nth-child(1) { left: 15%; animation-delay: -.1s; }
            .rain-drops i:nth-child(2) { left: 36%; animation-delay: -.7s; }
            .rain-drops i:nth-child(3) { left: 62%; animation-delay: -.35s; }
            .rain-drops i:nth-child(4) { left: 84%; animation-delay: -.9s; }
            .rain-state.wet { border-color: #7bb1cb; background: linear-gradient(110deg, #e8f3f6, #dcecf2); color: #245c78; }
            .rain-state.wet .rain-icon { background: #2f7398; color: #fff; }
            .rain-state.wet .rain-drops { opacity: .7; }
            .rain-state.wet .rain-copy small, .rain-state.wet .rain-action { color: #487487; }
            .rain-state.unknown, .rain-state.unavailable { filter: saturate(.55); }
            @keyframes rain-fall { to { transform: translate(18px, 100px) rotate(12deg); } }
            .wind-panel { min-width: 0; grid-template-columns: minmax(0, 1fr); padding: 23px 27px 18px; display: grid; grid-template-rows: auto auto auto 1fr auto auto; }
            .wind-header { display: flex; align-items: center; gap: 15px; }
            .wind-title { display: grid; gap: 3px; }
            .wind-title strong { font: 600 19px/1.1 Georgia, "Noto Serif TC", serif; }
            .wind-title small { color: var(--uninus-muted); font-size: 11px; }
            .periods, .atlas-period-controls, .atlas-transport-controls { display: grid; gap: 4px; }
            .wind-header .periods, .wind-header .atlas-period-controls { margin-left: auto; }
            .period-row { display: flex; gap: 2px; padding: 4px; border-radius: 12px; background: #edf0e9; }
            .periods button, .atlas-period-controls button { min-width: 43px; min-height: 34px; padding: 0 9px; border: 0 !important; border-radius: 9px; background: transparent !important; color: var(--uninus-muted) !important; cursor: pointer; font-size: 11px; font-weight: 800; box-shadow: none !important; }
            .periods button:hover, .atlas-period-controls button:hover { background: #fff !important; color: var(--uninus-ink) !important; }
            .periods button.active, .atlas-period-controls button.active { background: var(--uninus-ink) !important; color: #fff !important; outline: 0; box-shadow: 0 3px 8px #173c3b2e !important; }
            .wind-main { display: grid; grid-template-columns: minmax(320px, 1fr) 178px; align-items: center; gap: 6px; min-height: 390px; }
            #svg-container { min-width: 0; height: 366px; padding: 0; position: relative; }
            #svg-container svg { position: relative; z-index: 1; width: 100%; height: 100%; overflow: visible; }
            #svg-container svg circle[r="148"] { opacity: 0; }
            .rose-center-overlay { position: absolute; z-index: 2; left: 50%; top: 50%; width: 54px; height: 54px; transform: translate(-50%, -50%); display: grid; place-content: center; gap: 1px; border: 2px solid var(--uninus-ink); border-radius: 50%; background: var(--uninus-surface); color: var(--uninus-ink); text-align: center; pointer-events: none; box-shadow: 0 3px 11px rgba(23, 60, 59, .12); }
            .rose-center-overlay small { color: var(--uninus-teal); font-size: 8px; font-weight: 800; letter-spacing: .14em; }
            .rose-center-overlay strong { font: 700 14px/1 Georgia, "Noto Serif TC", serif; }
            .wind-current { min-width: 0; padding-left: 20px; display: grid; align-content: center; border-left: 1px solid var(--uninus-line); }
            .wind-speed { min-width: 44px; min-height: 44px; margin-top: 9px; display: inline-flex; align-items: baseline; color: var(--speed-color); }
            .wind-speed strong { font: 400 58px/.95 Georgia, serif; letter-spacing: -.04em; }
            .wind-speed small { margin-left: 5px; color: var(--uninus-muted); font-size: 11px; }
            .wind-direction-readout { width: 100%; margin-top: 18px; padding-top: 15px; display: grid; grid-template-columns: 0 1fr; text-align: left; border-top: 1px solid var(--uninus-line); }
            .direction-arrow { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; color: var(--direction-arrow-color); transform: rotate(var(--direction-angle)); }
            .wind-direction-readout > span:last-child { display: grid; gap: 5px; }
            .wind-direction-readout small { color: var(--uninus-muted); font-size: 10px; }
            .wind-direction-readout strong { font: 600 23px/1 Georgia, "Noto Serif TC", serif; }
            .wind-direction-readout strong { white-space: nowrap; }
            .wind-direction-readout em { color: var(--uninus-muted); font-size: 11px; font-style: normal; }
            .stats { margin-top: 22px; display: grid; gap: 9px; color: var(--uninus-muted); font-size: 11px; }
            .stats div { display: flex; justify-content: space-between; gap: 8px; }
            .stats strong { color: var(--uninus-ink); font-weight: 800; text-align: right; }
            .speed-legend { margin: 0 0 9px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
            .speed-legend span { min-width: 0; display: grid; gap: 4px; color: var(--uninus-muted); opacity: .76; font-size: 9px; }
            .speed-legend span.active { color: var(--uninus-ink); opacity: 1; font-weight: 800; }
            .speed-legend i { width: 100%; height: 4px; border-radius: 99px; background: var(--range-color); }
            .speed-legend small { font-size: 9px; }
            .timeline { min-height: 50px; display: flex; align-items: center; gap: 7px; border-top: 1px solid var(--uninus-line); }
            .atlas-transport-controls .period-row { padding: 0; background: transparent; }
            .atlas-transport-controls button { width: 38px; min-width: 38px; height: 36px; padding: 0; border: 0; border-radius: 9px; background: transparent !important; color: var(--uninus-muted) !important; cursor: pointer; font: 700 18px/1 Georgia, serif; }
            .atlas-transport-controls .play-button { border-radius: 50%; background: var(--uninus-teal) !important; color: #fff !important; font-family: "Segoe UI Symbol", sans-serif; font-size: 13px; box-shadow: 0 4px 10px rgba(8, 127, 114, .2) !important; }
            .atlas-transport-controls button:hover { background: #edf0e9 !important; color: var(--uninus-ink) !important; }
            .atlas-transport-controls .play-button:hover { background: var(--uninus-ink) !important; color: #fff !important; }
            .timeline > .periods { margin: 5px 0; }
            .timeline .period-row { background: transparent; }
            .timeline .periods button { min-width: 38px; font-size: 11px; }
            .range { margin-left: auto; color: var(--uninus-muted); font-size: 11px; white-space: nowrap; }
            .range::before { content: ""; display: inline-block; width: 72px; height: 2px; margin: 0 10px 3px 0; background: linear-gradient(90deg, var(--uninus-teal) 58%, var(--uninus-line) 58%); }
            .engine-text { padding: 4px 0; overflow-wrap: anywhere; color: var(--uninus-muted); font-size: 11px; }
            .engine-text:empty { display: none; }
            .error { margin: 8px 0; padding: 8px; border-radius: 8px; color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 8%, transparent); font-size: 12px; }
            .maintenance-strip { min-height: 42px; padding: 0 28px; display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--uninus-line); color: var(--uninus-muted); font-size: 10px; letter-spacing: .06em; }
            .maintenance-brand { color: inherit; font-weight: 400; }
            .maintenance-summary { margin-left: auto; }
            .maintenance-strip button { min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; gap: 6px; color: inherit; font-size: inherit; }
            .maintenance-strip button:first-of-type { color: inherit; font-weight: 400; }
            .maintenance-strip button i { display: none; }
            .maintenance-strip .signal-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
            .maintenance-strip .updated { white-space: nowrap; }
            .maintenance-strip.weak { color: #b56c19; }
            .maintenance-strip.offline { color: var(--error-color, #c7443e); }
            .maintenance-strip.offline button i { background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); }
            ha-card.layout-vertical .dashboard { grid-template-columns: 1fr; }
            ha-card.layout-vertical .overview { border-right: 0; border-bottom: 1px solid var(--uninus-line); }
            ha-card:is(.compact, .narrow, .small) .overview { padding: 24px 20px 20px; }
            ha-card:is(.compact, .narrow, .small) .temperature-hero strong { font-size: 84px; }
            ha-card:is(.compact, .narrow, .small) .wind-panel { padding: 21px 18px 16px; }
            ha-card:is(.compact, .narrow, .small) .wind-header { align-items: flex-start; flex-wrap: wrap; }
            ha-card:is(.compact, .narrow, .small) .wind-header .periods, ha-card:is(.compact, .narrow, .small) .wind-header .atlas-period-controls { order: 3; width: 100%; margin: 7px 0 0; }
            ha-card:is(.compact, .narrow, .small) .period-row { width: 100%; }
            ha-card:is(.compact, .narrow, .small) .periods button, ha-card:is(.compact, .narrow, .small) .atlas-period-controls button { min-height: 44px; flex: 1; }
            ha-card:is(.compact, .narrow, .small) .atlas-transport-controls button { min-width: 44px; width: 44px; min-height: 44px; height: 44px; }
            ha-card:is(.compact, .narrow, .small) .wind-main { grid-template-columns: 1fr; min-height: 0; }
            ha-card:is(.compact, .narrow, .small) #svg-container { height: 350px; }
            ha-card:is(.compact, .narrow, .small) .wind-current { padding: 15px 0 5px; grid-template-columns: 1.05fr 1fr 1.1fr; align-items: end; border-left: 0; border-top: 1px solid var(--uninus-line); }
            ha-card:is(.compact, .narrow, .small) .wind-speed strong { font-size: 43px; }
            ha-card:is(.compact, .narrow, .small) .wind-direction-readout { margin: 0; padding: 0 0 4px 15px; border-top: 0; border-left: 1px solid var(--uninus-line); }
            ha-card:is(.compact, .narrow, .small) .stats { margin: 0; padding: 0 0 4px 15px; border-left: 1px solid var(--uninus-line); }
            ha-card:is(.compact, .narrow, .small) .maintenance-strip { flex-wrap: wrap; padding: 8px 18px; }
            ha-card:is(.compact, .narrow, .small) .maintenance-strip button { min-height: 44px; padding-inline: 8px; }
            ha-card:is(.compact, .narrow, .small) .maintenance-strip .updated { margin-left: auto; }
            ha-card:is(.narrow, .small) .topbar { height: 68px; padding: 0 18px; }
            ha-card:is(.narrow, .small) .range::before { display: none; }
            ha-card.small .identity > span { font-size: 10px; letter-spacing: .03em; }
            ha-card.small .temperature-row { gap: 8px; }
            ha-card.small .temperature-hero strong { font-size: 74px; }
            ha-card.small .level-scale { margin-top: 14px; }
            ha-card.small .metrics { margin-top: 20px; }
            ha-card.small .metric-row { min-height: 64px; }
            ha-card.small .rain-state { margin-top: 14px; }
            ha-card.small #svg-container { height: 302px; }
            ha-card.small .wind-current { grid-template-columns: 1fr 1fr; }
            ha-card.small .stats { grid-column: 1 / -1; margin-top: 13px; padding: 13px 0 0; border-left: 0; border-top: 1px solid var(--uninus-line); grid-template-columns: 1fr 1fr; gap: 6px; }
            ha-card.small .stats div:last-child { grid-column: 1 / -1; }
            ha-card.small .maintenance-brand { display: none; }
            ha-card.small .maintenance-summary { margin-left: 0; color: var(--uninus-ink); font-weight: 800; }
            ha-card.small .maintenance-strip { min-height: 44px; padding: 0 18px; flex-wrap: nowrap; gap: 5px; font-size: 10px; letter-spacing: 0; }
            ha-card.small .maintenance-strip button { min-width: 0; min-height: 44px; padding-inline: 3px; white-space: nowrap; }
            ha-card.small .speed-legend span, ha-card.small .speed-legend small { font-size: 8px; }
            ha-card.small .maintenance-strip .updated { margin-left: 0; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .overview { padding: 18px 12px; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .temperature-row { display: grid; gap: 6px; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .temperature-hero strong { font-size: clamp(44px, 11cqi, 64px); }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .level-tag { justify-self: start; white-space: normal; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .timeline { flex-wrap: wrap; padding-block: 4px; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .timeline .range { width: 100%; margin-left: 0; text-align: right; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) .range::before { display: none; }
            ha-card.layout-horizontal:is(.compact, .narrow, .small) #svg-container { overflow: hidden; }
            @container (max-width: 340px) {
                .timeline { flex-wrap: wrap; padding-block: 4px; }
                .timeline .range { width: 100%; margin-left: 0; text-align: right; }
                #svg-container { overflow: hidden; }
            }
            @media (prefers-reduced-motion: reduce) {
                .rain-drops i { animation: none !important; }
            }
        `;
    }
}
