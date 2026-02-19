'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/clientsController');

router.post('/', ctrl.create);
router.get('/:id/config', ctrl.getConfig);
router.get('/:id/calls', ctrl.getCalls);

module.exports = router;
