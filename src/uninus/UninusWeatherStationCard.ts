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
    private requestGeneration = 0;
    private playbackTimeout?: number;
    private playbackButton?: PeriodShiftPlayButton;
    private periodShiftHighlightTimeout?: number;
    private periodShiftHighlightButton?: PeriodShiftButton;
    private refreshOnReconnect = false;

    public setConfig(config: UninusWeatherStationCardConfig): void {
        this.cancelPendingWork();
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

        return html`
            <ha-card class=${this.responsiveMode}>
                <header>
                    <div class="logo" aria-hidden="true"><span>U</span></div>
                    <div class="identity">
                        <span class="atlas-kicker">ATMOSPHERIC ATLAS · LIVE</span>
                        <strong>${this.config?.name ?? "UNINUS 氣象站"}</strong>
                        <span>${this.config?.device_label ?? "外部環境氣象站"}</span>
                    </div>
                    <div class="live-mark"><i></i><span>即時監測</span></div>
                </header>

                <main>
                    <aside class="column environment-column">
                        <section class="panel section-heading">
                            <span class="section-index">01</span>
                            <div><span class="eyebrow">ENVIRONMENT</span><strong>室外環境</strong></div>
                        </section>
                        ${this.renderWeatherMetric(temperature, weather?.temperature.value_ranges, "temperature", "溫度")}
                        ${this.renderWeatherMetric(humidity, weather?.humidity.value_ranges, "humidity", "相對濕度")}
                    </aside>

                    <section class="panel wind-panel">
                        <div class="wind-header">
                            <div class="wind-title">
                                <span class="section-index">02</span>
                                <div><span class="eyebrow">WIND HISTORY</span><strong>風速／風向圖</strong></div>
                            </div>
                            ${this.renderButtons("top")}
                        </div>
                        <div id="text-block-top" class="engine-text"></div>
                        ${this.renderButtons("top-below-text")}
                        <div class="wind-content">
                            <div id="svg-container" role="img" aria-label="歷史風向玫瑰圖"></div>
                            <aside class="wind-current">
                                <span class="eyebrow">目前風況</span>
                                <button class="wind-speed" style=${styleMap({ "--speed-color": speedRange?.color || "var(--uninus-green)" })}
                                    ?disabled=${!windSpeed.entity} @click=${() => this.showMoreInfo(windSpeed.entity)}>
                                    <strong>${processedSpeed === undefined ? windSpeed.value : processedSpeed.toFixed(1)}</strong>
                                    <small>${currentSpeedUnit}</small>
                                </button>
                                <button class="wind-direction-readout" ?disabled=${!windDirection.entity}
                                    @click=${() => this.showMoreInfo(windDirection.entity)}>
                                    <span class="direction-arrow" style=${styleMap({
                                        "--direction-angle": `${direction?.degrees ?? 0}deg`,
                                        "--direction-arrow-color": directionArrowColor,
                                    })}>↑</span>
                                    <span><strong>${direction?.label ?? "—"}</strong><small>${direction ? `${direction.degrees.toFixed(0)}°` : "—"}</small></span>
                                </button>
                                ${speedRanges.length ? html`<div class="speed-legend" role="list" aria-label="風速色階">
                                    ${speedRanges.map((range, index) => html`<span role="listitem" class=${range === speedRange ? "active" : ""}
                                        style=${styleMap({ "--range-color": range.color })}
                                        title=${`${range.from_value} ${currentSpeedUnit}`}>
                                        <i></i><small>${range.from_value}${index === speedRanges.length - 1 ? "+" : ""}</small>
                                    </span>`)}
                                </div>` : ""}
                            </aside>
                        </div>
                        ${this.renderButtons("bottom-above-text")}
                        <div id="text-block-bottom" class="engine-text"></div>
                        ${this.renderButtons("bottom")}
                        ${this.errorMessage ? html`<div class="error" role="alert">${this.errorMessage}</div>` : ""}
                    </section>

                    <aside class="column conditions-column">
                        <section class="panel section-heading">
                            <span class="section-index">03</span>
                            <div><span class="eyebrow">CONDITIONS</span><strong>現場狀態</strong></div>
                        </section>
                        <section class="panel light-panel">
                            <span class="weather-icon" aria-hidden="true">☀</span>
                            <div><span class="eyebrow">${illuminance.name || "光照度"}</span>
                                ${this.renderMetric(illuminance, "", "sensor-value")}</div>
                        </section>
                        <section class="panel rain ${rainClass} ${rainMotion ? "animated" : ""}">
                            <div class="rain-copy">
                                <span class="eyebrow">${rain.name || "降雨狀態"}</span>
                                <button class="rain-value" ?disabled=${!rain.entity}
                                    @click=${() => this.showMoreInfo(rain.entity)}>${getRainLabel(rainClass)}</button>
                                <span class="rain-detail">二元降雨感測</span>
                            </div>
                            <div class="rain-symbol" aria-hidden="true">
                                <span class="cloud">☁</span>
                                ${rainMotion ? html`<span class="rain-motion">
                                    <i></i><i></i><i></i><i></i>
                                    <b></b><b></b>
                                </span>` : html`<span class="rain-static">${rainClass === "dry" ? "◇" : "—"}</span>`}
                            </div>
                        </section>
                    </aside>
                </main>

                <footer class="maintenance-strip ${maintenanceTone}">
                    <span class="maintenance-brand">UNINUS WEATHER STATION</span>
                    <span>${this.config?.device_label ?? "外部環境氣象站"}</span>
                    ${connectivity.entity ? html`<button @click=${() => this.showMoreInfo(connectivity.entity)}>
                        <i></i>${connectivity.available ? (connected ? "已連線" : "離線") : "連線狀態無法使用"}
                    </button>` : ""}
                    ${signal.entity ? html`<button @click=${() => this.showMoreInfo(signal.entity)}>
                        訊號 ${signal.available ? `${signal.value}${signal.unit ? ` ${signal.unit}` : ""}` : "無法使用"}
                    </button>` : ""}
                    <span class="updated">最後更新 ${this.formatLastUpdated(temperature.lastUpdated)}</span>
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

    private renderButtons(location: string): TemplateResult {
        const buttonsConfig = this.cardConfig?.buttonsConfig;
        const rows = groupButtonsForLocation(
            buttonsConfig?.location ?? "",
            location,
            buttonsConfig?.buttons ?? [],
        );
        if (!rows.length) {
            return html``;
        }
        return html`<div class="periods ${location}">
            ${rows.map(row => html`<div class="period-row">
                ${row.map(button => html`
                    <button class=${button.baseConfig.active ? "active" : ""}
                        style=${button.baseConfig.buttonColors.getCss(button.baseConfig.active)}
                        @click=${this.handleButtonClickFunc(button)}>
                        ${button.baseConfig.buttonText}
                    </button>
                `)}
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
        }
    }

    private refreshMeasurements(animate: boolean): void {
        if (!this.initialized) return;
        this.stopPlayback();
        this.windRoseDirigent.cancelPendingRender();
        const requestGeneration = ++this.requestGeneration;
        this.errorMessage = "";
        this.windRoseDirigent.refreshData(() => requestGeneration === this.requestGeneration)
            .then((holder: MeasurementHolder) => {
                if (requestGeneration !== this.requestGeneration) return;
                this.windRoseDirigent.renderGraphs(animate);
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
        this.windRoseDirigent.cancelPendingRender();
        this.playbackButton = button;
        const requestGeneration = ++this.requestGeneration;
        const cardConfig = this.cardConfig;
        this.windRoseDirigent.refreshData(() => requestGeneration === this.requestGeneration).then((holder: MeasurementHolder) => {
            if (requestGeneration !== this.requestGeneration || cardConfig !== this.cardConfig) return;
            this.windRoseDirigent.renderGraphs(false);
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
        this.windRoseDirigent.cancelPendingRender();
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
                --uninus-green: #176d58;
                --uninus-teal: #178b83;
                --uninus-ink: var(--primary-text-color, #17362e);
                --uninus-muted: var(--secondary-text-color, #6f817a);
                --uninus-line: color-mix(in srgb, var(--uninus-green) 15%, var(--divider-color, #dce7e0));
                --uninus-paper: color-mix(in srgb, var(--card-background-color, #fff) 95%, #f3eddf);
                container-type: inline-size;
                overflow: hidden;
                border-radius: var(--ha-card-border-radius, 24px);
                color: var(--uninus-ink);
                background:
                    radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--uninus-green) 10%, transparent), transparent 28%),
                    linear-gradient(145deg, var(--uninus-paper), color-mix(in srgb, var(--uninus-paper) 88%, #e5f0e9));
                box-shadow: 0 14px 42px color-mix(in srgb, #123b31 13%, transparent);
            }
            button { font: inherit; }
            button:focus-visible { outline: 2px solid var(--uninus-teal); outline-offset: 2px; }
            header { min-height: 82px; padding: 15px 20px; display: flex; align-items: center; gap: 13px; border-bottom: 1px solid var(--uninus-line); }
            .logo { width: 47px; height: 47px; flex: 0 0 47px; border-radius: 15px 15px 15px 5px; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, #1e826b, #125545); box-shadow: 0 7px 16px color-mix(in srgb, var(--uninus-green) 25%, transparent); }
            .logo span { font-family: Georgia, serif; font-size: 25px; font-weight: 800; }
            .identity { min-width: 0; display: grid; gap: 2px; }
            .identity strong { font-family: Georgia, "Noto Serif TC", serif; font-size: 19px; letter-spacing: .02em; }
            .identity > span:last-child { color: var(--uninus-muted); font-size: 11px; }
            .atlas-kicker, .eyebrow { color: var(--uninus-teal); font-size: 10px; font-weight: 750; letter-spacing: .15em; }
            .live-mark { margin-left: auto; display: flex; align-items: center; gap: 7px; color: var(--uninus-muted); font-size: 11px; white-space: nowrap; }
            .live-mark i, .maintenance-strip button i { width: 7px; height: 7px; border-radius: 50%; background: #2e9a69; box-shadow: 0 0 0 4px color-mix(in srgb, #2e9a69 13%, transparent); }
            main { display: grid; grid-template-columns: minmax(174px, .72fr) minmax(360px, 1.8fr) minmax(174px, .72fr); gap: 12px; padding: 12px; }
            .column { min-width: 0; display: grid; align-content: start; gap: 10px; }
            .panel { min-width: 0; padding: 14px; border: 1px solid var(--uninus-line); border-radius: 17px; background: color-mix(in srgb, var(--card-background-color, #fff) 83%, transparent); box-shadow: inset 0 1px color-mix(in srgb, #fff 60%, transparent); }
            .section-heading { min-height: 58px; display: flex; align-items: center; gap: 10px; background: transparent; box-shadow: none; }
            .section-heading > div, .wind-title > div { display: grid; gap: 2px; }
            .section-heading strong, .wind-title strong { font-family: Georgia, "Noto Serif TC", serif; font-size: 14px; }
            .section-index { color: color-mix(in srgb, var(--uninus-green) 38%, transparent); font-family: Georgia, serif; font-size: 25px; font-style: italic; }
            .weather-metric { min-height: 132px; display: grid; align-content: space-between; gap: 10px; }
            .metric-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--uninus-muted); font-size: 11px; }
            .metric-heading strong { color: var(--metric-color); font-size: 10px; letter-spacing: .08em; }
            .metric, .wind-speed, .wind-direction-readout, .rain-value, .maintenance-strip button { appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
            .metric:disabled, .wind-speed:disabled, .wind-direction-readout:disabled, .rain-value:disabled { cursor: default; opacity: 1; }
            .primary-reading { display: inline-flex; align-items: flex-start; justify-content: flex-start; gap: 3px; color: var(--metric-color); }
            .primary-reading strong { font-family: Georgia, "Noto Serif TC", serif; font-size: clamp(35px, 4.2cqw, 48px); font-weight: 400; line-height: .95; }
            .primary-reading small { font-size: 14px; font-weight: 650; }
            .range-track { height: 4px; display: flex; gap: 3px; }
            .range-track i { flex: 1; border-radius: 4px; background-color: color-mix(in srgb, var(--range-color) 32%, transparent); }
            .range-track i.active { background-color: var(--range-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--range-color) 13%, transparent); }
            .wind-panel { padding: 0; overflow: hidden; }
            .wind-header { min-height: 59px; padding: 9px 13px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--uninus-line); }
            .wind-title { display: flex; align-items: center; gap: 9px; }
            .periods { margin: 8px 12px; display: grid; gap: 4px; }
            .wind-header .periods { margin: 0 0 0 auto; }
            .period-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
            .periods button { min-height: 29px; border: 1px solid var(--uninus-line); border-radius: 9px; padding: 4px 8px; color: var(--uninus-muted); background: color-mix(in srgb, var(--card-background-color, #fff) 75%, transparent); cursor: pointer; font-size: 11px; font-weight: 650; }
            .periods button.active { color: #fff; background: var(--uninus-green); border-color: var(--uninus-green); outline: 2px solid color-mix(in srgb, var(--uninus-green) 42%, transparent); outline-offset: 1px; box-shadow: 0 4px 10px color-mix(in srgb, var(--uninus-green) 20%, transparent); }
            .wind-content { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(145px, .42fr); min-height: 332px; }
            #svg-container { min-width: 0; min-height: 332px; padding: 8px; }
            .wind-current { min-width: 0; display: grid; align-content: center; gap: 14px; padding: 15px; border-left: 1px solid var(--uninus-line); background: linear-gradient(180deg, color-mix(in srgb, var(--uninus-teal) 4%, transparent), transparent); }
            .wind-speed { display: inline-flex; align-items: baseline; justify-content: flex-start; gap: 4px; color: var(--speed-color); }
            .wind-speed strong { font-family: Georgia, serif; font-size: 37px; line-height: 1; font-weight: 500; }
            .wind-speed small { color: var(--uninus-muted); font-size: 11px; }
            .wind-direction-readout { display: flex; align-items: center; gap: 11px; text-align: left; }
            .wind-direction-readout > span:last-child { display: grid; gap: 1px; }
            .wind-direction-readout strong { font-family: Georgia, "Noto Serif TC", serif; font-size: 20px; }
            .wind-direction-readout small { color: var(--uninus-muted); font-size: 11px; }
            .direction-arrow { width: 43px; height: 43px; display: grid; place-items: center; border: 1px solid var(--uninus-line); border-radius: 50%; color: var(--direction-arrow-color); font-size: 25px; transform: rotate(var(--direction-angle)); background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent); }
            .speed-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 5px; }
            .speed-legend span { min-width: 0; display: flex; align-items: center; gap: 4px; color: var(--uninus-muted); opacity: .72; }
            .speed-legend span.active { color: var(--uninus-ink); opacity: 1; font-weight: 750; }
            .speed-legend i { width: 14px; height: 6px; flex: 0 0 14px; border-radius: 3px; background-color: var(--range-color); }
            .speed-legend small { font-size: 10px; }
            .engine-text { padding: 0 13px; overflow-wrap: anywhere; color: var(--uninus-muted); font-size: 11px; }
            .engine-text:empty { display: none; }
            .light-panel { min-height: 96px; display: flex; align-items: center; gap: 12px; }
            .weather-icon { width: 39px; height: 39px; flex: 0 0 39px; display: grid; place-items: center; border-radius: 13px; color: #c77b22; background: color-mix(in srgb, #e7a23b 14%, transparent); font-size: 19px; }
            .light-panel > div { min-width: 0; display: grid; gap: 7px; }
            .sensor-value { display: inline-flex; align-items: baseline; gap: 3px; }
            .sensor-value strong { font-family: Georgia, serif; font-size: 23px; color: #bd7726; }
            .sensor-value small { color: var(--uninus-muted); font-size: 10px; }
            .rain { position: relative; min-height: 139px; display: grid; grid-template-columns: minmax(0, 1fr) 58px; align-items: center; gap: 7px; overflow: hidden; }
            .rain-copy { min-width: 0; display: grid; gap: 8px; }
            .rain-value { text-align: left; color: var(--uninus-green); font-family: Georgia, "Noto Serif TC", serif; font-size: 17px; font-weight: 700; }
            .rain-detail { color: var(--uninus-muted); font-size: 10px; }
            .rain.wet { border-color: color-mix(in srgb, #4d91b5 42%, var(--uninus-line)); background: linear-gradient(145deg, color-mix(in srgb, #6aa8c8 12%, var(--card-background-color, #fff)), color-mix(in srgb, #4d91b5 5%, transparent)); }
            .rain.wet .rain-value { color: #327799; }
            .rain.unknown, .rain.unavailable { filter: saturate(.55); }
            .rain-symbol { position: relative; width: 58px; height: 78px; color: #4f8fab; }
            .cloud { position: absolute; top: 3px; left: 10px; font-size: 36px; line-height: 1; }
            .rain-static { position: absolute; top: 48px; left: 25px; color: var(--uninus-muted); font-size: 15px; }
            .rain-motion i { position: absolute; top: 42px; width: 2px; height: 13px; border-radius: 3px; background: #4f9fc4; animation: rain-drop 1.05s linear infinite; }
            .rain-motion i:nth-child(1) { left: 14px; animation-delay: -.15s; }
            .rain-motion i:nth-child(2) { left: 27px; animation-delay: -.55s; }
            .rain-motion i:nth-child(3) { left: 39px; animation-delay: -.35s; }
            .rain-motion i:nth-child(4) { left: 49px; animation-delay: -.8s; }
            .rain-motion b { position: absolute; top: 66px; left: 13px; width: 35px; height: 9px; border: 1px solid color-mix(in srgb, #4f9fc4 65%, transparent); border-radius: 50%; animation: rain-ripple 1.8s ease-out infinite; }
            .rain-motion b:last-child { animation-delay: -.9s; }
            @keyframes rain-drop { 0% { transform: translateY(-6px); opacity: 0; } 25% { opacity: .9; } 100% { transform: translateY(15px); opacity: 0; } }
            @keyframes rain-ripple { from { transform: scale(.45); opacity: .75; } to { transform: scale(1.15); opacity: 0; } }
            .error { margin: 8px 12px 12px; padding: 8px; border-radius: 8px; color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 8%, transparent); font-size: 12px; }
            .maintenance-strip { min-height: 39px; padding: 8px 18px; display: flex; align-items: center; gap: 11px; border-top: 1px solid var(--uninus-line); color: var(--uninus-muted); font-size: 10px; letter-spacing: .02em; }
            .maintenance-brand { color: var(--uninus-green); font-weight: 800; letter-spacing: .08em; }
            .maintenance-strip button { min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; gap: 6px; color: inherit; font-size: inherit; }
            .maintenance-strip.weak { color: #b56c19; }
            .maintenance-strip.offline { color: var(--error-color, #c7443e); }
            .maintenance-strip.offline button i { background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); }
            .maintenance-strip .updated { margin-left: auto; }
            ha-card.compact main { grid-template-columns: minmax(165px, .72fr) minmax(330px, 1.5fr); }
            ha-card.compact .conditions-column { grid-column: 1 / -1; grid-template-columns: .8fr 1fr 1.4fr; }
            ha-card:is(.narrow, .small) header { align-items: center; }
            ha-card:is(.narrow, .small) main { grid-template-columns: 1fr; }
            ha-card:is(.narrow, .small) .environment-column { grid-template-columns: 1fr 1fr; }
            ha-card:is(.narrow, .small) .environment-column .section-heading { grid-column: 1 / -1; }
            ha-card:is(.narrow, .small) .wind-panel { grid-row: 2; }
            ha-card:is(.narrow, .small) .conditions-column { grid-template-columns: 1fr 1.15fr; }
            ha-card:is(.narrow, .small) .conditions-column .section-heading { grid-column: 1 / -1; }
            ha-card:is(.narrow, .small) .wind-header { align-items: flex-start; flex-direction: column; }
            ha-card:is(.narrow, .small) .wind-header .periods { margin-left: 0; width: 100%; }
            ha-card:is(.narrow, .small) .period-row { justify-content: flex-start; }
            ha-card:is(.narrow, .small) .periods button,
            ha-card:is(.narrow, .small) .maintenance-strip button { min-height: 44px; padding-inline: 12px; }
            ha-card:is(.narrow, .small) .wind-content { grid-template-columns: 1fr; }
            ha-card:is(.narrow, .small) .wind-current { grid-template-columns: .7fr 1fr; border-left: 0; border-top: 1px solid var(--uninus-line); }
            ha-card:is(.narrow, .small) .wind-current > .eyebrow, ha-card:is(.narrow, .small) .speed-legend { grid-column: 1 / -1; }
            ha-card:is(.narrow, .small) #svg-container { min-height: 340px; }
            ha-card:is(.narrow, .small) .maintenance-strip { flex-wrap: wrap; }
            ha-card:is(.narrow, .small) .maintenance-strip .updated { margin-left: 0; width: 100%; }
            ha-card.small .live-mark span { display: none; }
            ha-card.small .environment-column, ha-card.small .conditions-column { grid-template-columns: 1fr; }
            ha-card.small .environment-column .section-heading, ha-card.small .conditions-column .section-heading { grid-column: auto; }
            ha-card.small .primary-reading strong { font-size: 42px; }
            ha-card.small .wind-current { grid-template-columns: 1fr 1fr; }
            @media (prefers-reduced-motion: reduce) {
                .rain-motion i, .rain-motion b { animation: none !important; }
            }
        `;
    }

}
