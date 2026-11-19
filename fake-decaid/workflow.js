// Decaid's Workflow and its PUT, as Decaid v0.9.2 carries it out.
//
// Read from decaid v0.9.2: lib/src/services/webserver/workflow_handler.dart
// (`_applyUpdate`), lib/src/models/data/json_utils.dart (`deepMergeJson`),
// lib/src/models/data/workflow_context.dart (`fromJson`, `toJson`) and
// lib/src/models/data/workflow.dart; guided by decent-sync's
// server/test/support/decaid-workflow.ts. Recorded: recordings/workflow-merge.json.
//
// The body is deep-merged into the Workflow (objects key by key, anything else
// replaced, `profile.steps` whole), and the Workflow is rebuilt from the
// result: fields Decaid does not know are dropped, its profile's included, and
// a field of `context` merged in as null is dropped.

/** Each settings part's fields, whole numbers or doubles, as `Workflow.toJson` writes them. */
const PARTS = {
    steamSettings: { targetTemperature: 'int', duration: 'int', flow: 'double', stopAtTemperature: 'double' },
    hotWaterData: { targetTemperature: 'int', duration: 'int', volume: 'int', flow: 'double' },
    rinseData: { targetTemperature: 'int', duration: 'int', flow: 'double' },
};

/** A part merged in as null is rebuilt as Decaid's defaults; steamSettings refuses null. */
const DEFAULTS = {
    hotWaterData: { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
    rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
};

/** `WorkflowContext`'s fields, in `toJson`'s order. v0.9.2 added `grinderRpm`. */
const CONTEXT = {
    targetDoseWeight: 'double',
    targetYield: 'double',
    targetWaterVolume: 'double',
    grinderId: 'string',
    grinderModel: 'string',
    grinderBurrs: 'string',
    grinderSetting: 'string',
    grinderRpm: 'int',
    beanBatchId: 'string',
    coffeeName: 'string',
    coffeeRoaster: 'string',
    finalBeverageType: 'string',
    baristaName: 'string',
    drinkerName: 'string',
    extras: 'object',
};

const WORKFLOW_FIELDS = ['id', 'name', 'description', 'profile', 'context', 'steamSettings', 'hotWaterData', 'rinseData'];
const PROFILE_FIELDS = ['version', 'title', 'notes', 'author', 'beverage_type', 'steps', 'target_volume', 'target_weight', 'target_volume_count_start', 'tank_temperature'];

class FormatError extends Error {}

export const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
export const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** `deepMergeJson`: objects merged key by key, anything else replaced. */
export function deepMerge(base, updates) {
    const result = { ...base };
    for (const [key, value] of Object.entries(updates)) {
        const known = result[key];
        result[key] = isObject(known) && isObject(value) ? deepMerge(known, value) : value;
    }
    return result;
}

/**
 * `PUT /workflow` on `current`: `{ status, body }`, and the Workflow from then
 * on where it took.
 */
export function updateWorkflow(current, body) {
    if (!isObject(body)) return { answer: { status: 400, body: { error: 'Request body must be a JSON object' } } };
    try {
        rejectNulls(body, ['steamSettings', 'context']);
        if (isObject(body.steamSettings)) rejectNulls(body.steamSettings, ['targetTemperature', 'duration', 'flow', 'stopAtTemperature']);
        else if ('steamSettings' in body) throw new FormatError('Field "steamSettings" must be an object');
        if (isObject(body.context)) {
            rejectNulls(body.context, ['targetYield']);
            if ('targetYield' in body.context && typeof body.context.targetYield !== 'number') throw new FormatError('Field "targetYield" must be a number');
        } else if ('context' in body) throw new FormatError('Field "context" must be an object');
        const workflow = rebuilt(deepMerge(current, body));
        return { answer: { status: 200, body: copy(workflow) }, workflow };
    } catch (error) {
        if (!(error instanceof FormatError)) throw error;
        return { answer: { status: 400, body: { error: 'Invalid request', message: `FormatException: ${error.message}` } } };
    }
}

function rejectNulls(patch, fields) {
    for (const field of fields) if (field in patch && patch[field] === null) throw new FormatError(`Field "${field}" cannot be null`);
}

/** The Workflow Decaid rebuilds from a merged one. */
function rebuilt(merged) {
    const workflow = {};
    for (const field of WORKFLOW_FIELDS) if (field in merged) workflow[field] = merged[field];
    if (isObject(merged.profile)) {
        const profile = merged.profile;
        const kept = Object.fromEntries(PROFILE_FIELDS.filter(field => field in profile).map(field => [field, profile[field]]));
        if (Array.isArray(profile.steps)) kept.steps = profile.steps.map(rebuiltStep);
        workflow.profile = kept;
    }
    if (isObject(merged.context)) workflow.context = rebuiltContext(merged.context);
    else delete workflow.context;
    for (const [part, fields] of Object.entries(PARTS)) {
        const value = merged[part];
        const source = value === null || value === undefined ? DEFAULTS[part] : value;
        if (!isObject(source)) throw new FormatError(`Field "${part}" must be an object`);
        workflow[part] = Object.fromEntries(Object.entries(fields).map(([field, type]) => [field, readNumber(source[field], type)]));
    }
    return workflow;
}

/** A step as `ProfileStepPressure.toJson` and `ProfileStepFlow.toJson` write it, in their order. */
function rebuiltStep(step) {
    if (!isObject(step)) return step;
    const fields = ['name', 'pump', 'transition', 'exit', 'volume', 'seconds', 'weight', 'temperature', 'sensor', step.pump === 'flow' ? 'flow' : 'pressure', 'limiter'];
    const ordered = (value, keys) => (isObject(value) ? Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]])) : null);
    return Object.fromEntries(fields
        .filter(field => field in step || field === 'exit' || field === 'weight' || field === 'limiter')
        .map(field => [field, field === 'exit' ? ordered(step.exit, ['type', 'condition', 'value'])
            : field === 'limiter' ? ordered(step.limiter, ['value', 'range'])
                : field === 'weight' ? (step.weight ?? null) : step[field]]));
}

/** `WorkflowContext.fromJson` then `toJson`: known fields only, none that reads as null. */
function rebuiltContext(merged) {
    const context = {};
    for (const [field, type] of Object.entries(CONTEXT)) {
        const value = merged[field];
        const read = type === 'double' ? optionalDouble(value)
            : type === 'string' ? optionalString(value)
                : type === 'int' ? optionalInt(value)
                    : isObject(value) ? value : null;
        if (read !== null) context[field] = read;
    }
    return context;
}

/** `parseOptionalDouble`: a number, or a string that reads as one; any other value is a type error, a 500. */
function optionalDouble(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
    return null;
}

/** `_parseOptionalGrinderRpm`: a whole number of 0 or more, or null; anything else is refused. */
function optionalInt(value) {
    if (value === null || value === undefined) return null;
    if (Number.isInteger(value) && value >= 0) return value;
    throw new FormatError('grinderRpm must be a non-negative integer or null');
}

/**
 * `parseOptionalString`: a string, or a number or boolean as text. Dart writes
 * a whole double as "11.0", which JSON cannot tell from 11: the page sends
 * settings as strings, so the difference does not arise.
 */
function optionalString(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

/** A number as `parseInt` or `parseDouble` in json_utils.dart reads it: a fraction for an int is cut toward zero. */
function readNumber(value, type) {
    let number;
    if (typeof value === 'number') number = value;
    else if (typeof value === 'string' && /^[+-]?\d+(\.\d+)?$/.test(value.trim())) number = Number(value);
    else if (typeof value === 'string') throw new FormatError(`Invalid radix-10 number (at character 1)\n${value}\n^\n`);
    else number = 0;
    return type === 'int' ? Math.trunc(number) : number;
}
