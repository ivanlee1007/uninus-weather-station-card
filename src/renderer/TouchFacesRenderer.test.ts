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

    it("preserves confirmation for every action type without the misspelled key", () => {
        const cases: Array<[
            "tap_action" | "hold_action" | "double_tap_action",
            "createTapEventFunction" | "createHoldEventFunction" | "createDoubleTapEventFunction",
        ]> = [
            ["tap_action", "createTapEventFunction"],
            ["hold_action", "createHoldEventFunction"],
            ["double_tap_action", "createDoubleTapEventFunction"],
        ];
        const events: Array<FakeCustomEvent> = [];
        const { renderer, restore } = createRenderer(events);
        const confirmedAction = { ...action, confirmation: "Are you sure?" };

        try {
            cases.forEach(([, method]) => renderer[method](confirmedAction)());
        } finally {
            restore();
        }

        cases.forEach(([actionKey], index) => {
            const eventConfig = (events[index].detail as { config: Record<string, Record<string, unknown>> }).config;
            expect(eventConfig[actionKey].confirmation).toBe("Are you sure?");
            expect(eventConfig[actionKey]).not.toHaveProperty("conformation");
        });
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
