import type { Server } from 'socket.io';

// Holder so services can emit without importing the HTTP server. No-op when sockets are not attached (e.g. unit tests).
let io: Server | null = null;
export const setIo = (server: Server | null) => { io = server; };
export const getIo = () => io;

export const emitToConversation = (conversationId: string, event: string, payload: unknown) => {
  io?.to(`conv:${conversationId}`).emit(event, payload);
};

/** Make all live sockets of a user join/leave a conversation room (e.g. right after creation or leaving). */
export const joinUserToConversation = (userId: string, conversationId: string) => {
  io?.in(`user:${userId}`).socketsJoin(`conv:${conversationId}`);
};
export const removeUserFromConversation = (userId: string, conversationId: string) => {
  io?.in(`user:${userId}`).socketsLeave(`conv:${conversationId}`);
};
export const emitToUser = (userId: string, event: string, payload: unknown) => {
  io?.to(`user:${userId}`).emit(event, payload);
};
