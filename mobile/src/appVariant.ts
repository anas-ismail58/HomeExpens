// Which app is running: home expenses (default) or the kids' points app (built from src/kids-app,
// see app.config.js). The kids app's root layout marks itself when it loads, before anything renders,
// so read this at render or call time, never at module load.
let variant: 'expenses' | 'kids' = 'expenses';

export function markKidsApp() {
  variant = 'kids';
}

export function appVariant() {
  return variant;
}
