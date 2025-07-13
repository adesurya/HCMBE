// src/routes/categories.js
const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { categoryValidation, idValidation, paginationValidation } = require('../middleware/validation');

// Public routes
router.get('/', paginationValidation, categoryController.getCategories);
router.get('/:id', idValidation, categoryController.getCategory);

// Protected routes (admin/editor only)
router.use(verifyToken);
router.use(requireRole(['admin', 'editor']));

router.post('/', categoryValidation.create, categoryController.createCategory);
router.put('/:id', idValidation, categoryValidation.update, categoryController.updateCategory);
router.delete('/:id', idValidation, categoryController.deleteCategory);

module.exports = router;

