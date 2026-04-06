"""
Network utility functions for the Tools tab.
"""
import asyncio
import json
import re
import socket
import subprocess


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
