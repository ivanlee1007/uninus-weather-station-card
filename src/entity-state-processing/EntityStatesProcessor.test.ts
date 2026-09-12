import { describe, expect, it } from "@jest/globals";
import { EntityStatesProcessor } from "./EntityStatesProcessor";
import type { CardConfigWrapper } from "../config/CardConfigWrapper";
import type { HomeAssistant } from "../util/HomeAssistant";

const configWithUnits = (speedUnit: string, outputSpeedUnit: string): CardConfigWrapper => ({
    windDirectionEntity: { entity: "sensor.direction", attribute: undefined },
    currentDirection: { showArrow: true },
    windspeedEntities: [{
        entity: "sensor.speed",
        attribute: undefined,
        currentSpeedArrow: true,
        speedUnit,
        outputSpeedUnit,
    }],
    compassConfig: { autoRotate: false, entity: undefined, attribute: undefined },
    cornersInfo: {
        topLeftInfo: { show: false },
        topRightInfo: { show: false },
        bottomLeftInfo: { show: false },
        bottomRightInfo: { show: false },
    },
    textBlocks: {},
    roseConfig: { centerCircleConfig: {} },
} as unknown as CardConfigWrapper);

const hassWithSpeed = (speed: string): HomeAssistant => ({
    states: {
        "sensor.direction": { state: "0", attributes: {} },
        "sensor.speed": { state: speed, attributes: {} },
    },
} as unknown as HomeAssistant);

describe("EntityStatesProcessor per-config state", () => {
    it("rebuilds wind speed converters when initialized with a new config", () => {
        const processor = new EntityStatesProcessor();
        processor.init(configWithUnits("mps", "kph"));

        processor.init(configWithUnits("mps", "mps"));
        processor.updateHass(hassWithSpeed("10"));

        expect(processor.getWindSpeed(0)).toBe(10);
    });
});
