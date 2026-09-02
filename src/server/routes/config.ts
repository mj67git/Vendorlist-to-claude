import express from "express";
import { CALCULATION_WEIGHTS, GRADE_TIERS } from "../domain/vendorEvaluation.js";

/**
 * The scoring configuration the client reads on boot.
 *
 * The weights and the grade bands live on the server so the two sides cannot
 * disagree about what a score means. Unauthenticated on purpose: it is a
 * rubric, not data.
 */
export function configRoutes(): express.Router {
  const router = express.Router();

  router.get("/api/config/evaluation", (req, res) => {
    res.json({
      weights: CALCULATION_WEIGHTS,
      tiers: GRADE_TIERS
    });
  });

  return router;
}
