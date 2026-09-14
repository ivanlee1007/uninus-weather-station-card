import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => ({
    LitElement: class { requestUpdate() {} connectedCallback() {} disconnectedCallback() {} },
    html: jest.fn(),
    css: jest.fn(),
}));
jest.mock("lit/decorators.js", () => ({
    customElement: () => (target: unknown) => target,
    query: () => () => undefined,
}));
jest.mock("lit/directives/style-map.js", () => ({ styleMap: jest.fn((value: unknown) => value) }));
jest.mock("@svgdotjs/svg.js", () => ({
    SVG: () => ({ height() { return this; }, width() { return this; } }),
}));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

describe("UninusWeatherStationCard request lifecycle", () => {
    beforeAll(() => {
        Object.assign(globalThis, {
            window: Object.assign(globalThis, { customCards: [], setTimeout, clearTimeout }),
            customElements: { define: jest.fn(), get: jest.fn() },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("ignores an older refresh that resolves after a newer request", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const first = deferred<Record<string, never>>();
        const second = deferred<Record<string, never>>();
        const refreshData = jest.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const cancelPendingRender = jest.fn();
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        Object.assign(card, {
            initialized: true,
            windRoseDirigent: { refreshData, renderGraphs: jest.fn(), updateStateRender: jest.fn(), cancelPendingRender },
            requestUpdate: jest.fn(),
            errorMessage: "",
            requestGeneration: 0,
        });

        card.refreshMeasurements(false);
        card.refreshMeasurements(false);
        second.resolve({});
        await Promise.resolve();
        first.resolve({});
        await Promise.resolve();

        expect(card.windRoseDirigent.renderGraphs).toHaveBeenCalledTimes(1);
        expect(cancelPendingRender).toHaveBeenCalledTimes(2);
        expect(refreshData.mock.calls[0][0]).toEqual(expect.any(Function));
    });

    it("polishes the windrose after the deferred engine render", async () => {
        jest.useFakeTimers();
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const polishWindRoseSvg = jest.fn();
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        Object.assign(card, {
            initialized: true,
            windRoseDirigent: {
                refreshData: jest.fn<() => Promise<any>>().mockResolvedValue({}),
                renderGraphs: jest.fn(), updateStateRender: jest.fn(), cancelPendingRender: jest.fn(),
            },
            polishWindRoseSvg,
            requestUpdate: jest.fn(),
            errorMessage: "",
            requestGeneration: 0,
        });

        card.refreshMeasurements(false);
        await Promise.resolve();
        expect(polishWindRoseSvg).not.toHaveBeenCalled();
        jest.runOnlyPendingTimers();
        expect(polishWindRoseSvg).toHaveBeenCalledTimes(1);
    });

    it("refreshes immediately when an initialized card reconnects", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        Object.assign(card, {
            initialized: true,
            cardConfig: { disableAnimations: false },
            startInterval: jest.fn(),
            stopInterval: jest.fn(),
            observeSize: jest.fn(),
            refreshMeasurements: jest.fn(),
            cancelPendingWork: jest.fn(),
            windRoseDirigent: { cancelPendingRender: jest.fn() },
            hasUpdated: true,
        });

        card.disconnectedCallback();
        card.connectedCallback();

        expect(card.refreshMeasurements).toHaveBeenCalledWith(true);
    });

    it("cancels period-shift highlight timeouts on disconnect and setConfig", async () => {
        jest.useFakeTimers();
        const [{ UninusWeatherStationCard }, { PeriodShiftButton }] = await Promise.all([
            import("./UninusWeatherStationCard"),
            import("../config/buttons/types/PeriodShiftButton"),
        ]);
        const lifecycleActions = [
            (card: any) => card.disconnectedCallback(),
            (card: any) => card.setConfig(UninusWeatherStationCard.getStubConfig()),
        ];

        for (const lifecycleAction of lifecycleActions) {
            const button = new PeriodShiftButton({ active: false } as never, "-1h");
            const requestUpdate = jest.fn();
            const card = Object.create(UninusWeatherStationCard.prototype) as any;
            Object.assign(card, {
                initialized: true,
                cardConfig: {
                    activePeriod: { movePeriod: jest.fn(() => true) },
                    buttonsConfig: { disablePeriodSelectors: jest.fn(), undoPausedPlays: jest.fn() },
                },
                windRoseDirigent: { cancelPendingRender: jest.fn() },
                refreshMeasurements: jest.fn(),
                requestUpdate,
                stopInterval: jest.fn(),
                requestGeneration: 0,
            });

            card.handleButtonClickFunc(button)();
            expect(button.baseConfig.active).toBe(true);
            lifecycleAction(card);
            expect(button.baseConfig.active).toBe(false);
            requestUpdate.mockClear();
            jest.advanceTimersByTime(150);
            expect(requestUpdate).not.toHaveBeenCalled();
        }
    });

    it("cancels playback on setConfig and prevents its stale timeout from changing the new period", async () => {
        jest.useFakeTimers();
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        const oldPeriod = { movePeriod: jest.fn(() => true), endTime: new Date(0) };
        const button = {
            stepPeriod: {}, delay: 10, period: { endTime: new Date(1) }, paused: false,
            baseConfig: { active: true },
        };
        Object.assign(card, {
            initialized: true,
            cardConfig: { activePeriod: oldPeriod },
            windRoseDirigent: {
                refreshData: jest.fn<() => Promise<any>>().mockResolvedValue({}), renderGraphs: jest.fn(),
                updateStateRender: jest.fn(), cancelPendingRender: jest.fn(),
            },
            requestUpdate: jest.fn(),
            stopInterval: jest.fn(),
            requestGeneration: 0,
        });

        card.refreshMeasurementsPlay(button);
        await Promise.resolve();
        card.setConfig = UninusWeatherStationCard.prototype.setConfig;
        card.setConfig({
            ...UninusWeatherStationCard.getStubConfig(),
            data_period: { period_back: "-1h" },
        } as any);
        jest.runOnlyPendingTimers();

        expect(oldPeriod.movePeriod).not.toHaveBeenCalled();
        expect(button.baseConfig.active).toBe(false);
        expect(card.windRoseDirigent.cancelPendingRender).toHaveBeenCalledTimes(2);
    });
});

describe("UninusWeatherStationCard Atmospheric Atlas V2 shell", () => {
    it("derives concise outdoor condition language for the approved visual hierarchy", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;

        expect(card.describeTemperature(28.4)).toBe("溫暖");
        expect(card.describeTemperature(undefined)).toBe("環境狀態待確認");
        expect(card.describeWind(3.8)).toBe("微風");
        expect(card.describeWind(undefined)).toBe("");
    });

    it("summarizes the active wind history for the approved statistics rows", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.lastMeasurementHolder = {
            speedMeasurements: [[
                { value: "0.2" }, { value: "2.7" }, { value: "6.1" }, { value: "invalid" },
            ]],
        };

        expect(card.summarizeWindHistory(0)).toEqual({ average: 3, maximum: 6.1, calmPercentage: 33 });
        expect(card.summarizeWindHistory(1)).toEqual({ average: undefined, maximum: undefined, calmPercentage: undefined });
    });

    it("converts and duration-weights wind history statistics", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.cardConfig = { windspeedEntities: [{
            speedUnit: "kph", outputSpeedUnit: "mps", compensationFactor: 1, compensationAbsolute: 0,
        }], activePeriod: { startTime: new Date(0), endTime: new Date(40_000) } };
        card.lastMeasurementHolder = { speedMeasurements: [[
            { startTime: 0, endTime: 10, value: "3.6" },
            { startTime: 10, endTime: 1_000, value: "7.2" },
        ]] };

        expect(card.summarizeWindHistory(0)).toEqual({ average: 1.75, maximum: 2, calmPercentage: 0 });
    });

    it("resolves auto history units without crashing the stub or mislabeling values", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.cardConfig = { windspeedEntities: [{
            entity: "sensor.wind", speedUnit: "auto", outputSpeedUnit: "mps",
            compensationFactor: 1, compensationAbsolute: 0,
        }] };
        card._hass = { states: { "sensor.wind": { attributes: { unit_of_measurement: "km/h" } } } };
        card.lastMeasurementHolder = { speedMeasurements: [[{ startTime: 0, endTime: 10, value: "3.6" }]] };

        expect(card.summarizeWindHistory(0)).toEqual({ average: 1, maximum: 1, calmPercentage: 0 });

        card._hass = { states: {} };
        expect(() => card.summarizeWindHistory(0)).not.toThrow();
    });

    it("uses compact klx formatting without changing the illuminance entity", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const card = Object.create(UninusWeatherStationCard.prototype) as any;

        expect(card.formatIlluminance("18400", "lx")).toEqual({ value: "18.4", unit: "klx" });
        expect(card.formatIlluminance("850", "lx")).toEqual({ value: "850", unit: "lx" });
        expect(card.formatIlluminance("18", "klx")).toEqual({ value: "18", unit: "klx" });
    });

    it("hides radial percentage labels without hiding compass labels", async () => {
        const { UninusWeatherStationCard } = await import("./UninusWeatherStationCard");
        const percentage = { textContent: "45%", style: {} as Record<string, string> };
        const compass = { textContent: "西南", style: {} as Record<string, string> };
        const intermediateRing = { getAttribute: (name: string) => name === "r" ? "148" : null, style: {} as Record<string, string> };
        const outerRing = { getAttribute: (name: string) => name === "r" ? "500" : null, style: {} as Record<string, string> };
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.svg = { node: { querySelectorAll: (selector: string) => selector === "text"
            ? [percentage, compass]
            : selector === "circle" ? [intermediateRing, outerRing] : [] } };

        card.polishWindRoseSvg();

        expect(percentage.style.opacity).toBe("0");
        expect(compass.style.opacity).toBeUndefined();
        expect(intermediateRing.style.opacity).toBe("0");
        expect(outerRing.style.opacity).toBeUndefined();
    });

    it("renders weather semantics while keeping maintenance data only in the footer", async () => {
        const [{ UninusWeatherStationCard }, lit] = await Promise.all([
            import("./UninusWeatherStationCard"),
            import("lit"),
        ]);
        const htmlMock = lit.html as unknown as jest.Mock;
        htmlMock.mockClear();
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.responsiveMode = "wide";
        card.errorMessage = "";
        card.cardConfig = { buttonsConfig: undefined, disableAnimations: false };
        card.config = {
            ...UninusWeatherStationCard.getStubConfig(),
            name: "UNINUS 氣象站",
            device_label: "WS-01",
            rain_states: { wet: ["on"], dry: ["off"] },
            direction_labels: { custom_labels: { sw: "西南" } },
            windspeed_entities: [{
                entity: "sensor.wind_speed",
                speed_ranges: [{ from_value: 0, color: "green" }, { from_value: 2, color: "lime" }],
            }],
            weather_entities: {
                temperature: { entity: "sensor.temperature", value_ranges: [{ from_value: 0, color: "green", label: "舒適" }] },
                humidity: { entity: "sensor.humidity", value_ranges: [{ from_value: 0, color: "teal", label: "舒適" }] },
                illuminance: { entity: "sensor.illuminance", name: "光照度" },
                rain: { entity: "binary_sensor.rain", name: "降雨" },
                signal_strength: { entity: "sensor.signal", name: "訊號" },
                connectivity: { entity: "binary_sensor.connected", name: "連線" },
            },
        };
        card._hass = { states: {
            "sensor.temperature": { state: "28", attributes: { unit_of_measurement: "°C" }, last_updated: "2026-09-12T08:00:00Z" },
            "sensor.humidity": { state: "72", attributes: { unit_of_measurement: "%" } },
            "sensor.illuminance": { state: "12000", attributes: { unit_of_measurement: "lx" } },
            "binary_sensor.rain": { state: "on", attributes: {} },
            "sensor.signal": { state: "-61", attributes: { unit_of_measurement: "dBm" } },
            "binary_sensor.connected": { state: "on", attributes: {} },
            "sensor.wind_direction": { state: "225", attributes: { unit_of_measurement: "°" } },
            "sensor.wind_speed": { state: "3.8", attributes: { unit_of_measurement: "m/s" } },
        } };

        card.render();
        const markup = htmlMock.mock.calls.map(call => Array.isArray(call[0]) ? call[0].join("") : "").join("\n");
        expect(markup).toContain("atlas-kicker");
        expect(markup).toContain("dashboard");
        expect(markup).toContain("overview");
        expect(markup).toContain("temperature-row");
        expect(markup).toContain("wind-main");
        expect(markup).toContain("rose-center-overlay");
        expect(markup).toContain("timeline");
        expect(markup).toContain("maintenance-strip");
        expect(markup).toContain("maintenance-summary");
        expect(markup).toContain("signal-label");
        expect(markup).toContain("speed-legend");
        expect(markup).toContain('role="img"');
        expect(markup).toContain('role="list"');
        expect(markup).toContain("rain-drops");
        expect(markup).not.toContain('<div class="status">');
        expect(markup).not.toContain("section-index");
        expect(markup).not.toContain("conditions-column");
    });

    it("keeps unknown rain distinct from unavailable while showing the same safe message", async () => {
        const [{ UninusWeatherStationCard }, lit] = await Promise.all([
            import("./UninusWeatherStationCard"),
            import("lit"),
        ]);
        const htmlMock = lit.html as unknown as jest.Mock;
        htmlMock.mockClear();
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        card.responsiveMode = "narrow";
        card.errorMessage = "";
        card.initialized = false;
        card.cardConfig = { buttonsConfig: undefined, disableAnimations: false, windspeedEntities: [{ useForWindRose: true }] };
        card.config = { ...UninusWeatherStationCard.getStubConfig(), rain_states: { wet: ["on"], dry: ["off"] } };
        card._hass = { states: {
            "binary_sensor.rain": { state: "unknown", attributes: {} },
        } };

        card.render();
        const dynamicValues = htmlMock.mock.calls.flatMap(call => call.slice(1));
        expect(dynamicValues).toContain("unknown");
        expect(dynamicValues).not.toContain("unavailable");
    });

    it("uses the selected WindRose speed entity, converted value, ranges, and output unit", async () => {
        const [{ UninusWeatherStationCard }, lit] = await Promise.all([
            import("./UninusWeatherStationCard"),
            import("lit"),
        ]);
        const htmlMock = lit.html as unknown as jest.Mock;
        htmlMock.mockClear();
        const card = Object.create(UninusWeatherStationCard.prototype) as any;
        const getWindSpeed = jest.fn(() => 6.5);
        card.responsiveMode = "wide";
        card.errorMessage = "";
        card.initialized = true;
        card.entityStateProcessor = { getWindDirection: jest.fn(() => 225), getWindSpeed };
        card.cardConfig = {
            buttonsConfig: undefined,
            disableAnimations: false,
            windspeedEntities: [
                { useForWindRose: false, outputSpeedUnit: "mps" },
                { useForWindRose: true, outputSpeedUnit: "mps" },
            ],
        };
        card.config = {
            ...UninusWeatherStationCard.getStubConfig(),
            windspeed_entities: [
                { entity: "sensor.wind_speed", speed_ranges: [{ from_value: 0, color: "green" }] },
                { entity: "sensor.wind_speed_2", speed_ranges: [{ from_value: 0, color: "blue" }] },
            ],
        };
        card._hass = { states: {
            "sensor.wind_speed": { state: "1", attributes: { unit_of_measurement: "m/s" } },
            "sensor.wind_speed_2": { state: "23.4", attributes: { unit_of_measurement: "km/h" } },
        } };

        card.render();
        expect(getWindSpeed).toHaveBeenCalledWith(1, false);
        const dynamicValues = htmlMock.mock.calls.flatMap(call => call.slice(1));
        expect(dynamicValues).toContain("m/s");
        expect(dynamicValues).toContain("0 m/s");
        expect(dynamicValues).not.toContain("km/h");
    });

    it("includes reduced-motion safety and 44px narrow touch controls", async () => {
        const [{ UninusWeatherStationCard }, lit] = await Promise.all([
            import("./UninusWeatherStationCard"),
            import("lit"),
        ]);
        const cssMock = lit.css as unknown as jest.Mock;
        cssMock.mockClear();
        void UninusWeatherStationCard.styles;
        const styles = cssMock.mock.calls.map(call => Array.isArray(call[0]) ? call[0].join("") : "").join("\n");
        expect(styles).toContain("prefers-reduced-motion: reduce");
        expect(styles).toContain("min-height: 44px");
        expect(styles).toContain("container-type: inline-size");
        expect(styles).toMatch(/ha-card\s*\{[^}]*display:\s*block/);
        expect(styles).toContain(":focus-visible");
        expect(styles).toContain("grid-template-columns: minmax(330px, .88fr) minmax(500px, 1.42fr)");
        expect(styles).toContain("font-size: clamp(76px, 8cqi, 104px)");
        expect(styles).toContain(".rose-center-overlay { position: absolute;");
        expect(styles).toContain(".atlas-transport-controls .play-button");
        expect(styles).toContain(".range-track i.active::after");
        expect(styles).toContain('circle[r="148"] { opacity: 0; }');
        expect(styles).toContain(".maintenance-brand { color: inherit; font-weight: 400; }");
        expect(styles).toContain(".maintenance-strip button:first-of-type { color: inherit; font-weight: 400; }");
        expect(styles).not.toContain("ha-card.small .live-mark span { display: none;");
        expect(styles).toContain("ha-card.small .level-scale { margin-top: 14px;");
        expect(styles).toContain("ha-card.small .metrics { margin-top: 20px;");
        expect(styles).toContain(".wind-panel { min-width: 0; grid-template-columns: minmax(0, 1fr);");
        expect(styles).toContain(".atlas-transport-controls button { min-width: 44px; width: 44px; min-height: 44px; height: 44px;");
        expect(styles).toContain(".wind-speed { min-width: 44px; min-height: 44px;");
        expect(styles).toContain("@container (max-width: 340px)");
        expect(styles).toContain(".timeline { flex-wrap: wrap;");
        expect(styles).toContain("#svg-container { overflow: hidden;");
        expect(styles).toContain("ha-card.small .rain-state { margin-top: 14px;");
        expect(styles).toContain("ha-card:is(.narrow, .small) .dashboard { grid-template-columns: 1fr;");
    });
});
