// src/routes/ads.js
const express = require('express');
const router = express.Router();
const adsController = require('../controllers/adsController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { adsValidation, idValidation, paginationValidation } = require('../middleware/validation');

// Public routes
router.get('/position/:position', adsController.getAdsByPosition);

// Protected routes (admin only)
router.use(verifyToken);
router.use(requireRole(['admin']));

router.get('/', paginationValidation, adsController.getAds);
router.get('/:id', idValidation, adsController.getAd);
router.post('/', adsValidation.create, adsController.createAd);
router.put('/:id', idValidation, adsValidation.create, adsController.updateAd);
router.delete('/:id', idValidation, adsController.deleteAd);
router.get('/:id/stats', idValidation, adsController.getAdStats);

module.exports = router;

