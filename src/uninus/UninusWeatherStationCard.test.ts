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
