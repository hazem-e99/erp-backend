import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/finance',
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class FinanceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(FinanceGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Finance WS connected: ${client.id}`);
    client.join('finance');
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Finance WS disconnected: ${client.id}`);
  }

  emitFinanceUpdate(event: string, payload: Record<string, any>): void {
    this.server?.to('finance').emit(event, payload);
  }

  emitDashboardRefresh(data: Record<string, any>): void {
    this.server?.to('finance').emit('dashboard:refresh', data);
  }
}
