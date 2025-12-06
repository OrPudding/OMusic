// 【最终版本，请替换：src/services/file.js】

import file from '@system.file';
import prompt from '@system.prompt';

/**
 * ===================================================================
 * =================== 全局文件服务 (file.js) ========================
 * ===================================================================
 * 职责：
 * 1. 将VelaOS底层回调式的`@system.file` API，全面封装为现代化的、
 *    基于`Promise`的异步函数。
 * 2. 提供更健壮的错误处理机制。
 * 3. 提供`readJson`, `writeJson`, `ensureDirExists`等常用的高级封装，
 *    简化业务逻辑。
 * ===================================================================
 */
const fileService = {

    /**
     * 【公共】初始化文件服务。
     * 目前为空，为未来扩展保留，以保持与其他服务的架构一致性。
     */
    async initialize() {
        console.log("FileService: 初始化完成。");
    },

    // ===================================================================
    // =================== 核心读写方法 ==================================
    // ===================================================================

    /**
     * 读取文本文件。
     * @param {string} uri - 文件URI。
     * @param {string} [encoding='UTF-8'] - 编码格式。
     * @returns {Promise<string>} 文件内容。
     */
    readText(uri, encoding = 'UTF-8') {
        return new Promise((resolve, reject) => {
            file.readText({
                uri,
                encoding,
                success: (data) => resolve(data.text || ''),
                fail: (err, code) => reject({ code, message: `读取文件失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 写入文本文件。
     * @param {string} uri - 文件URI。
     * @param {string} text - 要写入的文本。
     * @param {object} [options={}] - 选项。
     * @param {string} [options.encoding='UTF-8'] - 编码格式。
     * @param {boolean} [options.append=false] - 是否追加模式。
     * @returns {Promise<void>}
     */
    writeText(uri, text, options = {}) {
        return new Promise((resolve, reject) => {
            file.writeText({
                uri,
                text,
                encoding: options.encoding || 'UTF-8',
                append: options.append || false,
                success: () => resolve(),
                fail: (err, code) => reject({ code, message: `写入文件失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 读取JSON文件。
     * @param {string} uri - 文件URI。
     * @param {any} [defaultValue=null] - 当文件不存在或解析失败时返回的默认值。
     * @returns {Promise<any>} 解析后的JSON对象或默认值。
     */
    async readJson(uri, defaultValue = null) {
        try {
            const text = await this.readText(uri);
            if (text === '') return defaultValue;
            return JSON.parse(text);
        } catch (error) {
            if (error.code === 301) { // 文件不存在
                return defaultValue;
            }
            console.error(`【严重警告】解析JSON文件失败: ${uri}`, error.message);
            return defaultValue;
        }
    },

    /**
     * 写入JSON文件。
     * @param {string} uri - 文件URI。
     * @param {any} data - 要写入的JavaScript对象。
     * @param {boolean} [pretty=true] - 是否格式化（美化）输出。
     * @returns {Promise<void>}
     */
    async writeJson(uri, data, pretty = true) {
        try {
            const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
            await this.writeText(uri, text);
        } catch (error) {
            console.error(`【严重警告】写入JSON文件失败: ${uri}`, error.message);
            prompt.showToast({ message: `保存核心数据失败: ${uri}` });
            throw error;
        }
    },

    /**
     * 读取ArrayBuffer。
     * @param {string} uri - 文件URI。
     * @param {object} [options={}] - 选项。
     * @param {number} [options.position] - 读取的起始位置。
     * @param {number} [options.length] - 读取的长度。
     * @returns {Promise<ArrayBuffer>}
     */
    readArrayBuffer(uri, options = {}) {
        return new Promise((resolve, reject) => {
            file.readArrayBuffer({
                uri,
                position: options.position,
                length: options.length,
                success: (data) => resolve(data.buffer),
                fail: (err, code) => reject({ code, message: `读取Buffer失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 写入ArrayBuffer。
     * @param {string} uri - 文件URI。
     * @param {ArrayBuffer} buffer - 要写入的Buffer。
     * @param {object} [options={}] - 选项。
     * @param {number} [options.position] - 写入的起始位置。
     * @param {boolean} [options.append=false] - 是否追加模式。
     * @returns {Promise<void>}
     */
    writeArrayBuffer(uri, buffer, options = {}) {
        return new Promise((resolve, reject) => {
            file.writeArrayBuffer({
                uri,
                buffer,
                position: options.position,
                append: options.append || false,
                success: () => resolve(),
                fail: (err, code) => reject({ code, message: `写入Buffer失败: ${code}`, data: err })
            });
        });
    },

    // ===================================================================
    // =================== 文件与目录管理 ================================
    // ===================================================================

    /**
     * 删除文件。如果文件不存在，也视为成功。
     * @param {string} uri - 文件URI。
     * @returns {Promise<void>}
     */
    delete(uri) {
        return new Promise((resolve, reject) => {
            file.delete({
                uri,
                success: () => resolve(),
                fail: (err, code) => {
                    if (code === 301) { // 文件不存在
                        resolve();
                    } else {
                        reject({ code, message: `删除文件失败: ${code}`, data: err });
                    }
                }
            });
        });
    },

    /**
     * 移动文件。
     * @param {string} srcUri - 源文件URI。
     * @param {string} dstUri - 目标文件URI。
     * @returns {Promise<string>} 目标文件的URI。
     */
    move(srcUri, dstUri) {
        return new Promise((resolve, reject) => {
            file.move({
                srcUri,
                dstUri,
                success: (uri) => resolve(uri),
                fail: (err, code) => reject({ code, message: `移动文件失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 复制文件。
     * @param {string} srcUri - 源文件URI。
     * @param {string} dstUri - 目标文件URI。
     * @returns {Promise<string>} 目标文件的URI。
     */
    copy(srcUri, dstUri) {
        return new Promise((resolve, reject) => {
            file.copy({
                srcUri,
                dstUri,
                success: (uri) => resolve(uri),
                fail: (err, code) => reject({ code, message: `复制文件失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 获取目录中的文件列表。
     * @param {string} uri - 目录URI。
     * @returns {Promise<Array<object>>} 文件列表。
     */
    list(uri) {
        return new Promise((resolve, reject) => {
            file.list({
                uri,
                success: (data) => resolve(data.fileList || []),
                fail: (err, code) => reject({ code, message: `获取文件列表失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 获取文件或目录的信息。
     * @param {string} uri - 文件或目录URI。
     * @param {boolean} [recursive=false] - 是否递归获取子目录信息。
     * @returns {Promise<object>} 文件信息。
     */
    get(uri, recursive = false) {
        return new Promise((resolve, reject) => {
            file.get({
                uri,
                recursive,
                success: (data) => resolve(data),
                fail: (err, code) => reject({ code, message: `获取文件信息失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 检查文件或目录是否存在。
     * @param {string} uri - 文件或目录URI。
     * @returns {Promise<boolean>} 是否存在。
     */
    exists(uri) {
        return new Promise((resolve) => {
            file.access({
                uri,
                success: () => resolve(true),
                fail: () => resolve(false)
            });
        });
    },

    /**
     * 创建目录。
     * @param {string} uri - 目录URI。
     * @param {boolean} [recursive=false] - 是否递归创建父目录。
     * @returns {Promise<void>}
     */
    mkdir(uri, recursive = false) {
        return new Promise((resolve, reject) => {
            file.mkdir({
                uri,
                recursive,
                success: () => resolve(),
                fail: (err, code) => reject({ code, message: `创建目录失败: ${code}`, data: err })
            });
        });
    },

    /**
     * 删除目录。
     * @param {string} uri - 目录URI。
     * @param {boolean} [recursive=false] - 是否递归删除子文件和子目录。
     * @returns {Promise<void>}
     */
    rmdir(uri, recursive = false) {
        return new Promise((resolve, reject) => {
            file.rmdir({
                uri,
                recursive,
                success: () => resolve(),
                fail: (err, code) => reject({ code, message: `删除目录失败: ${code}`, data: err })
            });
        });
    },

    // ===================================================================
    // =================== 高级封装方法 ==================================
    // ===================================================================

    /**
     * 确保目录存在，如果不存在则创建。
     * @param {string} uri - 目录URI。
     * @param {boolean} [recursive=true] - 是否递归创建父目录。
     * @returns {Promise<void>}
     */
    async ensureDirExists(uri, recursive = true) {
        const exists = await this.exists(uri);
        if (!exists) {
            try {
                await this.mkdir(uri, recursive);
            } catch (error) {
                if (!(await this.exists(uri))) {
                    throw error;
                }
            }
        }
    },

    /**
     * 追加数据到JSON文件对象中。
     * @param {string} uri - 文件URI。
     * @param {string} key - 要添加或更新的键。
     * @param {any} value - 要设置的值。
     * @returns {Promise<boolean>} 操作是否成功。
     */
    async appendToJson(uri, key, value) {
        try {
            const existingData = await this.readJson(uri, {});
            existingData[key] = value;
            await this.writeJson(uri, existingData);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * 从JSON文件对象中删除一个键。
     * @param {string} uri - 文件URI。
     * @param {string} key - 要删除的键。
     * @returns {Promise<boolean>} 操作是否成功。
     */
    async deleteFromJson(uri, key) {
        try {
            const existingData = await this.readJson(uri, {});
            if (existingData.hasOwnProperty(key)) {
                delete existingData[key];
                await this.writeJson(uri, existingData);
            }
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * 获取文件大小。
     * @param {string} uri - 文件URI。
     * @returns {Promise<number>} 文件大小（字节），失败则返回0。
     */
    async getFileSize(uri) {
        try {
            const info = await this.get(uri);
            return info.length || 0;
        } catch (error) {
            return 0;
        }
    },

    /**
     * 获取目录总大小（递归计算）。
     * @param {string} uri - 目录URI。
     * @returns {Promise<number>} 目录总大小（字节），失败则返回0。
     */
    async getDirSize(uri) {
        try {
            const info = await this.get(uri, true);
            let totalSize = 0;
            const calculateSize = (item) => {
                if (item.type === 'file') {
                    totalSize += item.length || 0;
                }
                if (item.subFiles) {
                    item.subFiles.forEach(calculateSize);
                }
            };
            calculateSize(info);
            return totalSize;
        } catch (error) {
            return 0;
        }
    },

    /**
     * 清理目录中的旧文件。
     * @param {string} uri - 目录URI。
     * @param {number} maxAge - 文件的最大存活时间（毫秒）。
     * @returns {Promise<number>} 已删除的文件数量。
     */
    async cleanupOldFiles(uri, maxAge) {
        try {
            const fileList = await this.list(uri);
            const now = Date.now();
            let deletedCount = 0;
            for (const fileItem of fileList) {
                if (now - fileItem.lastModifiedTime > maxAge) {
                    try {
                        await this.delete(fileItem.uri);
                        deletedCount++;
                    } catch (e) {
                        // 忽略单个文件删除失败
                    }
                }
            }
            return deletedCount;
        } catch (error) {
            return 0;
        }
    }
};

export default fileService;
