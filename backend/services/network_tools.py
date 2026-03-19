"""
Network utility functions for the Tools tab.
"""
import asyncio
import json
import re
import socket
import subprocess
from typing import AsyncIterator


async def get_local_interfaces() -> list[dict]:
    """Return IPv4 addresses for all network interfaces."""
    try:
        proc = await asyncio.create_subprocess_exec(
            'ip', '-j', 'addr', 'show',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode == 0:
            data = json.loads(out.decode())
            result = []
            for iface in data:
                name = iface.get('ifname', '')
                for a in iface.get('addr_info', []):
                    if a.get('family') == 'inet':
                        result.append({
                            'interface': name,
                            'ip': a['local'],
                            'prefix': a.get('prefixlen', 24),
                            'broadcast': a.get('broadcast', ''),
                        })
            return result
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        return [{'interface': 'default', 'ip': ip, 'prefix': 24, 'broadcast': ''}]
    except Exception:
        return []


async def scan_network(subnet: str) -> list[dict]:
    """
    Ping-scan subnet using nmap -sn.
    Falls back to a simple ping sweep if nmap is unavailable.
    Returns list of {ip, hostname, mac}.
    """
    # Try nmap first
    if subprocess.run(['which', 'nmap'], capture_output=True).returncode == 0:
        try:
            proc = await asyncio.create_subprocess_exec(
                'nmap', '-sn', subnet, '--oG', '-',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=90)
            hosts = []
            for line in out.decode().splitlines():
                m = re.match(r'Host:\s+(\S+)\s+\(([^)]*)\)\s+Status:\s+Up', line)
                if m:
                    hosts.append({'ip': m.group(1), 'hostname': m.group(2) or '', 'mac': ''})
            return hosts
        except Exception:
            pass

    # Fallback: parse ARP table after a broadcast ping
    try:
        base = subnet.rsplit('/', 1)[0].rsplit('.', 1)[0]
        pings = [
            asyncio.create_subprocess_exec(
                'ping', '-c', '1', '-W', '1', f'{base}.{i}',
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            for i in range(1, 255)
        ]
        procs = await asyncio.gather(*pings)
        await asyncio.gather(*[p.wait() for p in procs])

        arp = await asyncio.create_subprocess_exec(
            'arp', '-n',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        arp_out, _ = await arp.communicate()
        hosts = []
        for line in arp_out.decode().splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 3 and parts[2] not in ('(incomplete)', ''):
                ip = parts[0]
                mac = parts[2]
                if ip.startswith(base + '.'):
                    hosts.append({'ip': ip, 'hostname': '', 'mac': mac})
        return hosts
    except Exception:
        return []


async def list_interfaces() -> list[str]:
    """Return interface names suitable for packet capture."""
    ifaces = await get_local_interfaces()
    seen = set()
    result = []
    for i in ifaces:
        name = i['interface']
        if name not in seen:
            seen.add(name)
            result.append(name)
    return result or ['eth0']


async def capture_packets(
    interface: str,
    filter_expr: str,
) -> AsyncIterator[dict]:
    """
    Yield parsed packet dicts from tcpdump.
    Requires tcpdump to be installed (may need sudo/capabilities).
    Each dict: {id, time, src, src_port, dst, dst_port, proto, length, info}
    Special error dict: {error: str}
    """
    cmd = [
        'tcpdump', '-i', interface,
        '-n', '-l', '-tttt',
        '-q',        # brief protocol info
    ]
    if filter_expr.strip():
        cmd += filter_expr.strip().split()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        yield {'error': 'tcpdump not found. Install it with: sudo apt install tcpdump'}
        return
    except Exception as e:
        yield {'error': f'Failed to start tcpdump: {e}'}
        return

    # tcpdump line format with -tttt -q:
    # 2024-01-01 12:00:00.123456 IP 192.168.1.1.80 > 192.168.1.2.54321: tcp 100
    PKT_RE = re.compile(
        r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+'
        r'(\S+)\s+'           # protocol keyword (IP, IP6, ARP, etc.)
        r'(\S+?)\s*>\s*(\S+):\s*'  # src > dst:
        r'(.+)$'
    )
    ARP_RE = re.compile(
        r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(ARP.*)$'
    )

    seq = 0
    stderr_task = asyncio.create_task(proc.stderr.read())
    try:
        while True:
            try:
                line_bytes = await asyncio.wait_for(proc.stdout.readline(), timeout=10.0)
            except asyncio.TimeoutError:
                # No data for 10 s — check if process is still alive
                if proc.returncode is not None:
                    break
                continue

            if not line_bytes:
                break
            line = line_bytes.decode('utf-8', errors='replace').strip()
            if not line:
                continue

            m = PKT_RE.match(line)
            if m:
                ts, proto, src, dst, info = m.groups()
                # Extract length from info if present (e.g. "tcp 100" or "UDP, length 100")
                length = ''
                lm = re.search(r'length\s+(\d+)', info) or re.search(r'\s(\d+)$', info)
                if lm:
                    length = lm.group(1)
                yield {
                    'id': seq, 'time': ts.split(' ', 1)[1],
                    'src': src.rsplit('.', 1)[0] if '.' in src else src,
                    'src_port': src.rsplit('.', 1)[1] if src.count('.') > 3 else '',
                    'dst': dst.rstrip(':').rsplit('.', 1)[0] if '.' in dst else dst.rstrip(':'),
                    'dst_port': dst.rstrip(':').rsplit('.', 1)[1] if dst.rstrip(':').count('.') > 3 else '',
                    'proto': proto,
                    'length': length,
                    'info': info[:120],
                }
                seq += 1
                continue

            m2 = ARP_RE.match(line)
            if m2:
                ts, info = m2.groups()
                yield {
                    'id': seq, 'time': ts.split(' ', 1)[1],
                    'src': '', 'src_port': '',
                    'dst': '', 'dst_port': '',
                    'proto': 'ARP', 'length': '',
                    'info': info[:120],
                }
                seq += 1

    except Exception:
        pass
    finally:
        stderr_task.cancel()
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except Exception:
            pass

    # If process exited with error, surface stderr
    if proc.returncode not in (None, 0):
        try:
            stderr_bytes = stderr_task.result() if not stderr_task.cancelled() else b''
        except Exception:
            stderr_bytes = b''
        err = stderr_bytes.decode('utf-8', errors='replace').strip()
        if err:
            yield {'error': err}
