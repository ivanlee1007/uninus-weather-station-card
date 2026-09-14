import { describe, expect, it } from "@jest/globals";
import {
    classifyRainState,
    classifyResponsiveMode,
    buildWindRoseConfig,
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
    type HassStateLike,
    type RainClassification,
    type UninusWeatherStationCardConfig,
} from "./UninusWeatherHelpers";

const validConfig = (): UninusWeatherStationCardConfig => ({
    type: "custom:uninus-weather-station-card",
    wind_direction_entity: { entity: "sensor.wind_direction" },
    windspeed_entities: [{ entity: "sensor.wind_speed" }],
    weather_entities: {
        temperature: { entity: "sensor.temperature" },
        humidity: { entity: "sensor.humidity" },
        illuminance: { entity: "sensor.illuminance" },
        rain: { entity: "sensor.rain" },
    },
});

describe("normalizeWeatherStationConfig", () => {
    it("validates required weather and wind entities", () => {
        expect(() => normalizeWeatherStationConfig({} as UninusWeatherStationCardConfig))
            .toThrow("wind_direction_entity.entity");

        const missingTemperature = validConfig();
        delete (missingTemperature.weather_entities as Partial<typeof missingTemperature.weather_entities>).temperature;
        expect(() => normalizeWeatherStationConfig(missingTemperature))
            .toThrow("weather_entities.temperature.entity");
    });

    it("applies product and rain mapping defaults without changing wind config", () => {
        const config = validConfig();
        const normalized = normalizeWeatherStationConfig(config);

        expect(normalized.name).toBe("UNINUS 氣象站");
        expect(normalized.device_label).toBe("外部環境氣象站");
        expect(normalized.rain_states.wet).toEqual(["下雨中", "on"]);
        expect(normalized.rain_states.dry).toEqual(["沒下雨", "off"]);
        expect(normalized.wind_direction_entity).toBe(config.wind_direction_entity);
        expect(normalized.windspeed_entities).toBe(config.windspeed_entities);
    });

    it("supplies independent built-in temperature and humidity value ranges", () => {
        const normalized = normalizeWeatherStationConfig(validConfig());

        expect(normalized.weather_entities.temperature.value_ranges).toEqual(expect.arrayContaining([
            expect.objectContaining({ from_value: 18, color: "#168e72", label: "舒適" }),
            expect.objectContaining({ from_value: 26, color: "#d07b29", label: "偏高" }),
        ]));
        expect(normalized.weather_entities.humidity.value_ranges).toEqual(expect.arrayContaining([
            expect.objectContaining({ from_value: 40, color: "#168e72", label: "舒適" }),
            expect.objectContaining({ from_value: 70, color: "#d07b29", label: "偏高" }),
        ]));
        expect(normalized.weather_entities.temperature.value_ranges)
            .not.toBe(normalized.weather_entities.humidity.value_ranges);
    });

    it.each([
        ["temperature", "bad"],
        ["temperature", [{ from_value: Number.NaN, color: "blue" }]],
        ["temperature", [{ from_value: 0, color: "" }]],
        ["temperature", [{ from_value: 0, color: "url(https://example.test/pixel)" }]],
        ["temperature", [{ from_value: 0, color: "var(--secret)" }]],
        ["humidity", [{ from_value: 0, color: "blue", label: 7 }]],
        ["humidity", [{ from_value: 20, color: "blue" }, { from_value: 10, color: "green" }]],
        ["humidity", [{ from_value: 10, color: "blue" }, { from_value: 10, color: "green" }]],
    ])("rejects malformed weather_entities.%s.value_ranges", (key, valueRanges) => {
        const config = validConfig() as any;
        config.weather_entities[key].value_ranges = valueRanges;

        expect(() => normalizeWeatherStationConfig(config)).toThrow(
            `weather_entities.${key}.value_ranges`,
        );
    });

    it.each([
        "wet",
        ["on"],
        1,
        null,
    ])("rejects non-object top-level rain_states %p with an exact config error", (rainStates) => {
        const config = validConfig();
        config.rain_states = rainStates as never;

        expect(() => normalizeWeatherStationConfig(config)).toThrow(
            new Error("UNINUS weather station card: rain_states must be an object."),
        );
    });

    it.each([
        ["wet", "on"],
        ["wet", ["on", 1]],
        ["dry", { state: "off" }],
        ["dry", [false]],
    ])("rejects malformed rain_states.%s with an exact config error", (key, value) => {
        const config = validConfig() as UninusWeatherStationCardConfig & {
            rain_states: Record<string, unknown>;
        };
        config.rain_states = { [key]: value };

        expect(() => normalizeWeatherStationConfig(config)).toThrow(
            new Error(`UNINUS weather station card: rain_states.${key} must be an array of strings.`),
        );
    });

    it("produces rain mappings that classifyRainState can consume safely", () => {
        const normalized = normalizeWeatherStationConfig({
            ...validConfig(),
            rain_states: { wet: ["rain"], dry: ["clear"] },
        });

        expect(classifyRainState("rain", normalized.rain_states)).toBe("wet");
        expect(classifyRainState("clear", normalized.rain_states)).toBe("dry");
    });

    it.each([
        "bad",
        [],
        [{ from_value: "0", color: "green" }],
        [{ from_value: 0, color: "url(https://example.test/pixel)" }],
        [{ from_value: 0, color: "green" }, { from_value: 0, color: "blue" }],
    ])("rejects malformed windspeed speed_ranges %p", speedRanges => {
        const config = validConfig();
        config.windspeed_entities[0].speed_ranges = speedRanges;
        expect(() => normalizeWeatherStationConfig(config)).toThrow("windspeed_entities.0.speed_ranges");
    });

    it("preserves the upstream ability to supply valid speed ranges out of order", () => {
        const config = validConfig();
        config.windspeed_entities[0].speed_ranges = [
            { from_value: 2, color: "lime" },
            { from_value: 0, color: "green" },
        ];
        expect(() => normalizeWeatherStationConfig(config)).not.toThrow();
    });

    it.each([
        ["colors.rose_lines", (config: any) => { config.colors = { rose_lines: "red; background:url(https://example.test/pixel)" }; }],
        ["buttons_config.default_colors.bg_color", (config: any) => {
            config.buttons_config = { location: "top", default_colors: { bg_color: "url(https://example.test/pixel)" }, buttons: [] };
        }],
        ["buttons_config.buttons.0.colors.active_color", (config: any) => {
            config.buttons_config = {
                location: "top",
                buttons: [{ type: "period_selector", button_text: "1H", period_back: "-1h", colors: { active_color: "url(x)" } }],
            };
        }],
        ["corner_info.top_left.color", (config: any) => { config.corner_info = { top_left: { color: "url(x)" } }; }],
        ["text_blocks.top.text_color", (config: any) => { config.text_blocks = { top: { text_color: "url(x)" } }; }],
    ])("rejects unsafe configurable CSS at %s", (path, mutate) => {
        const config = validConfig();
        mutate(config);
        expect(() => normalizeWeatherStationConfig(config)).toThrow(path);
    });

    it.each([
        { n: 1 },
        { ne: null },
        "北東南西",
    ])("rejects malformed direction custom_labels %p", customLabels => {
        const config = validConfig();
        config.direction_labels = { custom_labels: customLabels };
        expect(() => normalizeWeatherStationConfig(config)).toThrow("direction_labels.custom_labels");
    });

    it("validates configured optional device entities", () => {
        const config = validConfig();
        config.weather_entities.signal_strength = { entity: "" };

        expect(() => normalizeWeatherStationConfig(config))
            .toThrow("weather_entities.signal_strength.entity");
    });
});

describe("weather value ranges", () => {
    it("selects the highest configured threshold not above a numeric state", () => {
        const ranges = [
            { from_value: 0, color: "green", label: "low" },
            { from_value: 20, color: "orange", label: "warm" },
            { from_value: 30, color: "red", label: "hot" },
        ];

        expect(resolveValueRange("26.4", ranges)).toEqual(ranges[1]);
    });

    it("returns no range when a value is below every configured threshold", () => {
        expect(resolveValueRange(-1, [{ from_value: 0, color: "green" }])).toBeUndefined();
    });

    it.each([undefined, "", "unknown", "unavailable", "twenty"])(
        "does not assign a range to nonnumeric state %p",
        value => expect(resolveValueRange(value, [{ from_value: 0, color: "green" }])).toBeUndefined(),
    );
});

describe("eight-direction wind display", () => {
    it.each([
        [0, "北"], [22.49, "北"], [22.5, "東北"], [67.49, "東北"],
        [67.5, "東"], [157.5, "南"], [247.5, "西"], [337.49, "西北"],
        [337.5, "北"], [360, "北"],
    ])("maps %s degrees to %s", (degrees, label) => {
        expect(resolveEightDirection(String(degrees))?.label).toBe(label);
    });

    it("uses configured labels without creating unnatural compound labels", () => {
        expect(resolveEightDirection("225", { sw: "西南偏南" })).toMatchObject({
            degrees: 225,
            key: "sw",
            label: "西南偏南",
        });
    });

    it.each([undefined, "", "unknown", "unavailable", "west", "-1"])(
        "does not invent a direction for %p",
        value => expect(resolveEightDirection(value)).toBeUndefined(),
    );
});

describe("safe configured colors", () => {
    it.each(["#168e72", "red", "rgb(100, 200, 100)", "hsl(120 40% 50% / .8)"])(
        "accepts color value %s", color => expect(isSafeCssColor(color)).toBe(true),
    );
    it.each(["url(https://example.test/pixel)", "image-set(url(x) 1x)", "var(--secret)", "red; background:url(x)", ""])(
        "rejects unsafe CSS value %s", color => expect(isSafeCssColor(color)).toBe(false),
    );
});

describe("wind speed ranges", () => {
    const ranges = [
        { from_value: 0, color: "rgb(100, 200, 100)" },
        { from_value: 2, color: "rgb(150, 220, 80)" },
        { from_value: 4, color: "yellow" },
        { from_value: 6, color: "orange" },
        { from_value: 9, color: "orangered" },
        { from_value: 12, color: "red" },
    ];

    it("uses the exact engine range that contains the current speed", () => {
        expect(resolveSpeedRange("3.8", ranges)).toEqual(ranges[1]);
        expect(resolveSpeedRange("12", ranges)).toEqual(ranges[5]);
    });

    it.each([undefined, "", "unknown", "fast"])("fails safely for %p", value => {
        expect(resolveSpeedRange(value, ranges)).toBeUndefined();
    });

    it("does not manufacture a palette when explicit ranges are absent or malformed", () => {
        expect(resolveSpeedRange("3.8", undefined)).toBeUndefined();
        expect(resolveSpeedRange("3.8", [{ from_value: 0, color: "" }])).toBeUndefined();
    });

    it("provides a sorted copy for the visible legend without changing the engine config", () => {
        const reversed = [...ranges].reverse();
        expect(normalizeSpeedRanges(reversed).map(range => range.from_value)).toEqual([0, 2, 4, 6, 9, 12]);
        expect(reversed[0].from_value).toBe(12);
        expect(normalizeSpeedRanges([{ from_value: Number.NaN, color: "red" }])).toEqual([]);
    });
});

describe("wind speed display unit", () => {
    it.each([
        [undefined, "km/h", "mps", undefined, "km/h"],
        [1, "km/h", "mps", undefined, "m/s"],
        [1, "m/s", "kph", undefined, "km/h"],
        [1, "km/h", "mps", "公尺/秒", "公尺/秒"],
        [1, "km/h", "invalid", undefined, ""],
    ])("resolves processed=%p raw=%s output=%s label=%p as %s", (processed, raw, output, label, expected) => {
        expect(resolveWindSpeedDisplayUnit(processed, raw, output, label)).toBe(expected);
    });
});

describe("active wind-speed entity", () => {
    it("uses the entity selected for the WindRose and otherwise falls back to the first entity", () => {
        expect(resolveActiveWindSpeedIndex([{ useForWindRose: false }, { useForWindRose: true }])).toBe(1);
        expect(resolveActiveWindSpeedIndex([{ useForWindRose: false }, { useForWindRose: false }])).toBe(0);
        expect(resolveActiveWindSpeedIndex([])).toBe(-1);
    });
});

describe("formatEntityState", () => {
    const states: Record<string, HassStateLike> = {
        "sensor.temperature": {
            state: "26.1",
            attributes: { friendly_name: "Outdoor temperature", unit_of_measurement: "°C" },
            last_updated: "2026-09-11T08:30:00Z",
        },
        "sensor.unknown": { state: "unknown", attributes: {} },
        "sensor.unavailable": { state: "unavailable", attributes: {} },
    };

    it("uses HA names and units unless the entity config overrides them", () => {
        expect(formatEntityState(states, { entity: "sensor.temperature" })).toEqual({
            entity: "sensor.temperature",
            name: "Outdoor temperature",
            value: "26.1",
            unit: "°C",
            available: true,
            lastUpdated: "2026-09-11T08:30:00Z",
        });
        expect(formatEntityState(states, {
            entity: "sensor.temperature",
            name: "Air",
            unit: "C",
        })).toMatchObject({ name: "Air", unit: "C" });
    });

    it.each(["sensor.missing", "sensor.unknown", "sensor.unavailable"])(
        "returns a safe unavailable display for %s",
        (entity) => {
            expect(formatEntityState(states, { entity })).toMatchObject({
                entity,
                value: "—",
                unit: "",
                available: false,
            });
        },
    );

    it("returns a safe placeholder when an optional entity is not configured", () => {
        expect(formatEntityState(states, undefined)).toEqual({
            entity: undefined,
            name: "",
            value: "—",
            unit: "",
            available: false,
            lastUpdated: undefined,
        });
    });

    it("treats case and whitespace variants of unavailable states safely", () => {
        const variantStates: Record<string, HassStateLike> = {
            "sensor.variant": { state: "  UnAvAiLaBlE  ", attributes: { unit_of_measurement: "°C" } },
        };

        expect(formatEntityState(variantStates, { entity: "sensor.variant" })).toMatchObject({
            value: "—",
            unit: "",
            available: false,
        });
    });
});

describe("classifyRainState", () => {
    const mapping = { wet: ["下雨中", "on", "raining"], dry: ["沒下雨", "off", "dry"] };

    it.each<[string, "wet" | "dry"]>([["下雨中", "wet"], ["ON", "wet"], ["沒下雨", "dry"], ["off", "dry"]])(
        "maps %s to %s",
        (state, expected) => expect(classifyRainState(state, mapping)).toBe(expected),
    );

    it.each<[string | undefined, "unavailable" | "unknown"]>([[undefined, "unavailable"], ["unknown", "unknown"], ["unavailable", "unavailable"], ["maybe", "unknown"]])(
        "classifies %s as %s safely",
        (state, expected) => expect(classifyRainState(state, mapping)).toBe(expected),
    );

    it.each<[RainClassification, string]>([
        ["wet", "偵測到降雨"],
        ["dry", "目前無降雨"],
        ["unknown", "降雨感測無法使用"],
        ["unavailable", "降雨感測無法使用"],
    ])("labels %s without inventing rain intensity", (classification, label) => {
        expect(getRainLabel(classification)).toBe(label);
    });

    it("animates only a confirmed wet state when animations are enabled", () => {
        expect(isRainAnimationEnabled("wet", false)).toBe(true);
        expect(isRainAnimationEnabled("wet", true)).toBe(false);
        expect(isRainAnimationEnabled("dry", false)).toBe(false);
        expect(isRainAnimationEnabled("unknown", false)).toBe(false);
        expect(isRainAnimationEnabled("unavailable", false)).toBe(false);
    });
});

describe("createMoreInfoEvent", () => {
    it("creates the standard bubbling and composed hass-more-info event", () => {
        class FakeCustomEvent {
            constructor(public type: string, public options: CustomEventInit) {}
        }

        const event = createMoreInfoEvent(
            "sensor.temperature",
            FakeCustomEvent as unknown as typeof CustomEvent,
        ) as unknown as FakeCustomEvent;

        expect(event.type).toBe("hass-more-info");
        expect(event.options).toEqual({
            detail: { entityId: "sensor.temperature" },
            bubbles: true,
            composed: true,
        });
    });
});

describe("classifyResponsiveMode", () => {
    it.each<[number, number, "wide" | "compact" | "narrow" | "small"]>([
        [980, 600, "wide"],
        [900, 900, "wide"],
        [899, 900, "compact"],
        [760, 500, "compact"],
        [560, 900, "compact"],
        [559, 900, "narrow"],
        [431, 480, "narrow"],
        [430, 900, "small"],
        [390, 900, "small"],
        [320, 480, "small"],
    ])("classifies a %sx%s card as %s", (width, height, expected) => {
        expect(classifyResponsiveMode(width, height)).toBe(expected);
    });
});

describe("groupButtonsForLocation", () => {
    const buttons = [
        { name: "previous", baseConfig: { newRow: false } },
        { name: "one-hour", baseConfig: { newRow: true } },
        { name: "eight-hours", baseConfig: { newRow: false } },
        { name: "next", baseConfig: { newRow: true } },
    ];

    it.each(["top", "top-below-text", "bottom-above-text", "bottom"])(
        "returns button rows only at the configured %s slot",
        location => {
            expect(groupButtonsForLocation(location, location, buttons).map(row => row.map(button => button.name)))
                .toEqual([["previous"], ["one-hour", "eight-hours"], ["next"]]);
            const otherLocation = location === "top" ? "bottom" : "top";
            expect(groupButtonsForLocation(location, otherLocation, buttons)).toEqual([]);
        },
    );
});

describe("buildWindRoseConfig", () => {
    it("reuses wind configuration and supplies Demo C period controls", () => {
        const config = normalizeWeatherStationConfig(validConfig());
        const wind = buildWindRoseConfig(config) as Record<string, unknown>;
        const buttons = (wind.buttons_config as { buttons: Array<Record<string, unknown>> }).buttons;

        expect(wind.wind_direction_entity).toBe(config.wind_direction_entity);
        expect(wind.windspeed_entities).toBe(config.windspeed_entities);
        expect(wind.hide_windspeed_bar).toBe(true);
        expect(buttons.map(button => button.button_text)).toEqual(["前移", "1H", "8H", "1D", "10D", "播放", "後移"]);
        expect(buttons.find(button => button.button_text === "8H")?.active).toBe(true);
        expect(buttons.find(button => button.button_text === "播放")).toMatchObject({
            type: "period_shift_play", period_back: "-8h", step_period: "+1h", window_period: "+1h",
        });
    });

    it("keeps explicitly configured engine period buttons", () => {
        const config = normalizeWeatherStationConfig({
            ...validConfig(),
            buttons_config: { location: "bottom", buttons: [{ type: "period_selector", button_text: "Today" }] },
        });
        expect((buildWindRoseConfig(config).buttons_config as { buttons: unknown[] }).buttons).toHaveLength(1);
    });

    it("defaults the engine to Traditional Chinese eight-direction labels without overriding explicit values", () => {
        const defaults = buildWindRoseConfig(normalizeWeatherStationConfig(validConfig()));
        expect(defaults.direction_labels).toMatchObject({
            show_cardinal_directions: true,
            show_intercardinal_directions: true,
            custom_labels: { n: "北", ne: "東北", e: "東", se: "東南", s: "南", sw: "西南", w: "西", nw: "西北" },
        });

        const explicit = buildWindRoseConfig(normalizeWeatherStationConfig({
            ...validConfig(),
            direction_labels: {
                show_intercardinal_directions: false,
                custom_labels: { ne: "NE custom" },
            },
        }));
        expect(explicit.direction_labels).toMatchObject({
            show_intercardinal_directions: false,
            custom_labels: { ne: "NE custom", sw: "西南" },
        });
    });

    it("supports a fixed data period with buttons disabled by omitting buttons_config", () => {
        const config = normalizeWeatherStationConfig({
            ...validConfig(),
            data_period: { period_back: "-24h" },
        });

        expect(buildWindRoseConfig(config).buttons_config).toBeUndefined();
    });
});
