// Lazy ajv barrel. ajv + ajv-formats are ~45 KB gzip and are only needed when a
// catalog is actually parsed/validated, so validator.ts imports this module
// dynamically. Keeping the two re-exports in their own module gives the bundler a
// single, stable-named lazy chunk (ajv-lazy-*.js) that holds ajv and its whole
// dependency subtree, out of the first-paint shell (and budgeted on its own line).
export { default as Ajv2020 } from 'ajv/dist/2020.js';
export { default as addFormats } from 'ajv-formats';
