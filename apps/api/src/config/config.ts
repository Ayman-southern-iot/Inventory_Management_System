import './load-dotenv';
import { buildConfig, type AppConfig } from './config.schema';

/**
 * The one `process.env` read in the backend. Everything else imports `config` from here.
 *
 * This is module-level on purpose: an invalid environment must crash at import time, before
 * Nest wires a single provider or the HTTP server binds a port. Failing at boot beats failing
 * at 3pm on a Tuesday (rules/00-engineering-standards.md).
 */
export const config: AppConfig = buildConfig(process.env);

export type { AppConfig };
export { ConfigValidationError } from './config.schema';

/** DI token, so services can inject config instead of importing it and becoming untestable. */
export const CONFIG = Symbol('APP_CONFIG');
