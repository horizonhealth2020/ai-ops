'use strict';

const router = require('express').Router();
const { vapiAuth } = require('../middleware/auth');
const bookingService = require('../services/bookingService');

/**
 * POST /api/v1/booking/create
 * Two-phase booking: FSM verification + persistence.
 */
router.post('/create', vapiAuth, async (req, res, next) => {
  try {
    const {
      client_id, call_id, caller_name, caller_phone, caller_email,
      caller_address, service_type, scheduled_date, scheduled_time,
      duration_min, notes,
    } = req.body;

    if (!client_id || !call_id || !caller_name || !caller_phone || !service_type || !scheduled_date || !scheduled_time) {
      return res.status(400).json({
        error: 'client_id, call_id, caller_name, caller_phone, service_type, scheduled_date, and scheduled_time are required',
      });
    }

    const result = await bookingService.createBooking({
      client_id, call_id, caller_name, caller_phone, caller_email,
      caller_address, service_type, scheduled_date, scheduled_time,
      duration_min, notes,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
