import { config } from 'dotenv';
import { RedisLock } from '../src';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

config();
(async () => {
  let i = 0;
  const redisLock = new RedisLock({ redisUrl: process.env.REDIS_URL! });

  async function test() {
    let lock = await redisLock.acquireLock('abc', 10);
    if (lock) {
      try {
        console.log('Lock acquired, processing...');
        await sleep(Math.floor(Math.random() * 5000));
      } finally {
        const released = await lock.release();
        if (released) {
          console.log('Lock released.');
        } else {
          console.log('Failed to release lock, it may have expired or was not held by this process.');
        }
      }
    } else {
      console.log('Failed to acquire lock, another process holds it.');
    }
  }

  while (true) {
    i++;
    test();
    await sleep(1000);
    if (i >= 20) {
      break;
    }
  }
})();
