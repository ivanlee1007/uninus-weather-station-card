import { describe, expect, it } from "@jest/globals";
import { CardConfigWrapper } from "./CardConfigWrapper";

const baseConfig = (refresh_interval: number) => ({
    title: "test",
    refresh_interval,
    data_period: { period_back: "-1h" },
    wind_direction_entity: { entity: "sensor.direction" },
    windspeed_entities: [{ entity: "sensor.speed" }],
} as never);

describe("CardConfigWrapper refresh_interval", () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        "rejects non-positive or non-finite value %s",
        (value: number) => expect(() => new CardConfigWrapper(baseConfig(value))).toThrow(/refresh_interval/),
    );
});
