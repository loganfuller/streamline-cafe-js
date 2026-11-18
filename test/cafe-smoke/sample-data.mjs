// Made-up data for the smoke run. Nothing here is a real cafe's: the names say
// what each thing is and nothing else.

export const BEANS = [
    { roaster: 'Sample Roasters', name: 'Sample Blend', roastDate: '2026-11-02T00:00:00Z' },
    { roaster: 'Sample Roasters', name: 'Sample Single Origin', roastDate: '2026-10-28T00:00:00Z' },
    { roaster: 'Example Coffee Co', name: 'Example Decaf', roastDate: '2026-10-20T00:00:00Z' },
];

export const GRINDER = { model: 'Sample Grinder 64' };

// The bean and batch dialog's: Sample Blend has a second batch, roasted before
// its first, and a third that is archived, which the dialog does not list.
export const MORE_BATCHES = [
    { bean: 'Sample Blend', roastDate: '2026-10-15T00:00:00Z' },
    { bean: 'Sample Blend', roastDate: '2026-09-20T00:00:00Z', archived: true },
];

// DYE2's baskets, with ids, as its own basket page makes them, and one archived.
// The recipes name the first two by id as well as by name.
export const BASKETS = [
    { id: 'bskt-sample-18', name: '18 g sample basket', size: 'double', diameterMm: 58, notes: '', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 'bskt-sample-20', name: '20 g sample basket', size: 'double', diameterMm: 58, notes: '', createdAt: '2026-11-01T00:00:01.000Z' },
    { id: 'bskt-sample-retired', name: 'Retired sample basket', size: 'single', diameterMm: 58, notes: '', createdAt: '2026-11-01T00:00:02.000Z', archived: true },
];

// The grinder dialog's: a second grinder, with burrs and a step of its own, and
// one archived, which the dialog does not list. The run pulls a shot on each of
// the two at a setting of its own (`GRINDER_USE`), which the dialog then says
// each was last used at and a choice of it takes.
export const SECOND_GRINDER = { model: 'Sample Grinder 38', burrType: 'conical', settingSmallStep: 0.5, settingBigStep: 2 };
export const ARCHIVED_GRINDER = { model: 'Sample Retired Grinder' };
export const GRINDER_USE = { first: { setting: '2.6', rpm: null }, second: { setting: '11.5', rpm: 800 } };

// The baristas the run's two shots with no recipe loaded record, one each, so
// the legend is seen to follow each Shot.
export const BARISTAS = ['Sample Barista', 'Example Barista'];

// `profile` is the title of a profile Decaid ships. `slot` is where the recipe
// ends up; DYE2 places 1 to 5 itself and the run writes 6 to 9 into its records.
export const RECIPES = [
    { slot: 1, name: 'House espresso', bean: 'Sample Blend', profile: 'Default', dose: 18, yield: 36, grind: '2.4', basket: '18 g sample basket' },
    { slot: 2, name: 'Single origin', bean: 'Sample Single Origin', profile: 'Adaptive v3', dose: 18, yield: 40, grind: '2.1', basket: '18 g sample basket' },
    { slot: 3, name: 'Decaf', bean: 'Example Decaf', profile: 'Default', dose: 17, yield: 34, grind: '1.9', basket: '18 g sample basket' },
    { slot: 5, name: 'Long black', bean: 'Sample Blend', profile: 'Default', dose: 20, yield: 50, grind: '2.8', basket: '20 g sample basket' },
    { slot: 7, name: 'Guest roast with a long name', bean: 'Sample Single Origin', profile: 'Adaptive v3', dose: 18.5, yield: 42, grind: '2.2', basket: '18 g sample basket' },
    { slot: 9, name: 'Filter', bean: 'Sample Single Origin', profile: 'Adaptive v3', dose: 15, yield: 250, grind: '6.5', basket: '' },
];
