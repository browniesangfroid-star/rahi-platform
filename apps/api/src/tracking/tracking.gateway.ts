import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';

interface AuthenticatedSocket extends Socket {
  data: { userId?: string };
}

/**
 * Phase 16 socket CORS. Only the configured web origins may open a
 * browser socket: SOCKET_CORS_ORIGINS (comma-separated) or, by
 * default, the local admin web on :3000. A wildcard is never
 * honoured, even if set explicitly — native mobile apps do not use
 * browser CORS, so there is no legitimate wildcard consumer.
 */
/**
 * Phase 17: with REDIS_URL set, socket broadcasts fan out through
 * Redis so every API instance reaches every connected client. The
 * adapter itself is only constructed in afterInit (never in this
 * helper), so unit tests can assert the selection without a Redis
 * server. Without REDIS_URL the gateway keeps Socket.IO's default
 * in-memory adapter — correct for a single instance.
 */
export function shouldUseRedisSocketAdapter(): boolean {
  return !!process.env.REDIS_URL;
}

export function socketCorsOrigins(): string[] {
  const raw = process.env.SOCKET_CORS_ORIGINS;
  if (!raw) return ['http://localhost:3000'];
  const origins = raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0 && o !== '*');
  return origins.length > 0 ? origins : ['http://localhost:3000'];
}

/**
 * Socket.IO gateway (Phase 9). Authentication is the same JWT as the
 * REST API, passed as handshake auth token; unauthenticated sockets
 * are disconnected on connect. Rooms are per ride (`ride:{id}`) and
 * membership is checked against the ride's participants on join.
 */
@WebSocketGateway({ cors: { origin: socketCorsOrigins() } })
export class TrackingGateway implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private redisPub?: Redis;
  private redisSub?: Redis;

  constructor(
    private readonly jwt: JwtService,
    private readonly tracking: TrackingService,
  ) {}

  afterInit(server: Server) {
    if (!shouldUseRedisSocketAdapter()) return;
    this.redisPub = new Redis(process.env.REDIS_URL as string);
    this.redisSub = this.redisPub.duplicate();
    server.adapter(createAdapter(this.redisPub, this.redisSub));
  }

  onModuleDestroy() {
    void this.redisPub?.quit().catch(() => undefined);
    void this.redisSub?.quit().catch(() => undefined);
  }

  async handleConnection(client: AuthenticatedSocket) {
    const token = client.handshake?.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload: any = this.jwt.verify(token);
      client.data.userId = payload.sub;
    } catch {
      client.disconnect(true);
    }
  }

  private room(rideId: string) {
    return `ride:${rideId}`;
  }

  /** Broadcast helper (status changes in Phase 10). No-op if the
   *  gateway has no server yet (e.g. a test app that never listened). */
  emitToRide(rideId: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(this.room(rideId)).emit(event, payload);
  }

  @SubscribeMessage('joinRide')
  async onJoinRide(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { rideId: string }) {
    const ride = await this.tracking.loadRide(body.rideId);
    this.tracking.assertParticipant(ride, client.data.userId!, false);
    await client.join(this.room(body.rideId));
    const latest = await this.tracking.latestLocation(body.rideId, client.data.userId!, false);
    return { joined: true, rideId: body.rideId, latest };
  }

  @SubscribeMessage('leaveRide')
  async onLeaveRide(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { rideId: string }) {
    await client.leave(this.room(body.rideId));
    return { left: true, rideId: body.rideId };
  }

  @SubscribeMessage('driverLocation')
  async onDriverLocation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { rideId: string; lat: number; lng: number },
  ) {
    const update = await this.tracking.reportLocation(client.data.userId!, body.rideId, body.lat, body.lng);
    this.server.to(this.room(body.rideId)).emit('locationUpdate', update);
    return update;
  }
}
