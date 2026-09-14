import { WindSpeedConvertFunctionFactory } from "../converter/WindSpeedConvertFunctionFactory";

export interface ValueRange {
    from_value: number;
    color: string;
    label?: string;
}

export interface SpeedColorRange {
    from_value: number;
    color: string;
}

const windSpeedUnitFactory = new WindSpeedConvertFunctionFactory();

export const resolveWindSpeedDisplayUnit = (
    processedValue: number | undefined,
    rawUnit: string,
    outputUnit: string | undefined,
    outputUnitLabel: string | undefined,
): string => {
    if (processedValue === undefined) return rawUnit;
    if (outputUnitLabel) return outputUnitLabel;
    return windSpeedUnitFactory.units.find(unit => unit.configs.includes(outputUnit ?? ""))?.name ?? "";
};

export interface WeatherEntityConfig {
    entity: string;
    name?: string;
    unit?: string;
    value_ranges?: ValueRange[];
}

export interface WeatherEntitiesConfig {
    temperature: WeatherEntityConfig;
    humidity: WeatherEntityConfig;
    illuminance: WeatherEntityConfig;
    rain: WeatherEntityConfig;
    signal_strength?: WeatherEntityConfig;
    connectivity?: WeatherEntityConfig;
}

export interface RainStatesConfig {
    wet?: string[];
    dry?: string[];
}

export interface UninusWeatherStationCardConfig {
    type: string;
    name?: string;
    device_label?: string;
    wind_direction_entity: { entity: string; [key: string]: unknown };
    windspeed_entities: Array<{ entity: string; [key: string]: unknown }>;
    weather_entities: WeatherEntitiesConfig;
    rain_states?: RainStatesConfig;
    [key: string]: unknown;
}

export type RainClassification = "wet" | "dry" | "unknown" | "unavailable";

export type EightDirectionKey = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface EightDirectionDisplay {
    degrees: number;
    key: EightDirectionKey;
    label: string;
}

const unsafeCssColorPattern = /(?:url|image(?:-set)?|var|attr|expression)\s*\(|[;{}\\]/i;
const cssColorFunctionPattern = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-zA-Z.,%+\-\s/]+\)$/;

export const isSafeCssColor = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const color = value.trim();
    const containsControlCharacter = [...color].some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
    });
    if (!color || color.length > 128 || containsControlCharacter || unsafeCssColorPattern.test(color)) return false;
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^[a-z]+$/i.test(color) || cssColorFunctionPattern.test(color);
};

export const resolveActiveWindSpeedIndex = (
    entities: readonly { useForWindRose: boolean }[],
): number => entities.length ? Math.max(0, entities.findIndex(entity => entity.useForWindRose)) : -1;

const traditionalChineseDirectionLabels: Record<EightDirectionKey, string> = {
    n: "北", ne: "東北", e: "東", se: "東南",
    s: "南", sw: "西南", w: "西", nw: "西北",
};

export const resolveEightDirection = (
    value: string | number | undefined,
    customLabels: Partial<Record<EightDirectionKey, string>> = {},
): EightDirectionDisplay | undefined => {
    if (typeof value === "string" && value.trim() === "") return undefined;
    const numericValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return undefined;
    const degrees = numericValue % 360;
    const keys: EightDirectionKey[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
    const key = keys[Math.floor(((degrees + 22.5) % 360) / 45)];
    return { degrees, key, label: customLabels[key] || traditionalChineseDirectionLabels[key] };
};

export const resolveValueRange = (
    value: string | number | undefined,
    ranges: readonly ValueRange[] | undefined,
): ValueRange | undefined => {
    if (typeof value === "string" && value.trim() === "") return undefined;
    const numericValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue) || !ranges?.length) return undefined;
    let match: ValueRange | undefined;
    for (const range of ranges) {
        if (numericValue >= range.from_value) match = range;
    }
    return match;
};

export const normalizeSpeedRanges = (
    ranges: readonly SpeedColorRange[] | undefined,
): SpeedColorRange[] => {
    if (!ranges?.length || ranges.some(range =>
        !Number.isFinite(range?.from_value) || !isSafeCssColor(range?.color)) ||
        new Set(ranges.map(range => range.from_value)).size !== ranges.length) {
        return [];
    }
    return [...ranges].sort((left, right) => left.from_value - right.from_value);
};

export const resolveSpeedRange = (
    value: string | number | undefined,
    ranges: readonly SpeedColorRange[] | undefined,
): SpeedColorRange | undefined => {
    if (typeof value === "string" && value.trim() === "") return undefined;
    const numericValue = typeof value === "number" ? value : Number(value);
    const sorted = normalizeSpeedRanges(ranges);
    if (!Number.isFinite(numericValue) || !sorted.length) return undefined;
    let match: SpeedColorRange | undefined;
    for (const range of sorted) {
        if (numericValue >= range.from_value) match = range;
    }
    return match;
};

export const classifyRainState = (
    state: string | undefined,
    mapping: { wet: string[]; dry: string[] },
): RainClassification => {
    if (!state) return "unavailable";
    const normalized = state.trim().toLocaleLowerCase();
    if (normalized === "unavailable") return "unavailable";
    if (normalized === "unknown" || normalized === "") return "unknown";
    if (mapping.wet.some(value => value.trim().toLocaleLowerCase() === normalized)) {
        return "wet";
    }
    if (mapping.dry.some(value => value.trim().toLocaleLowerCase() === normalized)) {
        return "dry";
    }
    return "unknown";
};

export const getRainLabel = (classification: RainClassification): string => {
    if (classification === "wet") return "偵測到降雨";
    if (classification === "dry") return "目前無降雨";
    return "降雨感測無法使用";
};

export const isRainAnimationEnabled = (
    classification: RainClassification,
    disableAnimations: boolean,
): boolean => classification === "wet" && !disableAnimations;

export type ResponsiveMode = "wide" | "compact" | "narrow" | "small";

export const groupButtonsForLocation = <T extends { baseConfig: { newRow: boolean } }>(
    configuredLocation: string,
    requestedLocation: string,
    buttons: T[],
): T[][] => {
    if (configuredLocation !== requestedLocation) return [];
    return buttons.reduce<T[][]>((rows, button) => {
        if (rows.length === 0 || button.baseConfig.newRow) rows.push([]);
        rows[rows.length - 1].push(button);
        return rows;
    }, []);
};

export const classifyResponsiveMode = (width: number, _height: number): ResponsiveMode => {
    if (width >= 900) {
        return "wide";
    }
    if (width >= 560) return "compact";
    return width > 430 ? "narrow" : "small";
};

export const createMoreInfoEvent = (
    entityId: string,
    EventConstructor: typeof CustomEvent = CustomEvent,
): CustomEvent<{ entityId: string }> => new EventConstructor("hass-more-info", {
    detail: { entityId },
    bubbles: true,
    composed: true,
});

export interface HassStateLike {
    state: string;
    attributes: Record<string, unknown>;
    last_updated?: string;
}

export interface EntityDisplay {
    entity: string | undefined;
    name: string;
    value: string;
    unit: string;
    available: boolean;
    lastUpdated: string | undefined;
}

export const formatEntityState = (
    states: Record<string, HassStateLike>,
    config: WeatherEntityConfig | undefined,
): EntityDisplay => {
    const state = config ? states[config.entity] : undefined;
    const normalizedState = state?.state.trim().toLocaleLowerCase();
    const unavailable = !state || normalizedState === "unknown" || normalizedState === "unavailable";
    return {
        entity: config?.entity,
        name: config?.name ?? (state?.attributes.friendly_name as string | undefined) ?? "",
        value: unavailable ? "—" : state.state,
        unit: unavailable ? "" : config?.unit ??
            (state.attributes.unit_of_measurement as string | undefined) ?? "",
        available: !unavailable,
        lastUpdated: state?.last_updated,
    };
};

export type NormalizedWeatherStationConfig = UninusWeatherStationCardConfig & {
    name: string;
    device_label: string;
    rain_states: { wet: string[]; dry: string[] };
};

const defaultPeriodButtons = [
    { type: "period_shift", button_text: "前移", shift_period: "-8h" },
    { type: "period_selector", button_text: "1H", period_back: "-1h" },
    { type: "period_selector", button_text: "8H", period_back: "-8h", active: true },
    { type: "period_selector", button_text: "1D", period_back: "-1d" },
    { type: "period_selector", button_text: "10D", period_back: "-10d" },
    {
        type: "period_shift_play", button_text: "播放", period_back: "-8h",
        step_period: "+1h", window_period: "+1h", delay: 1000,
    },
    { type: "period_shift", button_text: "後移", shift_period: "+8h" },
];

const defaultTemperatureRanges: ValueRange[] = [
    { from_value: -50, color: "#4388b8", label: "偏低" },
    { from_value: 18, color: "#168e72", label: "舒適" },
    { from_value: 26, color: "#d07b29", label: "偏高" },
    { from_value: 32, color: "#d6533e", label: "炎熱" },
];

const defaultHumidityRanges: ValueRange[] = [
    { from_value: 0, color: "#4388b8", label: "偏乾" },
    { from_value: 40, color: "#168e72", label: "舒適" },
    { from_value: 70, color: "#d07b29", label: "偏高" },
    { from_value: 85, color: "#d6533e", label: "潮濕" },
];

const withDirectionLabelDefaults = (value: unknown): Record<string, unknown> => {
    const configured = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const custom = configured.custom_labels && typeof configured.custom_labels === "object" &&
        !Array.isArray(configured.custom_labels)
        ? configured.custom_labels as Record<string, unknown>
        : {};
    return {
        show_cardinal_directions: true,
        show_intercardinal_directions: true,
        ...configured,
        custom_labels: { ...traditionalChineseDirectionLabels, ...custom },
    };
};

export const buildWindRoseConfig = (
    config: NormalizedWeatherStationConfig,
): Record<string, unknown> => ({
    ...config,
    title: "",
    hide_windspeed_bar: config.hide_windspeed_bar ?? true,
    current_direction: config.current_direction ?? { show_arrow: true },
    direction_labels: withDirectionLabelDefaults(config.direction_labels),
    buttons_config: config.buttons_config ?? (config.data_period ? undefined : {
        location: "top",
        buttons: defaultPeriodButtons.map(button => ({ ...button })),
    }),
});

const requireEntity = (path: string, value: unknown): void => {
    if (!value || typeof value !== "object" || !("entity" in value) ||
        typeof (value as { entity?: unknown }).entity !== "string" ||
        (value as { entity: string }).entity.trim() === "") {
        throw new Error(`UNINUS weather station card: ${path} is required.`);
    }
};

const validateRainStates = (key: "wet" | "dry", value: unknown): void => {
    if (value !== undefined && (!Array.isArray(value) || value.some(state => typeof state !== "string"))) {
        throw new Error(`UNINUS weather station card: rain_states.${key} must be an array of strings.`);
    }
};

const validateValueRanges = (key: "temperature" | "humidity", value: unknown): void => {
    if (value === undefined) return;
    const path = `weather_entities.${key}.value_ranges`;
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`UNINUS weather station card: ${path} must be a non-empty array.`);
    }
    let previous = Number.NEGATIVE_INFINITY;
    for (const range of value) {
        if (!range || typeof range !== "object" ||
            !Number.isFinite((range as ValueRange).from_value) ||
            !isSafeCssColor((range as ValueRange).color) ||
            ((range as ValueRange).label !== undefined && typeof (range as ValueRange).label !== "string") ||
            (range as ValueRange).from_value <= previous) {
            throw new Error(`UNINUS weather station card: ${path} contains an invalid or unordered range.`);
        }
        previous = (range as ValueRange).from_value;
    }
};

const validateSpeedRanges = (index: number, value: unknown): void => {
    if (value === undefined) return;
    const path = `windspeed_entities.${index}.speed_ranges`;
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`UNINUS weather station card: ${path} must be a non-empty array.`);
    }
    const ranges = value as SpeedColorRange[];
    if (normalizeSpeedRanges(ranges).length !== ranges.length) {
        throw new Error(`UNINUS weather station card: ${path} contains an invalid or duplicate range.`);
    }
};

const validateDirectionLabels = (value: unknown): void => {
    if (value === undefined) return;
    const configured = value as { custom_labels?: unknown };
    const customLabels = configured?.custom_labels;
    if (customLabels === undefined) return;
    if (!customLabels || typeof customLabels !== "object" || Array.isArray(customLabels) ||
        Object.values(customLabels).some(label => typeof label !== "string" || label.trim() === "")) {
        throw new Error("UNINUS weather station card: direction_labels.custom_labels must be an object of non-empty strings.");
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validateColorRecord = (path: string, value: unknown): void => {
    if (value === undefined) return;
    if (!isRecord(value)) {
        throw new Error(`UNINUS weather station card: ${path} must be an object.`);
    }
    for (const [key, color] of Object.entries(value)) {
        if (color !== undefined && !isSafeCssColor(color)) {
            throw new Error(`UNINUS weather station card: ${path}.${key} contains an unsafe color.`);
        }
    }
};

const validateConfigColors = (config: UninusWeatherStationCardConfig): void => {
    validateColorRecord("colors", config.colors);

    if (isRecord(config.buttons_config)) {
        validateColorRecord("buttons_config.default_colors", config.buttons_config.default_colors);
        if (Array.isArray(config.buttons_config.buttons)) {
            config.buttons_config.buttons.forEach((button, index) => {
                if (isRecord(button)) {
                    validateColorRecord(`buttons_config.buttons.${index}.colors`, button.colors);
                }
            });
        }
    }

    if (isRecord(config.corner_info)) {
        for (const [position, corner] of Object.entries(config.corner_info)) {
            if (isRecord(corner) && corner.color !== undefined && !isSafeCssColor(corner.color)) {
                throw new Error(`UNINUS weather station card: corner_info.${position}.color contains an unsafe color.`);
            }
        }
    }

    if (isRecord(config.text_blocks)) {
        for (const [position, block] of Object.entries(config.text_blocks)) {
            if (isRecord(block) && block.text_color !== undefined && !isSafeCssColor(block.text_color)) {
                throw new Error(`UNINUS weather station card: text_blocks.${position}.text_color contains an unsafe color.`);
            }
        }
    }
};

export const normalizeWeatherStationConfig = (
    config: UninusWeatherStationCardConfig,
): NormalizedWeatherStationConfig => {
    requireEntity("wind_direction_entity.entity", config?.wind_direction_entity);
    if (!Array.isArray(config?.windspeed_entities) || config.windspeed_entities.length === 0) {
        throw new Error("UNINUS weather station card: windspeed_entities requires at least one entity.");
    }
    config.windspeed_entities.forEach((entity, index) => {
        requireEntity(`windspeed_entities.${index}.entity`, entity);
        validateSpeedRanges(index, entity.speed_ranges);
    });
    requireEntity("weather_entities.temperature.entity", config?.weather_entities?.temperature);
    requireEntity("weather_entities.humidity.entity", config?.weather_entities?.humidity);
    requireEntity("weather_entities.illuminance.entity", config?.weather_entities?.illuminance);
    requireEntity("weather_entities.rain.entity", config?.weather_entities?.rain);
    if (config.weather_entities.signal_strength !== undefined) {
        requireEntity("weather_entities.signal_strength.entity", config.weather_entities.signal_strength);
    }
    if (config.weather_entities.connectivity !== undefined) {
        requireEntity("weather_entities.connectivity.entity", config.weather_entities.connectivity);
    }
    validateValueRanges("temperature", config.weather_entities.temperature.value_ranges);
    validateValueRanges("humidity", config.weather_entities.humidity.value_ranges);
    validateDirectionLabels(config.direction_labels);
    validateConfigColors(config);
    if (config.rain_states !== undefined &&
        (config.rain_states === null || typeof config.rain_states !== "object" || Array.isArray(config.rain_states))) {
        throw new Error("UNINUS weather station card: rain_states must be an object.");
    }
    validateRainStates("wet", config.rain_states?.wet);
    validateRainStates("dry", config.rain_states?.dry);

    return {
        ...config,
        name: config.name?.trim() || "UNINUS 氣象站",
        device_label: config.device_label?.trim() || "外部環境氣象站",
        weather_entities: {
            ...config.weather_entities,
            temperature: {
                ...config.weather_entities.temperature,
                value_ranges: config.weather_entities.temperature.value_ranges ??
                    defaultTemperatureRanges.map(range => ({ ...range })),
            },
            humidity: {
                ...config.weather_entities.humidity,
                value_ranges: config.weather_entities.humidity.value_ranges ??
                    defaultHumidityRanges.map(range => ({ ...range })),
            },
        },
        rain_states: {
            wet: config.rain_states?.wet ?? ["下雨中", "on"],
            dry: config.rain_states?.dry ?? ["沒下雨", "off"],
        },
    };
};
