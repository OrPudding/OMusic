// /utils/performance.js (建议放在一个公共的工具文件夹中)

/**
 * 一个简单的性能监测函数 (装饰器)
 * @param {Function} fn - 需要被监测性能的原始函数。
 * @param {string} functionName - 被监测函数的名称，用于日志输出。
 * @param {Object} context - 原始函数执行时需要绑定的 this 上下文。
 * @returns {Function} - 一个新的、带有性能监测功能的包装函数。
 */
function monitorPerformance(fn, functionName, context) {
    // 返回一个新的函数
    return function(...args) {
        // 1. 在函数执行前，记录当前时间戳
        const startTime = new Date().getTime();

        let result;
        try {
            // 2. 使用 apply 方法执行原始函数
            //    - `context` 确保函数内部的 `this` 指向正确 (例如，指向页面的 `this`)
            //    - `args` 将所有参数原封不动地传递给原始函数
            result = fn.apply(context, args);

        } catch (error) {
            // 如果原始函数执行出错，打印错误并重新抛出
            console.error(`[Performance Monitor] Function '${functionName}' threw an error:`, error);
            throw error;

        } finally {
            // 3. 在函数执行完毕后，再次记录时间戳
            const endTime = new Date().getTime();
            const duration = endTime - startTime;

            // 4. 计算并打印耗时
            //    - 使用 console.log 而不是 console.warn 或 console.error，避免在生产环境中引起不必要的警报
            //    - 为输出添加特殊标记 `[PM]` (Performance Monitor)，方便在日志中筛选
            console.log(`[PM] Function '${functionName}' took ${duration}ms to execute.`);
        }

        // 5. 返回原始函数的执行结果 (如果有的话)
        return result;
    };
}

// 导出这个工具函数
export default {
    monitor: monitorPerformance
};
