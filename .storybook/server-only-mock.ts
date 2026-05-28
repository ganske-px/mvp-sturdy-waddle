// Storybook builds for the browser; the `server-only` package exists solely
// to crash if imported into a client bundle. Components that consume types
// from server-only modules via `import type` are safe at runtime (the TS
// erasure removes the reference), but webpack still resolves the module
// path during bundling — this empty mock satisfies that resolution.
export {};
