import createDebugger from 'debug'
import type { IncomingMessage, ServerResponse } from 'http'
import http2proxy, { http1WebOptions, wsHttp1Options } from 'http2-proxy'
import type { Socket } from 'net'
import type { Duplex } from 'stream'
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

export type ProxyErrorCommon = {
	err: Error
	req: IncomingMessage
	context: string
	target: URL
}

export type WebError = ProxyErrorCommon & {
	type: 'web'
	res: ServerResponse
	next: (err?: unknown) => void
}

export type SocketError = ProxyErrorCommon & {
	type: 'socket'
	socket: Socket
	head: Buffer
}

export type ProxyError = WebError | SocketError

export type ProxyErrorHandler = (error: ProxyError) => Error | void

export type ProxyOptions = Partial<ProxyHttpOptions> & {
	target: string
	rewrite?: (path: string) => string
	secure?: boolean
	ws?: boolean
	onError?: ProxyErrorHandler
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

export const getMiddleware = (
	options: ProxyPluginOptions,
	defaultErrorHandler?: ProxyErrorHandler,
) => {
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

			if (defaultErrorHandler) {
				const userOnError = newOpts.onError
				newOpts.onError = (error) => {
					const newError = userOnError?.(error)

					if (newError !== undefined) {
						defaultErrorHandler(error)
					}
				}
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
		onMatch: (url: URL, context: string, opts: ProxyOptions) => void,
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

					onMatch(targetUrl, context, opts)
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
			(target, context, opts) => {
				http2proxy.web(
					req,
					res,
					getProxyHttpOptions(target, opts),
					(err, req, res) =>
						err &&
						opts.onError?.({
							type: 'web',
							err,
							req,
							res,
							context,
							target,
							next,
						}),
				)
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
			(target, context, opts) => {
				http2proxy.ws(
					req,
					socket as Socket,
					head,
					getProxyHttpOptions(target, opts),
					(err, req, socket, head) =>
						err &&
						opts.onError?.({
							type: 'socket',
							err,
							req,
							socket,
							head,
							context,
							target,
						}),
				)
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
	return {
		name: pluginName,
		configureServer: (server) => {
			const { webSocketHandler, proxyMiddleware } = getMiddleware(
				options,
				({ err }) => {
					server.config.logger.error(
						`[${pluginName}] http2 proxy error: ${err.stack}\n`,
						{
							timestamp: true,
							error: err,
						},
					)
				},
			)

			server.httpServer?.on('upgrade', webSocketHandler)
			server.middlewares.use(proxyMiddleware)
		},
	}
}
