import { WrappedMemoryCache } from '../src/';
const getProjectInfoForCache = async (id: string) => {
  return new Promise((resolve, reject) => {
    console.log('request backend', new Date());
    setTimeout(() => {
      let value = Math.random();
      if (value > 0.9) {
        console.log('throw error');
        reject('error');
      }
      resolve(id + value);
    }, 2000);
  });
};

async function start() {
  const cache = new WrappedMemoryCache({
    ttl: 10000,
    refreshThreshold: 3000,
    refreshFn: (key) => () => getProjectInfoForCache(key),
  });

  setInterval(async () => {
    for (let i = 0; i < 10; i++) {
      console.time('project1 - ' + i);
      const v = await cache.getCachedValue('project1');
      console.timeEnd('project1 - ' + i);
    }
  }, 1000);
}

start();
