// What the graph knows about the Shots it draws: which Shot is a recipe's
// latest, when a Shot is Unfinished, a Shot's lines, and what the legend says
// (docs/cafe/DESIGN.md, "Shots and the reference"). No browser global is touched.
import { createPourPhaseTracker, createScaleFlowResolver, hasMachineGFlow, isPourPhase } from '../modules/historical-gflow.js';
import { recipeName } from './strip-model.js';

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
 * The Shot Streamline's history module asks the chart to draw, from the two
 * things the chart's chooser is handed, or null when there is nothing to draw.
 * It carries no id: the module does not hand one over. Its time is its first
 * sample's, which Decaid takes within a second of the record's own time, so it
 * reads the same to the minute but at a minute's edge.
 */
export function drawnShot(measurements, workflow) {
    const samples = (Array.isArray(measurements) ? measurements : []).filter(Boolean);
    if (samples.length === 0) return null;
    const first = samples[0];
    return { id: null, timestamp: first.machine?.timestamp ?? first.scale?.timestamp ?? null, workflow: workflow ?? null, measurements };
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

/** The line under the legend while Decent Sync can't be reached: the tablet's copy is drawn, or says the recipe has none. */
export const UNCHANGEABLE_NOTICE = "Decent Sync can't be reached, so the reference can't be changed";
/** The same where nothing could be read: the tablet has no copy, as for a recipe in no slot, or it is not known yet whether Decent Sync serves the Machine. */
export const UNREAD_NOTICE = "Decent Sync can't be reached, so the reference can't be shown";

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
 *   `shot` is null with no reference; or null before it was read. On a Machine
 *   Decent Sync serves it may carry `unreachable`, the server can't be reached;
 *   `unread`, so nothing could be read; and `profileDiffers`, Decent Sync's
 *   word on the reference's profile. With a Shot it carries the Shot's
 *   `rating` and `note`.
 * - `remarks`: the rating and note of the Shot in the graph, `{ rating, note }`,
 *   or null where its record is not known: with no recipe the Shot comes from
 *   Streamline's history module with no record, until the page has read one.
 * - `opened`: for a Shot opened from the Shots list, `{ loaded, unfinished }`,
 *   the loaded recipe, null for none, and whether the Shot is Unfinished; null
 *   otherwise. `recipe` is then the Shot's own recipe, null for none, and
 *   `reference` that recipe's.
 *
 * The answer: `row`, the Shot's row (`label`, a phrase, or `name`, a recipe's
 * name, and `shot`, whose time and barista follow it, or null); `line`, a phrase under no row, or null;
 * `reference`, the Shot the reference row names, or null; `flag`, whether that
 * row says "Different profile"; `badge`, "This shot is the reference";
 * `targets`, the "Profile target" legend; `makeReference`, with `muted` where
 * it is shown and can't act; `notice`, a phrase saying why, or null;
 * `lines`, whether the reference's lines are drawn; `rate`, the rating and
 * note the Shot's row shows with its stars and note icon, or null where it has
 * neither: only a saved Shot is rated, so not while a shot runs or waits to be
 * saved; and `referenceRating` and `referenceNote`, what the reference's row
 * shows, each null where the reference has none; and `back`, whether "Back to
 * latest" shows.
 */
export function graphModel({ recipe, view, live = false, settling = false, shot, reference = null, remarks = null, opened = null }) {
    const inReference = view !== 'targets';
    const atRest = !live && !settling;
    const referenceShot = recipe && reference ? reference.shot : null;
    const isReference = atRest && !!shot && !!referenceShot && shot.id === referenceShot.id;
    const unknown = recipe === undefined;

    let row = null;
    if (live) row = { label: 'Live shot', shot: null };
    else if (opened) row = openedRow(recipe, opened.loaded, shot);
    else if (!unknown && (settling || shot)) row = { label: recipe ? 'Latest' : 'Last shot', shot: settling ? null : shot };

    let line = null;
    if (opened) line = null;
    else if (inReference && recipe === null) line = 'Pick a recipe to compare';
    else if (recipe && atRest && shot === null) line = 'No shot with this recipe on this machine yet';

    const showsReference = inReference && !!referenceShot && !isReference;
    // Decent Sync can't be reached, and a line says so. Where the tablet's copy
    // answered, Make reference stays, muted: the reference is known, and can't
    // be changed now. Where nothing could be read there is no Make reference.
    const unreachable = !!recipe && !!reference && reference.unreachable === true;
    const canChange = !reference || reference.canChange !== false;
    // An opened Unfinished Shot is drawn as it is, and is never made a reference.
    const offered = !!recipe && atRest && !!shot && !isReference && !(opened && opened.unfinished);
    const muted = offered && !canChange && unreachable && !reference.unread;
    // The line stays through a shot: it has a line of its own, and the graph
    // keeps its height.
    let notice = null;
    if (unreachable) notice = reference.unread ? UNREAD_NOTICE : UNCHANGEABLE_NOTICE;
    return {
        row,
        line,
        reference: showsReference ? referenceShot : null,
        // Decent Sync says whether the profile differs, by the Library's
        // Profiles. Without it the skin works it out, by title.
        flag: showsReference && (typeof reference.profileDiffers === 'boolean' ? reference.profileDiffers : differentProfile(recipe, referenceShot)),
        badge: inReference && isReference,
        targets: !inReference,
        makeReference: offered && (canChange || muted),
        muted,
        notice,
        lines: showsReference,
        rate: atRest && !unknown && !!shot && remarks ? { rating: remarks.rating ?? null, note: remarks.note ?? null } : null,
        referenceRating: showsReference ? reference.rating ?? null : null,
        referenceNote: showsReference ? reference.note ?? null : null,
        back: !!opened && !live,
    };
}

// An opened Shot's row: "Viewing" for a Shot of the loaded recipe, the
// recipe's own name for one of another, and "No recipe" for one pulled with
// none.
function openedRow(recipe, loaded, shot) {
    if (!recipe) return { label: 'No recipe', shot };
    if (loaded && String(loaded.id) === String(recipe.id)) return { label: 'Viewing', shot };
    return { label: null, name: recipeName(recipe), shot };
}

/**
 * Are two of the seam's answers for a reference the same to the graph? The same
 * Shot, or none, with the same things said about it. A push may repeat, and
 * the graph is drawn again only for an answer that differs. The Shot's rating
 * and note are not the graph's: a change of those writes the legend's row
 * again and draws nothing (`sameRemarks` in remarks.js).
 */
export function sameReference(a, b) {
    if (!a || !b) return false;
    const id = answer => (answer.shot && answer.shot.id != null ? String(answer.shot.id) : null);
    return id(a) === id(b)
        && (a.canChange !== false) === (b.canChange !== false)
        && !!a.unreachable === !!b.unreachable
        && !!a.unread === !!b.unread
        && a.profileDiffers === b.profileDiffers;
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

/**
 * Is a Shot's record that of the Shot Streamline's history module handed the
 * chart? The module hands over no id, so the two are matched by their first
 * sample's time, which is the handed Shot's `timestamp` (`drawnShot`). Two
 * Shots never share one, so the stars never act on a Shot other than the one
 * drawn.
 */
export function isDrawnShot(record, drawn) {
    if (!record || record.id == null || !drawn || !drawn.timestamp) return false;
    const first = drawnShot(record.measurements, record.workflow);
    return !!first && first.timestamp === drawn.timestamp;
}
