import { Global, Injectable, Scope } from '@nestjs/common';

@Injectable()
export class NotificationService {
  static counter = 0;
  constructor() {
    console.log('init NotificationService');
  }
  getHello(): string {
    return 'Hello World! From Notification Service';
  }
}
