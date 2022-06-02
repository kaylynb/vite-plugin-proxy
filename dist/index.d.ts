import { IncomingMessage, ServerResponse } from 'http';
import { http1WebOptions, wsHttp1Options } from 'http2-proxy';
import { Socket } from 'net';
import { Duplex } from 'stream';
import { ConnectionOptions } from 'tls';
import { Plugin } from 'vite';

declare module 'http2-proxy' {
    interface ConnectionOptionsSubset extends Pick<ConnectionOptions, 'ca' | 'cert' | 'ciphers' | 'clientCertEngine' | 'crl' | 'dhparam' | 'ecdhCurve' | 'honorCipherOrder' | 'key' | 'passphrase' | 'pfx' | 'rejectUnauthorized' | 'secureOptions' | 'secureProtocol' | 'servername' | 'sessionIdContext' | 'checkServerIdentity'> {
        highWaterMark?: number;
    }
    interface http1WebOptions extends ConnectionOptionsSubset {
    }
    interface wsHttp1Options extends ConnectionOptionsSubset {
    }
}
declare type ProxyHttpOptions = Omit<http1WebOptions & wsHttp1Options, 'onReq' | 'onRes'>;
declare type ProxyErrorCommon = {
    err: Error;
    req: IncomingMessage;
    context: string;
    target: URL;
};
declare type WebError = ProxyErrorCommon & {
    type: 'web';
    res: ServerResponse;
    next: (err?: unknown) => void;
};
declare type SocketError = ProxyErrorCommon & {
    type: 'socket';
    socket: Socket;
    head: Buffer;
};
declare type ProxyError = WebError | SocketError;
declare type ProxyErrorHandler = (error: ProxyError) => Error | void;
declare type ProxyOptions = Partial<ProxyHttpOptions> & {
    target: string;
    rewrite?: (path: string) => string;
    secure?: boolean;
    ws?: boolean;
    onError?: ProxyErrorHandler;
};
declare type ProxyPluginOptions = Record<string, string | ProxyOptions>;
declare const getMiddleware: (options: ProxyPluginOptions, defaultErrorHandler?: ProxyErrorHandler) => {
    proxyMiddleware: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
    webSocketHandler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};
declare const proxy: (options: ProxyPluginOptions) => Plugin;

export { ProxyError, ProxyErrorCommon, ProxyErrorHandler, ProxyOptions, ProxyPluginOptions, SocketError, WebError, getMiddleware, proxy };
