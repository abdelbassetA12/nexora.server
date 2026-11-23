import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Message } from '../src/database/models/Message';
import { app, api, as, makeUser } from './helpers';
import { attachSocketServer } from '../src/sockets';
import { setIo } from '../src/sockets/io';

let server: http.Server;
let ioServer: Server;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  ioServer = attachSocketServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  open.forEach((s) => s.close());
  await ioServer.close();
  setIo(null);
});

const client = (token?: string) => {
  const s = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
  open.push(s);
  return s;
};
const connected = (s: Socket) => new Promise<void>((res, rej) => { s.on('connect', () => res()); s.on('connect_error', (e) => rej(e)); });
const once = <T>(s: Socket, event: string) => new Promise<T>((res) => s.once(event, res));
const emitAck = <T>(s: Socket, event: string, payload: unknown) => new Promise<T>((res) => s.emit(event, payload, res));

describe('socket authentication', () => {
  it('rejects missing and invalid tokens', async () => {
    await expect(connected(client())).rejects.toThrow();
    await expect(connected(client('not-a-token'))).rejects.toThrow();
  });
});

describe('real-time messaging', () => {
  it('persists before acking and delivers message:new to other members only', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const spy = await makeUser();
    const conv = (await api().post('/api/v1/conversations').set(as(a)).send({ type: 'direct', userId: b.id })).body.data;

    const [sa, sb, ss] = [client(a.token), client(b.token), client(spy.token)];
    await Promise.all([connected(sa), connected(sb), connected(ss)]);
    let spyGot = false;
    ss.on('message:new', () => { spyGot = true; });

    const incoming = once<{ body: string }>(sb, 'message:new');
    const ack = await emitAck<{ ok: boolean; message: { id: string; body: string } }>(sa, 'message:send', { conversationId: conv.id, body: 'hello live', clientMsgId: 'sock-msg-0001' });
    expect(ack.ok).toBe(true);
    expect(await Message.countDocuments({ _id: ack.message.id })).toBe(1); // durable at ack time
    expect((await incoming).body).toBe('hello live');

    // Retrying the same clientMsgId returns the same message, no duplicate.
    const retry = await emitAck<{ ok: boolean; message: { id: string } }>(sa, 'message:send', { conversationId: conv.id, body: 'hello live', clientMsgId: 'sock-msg-0001' });
    expect(retry.message.id).toBe(ack.message.id);
    expect(await Message.countDocuments({})).toBe(1);

    await new Promise((r) => setTimeout(r, 150));
    expect(spyGot).toBe(false);
  });

  it('rejects sends from non-members and invalid payloads via ack', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const spy = await makeUser();
    const conv = (await api().post('/api/v1/conversations').set(as(a)).send({ type: 'direct', userId: b.id })).body.data;
    const ss = client(spy.token);
    await connected(ss);

    const denied = await emitAck<{ ok: boolean; error: { code: string } }>(ss, 'message:send', { conversationId: conv.id, body: 'let me in', clientMsgId: 'spy-msg-00001' });
    expect(denied).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const invalid = await emitAck<{ ok: boolean; error: { code: string } }>(ss, 'message:send', { conversationId: 'nope', body: '' });
    expect(invalid.error.code).toBe('VALIDATION_ERROR');
    const join = await emitAck<{ ok: boolean }>(ss, 'conversation:join', { conversationId: conv.id });
    expect(join.ok).toBe(false);
  });

  it('relays typing indicators to other members and broadcasts REST-sent messages and read receipts', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await api().post('/api/v1/conversations').set(as(a)).send({ type: 'direct', userId: b.id })).body.data;
    const [sa, sb] = [client(a.token), client(b.token)];
    await Promise.all([connected(sa), connected(sb)]);

    const typing = once<{ userId: string }>(sb, 'message:typing');
    sa.emit('message:typing', { conversationId: conv.id });
    expect((await typing).userId).toBe(a.id);

    const viaRest = once<{ body: string }>(sb, 'message:new');
    await api().post(`/api/v1/conversations/${conv.id}/messages`).set(as(a)).send({ body: 'from rest', clientMsgId: 'rest-msg-0001' });
    expect((await viaRest).body).toBe('from rest');

    const read = once<{ userId: string }>(sa, 'message:read');
    await api().post(`/api/v1/conversations/${conv.id}/read`).set(as(b)).send({});
    expect((await read).userId).toBe(b.id);
  });
});
