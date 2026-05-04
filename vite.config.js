import { defineConfig } from 'vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://127.0.0.1:3101';

export default defineConfig({
    server: {
        host: true,
        proxy: {
            '/api': {
                target: apiProxyTarget,
                changeOrigin: false,
                secure: false
            }
        },
        allowedHosts: [
            'demo.example.com',
            'dxecy-212-23-222-6.a.free.pinggy.link',
            '.pinggy.link',
            '.loca.lt'
        ]
    },
    preview: {
        host: '127.0.0.1',
        port: 3100,
        proxy: {
            '/api': {
                target: apiProxyTarget,
                changeOrigin: false,
                secure: false
            }
        },
        allowedHosts: [
            'demo.example.com'
        ]
    }
});
