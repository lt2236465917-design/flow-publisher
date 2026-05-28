export const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  // GPU rendering — use SwiftShader software rendering to avoid GPU process failures
  // that block page.screenshot() and page.evaluate() CDP calls
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer',
  '--use-gl=swiftshader',
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--disable-accelerated-2d-canvas',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-features=TranslateUI,BackForwardCache,MediaRouter',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-experiments',
  '--no-default-browser-check',
  // Speed-focused args for faster launch
  '--disable-offline-load-stale-cache',
  '--disable-composited-antialiasing'
]

export const STEALTH_SCRIPTS = `
  // 1. navigator.webdriver = false
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });

  // 2. 完善 window.chrome
  if (!window.chrome) {
    window.chrome = {};
  }
  window.chrome.runtime = {
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
    PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    connect: function() { throw new TypeError('Invalid invocation'); },
    sendMessage: function() { throw new TypeError('Invalid invocation'); }
  };

  // 3. 修复 plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ];
      plugins.refresh = () => {};
      return plugins;
    },
    configurable: true
  });

  // 4. 修复 languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    configurable: true
  });

  // 5. 修复 permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return originalQuery(parameters);
  };

  // 6. 修复 WebGL 指痕
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, parameter);
  };

  // 7. 修复 connection
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      downlink: 10,
      effectiveType: '4g',
      rtt: 50,
      saveData: false
    }),
    configurable: true
  });

  // 8. 修复 hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true
  });

  // 9. 修复 deviceMemory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true
  });

  // 10. 隐藏自动化相关属性
  delete navigator.__proto__.webdriver;

  // 11. 修复 toString 检测
  const originalToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    if (this === navigator.permissions.query) {
      return 'function query() { [native code] }';
    }
    return originalToString.call(this);
  };
`
