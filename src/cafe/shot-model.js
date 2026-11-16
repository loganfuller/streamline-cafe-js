// What the graph knows about the Shots it draws: which Shot is a recipe's
// latest, when a Shot is Unfinished, a Shot's lines, and what the legend says
// (docs/cafe/DESIGN.md, "Shots and the reference"). No browser global is touched.
import { createPourPhaseTracker, createScaleFlowResolver, hasMachineGFlow, isPourPhase } from '../modules/historical-gflow.js';

/** How many of the tablet's newest Shots a recipe's latest is looked for among. */
export const LATEST_WINDOW = 100;

/** The least the scale reads, in grams, once coffee has reached the cup. */
const FIRST_DRIP_GRAMS = 1;

const text = value => (typeof value === 'string' ? value.trim() : '');

/**
 * The recipe a Workflow names, by its DYE2 record id, or null. Streamline's
 * recipe apply writes it there, and a Shot's Workflow keeps it.
 */
export function shotRecipeId(workflow) {
    const id = workflow?.context?.extras?.dye?.recipeId;
    return id == null || id === '' ? null : String(id);
}

/**
 * The ids of the Shots pulled with a recipe, in the order of `rows`, which is
 * Decaid's list, newest first. A row carries its Workflow and no measurements.
 */
export function shotsWithRecipe(rows, recipeId) {
    if (recipeId == null || !Array.isArray(rows)) return [];
    return rows.filter(row => row && row.id != null && shotRecipeId(row.workflow) === String(recipeId)).map(row => row.id);
}

/**
 * Is this an Unfinished Shot? The machine never reached pouring and the scale
 * never read 1 g. It is Decent Sync's rule, worked out here from the Shot's own
 * record: no sample is in the `pouring` substate, and no sample after the
 * Preheat, the leading samples in `preparingForShot`, has a weight of 1 g or
 * more. Both are needed: a shot stopped on weight inside a long preinfusion
 * never reports pouring, though it ran whole.
 *
 * The details are Decent Sync's too (`timedSamples` in its protocol package),
 * so a tablet and its server call the same Shots Unfinished: the Preheat ends
 * at the first sample whose machine reading is in another substate, or has
 * none, and only a sample the machine timed counts, for pouring or for weight.
 */
export function isUnfinished(shot) {
    const samples = Array.isArray(shot?.measurements) ? shot.measurements : [];
    let preheat = true;
    for (const sample of samples) {
        const substate = sample?.machine?.state?.substate;
        if (preheat && substate !== 'preparingForShot') preheat = false;
        // A sample the machine did not time is no sample, past ending the Preheat.
        if (Number.isNaN(new Date(sample?.machine?.timestamp).getTime())) continue;
        if (substate === 'pouring') return false;
        const weight = sample?.scale?.weight;
        if (!preheat && typeof weight === 'number' && weight >= FIRST_DRIP_GRAMS) return false;
    }
    return true;
}

// The chart's own smoothing for a weight flow worked out from raw weights
// (SMOOTHING_FACTOR in chart.js, which does not export it).
const WEIGHT_FLOW_SMOOTHING = 0.1;

const line = () => ({ x: [], y: [] });

/**
 * A Shot's pressure, flow and weight flow against seconds, as Streamline's
 * chart draws a finished Shot: from the first sample in preinfusion or pouring,
 * through those two phases only, the weight flow from the machine where it
 * reports one and from the scale otherwise. `seconds` is where the last line
 * ends. These are the reference's lines, so they must lie where the same Shot's
 * solid lines would.
 */
export function shotCurves(measurements) {
    const samples = (Array.isArray(measurements) ? measurements : []).filter(Boolean);
    const curves = { pressure: line(), flow: line(), weight: line(), seconds: 0 };
    const inShot = sample => isPourPhase(sample.machine?.state?.substate);
    const first = samples.find(inShot);
    if (!first) return curves;
    const start = new Date(first.machine.timestamp);
    let end = start;
    for (let i = samples.length - 1; i >= 0; i -= 1) {
        if (inShot(samples[i])) { end = new Date(samples[i].machine.timestamp); break; }
    }
    const machineFlow = hasMachineGFlow(samples);
    const scaleFlow = createScaleFlowResolver(WEIGHT_FLOW_SMOOTHING);
    const phase = createPourPhaseTracker();
    for (const { machine, scale } of samples) {
        const substate = machine?.state?.substate;
        if (substate && phase.observe(substate)) {
            const seconds = (new Date(machine.timestamp) - start) / 1000;
            if (seconds >= 0) {
                curves.pressure.x.push(seconds);
                curves.pressure.y.push(machine.pressure);
                curves.flow.x.push(seconds);
                curves.flow.y.push(machine.flow);
                if (machineFlow && Number.isFinite(machine.weightFlow)) {
                    curves.weight.x.push(seconds);
                    curves.weight.y.push(machine.weightFlow);
                }
            }
        }
        if (phase.inPour && !machineFlow && scale && scale.weight) {
            const at = new Date(scale.timestamp);
            if (at > end) continue;
            const seconds = (at - start) / 1000;
            if (seconds >= 0) {
                curves.weight.x.push(seconds);
                curves.weight.y.push(scaleFlow(scale, seconds));
            }
        }
    }
    curves.seconds = Math.max(0, ...[curves.pressure, curves.flow, curves.weight].map(({ x }) => (x.length ? x[x.length - 1] : 0)));
    return curves;
}

/**
 * When a Shot was pulled, and by whom, as its record says: a Date or null, and
 * the barista's name or ''. Decaid writes a Shot's time as the tablet's local
 * time, which is how a Date reads a time with no offset.
 */
export function shotCredit(shot) {
    const when = shot?.timestamp ? new Date(shot.timestamp) : null;
    return {
        when: when && !Number.isNaN(when.getTime()) ? when : null,
        who: text(shot?.workflow?.context?.baristaName),
    };
}

/**
 * Was the Shot pulled on another profile than the recipe's? Profiles are
 * compared by title: Decaid's profile id is a hash of the profile's contents,
 * so a brew temperature stepped on the page gives the same profile another id.
 * False when the recipe or the Shot names no profile.
 */
export function differentProfile(recipe, shot) {
    const recipes = text(recipe?.profileTitle);
    const shots = text(shot?.workflow?.profile?.title);
    return !!recipes && !!shots && recipes !== shots;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * "Today 14:32" or "12 Nov 14:32", in `locale`. `today` is the word for today
 * in the page's language.
 */
export function whenText(when, now, locale, today) {
    if (!when) return '';
    let day;
    let time;
    try {
        time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        day = sameDay(when, now) ? today : when.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    } catch (error) {
        // A locale the tablet does not know: the tablet's own.
        time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        day = sameDay(when, now) ? today : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    return `${day} ${time}`;
}

export const VIEWS = ['reference', 'targets'];

/** The view a stored value names: Reference unless it says Targets. */
export function viewFrom(stored) {
    return stored === 'targets' ? 'targets' : 'reference';
}

/**
 * What the graph and its legend show.
 *
 * - `recipe`: the loaded recipe, null for none, undefined before DYE2 was read.
 * - `view`: `reference` or `targets`.
 * - `live`: a shot is running. `settling`: one has ended and Decaid does not
 *   have it yet, so the graph still holds its live lines.
 * - `shot`: the Shot in the graph: the recipe's latest, or with no recipe the
 *   tablet's newest. Undefined before it was read, null for none.
 * - `reference`: the seam's answer for the recipe, `{ shot, canChange }`, whose
 *   `shot` is null with no reference; or null before it was read.
 *
 * The answer: `row`, the Shot's row (`label`, a phrase, and `shot`, whose time
 * and barista follow it, or null); `line`, a phrase under no row, or null;
 * `reference`, the Shot the reference row names, or null; `flag`, whether that
 * row says "Different profile"; `badge`, "This shot is the reference";
 * `targets`, the "Profile target" legend; `makeReference`; and `lines`, whether
 * the reference's lines are drawn.
 */
export function graphModel({ recipe, view, live = false, settling = false, shot, reference = null }) {
    const inReference = view !== 'targets';
    const atRest = !live && !settling;
    const referenceShot = recipe && reference ? reference.shot : null;
    const isReference = atRest && !!shot && !!referenceShot && shot.id === referenceShot.id;
    const unknown = recipe === undefined;

    let row = null;
    if (live) row = { label: 'Live shot', shot: null };
    else if (!unknown && (settling || shot)) row = { label: recipe ? 'Latest' : 'Last shot', shot: settling ? null : shot };

    let line = null;
    if (inReference && recipe === null) line = 'Pick a recipe to compare';
    else if (inReference && recipe && atRest && shot === null) line = 'No shot with this recipe on this machine yet';

    const showsReference = inReference && !!referenceShot && !isReference;
    return {
        row,
        line,
        reference: showsReference ? referenceShot : null,
        flag: showsReference && differentProfile(recipe, referenceShot),
        badge: inReference && isReference,
        targets: !inReference,
        makeReference: !!recipe && atRest && !!shot && !isReference && (!reference || reference.canChange !== false),
        lines: showsReference,
    };
}

/** The Shot a stored choice names for a recipe, or null. `stored` is recipe to Shot. */
export function chosenShotId(stored, recipeId) {
    const id = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored[String(recipeId)] : null;
    return typeof id === 'string' && id ? id : null;
}

/** The stored choices with one recipe's Shot set, every other recipe's kept. */
export function withChosenShot(stored, recipeId, shotId) {
    const kept = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    return { ...kept, [String(recipeId)]: String(shotId) };
}
