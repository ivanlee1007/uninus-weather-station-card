export interface WeatherEntityConfig {
    entity: string;
    name?: string;
    unit?: string;
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

export const classifyRainState = (
    state: string | undefined,
    mapping: { wet: string[]; dry: string[] },
): RainClassification => {
    if (!state || state === "unknown" || state === "unavailable") {
        return "unavailable";
    }
    const normalized = state.trim().toLocaleLowerCase();
    if (mapping.wet.some(value => value.trim().toLocaleLowerCase() === normalized)) {
        return "wet";
    }
    if (mapping.dry.some(value => value.trim().toLocaleLowerCase() === normalized)) {
        return "dry";
    }
    return "unknown";
};

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
    if (width >= 760) {
        return "wide";
    }
    if (width >= 560) return "compact";
    return width > 390 ? "narrow" : "small";
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
    { type: "period_shift", button_text: "後移", shift_period: "+8h" },
];

export const buildWindRoseConfig = (
    config: NormalizedWeatherStationConfig,
): Record<string, unknown> => ({
    ...config,
    title: "",
    hide_windspeed_bar: config.hide_windspeed_bar ?? true,
    current_direction: config.current_direction ?? { show_arrow: true },
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

export const normalizeWeatherStationConfig = (
    config: UninusWeatherStationCardConfig,
): NormalizedWeatherStationConfig => {
    requireEntity("wind_direction_entity.entity", config?.wind_direction_entity);
    if (!Array.isArray(config?.windspeed_entities) || config.windspeed_entities.length === 0) {
        throw new Error("UNINUS weather station card: windspeed_entities requires at least one entity.");
    }
    config.windspeed_entities.forEach((entity, index) =>
        requireEntity(`windspeed_entities.${index}.entity`, entity));
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

    return {
        ...config,
        name: config.name?.trim() || "UNINUS 氣象站",
        device_label: config.device_label?.trim() || "外部環境氣象站",
        rain_states: {
            wet: config.rain_states?.wet ?? ["下雨中", "on"],
            dry: config.rain_states?.dry ?? ["沒下雨", "off"],
        },
    };
};
