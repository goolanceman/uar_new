/**
 * Animal welfare status vocabulary — shared between the animals API and the
 * admin animals view.
 *
 * Intentionally NOT transition-enforced: the shelter UI toggles animals
 * freely between AVAILABLE / FOSTERED / ADOPTED / CRITICAL (self-disabled
 * buttons only), and adoptions are recorded through AnimalPledge flows.
 * Both sides import these lists so they can never drift.
 */

export const ANIMAL_STATUSES = ["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"];

/** AnimalPledge support lifecycle: ACTIVE → COMPLETED | CANCELLED (terminal). */
export const ANIMAL_PLEDGE_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];
