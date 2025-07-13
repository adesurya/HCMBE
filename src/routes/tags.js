// src/routes/tags.js
const express = require('express');
const router = express.Router();
const tagController = require('../controllers/tagController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { tagValidation, idValidation, paginationValidation } = require('../middleware/validation');

// Public routes
router.get('/', paginationValidation, tagController.getTags);
router.get('/:id', idValidation, tagController.getTag);

// Protected routes (admin/editor only)
router.use(verifyToken);
router.use(requireRole(['admin', 'editor']));

router.post('/', tagValidation.create, tagController.createTag);
router.put('/:id', idValidation, tagValidation.update, tagController.updateTag);
router.delete('/:id', idValidation, tagController.deleteTag);

module.exports = router;

