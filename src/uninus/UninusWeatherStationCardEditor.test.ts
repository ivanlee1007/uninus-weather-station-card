import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => ({
    LitElement: class { requestUpdate() {} dispatchEvent() { return true; } },
    html: jest.fn(),
    css: jest.fn(),
}));
jest.mock("lit/decorators.js", () => ({
    customElement: () => (target: unknown) => target,
}));

import {
    configFromEditorData,
    editorDataFromConfig,
    type WeatherStationEditorData,
} from "./UninusWeatherStationCardEditor";
import type { UninusWeatherStationCardConfig } from "./UninusWeatherHelpers";

const config = (): UninusWeatherStationCardConfig => ({
    type: "custom:uninus-weather-station-card",
    name: "校園氣象站",
    layout: "horizontal",
    disable_animations: true,
    refresh_interval: 180,
    card_width: 8,
    wind_direction_entity: { entity: "sensor.wind_direction", direction_compensation: 5 },
    windspeed_entities: [{ entity: "sensor.wind_speed", name: "陣風", output_speed_unit: "kph" }],
    weather_entities: {
        temperature: { entity: "sensor.temperature", name: "戶外溫度" },
        humidity: { entity: "sensor.humidity" },
        illuminance: { entity: "sensor.illuminance" },
        rain: { entity: "binary_sensor.rain" },
        signal_strength: { entity: "sensor.rssi" },
    },
    colors: { rose_lines: "green" },
});

describe("weather station config editor mapping", () => {
    it("flattens common fields for Home Assistant form controls", () => {
        const data = editorDataFromConfig(config());
        expect(data).toMatchObject({
            name: "校園氣象站",
            layout: "horizontal",
            temperature_entity: "sensor.temperature",
            rain_entity: "binary_sensor.rain",
            wind_direction_entity: "sensor.wind_direction",
            wind_speed_entity: "sensor.wind_speed",
            output_speed_unit: "kph",
            signal_strength_entity: "sensor.rssi",
        });
    });

    it("writes form changes into nested config without discarding YAML-only settings", () => {
        const original = config();
        const data: WeatherStationEditorData = {
            ...editorDataFromConfig(original),
            layout: "vertical",
            temperature_entity: "sensor.new_temperature",
            wind_speed_entity: "sensor.new_wind_speed",
            connectivity_entity: "binary_sensor.station_online",
        };
        const updated = configFromEditorData(original, data);

        expect(updated.layout).toBe("vertical");
        expect(updated.weather_entities.temperature.entity).toBe("sensor.new_temperature");
        expect(updated.weather_entities.connectivity?.entity).toBe("binary_sensor.station_online");
        expect(updated.windspeed_entities[0].entity).toBe("sensor.new_wind_speed");
        expect(updated.wind_direction_entity.direction_compensation).toBe(5);
        expect(updated.colors).toEqual({ rose_lines: "green" });
    });

    it("removes optional entity blocks when the editor clears them", () => {
        const original = config();
        const updated = configFromEditorData(original, {
            ...editorDataFromConfig(original),
            signal_strength_entity: "",
            connectivity_entity: "",
        });

        expect(updated.weather_entities.signal_strength).toBeUndefined();
        expect(updated.weather_entities.connectivity).toBeUndefined();
    });
});
