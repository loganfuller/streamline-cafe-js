// Made-up data for the smoke run. Nothing here is a real cafe's: the names say
// what each thing is and nothing else.

export const BEANS = [
    { roaster: 'Sample Roasters', name: 'Sample Blend', roastDate: '2026-11-02T00:00:00Z' },
    { roaster: 'Sample Roasters', name: 'Sample Single Origin', roastDate: '2026-10-28T00:00:00Z' },
    { roaster: 'Example Coffee Co', name: 'Example Decaf', roastDate: '2026-10-20T00:00:00Z' },
];

export const GRINDER = { model: 'Sample Grinder 64' };

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
