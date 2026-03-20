/**
 * Reviews API routes
 * GET /api/reviews?telegram_id=xxx - returns fake reviews + user's own reviews
 * POST /api/reviews - create review (verified users only)
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET /api/reviews?telegram_id=xxx
router.get('/', async (req, res) => {
  try {
    const telegramId = req.query.telegram_id;
    let userReviews = [];

    if (telegramId) {
      const result = await pool.query(
        `SELECT r.id, r.author_name, r.rating, r.text, r.created_at
         FROM reviews r WHERE r.telegram_id = $1 ORDER BY r.created_at DESC`,
        [telegramId]
      );
      userReviews = result.rows.map(r => ({
        id: r.id,
        name: r.author_name || 'User',
        initials: (r.author_name || 'U').split(' ').map(n => n[0]).join(''),
        badge: null,
        text: r.text,
        rating: r.rating,
        date: new Date(r.created_at).toLocaleDateString('ru-RU'),
        helpful: 0,
        isOwn: true
      }));
    }

    res.json({ data: userReviews });
  } catch (err) {
    console.error('Reviews GET error:', err.message);
    res.json({ data: [] });
  }
});

// POST /api/reviews - create review (verified users only)
router.post('/', async (req, res) => {
  try {
    const { telegram_id, text, rating } = req.body;

    if (!telegram_id || !text || !rating) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const trimmedText = String(text).trim();
    if (trimmedText.length < 3 || trimmedText.length > 1000) {
      return res.status(400).json({ error: 'Review text must be 3-1000 characters' });
    }

    // Check user exists and is verified
    const userResult = await pool.query(
      'SELECT id, first_name, last_name, username, verified FROM users WHERE telegram_id = $1',
      [telegram_id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    if (!user.verified) {
      return res.status(403).json({ error: 'Only verified users can write reviews' });
    }

    // Build author name
    const authorName = user.first_name
      ? `${user.first_name} ${(user.last_name || '').charAt(0) || ''}`.trim() + '.'
      : user.username || 'User';

    const insertResult = await pool.query(
      `INSERT INTO reviews (user_id, telegram_id, author_name, rating, text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, author_name, rating, text, created_at`,
      [user.id, telegram_id, authorName, ratingNum, trimmedText]
    );

    const review = insertResult.rows[0];
    res.json({
      success: true,
      review: {
        id: review.id,
        name: review.author_name || 'User',
        initials: (review.author_name || 'U').split(' ').map(n => n[0]).join(''),
        text: review.text,
        rating: review.rating,
        date: new Date(review.created_at).toLocaleDateString('ru-RU'),
        helpful: 0,
        isOwn: true
      }
    });
  } catch (err) {
    console.error('Reviews POST error:', err.message);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

module.exports = router;
