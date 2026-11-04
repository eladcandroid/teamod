/** teamod's environment variables: TEAMOD_<name>. */
export const teamodEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => env[`TEAMOD_${name}`];

/** A variable teamod sets for a program it starts. */
export const teamodEnvBoth = (name: string, value: string): Record<string, string> => ({ [`TEAMOD_${name}`]: value });
