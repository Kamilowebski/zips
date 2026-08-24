import json
import os
import platform
import re
import shutil
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "devices.json"
CONFIG_FILE = ROOT / "config.json"
PORT = 5000
ADMIN_PASSWORD = os.environ.get("DEVICE_PANEL_PASSWORD", "admin123")

DEFAULT_CONFIG = {
    "areas": ["EXPORT", "MALA PACZKA", "ROZBIOR"],
    "types": ["terminal", "drukarka", "komputer", "bizerba", "maszyna", "inne"],
    "sshUser": "",
    "vncLocalPort": 5900,
    "vncRemotePort": 5900,
}

AREAS = {
    "104": "Starachowice",
}

TYPE_PREFIXES = {
    "T": "terminal",
    "P": "drukarka",
    "K": "komputer",
    "B": "bizerba",
}


def read_devices():
    if not DATA_FILE.exists():
        return []
    with DATA_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_devices(devices):
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(devices, file, ensure_ascii=False, indent=2)


def normalize_words(values):
    if isinstance(values, str):
        values = values.replace(";", ",").split(",")
    if not isinstance(values, list):
        values = []
    cleaned = []
    seen = set()
    for value in values:
        word = str(value).strip()
        key = word.lower()
        if word and key not in seen:
            cleaned.append(word)
            seen.add(key)
    return cleaned


def read_config():
    config = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        with CONFIG_FILE.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
        config.update({key: loaded.get(key, value) for key, value in DEFAULT_CONFIG.items()})

    devices = read_devices()
    config["areas"] = sorted(set(normalize_words(config["areas"]) + normalize_words([device.get("area", "") for device in devices])))
    config["types"] = sorted(set(normalize_words(config["types"]) + normalize_words([device.get("type", "") for device in devices])))
    return config


def parse_port(value, fallback):
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
    except (TypeError, ValueError):
        pass
    return fallback


def write_config(config):
    payload = {
        "areas": normalize_words(config.get("areas", [])),
        "types": normalize_words(config.get("types", [])),
        "sshUser": str(config.get("sshUser", "") or "").strip(),
        "vncLocalPort": parse_port(config.get("vncLocalPort"), DEFAULT_CONFIG["vncLocalPort"]),
        "vncRemotePort": parse_port(config.get("vncRemotePort"), DEFAULT_CONFIG["vncRemotePort"]),
    }
    with CONFIG_FILE.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    return payload


def enrich_device(device):
    device = dict(device)
    name = device.get("name", "").strip().upper()
    device["name"] = name
    match = re.match(r"^([A-Z])(\d{3})-(\d{4})$", name)
    if match:
        prefix, area_code, number = match.groups()
        device.setdefault("type", TYPE_PREFIXES.get(prefix, "inne"))
        device["areaCode"] = area_code
        device.setdefault("site", AREAS.get(area_code, f"Zaklad {area_code}"))
        device["number"] = number

    if "keywords" not in device or not isinstance(device["keywords"], list):
        device["keywords"] = normalize_words(device.get("keywords", ""))

    device.setdefault("type", "inne")
    device["ip"] = device.get("ip", "").strip()
    if not device.get("addressMode"):
        device["addressMode"] = "static" if device["type"] == "bizerba" else "dhcp"
    device.setdefault("area", "")
    device.setdefault("site", "")
    device.setdefault("note", "")

    if device["type"] == "bizerba":
        device["numerator"] = str(device.get("numerator", "") or "").strip()
    else:
        device.pop("numerator", None)

    return device


def require_password(handler, payload=None):
    password = handler.headers.get("X-Admin-Password", "")
    if payload and not password:
        password = payload.get("password", "")
    if password != ADMIN_PASSWORD:
        handler.send_json({"error": "Niepoprawne haslo administratora"}, status=403)
        return False
    return True


def find_device_by_name(name):
    wanted = name.strip().upper()
    for device in [enrich_device(item) for item in read_devices()]:
        if device.get("name") == wanted:
            return device
    return None


def ping_host(target):
    system = platform.system().lower()
    if system == "windows":
        command = ["ping", "-n", "1", "-w", "1000", target]
    else:
        command = ["ping", "-c", "1", "-W", "1", target]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3,
            encoding="utf-8",
            errors="replace",
        )
    except Exception as error:
        return {"online": False, "latencyMs": None, "error": str(error)}

    output = result.stdout + result.stderr
    latency = None
    latency_match = re.search(r"(?:time|czas)[=<]\s*(\d+)\s*ms", output, re.IGNORECASE)
    if latency_match:
        latency = int(latency_match.group(1))

    resolved_ip = None
    resolved_match = re.search(r"\[(\d{1,3}(?:\.\d{1,3}){3})\]", output)
    if not resolved_match:
        resolved_match = re.search(r"(?:Reply from|Odpowiedź z)\s+(\d{1,3}(?:\.\d{1,3}){3})", output, re.IGNORECASE)
    if resolved_match:
        resolved_ip = resolved_match.group(1)

    return {
        "online": result.returncode == 0,
        "latencyMs": latency,
        "target": target,
        "resolvedIp": resolved_ip,
        "raw": output[-800:],
    }


def device_ping_target(device):
    if device.get("addressMode") == "dhcp":
        return device.get("name")
    return device.get("ip") or device.get("name")


def build_ssh_target(device, ssh_user):
    host = device.get("name") if device.get("addressMode") == "dhcp" else (device.get("ip") or device.get("name"))
    ssh_user = (ssh_user or "").strip()
    return f"{ssh_user}@{host}" if ssh_user else host


def launch_ssh_tunnel(device, ssh_user, local_port, remote_port):
    ssh_path = shutil.which("ssh")
    if not ssh_path:
        return {
            "ok": False,
            "error": "Nie znaleziono polecenia 'ssh'. Zainstaluj klienta OpenSSH "
                     "(Windows: Ustawienia > Aplikacje > Opcjonalne funkcje > Dodaj funkcję > OpenSSH Client).",
        }

    target = build_ssh_target(device, ssh_user)
    forward = f"{local_port}:127.0.0.1:{remote_port}"
    command = [ssh_path, "-L", forward, target]
    system = platform.system().lower()

    try:
        if system == "windows":
            creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            subprocess.Popen(command, creationflags=creationflags)
        elif system == "darwin":
            script = f'tell application "Terminal" to do script "{" ".join(command)}"'
            subprocess.Popen(["osascript", "-e", script])
        else:
            terminal = None
            for candidate in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
                if shutil.which(candidate):
                    terminal = candidate
                    break
            if not terminal:
                return {"ok": False, "error": "Nie znaleziono terminala graficznego do uruchomienia SSH."}
            if terminal == "gnome-terminal":
                subprocess.Popen([terminal, "--", *command])
            else:
                subprocess.Popen([terminal, "-e", " ".join(command)])
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "target": target, "localPort": local_port, "remotePort": remote_port}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/devices":
            devices = [enrich_device(device) for device in read_devices()]
            self.send_json(devices)
            return

        if parsed.path == "/api/config":
            config = read_config()
            self.send_json({
                "areas": config["areas"],
                "types": config["types"],
                "siteCodes": AREAS,
                "sshUser": config.get("sshUser", ""),
                "vncLocalPort": config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]),
                "vncRemotePort": config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]),
            })
            return

        if parsed.path == "/api/ping":
            params = parse_qs(parsed.query)
            target = params.get("target", params.get("ip", [""]))[0].strip()
            if not target:
                self.send_json({"error": "Brak celu pingowania"}, status=400)
                return
            self.send_json(ping_host(target))
            return

        if parsed.path == "/api/ping-name":
            params = parse_qs(parsed.query)
            name = params.get("name", [""])[0].strip()
            if not name:
                self.send_json({"error": "Brak nazwy urzadzenia"}, status=400)
                return
            device = find_device_by_name(name)
            if not device:
                self.send_json({"error": "Nie znaleziono urzadzenia"}, status=404)
                return
            target = device_ping_target(device)
            result = ping_host(target)
            result["device"] = device
            self.send_json(result)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in ["/api/devices", "/api/config", "/api/ssh-tunnel"]:
            self.send_json({"error": "Nieznany endpoint"}, status=404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "Niepoprawny JSON"}, status=400)
            return

        if not require_password(self, payload):
            return

        if parsed.path == "/api/config":
            config = write_config(payload.get("config", payload))
            self.send_json({"ok": True, "config": config})
            return

        if parsed.path == "/api/ssh-tunnel":
            name = str(payload.get("name", "")).strip()
            if not name:
                self.send_json({"error": "Brak nazwy urzadzenia"}, status=400)
                return
            device = find_device_by_name(name)
            if not device:
                self.send_json({"error": "Nie znaleziono urzadzenia"}, status=404)
                return

            config = read_config()
            ssh_user = str(payload.get("sshUser") or config.get("sshUser") or "").strip()
            local_port = parse_port(payload.get("localPort"), config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]))
            remote_port = parse_port(payload.get("remotePort"), config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]))

            result = launch_ssh_tunnel(device, ssh_user, local_port, remote_port)
            if not result.get("ok"):
                self.send_json({"error": result.get("error", "Nie udalo sie uruchomic SSH")}, status=500)
                return

            message = (
                f"Uruchomiono SSH do {result['target']} w nowym oknie. "
                f"Wpisz haslo w tym oknie, a potem polacz sie VNC-em na localhost:{result['localPort']}."
            )
            self.send_json({"ok": True, "message": message, **result})
            return

        devices_payload = payload.get("devices", payload)
        if not isinstance(devices_payload, list):
            self.send_json({"error": "Lista urzadzen jest wymagana"}, status=400)
            return

        devices = [enrich_device(device) for device in devices_payload]
        seen_names = set()
        for device in devices:
            if not device.get("name"):
                self.send_json({"error": "Nazwa jest wymagana"}, status=400)
                return
            if device.get("addressMode") == "static" and not device.get("ip"):
                self.send_json({"error": f"Stale IP wymaga adresu: {device['name']}"}, status=400)
                return
            if device["name"] in seen_names:
                self.send_json({"error": f"Duplikat nazwy: {device['name']}"}, status=400)
                return
            seen_names.add(device["name"])

        write_devices(devices)
        self.send_json({"ok": True, "count": len(devices)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Panel urzadzen dziala: http://localhost:{PORT}")
    print("W sieci lokalnej uzyj adresu IP tego komputera i portu 5000.")
    server.serve_forever()
