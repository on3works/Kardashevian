// Thrown when someone presses Stop on a queued or running test. Run loops
// rethrow it instead of recording it as a model failure, so the run pauses
// with everything saved and Resume carries on from the same point.
export class RunStopped extends Error {
  constructor() { super('Stopped by hand'); this.name = 'RunStopped'; }
}
export const STOPPED_MESSAGE = 'Stopped by hand';
