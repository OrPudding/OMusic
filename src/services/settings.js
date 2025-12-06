// 【请用此版本完整替换您的 src/services/settings.js 文件】

// 【核心修正】直接导入所有需要的服务模块
import file from './file.js';

const SETTINGS_FILE_URI = 'internal://files/settings.json';

const settingsService = {
    // --- 默认设置 ---
    _defaults: {
        lyrics: { japaneseMode: 'translation', cantoneseMode: 'romaji', englishMode: 'translation' },
        lyricAdvanceTime: 1.8,
        gestures: { left: 'lyrics', right: 'playlist', up: 'none', down: 'none' },
        audioQuality: { online: 64, download: 128 },
        performance: { windowSize: 30, pageSize: 15 },
        network: { totalLimit: 500, apiPageSize: 20 },
        search: { totalLimit: 25, apiPageSize: 10 },
    },

    // --- 可选项预设 ---
    PRESETS: {
        lyrics: {
            japaneseMode: ['translation', 'romaji', 'original'],
            cantoneseMode: ['romaji', 'original'],
            englishMode: ['translation', 'original'],
        },
        lyricAdvanceTime: [0, 0.3, 0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2],
        audioQuality: {
            online: [64, 128, 192, 320, 990],
            download: [64, 128, 192, 320],
        },
        performance: {
            windowSize: [10, 20, 40],
            pageSize: [10, 15, 20],
        },
        network: {
            totalLimit: [50, 200, 500, 1000],
            apiPageSize: [10, 20, 50],
        },
        search: {
            totalLimit: [10, 25, 50],
            apiPageSize: [5, 10, 25],
        },
        gestures: ['none', 'lyrics', 'playlist', 'search', 'user', 'settings', 'prev', 'next'],
    },
    
    // --- 中文文本映射 ---
    TEXTS: {
        gestures: {
            none: '无操作', lyrics: '切换歌词页', playlist: '播放列表',
            search: '搜索', user: '个人中心', settings: '设置',
            prev: '上一首', next: '下一首'
        },
        lyrics: {
            japaneseMode: { translation: '显示翻译', romaji: '显示罗马音', original: '仅显示原文' },
            cantoneseMode: { romaji: '显示粤拼', original: '仅显示原文' },
            englishMode: { translation: '显示翻译', original: '仅显示原文' },
        }
    },

    // --- 内部状态 ---
    _settings: null,
    _isInitialized: false,

    /**
     * 【公共】初始化设置服务，加载设置。
     */
    async initialize() {
        if (this._isInitialized) return;
        console.log("SettingsService: 初始化...");
        await this.load();
        this._isInitialized = true;
        console.log("SettingsService: 初始化完成。");
    },

    /**
     * 【公共】获取所有设置。
     * @returns {object} 当前的所有设置。
     */
    getAll() {
        return this._settings;
    },

    /**
     * 【公共】获取指定路径的设置值。
     * @param {string} path - 例如 'audioQuality.online'。
     * @returns {any} 设置值。
     */
    get(path) {
        return path.split('.').reduce((o, k) => (o || {})[k], this._settings);
    },

    /**
     * 【公共】加载设置文件，如果失败则使用默认值并保存。
     */
    async load() {
        if (!file) {
            console.error("SettingsService: load 失败，file 服务模块未导入！");
            this._settings = { ...this._defaults };
            return;
        }
        try {
            const loadedSettings = await file.readJson(SETTINGS_FILE_URI);
            this._settings = this._deepMerge(this._defaults, loadedSettings || {});
        } catch (e) {
            console.warn("加载设置失败，将使用默认设置。", e);
            this._settings = { ...this._defaults };
        }
        await this.save();
    },

    /**
     * 【公共】保存当前设置到文件。
     */
    async save() {
        if (!file) {
            console.error("SettingsService: save 失败，file 服务模块未导入！");
            return;
        }
        try {
            await file.writeJson(SETTINGS_FILE_URI, this._settings);
        } catch (e) {
            console.error("保存设置失败:", e);
        }
    },

    /**
     * 【公共】切换一个设置项的值。
     * @param {string} path - 设置项的路径，例如 'lyrics.japaneseMode'。
     */
    toggle(path) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const parentPath = keys.join('.');
        
        const parentObject = parentPath ? this.get(parentPath) : this._settings;
        const presets = parentPath ? this.PRESETS[keys[0]][keys[1]] : this.PRESETS[lastKey];
        
        if (!parentObject || !presets) {
            console.error(`无效的设置路径或预设值: ${path}`);
            return;
        }

        const currentValue = parentObject[lastKey];
        const currentIndex = presets.indexOf(currentValue);
        const nextIndex = (currentIndex + 1) % presets.length;
        
        parentObject[lastKey] = presets[nextIndex];
        
        this.save();
    },

    /**
     * 【内部】深度合并对象，用于合并默认设置和加载的设置。
     */
    _deepMerge(target, source) {
        const output = { ...target };
        if (this._isObject(target) && this._isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this._isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, { [key]: source[key] });
                    } else {
                        output[key] = this._deepMerge(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        return output;
    },

    _isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }
};

export default settingsService;
