# @kaylyn/vite-plugin-proxy

Vite plugin that enables proxy configuration without downgrading HTTP/2. See https://vitejs.dev/config/#server-https

## Usage
___Ensure vite `proxy` configuration is removed or HTTP/2 will be disabled___ 

Add proxy configuration as part of `plugins`
```ts
import { proxy } from "@kaylyn/vite-plugin-proxy"

export default defineConfig({
  plugins: [
    proxy({
      "/api": "https://localhost:5001",
      "^/api2/.*": {
        target: "https://localhost:6001",
        rewrite: (path) => path.replace('/^\/api2/', ''),
        // Enable WebSocket proxying
        ws: true,
        // Disable TLS cert validation
        secure: false
      }
    })
  ]
})
```

## Config
This is not stabilized yet.

There is not a 1:1 mapping between [Vite proxy config](https://github.com/http-party/node-http-proxy#options), but some options are available:
- `secure`: `false` to disable TLS verification
- `ws`: `true` to enable proxying WebSockets

Simple configurations should just be copy/paste.

Some properties that are on `target` for `vite` proxy are at the top-level config. For example: `ca`, `cert`, etc.

Check [index.d.ts](dist/index.d.ts) for configuration format.

## Troubleshooting
Try running vite with `DEBUG` set to print debug logs to the terminal.

```bash
DEBUG="@kaylyn/vite-plugin-proxy" pnpx vite
