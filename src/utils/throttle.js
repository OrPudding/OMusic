/**
 * @file utils/throttle.js
 * @description 提供一个通用的节流 (throttle) 工具函数。
 */

/**
 * 节流函数：确保一个函数在指定的时间间隔内最多只执行一次。
 * 
 * 这个版本采用了 "尾部调用 (trailing call)" 的策略，即在节流周期结束后执行最后一次的调用。
 * 这对于像滑块拖动这样的场景非常有用，因为它能确保用户的最终意图（停止拖动时的位置）被正确执行。
 *
 * @param {Function} func - 需要被节流的目标函数。
 * @param {number} delay - 节流的时间窗口，单位为毫秒 (ms)。
 * @returns {Function} - 返回一个经过节流处理的新函数。
 */
function throttle(func, delay = 200) {
    let timeoutId = null;   // 用于存储 setTimeout 的 ID
    let lastArgs = null;    // 用于存储最后一次调用的参数
    let lastThis = null;    // 用于存储最后一次调用的 this 上下文

    // 返回一个包装后的新函数
    return function(...args) {
        // 每次调用时，都更新最后一次的参数和 this 上下文
        lastArgs = args;
        lastThis = this;

        // 如果当前没有正在等待的定时器，则设置一个新的
        if (!timeoutId) {
            timeoutId = setTimeout(() => {
                // 当定时器触发时，执行目标函数
                // 使用 .apply 来确保正确的 this 指向和参数传递
                func.apply(lastThis, lastArgs);
                
                // 执行完毕后，重置定时器ID，允许设置下一次的节流周期
                timeoutId = null;
            }, delay);
        }
    };
}

// 使用 ES6 模块导出规范，将 throttle 函数作为默认导出
export default throttle;
