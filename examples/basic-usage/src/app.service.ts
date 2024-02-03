import { Injectable } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Injectable()
export class AppService {
  constructor(private readonly notifyService: NotificationService) {}

  getHello(): string {
    return this.notifyService.getHello();
  }
}
