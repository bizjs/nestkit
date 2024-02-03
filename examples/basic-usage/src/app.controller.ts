import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { App2Service } from './app2.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly app2: App2Service,
  ) {}

  @Get()
  getHello(): string[] {
    return [this.appService.getHello(), this.app2.getHello()];
  }
}
