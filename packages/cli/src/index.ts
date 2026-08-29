export { parseArgs, flagBool, flagNumber, flagString, type Parsed } from './args.js';
export { DaemonClient, DaemonError, DEFAULT_PORT } from './client.js';
export { attachHere, clientFor, openHere, NeedsDaemon } from './context.js';
export { onPath } from './commands/doctor.js';
export { printHelp } from './help.js';
