import { describe, expect, it } from "@jest/globals";
import {
    classifyRainState,
    classifyResponsiveMode,
    buildWindRoseConfig,
    createMoreInfoEvent,
    formatEntityState,
    groupButtonsForLocation,
    normalizeWeatherStationConfig,
    type HassStateLike,
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

    it("validates configured optional device entities", () => {
        const config = validConfig();
        config.weather_entities.signal_strength = { entity: "" };

        expect(() => normalizeWeatherStationConfig(config))
            .toThrow("weather_entities.signal_strength.entity");
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

    it.each<[string | undefined, "unavailable" | "unknown"]>([[undefined, "unavailable"], ["unknown", "unavailable"], ["unavailable", "unavailable"], ["maybe", "unknown"]])(
        "classifies %s as %s safely",
        (state, expected) => expect(classifyRainState(state, mapping)).toBe(expected),
    );
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
        [760, 900, "wide"],
        [759, 500, "compact"],
        [560, 900, "compact"],
        [559, 900, "narrow"],
        [391, 480, "narrow"],
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
        expect(buttons.map(button => button.button_text)).toEqual(["前移", "1H", "8H", "1D", "10D", "後移"]);
        expect(buttons.find(button => button.button_text === "8H")?.active).toBe(true);
    });

    it("keeps explicitly configured engine period buttons", () => {
        const config = normalizeWeatherStationConfig({
            ...validConfig(),
            buttons_config: { location: "bottom", buttons: [{ type: "period_selector", button_text: "Today" }] },
        });
        expect((buildWindRoseConfig(config).buttons_config as { buttons: unknown[] }).buttons).toHaveLength(1);
    });

    it("supports a fixed data period with buttons disabled by omitting buttons_config", () => {
        const config = normalizeWeatherStationConfig({
            ...validConfig(),
            data_period: { period_back: "-24h" },
        });

        expect(buildWindRoseConfig(config).buttons_config).toBeUndefined();
    });
});
