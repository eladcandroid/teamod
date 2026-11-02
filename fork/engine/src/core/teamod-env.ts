/**
 * teamod's environment variables: TEAMOD_<name>, else the TEAMOD_<name> it had before the rename
 * (scripts, tests and shell profiles that still set the old name keep working).
 */
export const teamodEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => env[`TEAMOD_${name}`] ?? env[`TEAMOD_${name}`];

/** A variable teamod sets for a program it starts, under both names, so older readers see it too. */
export const teamodEnvBoth = (name: string, value: string): Record<string, string> => ({ [`TEAMOD_${name}`]: value, [`TEAMOD_${name}`]: value });
