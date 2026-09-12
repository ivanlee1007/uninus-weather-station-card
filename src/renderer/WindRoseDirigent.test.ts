import { describe, expect, it, jest } from "@jest/globals";
import { WindRoseDirigent } from "./WindRoseDirigent";

describe("WindRoseDirigent initialization", () => {
    it("clears all entity and render arrays before rebuilding", () => {
        const dirigent = Object.create(WindRoseDirigent.prototype) as any;
        Object.assign(dirigent, {
            measurementCounters: [{}], outputSpeedUnits: [{}], speedRangeServices: [{}],
            windBarRenderers: [{}], currentSpeedRenderers: [{}], windRoseData: [{}],
            backgroundElement: {}, currentDirectionRenderer: {}, infoCornersRendeerer: {}, infoText: "old",
        });

        dirigent.resetForInit();

        expect(dirigent.measurementCounters).toEqual([]);
        expect(dirigent.outputSpeedUnits).toEqual([]);
        expect(dirigent.speedRangeServices).toEqual([]);
        expect(dirigent.windBarRenderers).toEqual([]);
        expect(dirigent.currentSpeedRenderers).toEqual([]);
        expect(dirigent.windRoseData).toEqual([]);
        expect(dirigent.backgroundElement).toBeUndefined();
        expect(dirigent.currentDirectionRenderer).toBeUndefined();
        expect(dirigent.infoCornersRendeerer).toBeUndefined();
        expect(dirigent.infoText).toBe("");
    });

    it("does not process a response after its request becomes stale", async () => {
        const matcher = { match: jest.fn() };
        const dirigent = Object.create(WindRoseDirigent.prototype) as any;
        Object.assign(dirigent, {
            initReady: true,
            log: { method: jest.fn() },
            cardConfig: { activePeriod: {}, windspeedEntities: [{ useForWindRose: true }] },
            templateParser: { clearValues: jest.fn(), addPeriodData: jest.fn() },
            measurementProvider: { getMeasurements: jest.fn<() => Promise<any>>().mockResolvedValue({}) },
            measurementMatcher: matcher,
            windRoseData: [],
        });

        await expect(dirigent.refreshData(() => false)).rejects.toThrow("Stale measurement request");
        expect(matcher.match).not.toHaveBeenCalled();
    });
});
