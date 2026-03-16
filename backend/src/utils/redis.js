const Redis = require('ioredis');
const config = require('../config');
const logger = require('./logger');

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis(config.redis.url || {
      host: 'localhost',
      port: 6379,
      password: config.redis.password,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error('Redis error', { err: err.message }));
  }
  return redis;
}

module.exports = { getRedis };
