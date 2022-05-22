import createDebugger from 'debug'
import { IncomingMessage, ServerResponse } from 'http'
import http2proxy, { http1WebOptions, wsHttp1Options } from 'http2-proxy'
import { Socket } from 'net'
import { Duplex } from 'stream'
import type { ConnectionOptions } from 'tls'
import type { Plugin } from 'vite'

declare module 'http2-proxy' {
	// `http2-proxy` copies these options to the request when handled
	interface ConnectionOptionsSubset
		extends Pick<
			ConnectionOptions,
			| 'ca'
			| 'cert'
			| 'ciphers'
			| 'clientCertEngine'
			| 'crl'
			| 'dhparam'
			| 'ecdhCurve'
			| 'honorCipherOrder'
			| 'key'
			| 'passphrase'
			| 'pfx'
			| 'rejectUnauthorized'
			| 'secureOptions'
			| 'secureProtocol'
			| 'servername'
			| 'sessionIdContext'
			| 'checkServerIdentity'
		> {
		highWaterMark?: number
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface http1WebOptions extends ConnectionOptionsSubset {}

	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface wsHttp1Options extends ConnectionOptionsSubset {}
}

type ProxyHttpOptions = Omit<
	http1WebOptions & wsHttp1Options,
	'onReq' | 'onRes'
>

export type ProxyOptions = Partial<ProxyHttpOptions> & {
	target: string
	rewrite?: (path: string) => string
	secure?: boolean
	ws?: boolean
}

export type ProxyPluginOptions = Record<string, string | ProxyOptions>

const pluginName = '@kaylyn/vite-plugin-proxy'

const debug = createDebugger(pluginName)

const HMR_HEADER = 'vite-hmr'

const cleanOpts = (opts: ProxyOptions): Partial<ProxyHttpOptions> => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { target, rewrite, secure, ws, ...cleaned } = opts

	return cleaned
}

const doesProxyContextMatchUrl = (context: string, url: string): boolean =>
	(context.startsWith('^') && new RegExp(context).test(url)) ||
	url.startsWith(context)

const isWebsocket = (opts: ProxyOptions) =>
	opts.ws || opts.target.startsWith('ws:') || opts.target.startsWith('wss:')

const getProtocol = (
	url: URL,
): Exclude<ProxyOptions['protocol'], undefined> => {
	const protocol = url.protocol

	if (protocol.startsWith('https') || protocol.startsWith('wss')) {
		return 'https'
	}

	if (protocol.startsWith('http') || protocol.startsWith('ws')) {
		return 'http'
	}

	throw new Error(`Invalid protocol: ${protocol}`)
}

const getPort = (url: URL): number =>
	url.port === '' ? { http: 80, https: 443 }[getProtocol(url)] : +url.port

export const getMiddleware = (options: ProxyPluginOptions) => {
	const proxyEntries = new Map<string, ProxyOptions>(
		Object.entries(options).map(([context, opts]): [string, ProxyOptions] => {
			if (typeof opts === 'string') {
				return [context, { target: opts }]
			}

			const newOpts = { ...opts }

			// Convert `secure` to `rejectUnauthorized` to allow easier migration from vite `proxy` config
			if (newOpts.rejectUnauthorized === undefined && opts.secure === false) {
				newOpts.rejectUnauthorized = false
			}

			return [context, newOpts]
		}),
	)

	const getProxyHttpOptions = (
		url: URL,
		opts: ProxyOptions,
	): ProxyHttpOptions => {
		const protocol = getProtocol(url)
		const port = getPort(url)
		const { hostname, pathname, search } = url
		const path = pathname + search

		return {
			...{
				protocol,
				hostname,
				port,
				path,
			},
			...cleanOpts(opts),
		}
	}

	const handleProxyMatches = (
		req: IncomingMessage,
		onMatch: (url: URL, context: string, opts: ProxyHttpOptions) => void,
		matchOpts?: {
			onMiss?: () => void
			test?: (context: string, opts: ProxyOptions) => boolean
		},
	) => {
		if (req.url) {
			for (const [context, opts] of proxyEntries) {
				if (
					doesProxyContextMatchUrl(context, req.url) &&
					(matchOpts?.test?.(context, opts) ?? true)
				) {
					debug(`${req.url} -> ${isWebsocket(opts) ? 'ws ' : ''}${opts.target}`)

					let url = req.url
					if (opts.rewrite) {
						url = opts.rewrite(url)
						debug(`rewrite: ${req.url} -> ${url}`)
					}

					const targetUrl = new URL(url, opts.target)
					debug(`targetUrl: ${targetUrl}`)

					onMatch(targetUrl, context, getProxyHttpOptions(targetUrl, opts))
					return
				} else {
					matchOpts?.onMiss?.()
				}
			}
		}
	}

	const proxyMiddleware = (
		req: IncomingMessage,
		res: ServerResponse,
		next: (err?: unknown) => void,
	) =>
		handleProxyMatches(
			req,
			(_, __, opts) => {
				http2proxy.web(req, res, opts, (err) => err && next(err))
			},
			{
				onMiss: () => next(),
			},
		)

	const webSocketHandler = (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	) =>
		handleProxyMatches(
			req,
			(_, __, opts) => {
				http2proxy.ws(req, socket as Socket, head, opts)
			},
			{
				test: (_: string, opts: ProxyOptions) =>
					isWebsocket(opts) &&
					req.headers['sec-websocket-protocol'] !== HMR_HEADER,
			},
		)

	return { proxyMiddleware, webSocketHandler }
}

export const proxy = (options: ProxyPluginOptions): Plugin => {
	const { webSocketHandler, proxyMiddleware } = getMiddleware(options)

	return {
		name: pluginName,
		configureServer: (server) => {
			server.httpServer?.on('upgrade', webSocketHandler)
			server.middlewares.use(proxyMiddleware)
		},
	}
}
