import { IncomingMessage, ServerResponse } from 'http';
import { http1WebOptions, wsHttp1Options } from 'http2-proxy';
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
declare type ProxyOptions = Partial<ProxyHttpOptions> & {
    target: string;
    rewrite?: (path: string) => string;
    secure?: boolean;
    ws?: boolean;
};
declare type ProxyPluginOptions = Record<string, string | ProxyOptions>;
declare const getMiddleware: (options: ProxyPluginOptions) => {
    proxyMiddleware: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
    webSocketHandler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};
declare const proxy: (options: ProxyPluginOptions) => Plugin;

export { ProxyOptions, ProxyPluginOptions, getMiddleware, proxy };
