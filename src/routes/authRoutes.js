const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  registerRules,
  loginRules,
  updateProfileRules,
  changePasswordRules,
} = require('../middleware/validators');

const router = express.Router();

router.post('/register', registerRules, validate, authController.register);
router.post('/login', loginRules, validate, authController.login);
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.me);
router.patch('/me', protect, updateProfileRules, validate, authController.updateMe);
router.post('/change-password', protect, changePasswordRules, validate, authController.changePassword);

module.exports = router;
