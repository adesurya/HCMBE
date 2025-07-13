// src/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { userValidation, idValidation, paginationValidation } = require('../middleware/validation');

// All routes require authentication
router.use(verifyToken);

// Get users (admin/editor only)
router.get('/', requireRole(['admin', 'editor']), paginationValidation, userController.getUsers);
router.get('/:id', requireRole(['admin', 'editor']), idValidation, userController.getUser);

// Admin only routes
router.use(requireRole(['admin']));

router.post('/', userValidation.register, userController.createUser);
router.put('/:id', idValidation, userValidation.update, userController.updateUser);
router.delete('/:id', idValidation, userController.deleteUser);
router.post('/:id/activate', idValidation, userController.activateUser);
router.post('/:id/deactivate', idValidation, userController.deactivateUser);

module.exports = router;

