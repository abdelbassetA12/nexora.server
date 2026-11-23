import { Notification, NOTIFICATION_TYPES } from '../../database/models/Notification';
import { logger } from '../../utils/logger';
import { isBlockedBetween } from '../common/access';

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

interface Input {
  recipient: unknown;
  actor: unknown;
  type: NotificationType;
  resourceType: 'post' | 'comment' | 'community' | 'user';
  resourceId: unknown;
}

/**
 * Creates a notification for a real application event. Never throws: a failed notification
 * must not fail the action that triggered it. Self-notifications and blocked pairs are skipped.
 */
export async function notify(input: Input): Promise<void> {
  try {
    const recipient = String(input.recipient);
    const actor = String(input.actor);
    if (recipient === actor) return;
    if (await isBlockedBetween(recipient, actor)) return;
    await Notification.create({ ...input, recipient: input.recipient, actor: input.actor });
  } catch (err) {
    logger.error({ err }, 'Failed to create notification');
  }
}
