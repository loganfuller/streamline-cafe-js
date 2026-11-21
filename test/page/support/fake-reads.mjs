// What the page tests read of the fake Decaid's state, and the one fixture
// write they share (`matchMachine`): DYE2's records, the recipe it has loaded,
// and Decaid's profiles as the page reads them.

import { expect } from './test.mjs';
import { recording } from './adapter.mjs';

const DYE2 = 'dye2.reaplugin';
const RECORDS = `/api/v1/store/${DYE2}/recipes`;

/** DYE2's recipe records, as its store holds them. */
export const records = fake => fake.store.get(DYE2, 'recipes') || [];
/** A recipe's DYE2 record, by its name. */
export const recordOf = (fake, name) => records(fake).find(row => row && row.name === name);
/** The id of the recipe DYE2 has loaded, or null. */
export const loadedId = fake => { const selection = fake.selection(); return selection?.kind === 'recipe' ? selection.id : null; };
/** A write of DYE2's records, in the fake's log. */
export const isRecordWrite = entry => entry.method === 'POST' && entry.path === RECORDS;

const MACHINE_FIELDS = { steamTempC: ['steamSettings', 'targetTemperature'], steamTimeS: ['steamSettings', 'duration'], steamFlowMls: ['steamSettings', 'flow'], steamStopAtTempC: ['steamSettings', 'stopAtTemperature'], hotWaterTempC: ['hotWaterData', 'targetTemperature'], hotWaterTimeS: ['hotWaterData', 'duration'], hotWaterMl: ['hotWaterData', 'volume'], hotWaterFlowMls: ['hotWaterData', 'flow'], flushTempC: ['rinseData', 'targetTemperature'], flushS: ['rinseData', 'duration'], flushFlowMls: ['rinseData', 'flow'] };
export function matchMachine(fake, name) {
    const machineNow = fake.workflow();
    fake.store.set(DYE2, 'recipes', records(fake).map(row => {
        if (!row || row.name !== name) return row;
        const dashboardVariables = { ...row.dashboardVariables };
        for (const [key, [group, field]] of Object.entries(MACHINE_FIELDS)) {
            if (dashboardVariables[key] != null && machineNow[group]?.[field] != null) dashboardVariables[key] = machineNow[group][field];
        }
        return { ...row, dashboardVariables };
    }));
    const { targetTemperature, flow } = machineNow.rinseData || {};
    fake.patchBoot('GET /api/v1/machine/settings', settings => ({ ...settings, ...(targetTemperature != null && { flushTemp: targetTemperature }), ...(flow != null && { flushFlow: flow }) }));
}

/**
 * The `measurements` and `annotations` of what Decaid stores for a shot of
 * `stored`'s stopped two seconds into its profile: its Preheat and its first
 * two seconds of preinfusion, nothing on the scale, the machine never pouring,
 * and only the weighed dose kept. `isUnfinished` (src/cafe/shot-model.js)
 * calls it Unfinished. The fake can't stop a pour early, so a test adds such a
 * Shot with `fake.shots.add`.
 */
export function unfinishedParts(stored) {
    const startedAt = stored.measurements.find(m => m.machine.state.substate !== 'preparingForShot').machine.timestamp;
    const cut = Date.parse(startedAt) + 2000;
    const measurements = stored.measurements
        .filter(m => m.machine.state.substate === 'preparingForShot' || (m.machine.state.substate === 'preinfusion' && Date.parse(m.machine.timestamp) <= cut))
        .map(m => ({ ...m, scale: m.scale ? { ...m.scale, weight: 0, weightFlow: 0 } : m.scale }));
    return { measurements, annotations: { actualDoseWeight: stored.annotations.actualDoseWeight } };
}

/** Decaid's profiles, as the page reads them at boot. */
export const PROFILES = recording('boot').requests['GET /api/v1/profiles?includeHidden=true'].body;

// Streamline's own profile overrides (src/modules/profile-overrides.js) keep the
// grind setting a Workflow write leaves, under the id Decaid's profile library
// gives the Workflow's profile: the write that keeps `grinderSetting`.
export function profileOverride(fake, grinderSetting) {
    const matches = PROFILES.filter(entry => entry.profile.title === fake.workflow().profile.title);
    expect(matches, 'one profile in Decaid\'s library has the Workflow\'s title').toHaveLength(1);
    return { write: `POST /api/v1/store/streamlineProfileOverrides/${encodeURIComponent(matches[0].id)}`, body: { grinderSetting } };
}
