// The weekly run's report (docs/cafe/TESTING.md, "The weekly run"): when the
// newest stable Decaid, DYE2 and Decent Sync record differently from the
// committed recordings, or a journey fails on them, it opens an issue here, or
// adds a comment to the one already open. It names the versions run, the
// recordings that differ and the journeys that failed, and nothing of any
// machine's or cafe's: the stack is a simulated machine with made-up data.
//
//   node scripts/fake-decaid-recorder/weekly-issue.mjs --pins=<file> --record=<outcome> \
//       --replay=<tap file> --compare=<markdown file> --journeys=<outcome> --results=<playwright json> \
//       [--run=<url>] [--dry-run]
//
// Outcomes are the jobs' (success, failure, cancelled, skipped). It needs `gh`,
// signed in with the right to write issues (GH_TOKEN in Actions).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './stack.mjs';

const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const read = path => (path && existsSync(path) ? readFileSync(path, 'utf8') : '');
export const LABEL = 'real-stack-weekly';
const TITLE = 'The weekly real-stack run differs from the pins';

const pinned = JSON.parse(readFileSync(join(ROOT, 'fake-decaid', 'pins.json'), 'utf8'));
const ran = JSON.parse(read(flag('pins')) || 'null') || pinned;

/** The replay's failed tests: each recording the fake no longer answers as the fresh one did. */
export function failedReplays(tap) {
    return [...tap.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match => match[1].trim()).filter(name => !/^test\/|\.test\.mjs$/.test(name));
}

/** The journeys that failed, by file and title, from Playwright's JSON report. */
export function failedJourneys(results) {
    if (!results) return [];
    const failed = [];
    const walk = (suite, titles) => {
        for (const spec of suite.specs || []) {
            for (const t of spec.tests || []) {
                const last = t.results?.at(-1);
                if (t.status === 'unexpected' || t.status === 'flaky') failed.push({ title: [...titles, spec.title].filter(Boolean).join(' › '), file: spec.file, error: (last?.error?.message || '').split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200) });
            }
        }
        for (const inner of suite.suites || []) walk(inner, [...titles, inner.title && !inner.title.endsWith('.spec.mjs') ? inner.title : '']);
    };
    for (const suite of results.suites || []) walk(suite, []);
    return failed;
}

/** The report's text, or null when nothing differs and nothing failed. */
export function report({ ran, pinned, record, replays, compare, journeys, journeyOutcome, run }) {
    const problems = record !== 'success' || replays.length || compare.trim() || journeys.length || journeyOutcome !== 'success';
    if (!problems) return null;
    const version = key => `${ran[key].version}${ran[key].version === pinned[key].version ? ' (the pin)' : ` (pinned ${pinned[key].version})`}`;
    const lines = [
        `The weekly run against the newest stable releases${run ? ` ([run](${run}))` : ''}:`,
        '',
        `- Decaid ${version('decaid')}`,
        `- DYE2 ${version('dye2')}`,
        `- Decent Sync ${version('decentSync')}`,
        `- Streamline ${ran.streamline.version} (the pin; the skin is built on it)`,
        '',
    ];
    if (record !== 'success') lines.push(`**The recorder did not finish** (${record}); see the run's log.`, '');
    if (replays.length) lines.push('**Recordings the fake no longer answers as the fresh one did** (`test/fake-decaid-recordings.test.mjs` on the fresh recordings):', '', ...replays.map(name => `- ${name}`), '');
    if (compare.trim()) lines.push('**Recordings whose shape differs from the committed one** (`compare.mjs`: + only in the fresh one, - only in the committed one, ~ another kind of value):', '', compare.trim(), '');
    if (journeys.length) lines.push('**Journeys that failed:**', '', ...journeys.map(j => `- \`${j.file}\`: ${j.title}${j.error ? `: ${j.error}` : ''}`), '');
    else if (journeyOutcome !== 'success') lines.push(`**The journeys did not finish** (${journeyOutcome}); see the run's log.`, '');
    lines.push('A bump to these versions is its own pull request, which records again (docs/cafe/TESTING.md, "Bumping a pin").');
    return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const text = report({
        ran,
        pinned,
        record: flag('record'),
        replays: failedReplays(read(flag('replay'))),
        compare: read(flag('compare')),
        journeys: failedJourneys(JSON.parse(read(flag('results')) || 'null')),
        journeyOutcome: flag('journeys'),
        run: flag('run'),
    });
    if (!text) {
        console.log('nothing differs and nothing failed: no issue');
    } else if (process.argv.includes('--dry-run')) {
        console.log(text);
    } else {
        const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
        gh('label', 'create', LABEL, '--color', 'C5DEF5', '--description', 'The weekly run against the newest stable Decaid, DYE2 and Decent Sync', '--force');
        const open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '1'));
        if (open.length) {
            gh('issue', 'comment', String(open[0].number), '--body', text);
            console.log(`added to issue #${open[0].number}`);
        } else {
            console.log(gh('issue', 'create', '--title', TITLE, '--label', LABEL, '--body', text));
        }
    }
}
