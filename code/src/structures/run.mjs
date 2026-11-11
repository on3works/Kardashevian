// Lightest Structure: new sites run structures-v2; sites made before it keep
// their own generator, solver and view so their stored results stay true.
import * as v1 from './v1/run.mjs';
import * as v2 from './run2.mjs';

export const STRUCTURES_ATTEMPTS = v2.STRUCTURES_ATTEMPTS;
export const newStructuresInput = v2.newStructuresInput;
const impl = run => (run.input?.protocol === 'structures-v1' ? v1 : v2);
export function structuresRun(run, deps) { return impl(run).structuresRun(run, deps); }
export function publicStructuresView(run) { return impl(run).publicStructuresView(run); }
