// src/utils/screenKeep.js

import brightness from '@system.brightness';

/**
 * 简单屏幕常亮工具
 * 直接封装brightness.setKeepScreenOn，提供安全调用
 */
const screenKeep = {
    /**
     * 开启屏幕常亮
     * @returns {boolean} 是否成功
     */
    enable() {
        try {
            if (brightness && typeof brightness.setKeepScreenOn === 'function') {
                brightness.setKeepScreenOn({
                    keepScreenOn: true,
                    success: () => console.log('屏幕常亮开启成功'),
                    fail: (data, code) => console.warn(`屏幕常亮开启失败 code=${code}`, data)
                });
                return true;
            }
            console.log('设备不支持屏幕常亮');
            return false;
        } catch (error) {
            console.error('开启屏幕常亮异常:', error);
            return false;
        }
    },

    /**
     * 关闭屏幕常亮
     * @returns {boolean} 是否成功
     */
    disable() {
        try {
            if (brightness && typeof brightness.setKeepScreenOn === 'function') {
                brightness.setKeepScreenOn({
                    keepScreenOn: false,
                    success: () => console.log('屏幕常亮关闭成功'),
                    fail: (data, code) => console.warn(`屏幕常亮关闭失败 code=${code}`, data)
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('关闭屏幕常亮异常:', error);
            return false;
        }
    }
};

export default screenKeep;
