/** Reads a reactive value only to register it as a dependency, then returns `x`. */
export const dep = <T>(_tracked: unknown, x: T): T => x;
