import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { socketConversationSchema, socketSendSchema } from '../shared/index';
import { env } from '../config/env';
import { authenticateToken } from '../middleware/auth';
import { activeConversationIds, markRead, requireMember, sendMessage } from '../modules/messages/messages.service';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { setIo } from './io';

/*
 * Event contract (all payloads validated with the shared Zod schemas):
 *   client → server  message:send {conversationId, body, clientMsgId, replyTo?}  (ack: {ok, message} | {ok:false, error})
 *                    message:typing / message:typing-stop {conversationId}
 *                    message:read {conversationId}                               (ack)
 *                    conversation:join {conversationId}                          (ack)
 *   server → client  message:new, message:updated, message:deleted, message:read, message:typing, message:typing-stop
 * The authenticated user id always comes from the verified token, never from the payload.
 */

type Ack = (res: unknown) => void;
const toError = (e: unknown) => {
  if (e instanceof AppError) return { code: e.code, message: e.message };
  logger.error({ err: e }, 'Socket handler error');
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
};

// Small per-socket token bucket to stop event flooding.
function limiter(max: number, perMs: number) {
  let tokens = max;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(max, tokens + ((now - last) / perMs) * max);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function attachSocketServer(server: http.Server): Server {
  const io = new Server(server, {
    cors: { origin: env.clientOrigins.length ? env.clientOrigins : false },
    maxHttpBufferSize: 20_000,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      socket.data.auth = await authenticateToken(token);
      next();
    } catch (e) {
      const err = new Error(e instanceof AppError ? e.code : 'UNAUTHORIZED');
      next(err);
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket.data.auth as { userId: string }).userId;
    socket.join(`user:${userId}`);
    // Rooms are derived from database membership at connect time.
    for (const id of await activeConversationIds(userId)) socket.join(`conv:${id}`);

    const allowMessage = limiter(10, 10_000);
    const allowTyping = limiter(20, 10_000);

    socket.on('message:send', async (raw: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (!allowMessage()) return reply({ ok: false, error: { code: 'RATE_LIMITED', message: 'You are sending messages too quickly.' } });
      const parsed = socketSendSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid message' } });
      try {
        const { conversationId, ...input } = parsed.data;
        const { message } = await sendMessage(userId, conversationId, input);
        reply({ ok: true, message }); // ack only after the message is persisted
      } catch (e) {
        reply({ ok: false, error: toError(e) });
      }
    });

    const typing = (event: 'message:typing' | 'message:typing-stop') => async (raw: unknown) => {
      if (!allowTyping()) return;
      const parsed = socketConversationSchema.safeParse(raw);
      if (!parsed.success) return;
      try {
        await requireMember(parsed.data.conversationId, userId);
        socket.to(`conv:${parsed.data.conversationId}`).emit(event, { conversationId: parsed.data.conversationId, userId });
      } catch { /* not a member: silently ignore */ }
    };
    socket.on('message:typing', typing('message:typing'));
    socket.on('message:typing-stop', typing('message:typing-stop'));

    socket.on('message:read', async (raw: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const parsed = socketConversationSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload' } });
      try { reply({ ok: true, ...(await markRead(userId, parsed.data.conversationId)) }); } catch (e) { reply({ ok: false, error: toError(e) }); }
    });

    socket.on('conversation:join', async (raw: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const parsed = socketConversationSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload' } });
      try {
        await requireMember(parsed.data.conversationId, userId);
        await socket.join(`conv:${parsed.data.conversationId}`);
        reply({ ok: true });
      } catch (e) { reply({ ok: false, error: toError(e) }); }
    });
  });

  return io;
}
