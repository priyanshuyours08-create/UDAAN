const { Notification } = require('../models');

async function getUserNotifications(req, res) {
  try {
    let page = parseInt(req.query.page, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const { count, rows } = await Notification.findAndCountAll({
      where: { user_id: req.user.id },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit),
      notifications: rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function markAllAsRead(req, res) {
  try {
    const [affectedCount] = await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } }
    );
    res.json({ message: 'Notifications marked as read', affectedCount });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function markAsRead(req, res) {
  try {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    const notifId = parseInt(req.params.id, 10);

    const notif = await Notification.findByPk(notifId);
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notif.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not own this notification' });
    }

    await notif.update({ is_read: true });
    res.json({ message: 'Notification marked as read', notification: notif });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getUserNotifications,
  markAllAsRead,
  markAsRead
};
