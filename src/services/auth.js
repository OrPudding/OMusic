// 【请用此版本完整替换您的 src/services/auth.js 文件】

import crypto from '@system.crypto';
import device from '@system.device';
import file from '@system.file';
import fetch from '@system.fetch';

const LICENSE_FILE_URI = 'internal://files/license.json';
const STATUS_FILE_URI = 'internal://files/app_status.json';

const SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0YQakr41N+9bHZ7SI5Il
IO7FDTkf6708E94ZUH57zUgzLtx4LwUxp6w+374D2LU/xVRBNaJhvdbTHwPV0CKS
w2IvHtZDMCYlTpZ/CKMkcTioHJ+49roCquhETWiEGWf7dQJFhxsdndqsrzx4Cih/
HwS3vI1kcRfiuklkaW542OeaOrvCPx0OKRVz5ngeUWD9fS2I9QQ3vkhodnI5C8+O
uEknhKNaBOc0r2sDFSyAGBz4aVkF3X95dGmfWQ6aoTMZpmoEi0zMfQXUUIxl7lN1
ZdRbYWIH1E0/S7dmIq6tC8+69Pyt8Jc8VfhClV97mF/LLrnN0T358bR5b2OTuuk1
6QIDAQAB
-----END PUBLIC KEY-----`;

const authService = {
    isActivated: null,
    deviceId: null,
    eulaAgreed: null,
    
    ACTIVATION_SERVER_URL: 'https://vela-verify.orpu.moe',
    AFDIAN_PURCHASE_URL: 'https://afdian.com/item/64db28ce9f7d11f088fc52540025c377',

    async initialize( ) {
        if (this.isActivated !== null && this.eulaAgreed !== null) return;
        console.log("AuthService: Initializing...");
        try {
            this.deviceId = await this._getDeviceIdentifier();
            const status = await this._readJson(STATUS_FILE_URI, {});
            this.eulaAgreed = status.eulaAgreed === true;

            if (this.eulaAgreed) {
                this.isActivated = await this._checkLocalLicense();
            } else {
                this.isActivated = false;
            }
        } catch (error) {
            console.error(`AuthService: 初始化检查失败: ${error.message}`);
            this.isActivated = false;
            this.eulaAgreed = false;
        }
        console.log(`AuthService: 初始化检查完成. EULA: ${this.eulaAgreed}, Activated: ${this.isActivated}`);
    },

    getInitialUiState() {
        if (this.isActivated) {
            return { status: 'activated' };
        }
        if (!this.eulaAgreed) {
            return { status: 'needs_eula' };
        }
        return { status: 'needs_activation', deviceId: this.deviceId, purchaseUrl: this.AFDIAN_PURCHASE_URL };
    },

    async agreeEula() {
        await this._writeJson(STATUS_FILE_URI, { eulaAgreed: true });
        this.eulaAgreed = true;
        this.isActivated = await this._checkLocalLicense();
    },

    async attemptActivation() {
        if (!this.deviceId) throw new Error("设备ID未初始化");
        
        const postData = { device_id: this.deviceId };
        const response = await this._fetch({
            url: `${this.ACTIVATION_SERVER_URL}/activate`,
            method: 'POST',
            data: postData,
        });

        if (response.status === 'success' && response.data.status === 'success') {
            await this._writeJson(LICENSE_FILE_URI, response.data.license);
            this.isActivated = await this._checkLocalLicense();
            if (this.isActivated) {
                return { status: 'activated' };
            }
        }
        
        const serverMessage = (response.data && response.data.message) || '服务器返回了未知错误。';
        throw new Error(serverMessage);
    },
    
    reset() {
        this.isActivated = null;
        this.deviceId = null;
        this.eulaAgreed = null;
    },

    _getDeviceIdentifier() {
        return new Promise((resolve, reject) => {
            device.getDeviceId({
                success: (data) => data?.deviceId ? resolve(data.deviceId) : reject(new Error('未能获取到有效的设备ID')),
                fail: (data, code) => reject(new Error(`获取设备ID失败 (code: ${code})`))
            });
        });
    },

    _checkLocalLicense() {
        return new Promise(async (resolve) => {
            try {
                const license = await this._readJson(LICENSE_FILE_URI);
                if (!license || license.payload.device_id !== this.deviceId) {
                    resolve(false);
                    return;
                }
                const payloadStr = JSON.stringify(license.payload, Object.keys(license.payload).sort());
                const isValid = await new Promise(verifyResolve => {
                    crypto.verify({
                        data: payloadStr, signature: license.signature, publicKey: SERVER_PUBLIC_KEY, algo: 'RSA-SHA256',
                        success: verifyResult => verifyResolve(verifyResult),
                        fail: () => verifyResolve(false)
                    });
                });
                resolve(isValid);
            } catch {
                resolve(false);
            }
        });
    },

    _readJson(uri, defaultValue = null) {
        return new Promise(resolve => {
            file.readText({
                uri,
                success: data => {
                    try { 
                        const parsed = JSON.parse(data.text);
                        resolve(parsed);
                    } catch { 
                        resolve(defaultValue); 
                    }
                },
                fail: () => resolve(defaultValue)
            });
        });
    },

    _writeJson(uri, data) {
        return new Promise((resolve, reject) => {
            file.writeText({
                uri, text: JSON.stringify(data, null, 2),
                success: resolve,
                fail: (err, code) => reject(new Error(`写入文件失败 (code: ${code})`))
            });
        });
    },

    _fetch(options) {
        return new Promise(resolve => {
            fetch.fetch({
                ...options,
                header: { 'Content-Type': 'application/json' },
                responseType: 'text',
                success: response => {
                    try {
                        resolve({ status: 'success', data: JSON.parse(response.data) });
                    } catch {
                        resolve({ status: 'fail', message: 'JSON解析失败' });
                    }
                },
                fail: (err, code) => resolve({ status: 'fail', message: `网络错误 (code: ${code})` })
            });
        });
    }
};

export default authService;
