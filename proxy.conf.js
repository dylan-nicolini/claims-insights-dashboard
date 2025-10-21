// Vite-compatible proxy config for Angular v20+
// Logging is done via proxy event listeners inside `configure`.

function entry(prefix, target, { secure = true, label = prefix } = {}) {
  return {
    target,
    changeOrigin: true,
    secure,
    // Vite uses `rewrite` (not `pathRewrite`)
    rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
    configure: (proxy /* http-proxy instance */, options) => {
      proxy.on('proxyReq', (proxyReq, req, res) => {
        console.log(`[proxy:req] ${req.method} ${req.url} -> ${target}`);
      });
      proxy.on('proxyRes', (proxyRes, req, res) => {
        try { proxyRes.headers['x-proxy-passed'] = label.replace(/^\//, ''); } catch {}
        console.log(`[proxy:res] ${req.method} ${req.url} <- ${target} status=${proxyRes.statusCode}`);
      });
      proxy.on('error', (err, req, res) => {
        console.error(`[proxy:err] ${req.method} ${req.url} -> ${target} ${err.code || err.message}`);
      });
    }
  };
}

module.exports = {
  '/dev-api':  entry('/dev-api',  'https://services-claims-dev.selective.com'),
  '/qa-api':   entry('/qa-api',   'https://services-claims-qa.selective.com',      { secure: true }),
  '/stg-api':  entry('/stg-api',  'https://services-claims-staging.selective.com', { secure: true }),
  '/prod-api': entry('/prod-api', 'https://services-claims.selective.com'),
  '/httpbin':  entry('/httpbin',  'https://httpbin.org')
};