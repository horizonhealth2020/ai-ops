'use strict';

const router = require('express').Router();
const { vapiAuth } = require('../middleware/auth');
const { createPayment } = require('../services/paymentService');

/**
 * POST /api/v1/payment/create-intent
 * Create a payment intent and send SMS link.
 */
router.post('/create-intent', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, amount_cents, description, caller_phone, booking_id } = req.body;

    if (!client_id || !amount_cents || !description) {
      return res.status(400).json({ error: 'client_id, amount_cents, and description are required' });
    }

    const result = await createPayment(client_id, {
      amount_cents,
      description,
      caller_phone,
      booking_id,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
