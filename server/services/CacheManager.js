import NodeCache from 'node-cache';
import { CACHE_CONFIG } from '../config/datasources.js';

/**
 * キャッシュ管理サービス
 */
export class CacheManager {
    constructor() {
        this.cache = new NodeCache({
            stdTTL: CACHE_CONFIG.stdTTL,
            checkperiod: CACHE_CONFIG.checkperiod,
            maxKeys: CACHE_CONFIG.maxKeys,
        });
    }

    get(key) {
        return this.cache.get(key);
    }

    set(key, value, ttl) {
        return this.cache.set(key, value, ttl);
    }

    del(key) {
        return this.cache.del(key);
    }

    flush() {
        return this.cache.flushAll();
    }

    getStats() {
        return this.cache.getStats();
    }
}
