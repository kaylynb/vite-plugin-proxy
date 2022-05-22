import createDebugger from 'debug';
import http2proxy from 'http2-proxy';

const pluginName = "@kaylyn/vite-plugin-proxy";
const debug = createDebugger(pluginName);
const HMR_HEADER = "vite-hmr";
const cleanOpts = (opts) => {
  const { target, rewrite, secure, ws, ...cleaned } = opts;
  return cleaned;
};
const doesProxyContextMatchUrl = (context, url) => context.startsWith("^") && new RegExp(context).test(url) || url.startsWith(context);
const isWebsocket = (opts) => opts.ws || opts.target.startsWith("ws:") || opts.target.startsWith("wss:");
const getProtocol = (url) => {
  const protocol = url.protocol;
  if (protocol.startsWith("https") || protocol.startsWith("wss")) {
    return "https";
  }
  if (protocol.startsWith("http") || protocol.startsWith("ws")) {
    return "http";
  }
  throw new Error(`Invalid protocol: ${protocol}`);
};
const getPort = (url) => url.port === "" ? { http: 80, https: 443 }[getProtocol(url)] : +url.port;
const getMiddleware = (options) => {
  const proxyEntries = new Map(Object.entries(options).map(([context, opts]) => {
    if (typeof opts === "string") {
      return [context, { target: opts }];
    }
    const newOpts = { ...opts };
    if (newOpts.rejectUnauthorized === void 0 && opts.secure === false) {
      newOpts.rejectUnauthorized = false;
    }
    return [context, newOpts];
  }));
  const getProxyHttpOptions = (url, opts) => {
    const protocol = getProtocol(url);
    const port = getPort(url);
    const { hostname, pathname, search } = url;
    const path = pathname + search;
    return {
      ...{
        protocol,
        hostname,
        port,
        path
      },
      ...cleanOpts(opts)
    };
  };
  const handleProxyMatches = (req, onMatch, matchOpts) => {
    if (req.url) {
      for (const [context, opts] of proxyEntries) {
        if (doesProxyContextMatchUrl(context, req.url) && (matchOpts?.test?.(context, opts) ?? true)) {
          debug(`${req.url} -> ${isWebsocket(opts) ? "ws " : ""}${opts.target}`);
          let url = req.url;
          if (opts.rewrite) {
            url = opts.rewrite(url);
            debug(`rewrite: ${req.url} -> ${url}`);
          }
          const targetUrl = new URL(url, opts.target);
          debug(`targetUrl: ${targetUrl}`);
          onMatch(targetUrl, context, getProxyHttpOptions(targetUrl, opts));
          return;
        } else {
          matchOpts?.onMiss?.();
        }
      }
    }
  };
  const proxyMiddleware = (req, res, next) => handleProxyMatches(req, (_, __, opts) => {
    http2proxy.web(req, res, opts, (err) => err && next(err));
  }, {
    onMiss: () => next()
  });
  const webSocketHandler = (req, socket, head) => handleProxyMatches(req, (_, __, opts) => {
    http2proxy.ws(req, socket, head, opts);
  }, {
    test: (_, opts) => isWebsocket(opts) && req.headers["sec-websocket-protocol"] !== HMR_HEADER
  });
  return { proxyMiddleware, webSocketHandler };
};
const proxy = (options) => {
  const { webSocketHandler, proxyMiddleware } = getMiddleware(options);
  return {
    name: pluginName,
    configureServer: (server) => {
      server.httpServer?.on("upgrade", webSocketHandler);
      server.middlewares.use(proxyMiddleware);
    }
  };
};

export { getMiddleware, proxy };
