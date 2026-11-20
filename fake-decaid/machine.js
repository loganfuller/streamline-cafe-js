// The simulated machine: its state, the frames its sockets carry, and one
// recorded pour replayed when the test says, with the Shot Decaid stores.
//
// Read from decaid v0.9.2: lib/src/services/webserver/de1handler.dart (the
// machine snapshot socket, `PUT /machine/state/<state>`),
// lib/src/models/data/shot_state_event.dart (the shot-state socket),
// lib/src/controllers/de1_state_manager.dart (`_persistShotIfNeeded`: the Shot
// is stored once the shot is finished, with the Workflow as it is then and the
// shot's start as its time) and lib/src/models/data/shot_annotations.dart (the
// dose is the Workflow's target, which the model sets; the yield, the scale's
// last weight there, is the recorded Shot's, as are its measurements and stop
// reason).
// Recorded: recordings/pour.json, one pour of the simulated machine on the
// pinned Decaid with its frames through the store, and the Shot it stored;
// and recordings/real/de1pro-pour.json, one on a real DE1Pro with a real
// scale, captured by hand, whose Shot Decaid stored with the Workflow's dose
// too. A fake plays the one it is made with.
//
// The machine's calibration, which Streamline's settings page reads as it
// opens (`GET /machine/calibration/<target>?source=`): as de1handler.dart
// answers it from the simulated machine (mock_de1.dart, `readCalibration`):
// flow 1.0, pressure 9.0 and temperature 93.0 measured, current and factory
// alike, reported as 1.0 for flow and pressure and 0.0 for temperature; an
// unknown target or source is a 400. Writes have no answer.
// Recorded: recordings/machine-calibration.json.
//
// The model keeps no clock. `now()` is the page's time, which the test sets;
// each replayed frame keeps its distance in time from the pour's start, read
// from the recording's own timestamps.

import { copy } from './workflow.js';

/** Decaid's local time with no offset, as `DateTime.toIso8601String()` writes it, to the microsecond. */
// One formatter for each zone: making one is far slower than using it.
const formatters = new Map();
const formatterFor = timeZone => {
    if (!formatters.has(timeZone)) {
        formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
            timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
    }
    return formatters.get(timeZone);
};

export function localTime(ms, timeZone) {
    const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
    const fraction = String(((ms % 1000) + 1000) % 1000).padStart(3, '0');
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${fraction}000`;
}

/**
 * A recorded time moved by `shift` ms, written as it was: local with no offset
 * in `timeZone`, or UTC with its Z, keeping the microseconds Decaid wrote.
 */
export function shiftTime(text, shift, timeZone) {
    if (typeof text !== 'string') return text;
    // Dart writes microseconds only where there are some: keep what was written.
    const fraction = (/\.(\d+)/.exec(text) || [])[1] || '';
    const ms = recordedMs(text) + shift;
    const utc = /[zZ]$/.test(text);
    const seconds = utc ? new Date(ms).toISOString().slice(0, 19) : localTime(ms, timeZone).slice(0, 19);
    const millis = String(((ms % 1000) + 1000) % 1000).padStart(3, '0');
    const written = fraction ? `.${(millis + fraction.slice(3)).slice(0, Math.max(3, fraction.length))}` : '';
    return `${seconds}${written}${utc ? 'Z' : ''}`;
}

const CALIBRATION = { flow: 1.0, pressure: 9.0, temperature: 93.0 };

/** `GET /machine/calibration/<target>?source=`, as the simulated machine answers it. */
export function calibration(target, source = 'current') {
    if (!Object.hasOwn(CALIBRATION, target)) return { status: 400, body: { error: `Unknown calibration target: ${target}` } };
    if (source !== 'current' && source !== 'factory') return { status: 400, body: { error: `Unknown calibration source: ${source}` } };
    return { status: 200, body: { target, source, de1ReportedValue: target === 'temperature' ? 0 : 1, measuredValue: CALIBRATION[target] } };
}

/** A recorded local time, written in the recording's zone, as epoch milliseconds. */
function recordedMs(text, offsetMinutes = 0) {
    const iso = /[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text.slice(0, 23)}Z`;
    return Date.parse(iso) - offsetMinutes * 60_000;
}

/**
 * @param {{ pour: object, timeZone: string, now: () => number, emit: (path: string, frame: object) => void,
 *           nextId: () => string, workflow: () => object, store: (shot: object) => void }} options
 */
export function createMachine({ pour, timeZone, now, emit, nextId, workflow, store }) {
    // The pour, to the machine back at rest; what follows, to the store, is the
    // shot-state socket saying the shot finished, which the store sends.
    const restAt = pour.idleAtMs + 500;
    // DYE2's pushes in the recording are the model's to make (dye2.js), not the machine's.
    const frames = pour.frames.filter(f => f.ms <= restAt && !f.socket.startsWith('plugins/'));
    const afterStore = pour.frames.filter(f => f.ms > restAt && f.socket === 'machine/shotState');
    const firstMachine = frames.find(f => f.socket === 'machine/snapshot');
    // The recording's clock, at the moment the pour was asked for.
    const recordedZero = recordedMs(firstMachine.frame.timestamp) - firstMachine.ms;
    const rebase = text => shiftTime(text, now0 - recordedZero, timeZone);
    let now0 = 0;

    const state = {
        snapshot: copy(pour.atRest['machine/snapshot']),
        scale: copy(pour.atRest['scale/snapshot']),
        shotState: copy(pour.atRest['machine/shotState']),
        pour: null,
    };

    const stamped = frame => ({ ...copy(frame), timestamp: localTime(now(), timeZone) });

    function rebased(entry, shotId) {
        const frame = copy(entry.frame);
        if (typeof frame.timestamp === 'string') frame.timestamp = rebase(frame.timestamp);
        if ('shotId' in frame && frame.shotId) frame.shotId = shotId;
        return frame;
    }

    function play(toMs) {
        const run = state.pour;
        if (!run) throw new Error('no pour is running');
        while (run.cursor < frames.length && frames[run.cursor].ms <= toMs) {
            const entry = frames[run.cursor++];
            const frame = rebased(entry, run.shotId);
            if (entry.socket === 'machine/snapshot') state.snapshot = frame;
            else if (entry.socket === 'scale/snapshot' && 'weight' in frame) state.scale = frame;
            else if (entry.socket === 'machine/shotState') state.shotState = frame;
            emit(`/ws/v1/${entry.socket}`, frame);
        }
        run.played = Math.max(run.played, toMs);
        if (run.cursor >= frames.length) run.finished = true;
    }

    return {
        state,
        /** The frame `GET /machine/state` answers: the latest snapshot. */
        snapshot: () => copy(state.snapshot),
        /** What each machine socket sends as it opens. */
        opening(path) {
            if (path === '/ws/v1/machine/snapshot') return [stamped(state.snapshot)];
            if (path === '/ws/v1/machine/shotState') return [copy(state.shotState)];
            if (path === '/ws/v1/scale/snapshot') return [{ status: 'connected' }, stamped(state.scale)];
            return null;
        },
        /** Decaid's stream at rest: one frame of each, as it sends a few times a second. */
        tick() {
            if (state.pour && !state.pour.finished) return;
            emit('/ws/v1/machine/snapshot', stamped(state.snapshot));
            emit('/ws/v1/scale/snapshot', stamped(state.scale));
        },
        /** The machine's state set through Decaid's API: espresso starts the pour, the rest is a state of its own. */
        setState(name) {
            if (name === 'espresso') return this.startPour();
            state.snapshot = { ...stamped(state.snapshot), state: { state: name, substate: 'idle' } };
            emit('/ws/v1/machine/snapshot', copy(state.snapshot));
            return null;
        },
        /** The pour starts: nothing is sent until `playPour` reaches its first frame. */
        startPour() {
            if (state.pour && !state.pour.stored) throw new Error('a pour is already running');
            now0 = now();
            state.pour = { shotId: nextId(), cursor: 0, played: 0, finished: false, stored: false, startedAt: now0 };
            return state.pour.shotId;
        },
        /** Sends every frame of the pour up to `ms` from its start. */
        playPour: ms => play(ms),
        /** Sends what is left of the pour, to the machine back at rest. */
        finishPour: () => play(Infinity),
        /** How long the recorded pour runs, to its last frame. */
        pourLength: () => frames[frames.length - 1].ms,
        /**
         * When the recorded machine was back at rest, and when the recorder
         * had the stored Shot from Decaid's list, in ms from the pour's start.
         * The real pour's capture polled the list from the frame at rest on,
         * though Decaid had stored its Shot about 1.8 s before that frame.
         */
        pourTimes: () => ({ idleAtMs: pour.idleAtMs, storedAtMs: pour.storedAtMs }),
        /** The ms from the pour's start of the first frame matching `test`. */
        pourMoment: test => frames.find(entry => test(entry.frame, entry.socket))?.ms ?? null,
        /** Decaid stores the Shot: the pour's own record, with the Workflow as it is now. */
        storeShot() {
            const run = state.pour;
            if (!run || !run.finished) throw new Error('the pour has not finished');
            if (run.stored) throw new Error('the pour is stored already');
            const recorded = pour.shot;
            const current = workflow();
            const shot = {
                ...copy(recorded),
                id: run.shotId,
                timestamp: rebase(recorded.timestamp),
                createdAt: new Date(now()).toISOString(),
                updatedAt: new Date(now()).toISOString(),
                measurements: recorded.measurements.map(m => ({
                    ...copy(m),
                    machine: m.machine ? { ...copy(m.machine), timestamp: rebase(m.machine.timestamp) } : m.machine,
                    scale: m.scale ? { ...copy(m.scale), timestamp: rebase(m.scale.timestamp) } : m.scale,
                })),
                workflow: { ...copy(current), machine: copy(recorded.workflow.machine) },
                annotations: copy(recorded.annotations) || {},
            };
            delete shot.annotations.actualDoseWeight;
            if (current.context?.targetDoseWeight != null) shot.annotations.actualDoseWeight = current.context.targetDoseWeight;
            run.stored = true;
            // The shot-state socket says the shot finished, then DYE2, told of
            // the Shot stored, pushes: the order the recording has them in.
            for (const entry of afterStore) {
                const frame = rebased(entry, run.shotId);
                state.shotState = frame;
                emit(`/ws/v1/${entry.socket}`, frame);
            }
            store(shot);
            return shot.id;
        },
    };
}
