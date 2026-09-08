/**
 * WebAssembly-free replacements for Node's fetch globals, for jitless runtimes.
 *
 * Apple forbids JIT in third-party apps, so nodejs-mobile runs V8 jitless on iOS and the
 * engine has no `WebAssembly` object at all. Node 18's `fetch`, `Request`, `Response`,
 * `Headers` and `FormData` are lazy getters onto undici, which compiles llhttp from WASM
 * the moment any one of them is *touched* — so the first outbound request, or the first
 * `Response` that @hono/node-server builds for an incoming one, would kill the process with
 * `ReferenceError: WebAssembly is not defined`.
 *
 * node-fetch implements the same surface directly on `node:http`/`node:https` with no WASM
 * anywhere, so it stands in for undici here. Where the two disagree is bodies: node-fetch
 * predates web streams and works in Node `Readable`s, while @hono/node-server expects the
 * spec's `ReadableStream`. See `asDualStream` for how both are kept happy.
 */

import { Readable } from 'node:stream';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const isWebStream = (v: Any): boolean => typeof v?.getReader === 'function';
const isNodeStream = (v: Any): boolean =>
  typeof v?.pipe === 'function' && typeof v?.on === 'function';

/** Web ReadableStream → Node Readable, so node-fetch can accept a spec body. */
function toNodeBody(body: Any): Any {
  return isWebStream(body) ? Readable.fromWeb(body) : body;
}

/**
 * Exposes one body object that both consumers accept.
 *
 * It has to stay the Node `Readable` node-fetch handed us, because node-fetch's own
 * `consumeBody` — which backs `.json()`, `.text()` and friends — silently returns an empty
 * buffer for anything that is not a Node `Stream`. Handing back a converted web stream is
 * what made `await c.req.json()` come back as `''`.
 *
 * So instead of converting, layer on the slice of the ReadableStream surface that
 * @hono/node-server actually uses when writing a response: `locked`, `getReader()` and
 * `cancel()`. The reader is a genuine web reader over the same stream, created only if
 * something asks for it.
 */
function asDualStream(body: Any): Any {
  if (!body || isWebStream(body) || !isNodeStream(body)) {
    return body;
  }
  Object.defineProperties(body, {
    locked: { get: () => false, configurable: true },
    getReader: { value: () => Readable.toWeb(body).getReader(), configurable: true },
    cancel: {
      value: (reason?: unknown) => {
        body.destroy(reason as Error);
        return Promise.resolve();
      },
      configurable: true,
    },
  });
  return body;
}

/** Adds the body translation to a node-fetch Request/Response class. */
function withWebStreamBody(Base: Any, bodyIsFirstArg: boolean): Any {
  const Ctor = Base as new (...args: Any[]) => Any;
  // `bodyIsFirstArg` is passed explicitly rather than sniffed from `Base.name`: esbuild
  // minifies these class names away, so any name check silently picks the wrong branch.
  const Wrapped = class extends Ctor {
    constructor(first: Any, init: Any) {
      if (bodyIsFirstArg) {
        super(toNodeBody(first), init);
      } else if (init && typeof init === 'object' && 'body' in init) {
        super(first, { ...init, body: toNodeBody(init.body) });
      } else {
        super(first, init);
      }
    }
    get body(): Any {
      // Equivalent to `super.body`, but node-fetch defines the getter on the Body mixin
      // rather than on Response itself, so walk the chain explicitly with `this` bound.
      return asDualStream(Reflect.get(Ctor.prototype, 'body', this));
    }
  };
  return Wrapped;
}

/**
 * Rebuilds `Response.json()` on top of `new this(...)`.
 *
 * node-fetch's static factories hardcode `new Response(...)` against node-fetch's own
 * class, so they return a raw node-fetch response and skip the body handling above —
 * which is exactly how Hono's `c.json()` ends up handing @hono/node-server a body it
 * cannot write. Constructing through `this` instead yields the real subclass: our wrapper
 * when called directly, and @hono/node-server's own cached Response through that.
 *
 * `Response.redirect()` and `Response.error()` need no equivalent: both produce a null
 * body, which never reaches the stream path.
 */
function patchJsonStatic(Wrapped: Any, HeadersImpl: Any): void {
  Object.defineProperty(Wrapped, 'json', {
    value: function (this: Any, data: unknown, init: Any = {}) {
      const body = JSON.stringify(data);
      if (body === undefined) {
        throw new TypeError('data is not JSON serializable');
      }
      const headers = new HeadersImpl(init?.headers);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      return new this(body, { ...init, headers });
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Installs the pure-JS fetch stack over the undici-backed globals. No-op on any runtime
 * that has WebAssembly (Android, desktop, CI), which keeps the fast built-in fetch there.
 *
 * Must run before anything that captures these globals is imported — note that
 * @hono/node-server reads `global.Request`/`global.Response` in its module body, so
 * src/ios.ts imports both it and the gateway dynamically, after calling this.
 */
export async function installJitlessFetch(): Promise<void> {
  if (typeof (globalThis as Any).WebAssembly !== 'undefined') return;

  const nodeFetch = await import('node-fetch');

  // Response takes its body as the first argument; Request takes it in `init`.
  const Request = withWebStreamBody(nodeFetch.Request as Any, false);
  const Response = withWebStreamBody(nodeFetch.Response as Any, true);
  patchJsonStatic(Response, nodeFetch.Headers);

  const replacements: Record<string, unknown> = {
    // node-fetch's default export is fetch itself; the classes are named exports.
    fetch: nodeFetch.default,
    Headers: nodeFetch.Headers,
    Request,
    Response,
    FormData: nodeFetch.FormData,
  };

  for (const [name, value] of Object.entries(replacements)) {
    if (!value) continue;
    // defineProperty rather than assignment: these globals are lazy accessors, and
    // assigning through them can invoke the getter we are trying to avoid.
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}
