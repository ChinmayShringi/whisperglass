// Thin import boundary so renderer code depends on the pure insight detector
// without reaching deep into src/main in every component. The detector logic
// itself is the shared pure module; this file only re-exports it.
export { detectInsights } from '../../../main/insights/insight-detector'
export type { Insight, DetectInsightsOptions } from '../../../main/insights/insight-detector'
