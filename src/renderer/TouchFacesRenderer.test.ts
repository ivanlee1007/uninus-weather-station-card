import { describe, expect, it } from "@jest/globals";
import { TouchFacesRenderer } from "./TouchFacesRenderer";
import type { CardConfigHaAction } from "../card/CardConfigHaAction";

class FakeCustomEvent<T = unknown> {
    constructor(public type: string, public options: CustomEventInit<T>) {}

    get detail(): T | null {
        return this.options.detail ?? null;
    }
}

const action: CardConfigHaAction = {
    action: "navigate",
    navigation_path: "/lovelace/weather",
    url_path: undefined,
    perform_action: undefined,
    data: undefined,
    target: undefined,
    confirmation: undefined,
    pipeline_id: undefined,
    start_listening: undefined,
    entity: "sensor.wind_speed",
};

const createRenderer = (events: Array<FakeCustomEvent>) => {
    const originalCustomEvent = globalThis.CustomEvent;
    Object.defineProperty(globalThis, "CustomEvent", {
        configurable: true,
        value: FakeCustomEvent,
    });
    const renderer = new TouchFacesRenderer(
        {} as never,
        {} as never,
        event => events.push(event as unknown as FakeCustomEvent),
        {} as never,
    );
    return {
        renderer,
        restore: () => Object.defineProperty(globalThis, "CustomEvent", {
            configurable: true,
            value: originalCustomEvent,
        }),
    };
};

describe("TouchFacesRenderer Home Assistant action events", () => {
    it("keeps the configured action object in the tap payload", () => {
        const events: Array<FakeCustomEvent> = [];
        const { renderer, restore } = createRenderer(events);

        try {
            renderer.createTapEventFunction(action)();
        } finally {
            restore();
        }

        expect(events[0].detail).toEqual({
            action: "tap",
            config: {
                entity: "sensor.wind_speed",
                tap_action: expect.objectContaining({
                    action: "navigate",
                    navigation_path: "/lovelace/weather",
                }),
            },
        });
    });

    it("puts the configured action object in the double-tap payload", () => {
        const events: Array<FakeCustomEvent> = [];
        const { renderer, restore } = createRenderer(events);

        try {
            renderer.createDoubleTapEventFunction(action)();
        } finally {
            restore();
        }

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("hass-action");
        expect(events[0].detail).toEqual({
            action: "double_tap",
            config: {
                entity: "sensor.wind_speed",
                double_tap_action: expect.objectContaining({
                    action: "navigate",
                    navigation_path: "/lovelace/weather",
                }),
            },
        });
        expect(typeof (events[0].detail as { config: { double_tap_action: unknown } }).config.double_tap_action)
            .toBe("object");
    });

    it("keeps the configured action object in the hold payload", () => {
        const events: Array<FakeCustomEvent> = [];
        const { renderer, restore } = createRenderer(events);

        try {
            renderer.createHoldEventFunction(action)();
        } finally {
            restore();
        }

        expect(events[0].detail).toEqual({
            action: "hold",
            config: {
                entity: "sensor.wind_speed",
                hold_action: expect.objectContaining({
                    action: "navigate",
                    navigation_path: "/lovelace/weather",
                }),
            },
        });
    });
});
