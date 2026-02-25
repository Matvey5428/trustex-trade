/**
 * controllers/verificationController.js
 * Контроллер для управления верификацией пользователей
 */

const dbManager = require('../models/dbManager');

/**
 * Получить или создать пользователя по Telegram ID
 */
const getOrCreateUser = (req, res) => {
  try {
    const { telegramId } = req.body;

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: 'Telegram ID не передан',
      });
    }

    const user = dbManager.getOrCreateUser(telegramId);

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Создать заявку на верификацию
 */
const submitVerification = (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID не передан',
      });
    }

    const verification = dbManager.submitVerification(parseInt(userId));

    res.json({
      success: true,
      data: verification,
      message: 'Заявка на верификацию создана. Администратор свяжется с вами.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить ожидающие заявки на верификацию (для админ)
 */
const getPendingVerifications = (req, res) => {
  try {
    const verifications = dbManager.getPendingVerifications();

    // Обогащаем данные информацией о пользователях
    const enrichedVerifications = verifications.map(v => {
      const user = dbManager.getUserById(v.userId);
      return {
        ...v,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          createdAt: user.createdAt,
        },
      };
    });

    res.json({
      success: true,
      data: enrichedVerifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Одобрить верификацию пользователя (для админ)
 */
const approveVerification = (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID не передан',
      });
    }

    const user = dbManager.approveVerification(parseInt(userId));

    res.json({
      success: true,
      data: user,
      message: 'Верификация пользователя одобрена',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить статус верификации пользователя
 */
const getVerificationStatus = (req, res) => {
  try {
    const { userId } = req.params;

    const user = dbManager.getUserById(parseInt(userId));
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    res.json({
      success: true,
      data: user.verification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getOrCreateUser,
  submitVerification,
  getPendingVerifications,
  approveVerification,
  getVerificationStatus,
};
