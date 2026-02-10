#!/usr/bin/env python3
"""Rotating IPv6 HTTP/HTTPS proxy.

Listens on IPv4, exits through a random IPv6 from the configured /64 subnet
on each new connection. Falls back to IPv4 if the target has no AAAA record.

Usage:
    PROXY_PORT=9595 IPV6_PREFIX=2a13:4ac0:20:16 python3 ipv6_rotate_proxy.py

Then configure clients:
    export HTTPS_PROXY=http://127.0.0.1:9595
    export HTTP_PROXY=http://127.0.0.1:9595
"""

import asyncio
import logging
import os
import random
import socket

LISTEN = os.getenv('PROXY_LISTEN', '127.0.0.1')
PORT = int(os.getenv('PROXY_PORT', '9595'))
IPV6_PREFIX = os.getenv('IPV6_PREFIX', '2a13:4ac0:20:16')
BUFFER = 65536
LOG_LEVEL = os.getenv('PROXY_LOG_LEVEL', 'INFO').upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='[%(asctime)s] %(levelname)s %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('ipv6proxy')


def rand_ipv6():
    """Generate a random IPv6 address within the /64 subnet."""
    b = random.getrandbits(64)
    return (
        f'{IPV6_PREFIX}:'
        f'{(b >> 48) & 0xFFFF:04x}:'
        f'{(b >> 32) & 0xFFFF:04x}:'
        f'{(b >> 16) & 0xFFFF:04x}:'
        f'{b & 0xFFFF:04x}'
    )


async def relay(reader, writer):
    """Pipe data from reader to writer until EOF."""
    try:
        while True:
            data = await reader.read(BUFFER)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, OSError, asyncio.CancelledError):
        pass
    finally:
        try:
            if not writer.is_closing():
                writer.close()
        except Exception:
            pass


async def connect_v6(host, port):
    """Connect to target via IPv6, binding to a random source address."""
    loop = asyncio.get_event_loop()
    infos = await loop.getaddrinfo(
        host, port, family=socket.AF_INET6, type=socket.SOCK_STREAM,
    )
    if not infos:
        raise OSError(f'No AAAA record for {host}')

    last_err = None
    for family, stype, proto, _, sockaddr in infos:
        ipv6 = rand_ipv6()
        sock = socket.socket(family, stype, proto)
        sock.setblocking(False)
        try:
            sock.bind((ipv6, 0, 0, 0))
            await asyncio.wait_for(loop.sock_connect(sock, sockaddr), timeout=10)
            reader, writer = await asyncio.open_connection(sock=sock)
            return reader, writer, ipv6
        except Exception as exc:
            sock.close()
            last_err = exc
    raise last_err or OSError('IPv6 connect failed')


async def connect_v4(host, port):
    """Fallback: connect via IPv4 directly."""
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(host, port), timeout=10,
    )
    return reader, writer, 'IPv4-direct'


async def open_remote(host, port):
    """Try IPv6 first, fallback to IPv4."""
    try:
        return await connect_v6(host, port)
    except Exception:
        return await connect_v4(host, port)


async def handle_connect(client_r, client_w, host, port):
    """Handle HTTPS CONNECT tunnel."""
    try:
        remote_r, remote_w, via = await open_remote(host, port)
    except Exception as exc:
        log.warning('CONNECT %s:%d FAIL: %s', host, port, exc)
        client_w.write(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
        await client_w.drain()
        return

    log.info('CONNECT %s:%d via %s', host, port, via)
    client_w.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
    await client_w.drain()

    t1 = asyncio.create_task(relay(client_r, remote_w))
    t2 = asyncio.create_task(relay(remote_r, client_w))
    await asyncio.gather(t1, t2, return_exceptions=True)


async def handle_http(client_r, client_w, method, url, version, header_lines):
    """Handle plain HTTP proxy request (non-CONNECT)."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or 80
    path = parsed.path or '/'
    if parsed.query:
        path += '?' + parsed.query

    try:
        remote_r, remote_w, via = await open_remote(host, port)
    except Exception as exc:
        log.warning('%s %s FAIL: %s', method, url[:80], exc)
        client_w.write(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
        await client_w.drain()
        return

    log.info('%s %s via %s', method, url[:80], via)

    # Reconstruct request with relative path (strip scheme+host)
    req = f'{method} {path} {version}\r\n'
    for h in header_lines:
        low = h.lower()
        if low.startswith('proxy-connection') or low.startswith('proxy-auth'):
            continue
        req += h + '\r\n'
    req += '\r\n'
    remote_w.write(req.encode('utf-8', errors='replace'))
    await remote_w.drain()

    t1 = asyncio.create_task(relay(client_r, remote_w))
    t2 = asyncio.create_task(relay(remote_r, client_w))
    await asyncio.gather(t1, t2, return_exceptions=True)


async def handle_client(reader, writer):
    """Dispatch incoming proxy request."""
    try:
        first_line = await asyncio.wait_for(reader.readline(), timeout=30)
        if not first_line:
            return
        line = first_line.decode('utf-8', errors='replace').strip()
        parts = line.split()
        if len(parts) < 3:
            return

        method = parts[0].upper()
        target = parts[1]
        version = parts[2]

        # Read headers
        header_lines = []
        while True:
            h = await asyncio.wait_for(reader.readline(), timeout=10)
            if not h or h in (b'\r\n', b'\n'):
                break
            header_lines.append(h.decode('utf-8', errors='replace').rstrip('\r\n'))

        if method == 'CONNECT':
            if ':' in target:
                host, port_s = target.rsplit(':', 1)
                port = int(port_s)
            else:
                host, port = target, 443
            await handle_connect(reader, writer, host, port)
        else:
            await handle_http(reader, writer, method, target, version, header_lines)

    except (asyncio.TimeoutError, ConnectionResetError, BrokenPipeError):
        pass
    except Exception as exc:
        log.warning('Handler error: %s', exc)
    finally:
        try:
            if not writer.is_closing():
                writer.close()
        except Exception:
            pass


async def main():
    server = await asyncio.start_server(handle_client, LISTEN, PORT)
    log.info(
        'IPv6 rotating proxy listening on %s:%d (prefix %s::/64)',
        LISTEN, PORT, IPV6_PREFIX,
    )
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
