// The scenarios behind each rule the fake Decaid follows: short lists of
// requests the recorder sends to the pinned real stack. Each answer, and each
// push DYE2 made on its `changed` socket meanwhile, is written to
// fake-decaid/recordings/<scenario>.json, and `npm test` sends the same
// requests to the model and compares (test/fake-decaid-recordings.test.mjs).
//
// `dye2: true` keeps DYE2's store keys with the Workflow the scenario starts
// from, for a scenario whose answers DYE2 has a hand in.
//
// A step's `body` may be a function of what the scenario has seen: `sample`
// (the sample data as Decaid answers it at the start) and `seen` (earlier
// answers, by the step's `as`). The recording keeps the request as sent.
//
// A step `{ event: 'restart-dye2' }` is no request: the recorder disables DYE2
// and enables it again through Decaid's plugin routes and waits for it to load,
// and the replay calls the model's `restartDye2()`. `{ event: 'disable-dye2' }`
// and `{ event: 'enable-dye2' }` are each half of that, and the replay calls
// `disableDye2()` and `enableDye2()`. An event's recording has no answer, and
// what DYE2 pushes as it loads is neither kept nor compared.
//
// Each scenario keeps the Workflow it started from, which the replay starts
// from too, and puts back what else it relies on (no recipe loaded) with its
// first requests, so they can be recorded and replayed one at a time.

const DYE2 = '/plugins/dye2.reaplugin';
const recipeNamed = (sample, name) => sample.recipes.find(row => row.name === name);
const grinderNamed = (sample, model) => sample.grinders.find(row => row.model === model);
const beanNamed = (sample, name) => sample.beans.find(row => row.name === name);
// The one batch of a sample bean that has one, so a write to it reorders no list.
const onlyBatch = (sample, name) => sample.batches[beanNamed(sample, name).id][0];
const decafBatch = ({ sample }) => `/bean-batches/${onlyBatch(sample, 'Example Decaf').id}`;
const decafBatches = query => ({ sample }) => `/beans/${beanNamed(sample, 'Example Decaf').id}/batches${query}`;
// DYE2's records with one of them on another profile, as the page's profile
// change writes it: the profile, in its snapshot and its stored Workflow.
const withProfile = (sample, name, profile) => sample.recipes.map(row => (row.name === name
    ? { ...row, profileTitle: profile.title, profileSnapshot: profile, workflow: { ...row.workflow, profile } }
    : row));
// The Workflow Streamline's `applyRecipe` writes for a recipe, as the page sent
// it on the pinned stack: the record's context, its basket and its id, its
// profile, and the dial-in fields DYE2 holds cleared where the record has none.
const applied = record => ({
    context: {
        ...record.workflow.context,
        extras: { ...record.workflow.context.extras, dye: { v: 1, recipeId: record.id }, rpm: null, feedRate: null },
        drinkerName: null,
    },
    profile: record.workflow.profile,
});

// A profile with every step's temperature moved by `by`, as the page's brew
// temperature stepper writes it.
const warmer = (profile, by) => ({ ...profile, steps: profile.steps.map(step => ({ ...step, temperature: step.temperature + by })) });
// The sample records with one of them holding none of `keys` in its dashboard.
const withoutFields = (sample, name, keys) => sample.recipes.map(row => (row.name === name
    ? { ...row, dashboardVariables: Object.fromEntries(Object.entries(row.dashboardVariables).filter(([key]) => !keys.includes(key))) }
    : row));

export const SCENARIOS = [
    {
        name: 'workflow-merge',
        rule: 'fake-decaid/workflow.js',
        // DYE2 hears each write, and answers the selection the scenario clears.
        dye2: true,
        about: 'Decaid merges a Workflow write into the Workflow and rebuilds it: objects key by key, a context field written as null dropped, nulls inside extras kept, unknown fields dropped, a profile\'s steps replaced whole; nulls and wrong types refused.',
        steps: [
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'GET', path: '/workflow' },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ context: { grinderId: grinderNamed(sample, 'Sample Grinder 64').id, grinderModel: 'Sample Grinder 64', grinderSetting: '2.6', extras: { rpm: null } } }) },
            { method: 'PUT', path: '/workflow', body: { context: { coffeeName: null, baristaName: 'Sample Barista', unknownField: 1, extras: { feedRate: null, sample: { nested: true } } }, unknownTop: true } },
            { method: 'PUT', path: '/workflow', body: { context: { targetDoseWeight: '18.5', grinderSetting: 3, grinderRpm: 900 } } },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ profile: { ...sample.workflow.profile, steps: sample.workflow.profile.steps.slice(0, 1), id: 'dropped' } }) },
            { method: 'PUT', path: '/workflow', body: { context: null } },
            { method: 'PUT', path: '/workflow', body: { context: { targetYield: null } } },
            { method: 'PUT', path: '/workflow', body: { context: { targetYield: '36' } } },
            { method: 'PUT', path: '/workflow', body: { steamSettings: { flow: null } } },
            { method: 'PUT', path: '/workflow', body: { hotWaterData: null } },
            { method: 'GET', path: '/workflow' },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
        ],
    },
    {
        name: 'store',
        rule: 'fake-decaid/store.js',
        about: 'Decaid\'s store: a key never written answers null, a write answers {} and is read back as written, a namespace lists its keys or, with full=1, its values, and a delete answers {}.',
        steps: [
            { method: 'GET', path: '/store/fakeDecaidScenario/never' },
            { method: 'POST', path: '/store/fakeDecaidScenario/object', body: { a: 1, list: [1, 'two', null] } },
            { method: 'GET', path: '/store/fakeDecaidScenario/object' },
            { method: 'POST', path: '/store/fakeDecaidScenario/text', body: 'true' },
            { method: 'GET', path: '/store/fakeDecaidScenario/text' },
            { method: 'POST', path: '/store/fakeDecaidScenario/profile%3Aab12', body: { grinderSetting: '11.5' } },
            { method: 'GET', path: '/store/fakeDecaidScenario/profile%3Aab12' },
            { method: 'GET', path: '/store/fakeDecaidScenario' },
            { method: 'GET', path: '/store/fakeDecaidScenario?full=1' },
            { method: 'DELETE', path: '/store/fakeDecaidScenario/object' },
            { method: 'GET', path: '/store/fakeDecaidScenario/object' },
            { method: 'GET', path: '/store/fakeDecaidScenario?full=1' },
        ],
    },
    {
        name: 'dye2-selection',
        rule: 'fake-decaid/dye2.js',
        dye2: true,
        about: 'DYE2 derives the selection from the Workflow: a recipe by the Workflow\'s recipeId, modified once the Workflow moves off a field the record holds; a recent whose fields the Workflow matches; pushes on changed only when the selection moves; clears recipeId when the profile changes under a recipe; and a Workflow write leaves its records as they were.',
        socket: '/ws/v1/plugins/dye2.reaplugin/changed',
        steps: [
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/store/dye2.reaplugin/selection' },
            // A recipe loaded as the page loads one: Streamline's apply, then the id.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => applied(recipeNamed(sample, 'House espresso')) },
            { method: 'POST', path: `${DYE2}/selection`, body: ({ sample }) => ({ kind: 'recipe', id: recipeNamed(sample, 'House espresso').id }) },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/store/dye2.reaplugin/selection' },
            // The grinder dialog's write: the recipe stays loaded and its record unchanged.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ context: { grinderId: grinderNamed(sample, 'Sample Grinder 38').id, grinderModel: 'Sample Grinder 38', grinderSetting: '11.5', extras: { rpm: 800 } } }) },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            // Another recipe, then a step back onto every field the record holds.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => applied(recipeNamed(sample, 'Decaf')) },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ context: { targetDoseWeight: 17.5 } }) },
            { method: 'GET', path: `${DYE2}/selection` },
            // Another profile under the recipe: DYE2 clears the recipe's id.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ profile: recipeNamed(sample, 'Single origin').workflow.profile }) },
            { method: 'GET', path: '/workflow' },
            { method: 'GET', path: `${DYE2}/selection` },
            // Its own skin answer, and a recipe id no record has.
            { method: 'GET', path: `${DYE2}/skin` },
            { method: 'POST', path: `${DYE2}/selection`, body: { kind: 'recipe', id: 'recipe-none' } },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
        ],
    },
    {
        name: 'dye2-record',
        rule: 'fake-decaid/dye2.js',
        dye2: true,
        about: 'DYE2\'s record, as Decent Sync\'s plugin asks for it: nothing saved with no recipe loaded or nothing moved; a moved dose, yield and grind setting written into the loaded recipe\'s record and its stored Workflow; a brew temperature moved, its stored profile moved with it; a basket chosen, id and name together; a hot water value the record holds; steam turned off, its temperature and time held back; a value the record does not hold, written once moved since the apply and not otherwise; and a recipe whose record is gone. Each write pushes on changed, and only that row changes.',
        socket: '/ws/v1/plugins/dye2.reaplugin/changed',
        steps: [
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            // House espresso loaded as the page loads it, then saved with nothing moved.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => applied(recipeNamed(sample, 'House espresso')) },
            { method: 'POST', path: `${DYE2}/selection`, body: ({ sample }) => ({ kind: 'recipe', id: recipeNamed(sample, 'House espresso').id }) },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            // The dial-in moved.
            { method: 'PUT', path: '/workflow', body: { context: { targetDoseWeight: 18.5, targetYield: 38, grinderSetting: '2.6' } } },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            { method: 'GET', path: `${DYE2}/selection` },
            // The brew temperature two degrees up.
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ profile: warmer(recipeNamed(sample, 'House espresso').workflow.profile, 2) }) },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            // A basket chosen, as the basket dialog writes it.
            { method: 'PUT', path: '/workflow', body: { context: { extras: { basketId: 'bskt-sample-20', basketName: '20 g sample basket' } } } },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            // A hot water value the record holds.
            { method: 'PUT', path: '/workflow', body: { hotWaterData: { volume: 60 } } },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            // Steam turned off as Streamline turns it off, and the dose moved back.
            { method: 'PUT', path: '/workflow', body: { steamSettings: { targetTemperature: 0, duration: 0 }, context: { targetDoseWeight: 18 } } },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            { method: 'PUT', path: '/workflow', body: { steamSettings: { targetTemperature: 150, duration: 50 }, hotWaterData: { volume: 50 } } },
            // Decaf's record holding no hot water time and no steam flow: the
            // time moved after the apply is written, the flow left alone is not.
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => withoutFields(sample, 'Decaf', ['hotWaterTimeS', 'steamFlowMls']) },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => applied(recipeNamed(sample, 'Decaf')) },
            { method: 'POST', path: `${DYE2}/selection`, body: ({ sample }) => ({ kind: 'recipe', id: recipeNamed(sample, 'Decaf').id }) },
            { method: 'PUT', path: '/workflow', body: { hotWaterData: { duration: 35 } } },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            // Decaf's record gone while it is loaded.
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => sample.recipes.filter(row => row.name !== 'Decaf') },
            { method: 'POST', path: `${DYE2}/record`, body: {} },
            // Everything put back.
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => sample.recipes },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
        ],
    },
    {
        name: 'grinders',
        rule: 'fake-decaid/library.js',
        about: 'Decaid\'s grinders: the archived left out unless asked for, the most recently changed first; one by its id, or 404; a bean batch by its id.',
        steps: [
            { method: 'GET', path: '/grinders' },
            { method: 'GET', path: '/grinders?includeArchived=false' },
            { method: 'GET', path: '/grinders?includeArchived=true' },
            { method: 'GET', path: ({ sample }) => `/grinders/${grinderNamed(sample, 'Sample Grinder 38').id}` },
            { method: 'GET', path: '/grinders/no-such-grinder' },
            { method: 'GET', path: ({ sample }) => `/bean-batches/${sample.workflow.context.beanBatchId}` },
        ],
    },
    {
        name: 'beans',
        rule: 'fake-decaid/library.js',
        about: 'Decaid\'s beans and a bean\'s batches: bare lists, the most recently changed first, the archived left out unless asked for; no batches for a bean it doesn\'t have.',
        steps: [
            { method: 'GET', path: '/beans' },
            { method: 'GET', path: '/beans?includeArchived=false' },
            { method: 'GET', path: '/beans?includeArchived=true' },
            { method: 'GET', path: ({ sample }) => `/beans/${beanNamed(sample, 'Sample Blend').id}/batches` },
            { method: 'GET', path: ({ sample }) => `/beans/${beanNamed(sample, 'Sample Blend').id}/batches?includeArchived=true` },
            { method: 'GET', path: ({ sample }) => `/beans/${beanNamed(sample, 'Example Decaf').id}/batches?includeArchived=false` },
            { method: 'GET', path: '/beans/no-such-bean/batches?includeArchived=true' },
        ],
    },
    {
        name: 'batch-weight',
        rule: 'fake-decaid/library.js',
        about: 'A batch\'s remaining weight written alone: every other field of the record is kept, the answer is the record as stored, and a read gives it back; a weight that is no number is refused, a batch Decaid doesn\'t have is not found, and a null clears the weight.',
        steps: [
            { method: 'GET', path: decafBatch },
            { method: 'PUT', path: decafBatch, body: { weightRemaining: 2890 } },
            { method: 'GET', path: decafBatch },
            { method: 'GET', path: decafBatches('') },
            { method: 'PUT', path: decafBatch, body: { weightRemaining: 'heavy' } },
            { method: 'PUT', path: '/bean-batches/no-such-batch', body: { weightRemaining: 100 } },
            { method: 'GET', path: decafBatch },
            { method: 'PUT', path: decafBatch, body: { weightRemaining: null } },
            { method: 'GET', path: decafBatch },
        ],
    },
    {
        name: 'batch-archive',
        rule: 'fake-decaid/library.js',
        about: 'A batch archived with a write of that field alone: every other field of the record is kept, a bean\'s batches leave it out unless the archived are asked for, and a read by its id still gives it; a null is refused; and it is brought back the same way.',
        steps: [
            { method: 'PUT', path: decafBatch, body: { archived: true } },
            { method: 'GET', path: decafBatch },
            { method: 'GET', path: decafBatches('') },
            { method: 'GET', path: decafBatches('?includeArchived=true') },
            { method: 'PUT', path: decafBatch, body: { archived: null } },
            { method: 'PUT', path: decafBatch, body: { archived: false } },
            { method: 'GET', path: decafBatches('') },
        ],
    },
    {
        name: 'dye2-save-recipe',
        rule: 'fake-decaid/dye2.js',
        dye2: true,
        about: 'DYE2\'s save-recipe: a recipe from the live Workflow, named from the first word of its profile\'s title and its bean (a name taken gets " 2"), or by the name asked for, in the slot asked for (its holder losing the slot) or none, the Workflow\'s recipeId set to it and the recipe loaded, with a push.',
        socket: '/ws/v1/plugins/dye2.reaplugin/changed',
        steps: [
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            // A Workflow on Adaptive v3 with a bean, saved into slot 4: "Adaptive <bean>".
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ profile: recipeNamed(sample, 'Single origin').workflow.profile, context: { coffeeName: 'Sample Blend' } }) },
            { method: 'POST', path: `${DYE2}/save-recipe`, body: { slot: 4 } },
            { method: 'GET', path: '/workflow' },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            // The same again, into slot 4: the name counts, and the first loses its slot.
            { method: 'POST', path: `${DYE2}/save-recipe`, body: { slot: 4 } },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            // A name asked for, and no slot.
            { method: 'POST', path: `${DYE2}/save-recipe`, body: { name: '  Sample Named Recipe ', slot: 9 } },
            { method: 'GET', path: '/store/dye2.reaplugin/recipes' },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => sample.recipes },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
        ],
    },
    {
        name: 'dye2-restart',
        rule: 'fake-decaid/dye2.js',
        dye2: true,
        about: 'DYE2 started again keeps a recipe loaded whose record holds the Workflow\'s profile, as after a profile change written into the record first; and keeps it loaded when the record holds another profile too.',
        steps: [
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => applied(recipeNamed(sample, 'House espresso')) },
            { method: 'POST', path: `${DYE2}/selection`, body: ({ sample }) => ({ kind: 'recipe', id: recipeNamed(sample, 'House espresso').id }) },
            // The record takes Adaptive v3 first, then the Workflow does: still loaded.
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => withProfile(sample, 'House espresso', recipeNamed(sample, 'Single origin').workflow.profile) },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => ({ profile: recipeNamed(sample, 'Single origin').workflow.profile }) },
            { method: 'GET', path: `${DYE2}/selection` },
            { event: 'restart-dye2' },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/workflow' },
            // The record back on its own profile, and DYE2 started again: still loaded.
            { method: 'POST', path: '/store/dye2.reaplugin/recipes', body: ({ sample }) => sample.recipes },
            { event: 'restart-dye2' },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: '/workflow' },
            { method: 'POST', path: `${DYE2}/selection`, body: {} },
            { method: 'PUT', path: '/workflow', body: ({ sample }) => sample.workflow },
        ],
    },
    {
        name: 'dye2-plugin',
        rule: 'fake-decaid/index.js',
        about: 'DYE2 disabled in Decaid: listed as not loaded, its routes answered 404; enabled again: listed as loaded, its routes answered as before.',
        steps: [
            { method: 'GET', path: '/plugins' },
            { event: 'disable-dye2' },
            { method: 'GET', path: '/plugins' },
            { method: 'GET', path: `${DYE2}/selection` },
            { method: 'GET', path: `${DYE2}/skin` },
            { event: 'enable-dye2' },
            { method: 'GET', path: '/plugins' },
            { method: 'GET', path: `${DYE2}/selection` },
        ],
    },
    {
        name: 'machine-calibration',
        rule: 'fake-decaid/machine.js',
        about: 'The simulated machine\'s calibration, as Streamline\'s settings page reads it: each target\'s current and factory values; an unknown target or source refused.',
        steps: [
            { method: 'GET', path: '/machine/calibration/temperature?source=current' },
            { method: 'GET', path: '/machine/calibration/pressure?source=current' },
            { method: 'GET', path: '/machine/calibration/flow?source=current' },
            { method: 'GET', path: '/machine/calibration/flow?source=factory' },
            { method: 'GET', path: '/machine/calibration/flow' },
            { method: 'GET', path: '/machine/calibration/weight?source=current' },
            { method: 'GET', path: '/machine/calibration/flow?source=other' },
        ],
    },
    {
        name: 'shots',
        rule: 'fake-decaid/shots.js',
        about: 'Decaid\'s Shots: newest first, without measurements, with total, limit and offset; filtered by grinder; by ids, a bare list of whole Shots; the latest; one by id or 404; an edit merged, a note cleared to "", a rating out of range and measurements refused.',
        steps: [
            { method: 'GET', path: '/shots' },
            { method: 'GET', path: '/shots?limit=1&orderBy=timestamp&order=desc' },
            { method: 'GET', path: '/shots?limit=100&orderBy=timestamp&order=desc' },
            { method: 'GET', path: '/shots?limit=20&offset=1&order=desc' },
            { method: 'GET', path: '/shots?limit=0&order=asc' },
            { method: 'GET', path: ({ sample }) => `/shots?limit=5&grinderId=${grinderNamed(sample, 'Sample Grinder 38').id}&orderBy=timestamp&order=desc` },
            { method: 'GET', path: '/shots?limit=5&grinderId=no-such-grinder&orderBy=timestamp&order=desc' },
            { method: 'GET', path: ({ sample }) => `/shots?ids=${sample.shots[0].id}&limit=1&orderBy=timestamp&order=desc` },
            { method: 'GET', path: ({ sample }) => `/shots?ids=${sample.shots[0].id}&grinderId=x` },
            { method: 'GET', path: '/shots/latest' },
            { method: 'GET', path: ({ sample }) => `/shots/${sample.shots[0].id}` },
            { method: 'GET', path: '/shots/no-such-shot' },
            { method: 'PUT', path: ({ sample }) => `/shots/${sample.shots[0].id}`, body: { annotations: { enjoyment: 8, espressoNotes: 'Sample note' } } },
            { method: 'PUT', path: ({ sample }) => `/shots/${sample.shots[0].id}`, body: { annotations: { espressoNotes: null } } },
            { method: 'PUT', path: ({ sample }) => `/shots/${sample.shots[0].id}`, body: { annotations: { enjoyment: 11 } } },
            { method: 'PUT', path: ({ sample }) => `/shots/${sample.shots[0].id}`, body: { measurements: [] } },
            { method: 'PUT', path: ({ sample }) => `/shots/${sample.shots[0].id}`, body: { annotations: { enjoyment: null, espressoNotes: '' } } },
        ],
    },
];

/**
 * Records every scenario against the real stack. `sample` is the sample data
 * as recorded at the start (recordings/sample-data.json).
 */
export async function recordScenarios({ decaid, raw, ws, write, sleep, opened, sample, only = null }) {
    const state = {
        beans: sample.beans,
        batches: sample.batches,
        workflow: sample.workflow,
        recipes: sample.store['dye2.reaplugin'].recipes,
        grinders: sample.grinders,
        shots: [...sample.shots].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    };
    for (const scenario of SCENARIOS) {
        if (only && !only.includes(scenario.name)) continue;
        const pushes = [];
        let socket = null;
        if (scenario.socket) {
            socket = new WebSocket(`${ws}${scenario.socket.replace('/ws/v1', '')}`);
            socket.onmessage = event => pushes.push(JSON.parse(String(event.data)));
            await opened(socket);
        }
        // The Workflow and DYE2's keys as they stand, which the replay starts
        // from: a write can add to a Workflow but not take away what an earlier
        // scenario added, and DYE2 works its recents out again after each Shot.
        const given = {
            workflow: (await raw('GET', '/workflow')).body,
            ...(scenario.dye2 ? { store: { 'dye2.reaplugin': (await raw('GET', '/store/dye2.reaplugin?full=1')).body } } : {}),
        };
        const steps = [];
        for (const step of scenario.steps) {
            if (step.event) {
                if (!['restart-dye2', 'disable-dye2', 'enable-dye2'].includes(step.event)) throw new Error(`no such event: ${step.event}`);
                const loadedAfter = step.event !== 'disable-dye2';
                if (step.event !== 'enable-dye2') await decaid('POST', '/plugins/dye2.reaplugin/disable', undefined, { manage: true });
                if (loadedAfter) await decaid('POST', '/plugins/dye2.reaplugin/enable', undefined, { manage: true });
                for (let waited = 0; ; waited += 500) {
                    const plugins = await decaid('GET', '/plugins');
                    if (!!plugins.find(p => p.id === 'dye2.reaplugin')?.loaded === loadedAfter) break;
                    if (waited > 60_000) throw new Error(`DYE2 did not ${loadedAfter ? 'load again' : 'unload'} within 60 s`);
                    await sleep(500);
                }
                // DYE2 reads the Workflow as it loads, and may write it.
                if (loadedAfter) await sleep(3000);
                steps.push({ event: step.event });
                continue;
            }
            const path = typeof step.path === 'function' ? step.path({ sample: state }) : step.path;
            const body = typeof step.body === 'function' ? step.body({ sample: state }) : step.body;
            pushes.length = 0;
            const answer = await raw(step.method, path, body);
            // DYE2 hears a Workflow change a moment after Decaid answers it.
            await sleep(step.method === 'GET' ? 100 : 1500);
            steps.push({ request: { method: step.method, path, ...(body === undefined ? {} : { body }) }, answer, ...(socket ? { pushes: [...pushes] } : {}) });
        }
        socket?.close();
        await write(scenario.name, { rule: scenario.rule, about: scenario.about, ...(scenario.socket ? { socket: scenario.socket } : {}), given, steps });
        console.log(`recorded ${scenario.name}: ${steps.length} steps`);
    }
}
