/**
 * Kit scan schemas — request definitions for /api/kit-scan.
 *
 * The single endpoint (POST /) validates its body mid-flow in the legacy
 * route: the code check ("Kit code is required", 400) must keep its exact
 * wire message, and the location coercion happens at update time after the
 * unit lookup and status gates. Encoding these in Zod would reword the error
 * (the validate middleware prefixes field paths) and reorder checks, so the
 * service performs the identical checks. Nothing to validate here.
 */
export {};
