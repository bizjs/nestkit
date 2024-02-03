import { Injectable } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Injectable()
export class App2Service {
  constructor(private readonly notifyService: NotificationService) {}

  getHello(): string {
    const a = this.notifyService.getHello();
    return `app2: ${a}`;
  }
}
