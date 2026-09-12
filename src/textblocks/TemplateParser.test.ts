import { beforeEach, describe, expect, test } from "@jest/globals";
import { TemplateParser } from "./TemplateParser";
import { DateTimeFormatter } from "../formatter/DateTimeFormatter";
import { EntityState } from "../entity-state-processing/EntityState";
import {
    DateFormat,
    FirstWeekday,
    FrontendLocaleData,
    NumberFormat,
    TimeFormat,
    TimeZone
} from "../util/HomeAssistant";

describe('TemplateParser', () => {

    let templateParser: TemplateParser;
    let dateTimeFormatter: DateTimeFormatter;

    beforeEach(() => {
        let frontendLocaleData: FrontendLocaleData = {
            language: "nl",
            number_format: NumberFormat.system,
            time_format: TimeFormat.twenty_four,
            date_format: DateFormat.YMD,
            first_weekday: FirstWeekday.monday,
            time_zone: TimeZone.local,
        }
        dateTimeFormatter = new DateTimeFormatter(frontendLocaleData, "America/New_York")
        templateParser = new TemplateParser(dateTimeFormatter);
    });


    test('replace ${test} with value', () => {
        templateParser.addOrUpdateValue('test', 'aan');
        templateParser.addOrUpdateValue('e', 'E');
        expect(templateParser.parse('abc${test}d${e}f')).toEqual('abcaandEf');
    });

    test('preserves JavaScript replacement tokens in entity values', () => {
        const entityState = new EntityState(true, 'sensor.tokens', undefined);
        entityState.state = "before $& $` $' after";
        templateParser.addEntityStates([entityState]);

        expect(templateParser.parse('L${sensor.tokens}R')).toBe("Lbefore $& $` $' afterR");
    });

    test('preserves entity ampersands for plain-text and SVG consumers', () => {
        const entityState = new EntityState(true, 'sensor.label', undefined);
        entityState.state = 'A&B';
        templateParser.addEntityStates([entityState]);

        expect(templateParser.parse('${sensor.label}')).toBe('A&B');
        expect(templateParser.templateValues.find(value => value.name === 'sensor.label')?.value).toBe('A&B');
    });

    test('find entity palceholder', () => {
       const entities = TemplateParser.findEntityPlaceholders(`tes $\{jan} asd $\{sensor.wind-speed} $\{asdf`);

       expect(entities.length).toEqual(1);
       expect(entities[0].entity).toEqual('sensor.wind-speed');
       expect(entities[0].attribute).toBeUndefined();
    });

    test('find entity palceholder with attribute', () => {
        const entities = TemplateParser.findEntityPlaceholders(`tes $\{jan} asd $\{sensor.wind-speed.max} $\{asdf`);

        expect(entities.length).toEqual(1);
        expect(entities[0].entity).toEqual('sensor.wind-speed');
        expect(entities[0].attribute).toEqual('max');
        expect(entities[0].active).toEqual(true);
    });

    test('find entity palceholder, no entite', () => {
        const entities = TemplateParser.findEntityPlaceholders(`tes $\{jan} xx$\{asdf`);

        expect(entities.length).toEqual(0);
    });

});
