'use strict';

const router = require('express').Router();
const { vapiAuth } = require('../middleware/auth');
const availabilityService = require('../services/availabilityService');
const logger = require('../utils/logger');

/**
 * POST /api/v1/availability/check
 * Check available appointment slots.
 */
router.post('/check', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, date } = req.body;

    if (!client_id || !date) {
      return res.status(400).json({ error: 'client_id and date are required' });
    }

    const result = await availabilityService.checkAvailability(client_id, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/availability/hold
 * Soft-lock an appointment slot.
 */
router.post('/hold', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, call_id, date, time } = req.body;

    if (!client_id || !call_id || !date || !time) {
      return res.status(400).json({ error: 'client_id, call_id, date, and time are required' });
    }

    const result = await availabilityService.holdSlot(client_id, call_id, date, time);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/availability/hold/:holdId
 * Release a held slot.
 */
router.delete('/hold/:holdId', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, date, time } = req.body;

    if (!client_id || !date || !time) {
      return res.status(400).json({ error: 'client_id, date, and time are required in body' });
    }

    await availabilityService.releaseHold(client_id, date, time);
    res.json({ status: 'released' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
