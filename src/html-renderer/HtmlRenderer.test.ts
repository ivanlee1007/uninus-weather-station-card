import { describe, expect, it } from "@jest/globals";
import { HtmlRenderer } from "./HtmlRenderer";
import { TemplateParser } from "../textblocks/TemplateParser";
import { EntityState } from "../entity-state-processing/EntityState";
import type { CardConfigWrapper } from "../config/CardConfigWrapper";
import type { DateTimeFormatter } from "../formatter/DateTimeFormatter";

describe("HtmlRenderer entity substitutions", () => {
    it("escapes hostile entity state while preserving configured template markup", () => {
        const parser = new TemplateParser({} as DateTimeFormatter);
        const entityState = new EntityState(true, "sensor.hostile", undefined);
        entityState.state = `<img src=x onerror="globalThis.pwned=true">&'`;
        parser.addEntityStates([entityState]);
        const cardConfig = {
            textBlocks: {
                top: { text: "<strong>${sensor.hostile}</strong>" },
            },
        } as unknown as CardConfigWrapper;
        const renderer = new HtmlRenderer(cardConfig, parser);
        const top = { innerHTML: "" } as HTMLDivElement;
        const bottom = { innerHTML: "" } as HTMLDivElement;
        renderer.setHtmlElements(top, bottom);

        renderer.renderTextBlocks();

        expect(top.innerHTML).toBe(
            "<strong>&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;&amp;&#39;</strong>",
        );
        expect(top.innerHTML).not.toContain("<img");
    });
});
