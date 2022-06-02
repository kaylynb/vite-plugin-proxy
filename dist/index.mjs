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
const getMiddleware = (options, defaultErrorHandler) => {
  const proxyEntries = new Map(Object.entries(options).map(([context, opts]) => {
    if (typeof opts === "string") {
      return [context, { target: opts }];
    }
    const newOpts = { ...opts };
    if (newOpts.rejectUnauthorized === void 0 && opts.secure === false) {
      newOpts.rejectUnauthorized = false;
    }
    if (defaultErrorHandler) {
      const userOnError = newOpts.onError;
      newOpts.onError = (error) => {
        const newError = userOnError?.(error);
        if (newError !== void 0) {
          defaultErrorHandler(error);
        }
      };
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
          onMatch(targetUrl, context, opts);
          return;
        } else {
          matchOpts?.onMiss?.();
        }
      }
    }
  };
  const proxyMiddleware = (req, res, next) => handleProxyMatches(req, (target, context, opts) => {
    http2proxy.web(req, res, getProxyHttpOptions(target, opts), (err, req2, res2) => err && opts.onError?.({
      type: "web",
      err,
      req: req2,
      res: res2,
      context,
      target,
      next
    }));
  }, {
    onMiss: () => next()
  });
  const webSocketHandler = (req, socket, head) => handleProxyMatches(req, (target, context, opts) => {
    http2proxy.ws(req, socket, head, getProxyHttpOptions(target, opts), (err, req2, socket2, head2) => err && opts.onError?.({
      type: "socket",
      err,
      req: req2,
      socket: socket2,
      head: head2,
      context,
      target
    }));
  }, {
    test: (_, opts) => isWebsocket(opts) && req.headers["sec-websocket-protocol"] !== HMR_HEADER
  });
  return { proxyMiddleware, webSocketHandler };
};
const proxy = (options) => {
  return {
    name: pluginName,
    configureServer: (server) => {
      const { webSocketHandler, proxyMiddleware } = getMiddleware(options, ({ err }) => {
        server.config.logger.error(`[${pluginName}] http2 proxy error: ${err.stack}
`, {
          timestamp: true,
          error: err
        });
      });
      server.httpServer?.on("upgrade", webSocketHandler);
      server.middlewares.use(proxyMiddleware);
    }
  };
};

export { getMiddleware, proxy };
