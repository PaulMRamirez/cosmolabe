// Public surface of the engine controller.
export { BesselEngine, type CatalogSource } from './engine.ts';
export { useBesselEngine } from './use-bessel-engine.ts';
export { bootScene, type EngineCore } from './bootstrap.ts';
export { STEPS, FOCUS_DISTANCE, DEFAULT_FOCUS_DISTANCE, RATE_STEPS } from './constants.ts';
export { HPOP_FORCE_MODEL_LABELS, type HpopForceModel } from './hpop-model.ts';
export { DEFAULT_MCS_DESIGN, type McsDesign } from './mcs.ts';
