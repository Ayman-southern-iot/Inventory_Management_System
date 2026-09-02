/// <reference types="vite/client" />

/**
 * Build time, injected by `define` in `vite.config.ts`. Never assigned at runtime — the
 * bundler replaces the identifier with a literal, so it exists in the built file and nowhere
 * else.
 */
declare const __BUILD_TIME__: string;
