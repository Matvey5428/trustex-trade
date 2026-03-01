/**
 * Reviews API routes
 * Returns empty array - frontend generates fake reviews as fallback
 */

const express = require('express');
const router = express.Router();

// GET /api/reviews - Returns reviews (empty, frontend generates fake ones)
router.get('/', (req, res) => {
  // Return empty array - frontend will generate fake reviews
  res.json({ data: [] });
});

module.exports = router;
