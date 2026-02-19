'use strict';

const router = require('express').Router();
const vapiAuth = require('../middleware/auth');
const ctrl = require('../controllers/vapiController');

router.use(vapiAuth);

router.post('/chat', ctrl.chat);
router.post('/webhook', ctrl.webhook);

module.exports = router;
